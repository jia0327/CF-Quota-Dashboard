import { sendToChannel } from './channels';
import {
  applyCooldownUpdates,
  filterAlertsByCooldown,
  resolveEnabledAlertRules,
} from './account-alerts';
import {
  getAlertCooldown,
  getChannels,
  saveAlertCooldown,
} from './kv-store';
import type {
  AccountConfig,
  AccountSnapshot,
  AlertItem,
  AlertMessage,
  Env,
  NotificationChannel,
  QuotaMetric,
  SendResult,
} from './types';

function formatUsed(metric: QuotaMetric): string {
  if (metric.unit === 'GB') return `${metric.used} GB`;
  if (metric.unit === 'bytes') return `${metric.used} B`;
  return String(metric.used);
}

function isR2Inactive(account: AccountSnapshot): boolean {
  return account.serviceStatus?.r2 === 'not_activated';
}

export function collectAlerts(
  snapshots: AccountSnapshot[],
  accountConfigs: AccountConfig[],
): AlertItem[] {
  const configByAccountId = new Map(accountConfigs.map((a) => [a.accountId, a]));
  const alerts: AlertItem[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.status !== 'ok') continue;

    const config = configByAccountId.get(snapshot.accountId);
    if (!config?.enabled) continue;

    const rules = resolveEnabledAlertRules(config);
    if (!rules.length) continue;

    for (const rule of rules) {
      if (rule.metricKey.startsWith('r2_') && isR2Inactive(snapshot)) continue;
      const metric = snapshot.quotas[rule.metricKey];
      if (!metric?.available) continue;
      if (metric.pct >= rule.thresholdPercent) {
        alerts.push({
          account: snapshot.accountName,
          accountId: snapshot.accountId,
          metricKey: rule.metricKey,
          metric,
          thresholdPercent: rule.thresholdPercent,
        });
      }
    }
  }

  alerts.sort((a, b) => b.metric.pct - a.metric.pct);
  return alerts;
}

export function buildAlertContent(alerts: AlertItem[]): AlertMessage | null {
  if (!alerts.length) return null;

  const lines = alerts.slice(0, 20).map(({ account, metric, thresholdPercent }) => {
    const used = formatUsed(metric);
    return `- **${account}** · ${metric.label}: ${used} (${metric.pct}% ≥ ${thresholdPercent}% of ${metric.limit} ${metric.unit}/${metric.period})`;
  });

  const plainLines = alerts.slice(0, 20).map(({ account, metric, thresholdPercent }) => {
    const used = formatUsed(metric);
    return `- ${account} · ${metric.label}: ${used} (${metric.pct}% ≥ ${thresholdPercent}% of ${metric.limit} ${metric.unit}/${metric.period})`;
  });

  const thresholds = [...new Set(alerts.map((a) => a.thresholdPercent))].sort((a, b) => a - b);
  const thresholdLabel =
    thresholds.length === 1
      ? `≥${thresholds[0]}%`
      : `≥${thresholds.join('%, ≥')}%`;

  const title = `CF Quota Alert (${thresholdLabel})`;
  const markdown = [
    `## ${title}`,
    '',
    ...lines,
    alerts.length > 20 ? `\n_...and ${alerts.length - 20} more_` : '',
    '',
    `_Updated: ${new Date().toISOString()}_`,
  ].join('\n');

  const content = [
    title,
    '',
    ...plainLines,
    alerts.length > 20 ? `\n...and ${alerts.length - 20} more` : '',
    '',
    `Updated: ${new Date().toISOString()}`,
  ].join('\n');

  return {
    title,
    content,
    markdown,
    alerts,
    threshold: thresholds[0],
  };
}

function legacyWebhookChannel(webhookUrl: string): NotificationChannel {
  return {
    id: 'legacy-webhook',
    type: 'wecom',
    name: 'Legacy WEBHOOK_URL',
    enabled: true,
    config: { webhookUrl },
  };
}

async function resolveChannels(env: Env): Promise<NotificationChannel[]> {
  const channels = await getChannels(env.KV);

  if (channels.length > 0) {
    return channels.filter((c) => c.enabled);
  }

  const legacyUrl = env.WEBHOOK_URL?.trim();
  if (legacyUrl) return [legacyWebhookChannel(legacyUrl)];

  return [];
}

export async function sendQuotaAlert(
  env: Env,
  snapshots: AccountSnapshot[],
  accountConfigs: AccountConfig[],
): Promise<boolean> {
  const allAlerts = collectAlerts(snapshots, accountConfigs);
  if (!allAlerts.length) return false;

  const cooldown = await getAlertCooldown(env.KV);
  const alerts = filterAlertsByCooldown(allAlerts, cooldown);
  const message = buildAlertContent(alerts);
  if (!message) return false;

  const channels = await resolveChannels(env);
  if (!channels.length) return false;

  const results = await Promise.all(
    channels.map((channel) => sendToChannel(channel, message)),
  );

  const sent = results.some((r) => r.ok);
  if (sent) {
    await saveAlertCooldown(env.KV, applyCooldownUpdates(cooldown, alerts));
  }

  return sent;
}

export interface ChannelTestOutcome {
  channelId: string;
  channelName: string;
  channelType: NotificationChannel['type'];
  ok: boolean;
  error?: string;
}

export function buildTestMessage(options?: { accountName?: string }): AlertMessage {
  const accountName = options?.accountName ?? '示例账号';
  const now = new Date().toISOString();
  const threshold = 80;
  const metric: QuotaMetric = {
    used: 85000,
    limit: 100000,
    pct: 85,
    unit: 'requests',
    period: 'daily',
    label: 'Workers Requests',
    available: true,
  };

  const sampleAlert: AlertItem = {
    account: accountName,
    accountId: 'test',
    metricKey: 'workers_requests',
    thresholdPercent: threshold,
    metric,
  };

  const used = formatUsed(metric);
  const plainLine = `- ${accountName} · ${metric.label}: ${used} (${metric.pct}% ≥ ${threshold}% of ${metric.limit} ${metric.unit}/${metric.period})`;
  const mdLine = `- **${accountName}** · ${metric.label}: ${used} (${metric.pct}% ≥ ${threshold}% of ${metric.limit} ${metric.unit}/${metric.period})`;

  const title = '【测试告警】CF 配额监控测试消息';
  const intro = '若收到此消息，说明通知通道配置正常。以下为模拟告警格式示例：';

  return {
    title,
    content: [title, '', intro, '', plainLine, '', `发送时间: ${now}`, '', '— 此为测试消息，请忽略 —'].join('\n'),
    markdown: [`## ${title}`, '', intro, '', mdLine, '', `_发送时间: ${now}_`, '', '_此为测试消息，请忽略_'].join('\n'),
    alerts: [sampleAlert],
    threshold,
  };
}

export async function sendTestNotification(
  channel: NotificationChannel,
  options?: { accountName?: string },
): Promise<SendResult> {
  return sendToChannel(channel, buildTestMessage(options));
}

export async function sendTestAlerts(
  env: Env,
  options?: { accountName?: string },
): Promise<{ channels: ChannelTestOutcome[]; sent: boolean }> {
  const channels = await resolveChannels(env);
  if (!channels.length) {
    return { channels: [], sent: false };
  }

  const message = buildTestMessage(options);
  const channels_result = await Promise.all(
    channels.map(async (channel) => {
      const result = await sendToChannel(channel, message);
      return {
        channelId: channel.id,
        channelName: channel.name,
        channelType: channel.type,
        ok: result.ok,
        error: result.error,
      };
    }),
  );

  return { channels: channels_result, sent: channels_result.some((r) => r.ok) };
}
