import type {
  AccountAlertRule,
  AccountConfig,
  AccountSnapshot,
  AlertCooldownState,
  DashboardConfig,
  Env,
  NotificationChannel,
  PublicAccount,
  PublicNotificationChannel,
  QuotaSnapshot,
} from './types';
import { normalizeAlertRules } from './account-alerts';
import {
  decryptField,
  encryptField,
  type EncryptionContext,
  hasEncryptionKey,
  isEncryptedValue,
} from './encryption';

export type KvStoreContext = EncryptionContext;

const ACCOUNTS_KEY = 'ACCOUNTS';
const SNAPSHOT_KEY = 'QUOTA_SNAPSHOT';
const CHANNELS_KEY = 'NOTIFICATION_CHANNELS';
const DASHBOARD_CONFIG_KEY = 'DASHBOARD_CONFIG';
const ALERT_COOLDOWN_KEY = 'ALERT_COOLDOWN';

export const ALLOWED_REFRESH_INTERVALS = [15, 20, 30, 60, 120, 360] as const;
export const DEFAULT_REFRESH_INTERVAL_MINUTES = 20;

const SENSITIVE_CONFIG_KEYS = new Set([
  'webhookUrl',
  'botToken',
  'chatId',
  'customHeaders',
]);

async function decryptAccount(account: AccountConfig, ctx?: KvStoreContext): Promise<AccountConfig> {
  return {
    ...account,
    apiToken: await decryptField(account.apiToken, ctx),
  };
}

async function encryptAccount(account: AccountConfig, ctx?: KvStoreContext): Promise<AccountConfig> {
  if (!ctx || !hasEncryptionKey(ctx)) return account;
  return {
    ...account,
    apiToken: await encryptField(account.apiToken, ctx),
  };
}

async function decryptChannel(channel: NotificationChannel, ctx?: KvStoreContext): Promise<NotificationChannel> {
  const config: Record<string, string> = { ...channel.config };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (config[key]) {
      config[key] = await decryptField(config[key], ctx);
    }
  }
  return { ...channel, config };
}

async function encryptChannel(channel: NotificationChannel, ctx?: KvStoreContext): Promise<NotificationChannel> {
  if (!ctx || !hasEncryptionKey(ctx)) return channel;
  const config: Record<string, string> = { ...channel.config };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (config[key]) {
      config[key] = await encryptField(config[key], ctx);
    }
  }
  return { ...channel, config };
}

export function accountNeedsEncryptionMigration(account: AccountConfig): boolean {
  return Boolean(account.apiToken && !isEncryptedValue(account.apiToken));
}

export function channelNeedsEncryptionMigration(channel: NotificationChannel): boolean {
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const value = channel.config[key];
    if (value && !isEncryptedValue(value)) return true;
  }
  return false;
}

export async function getAccounts(kv: KVNamespace, ctx?: KvStoreContext): Promise<AccountConfig[]> {
  const raw = await kv.get(ACCOUNTS_KEY, 'json');
  if (!raw || !Array.isArray(raw)) return [];
  const accounts = raw as AccountConfig[];
  return Promise.all(accounts.map((account) => decryptAccount(account, ctx)));
}

export async function saveAccounts(
  kv: KVNamespace,
  accounts: AccountConfig[],
  ctx?: KvStoreContext,
): Promise<void> {
  const stored = ctx && hasEncryptionKey(ctx)
    ? await Promise.all(accounts.map((account) => encryptAccount(account, ctx)))
    : accounts;
  await kv.put(ACCOUNTS_KEY, JSON.stringify(stored));
}

export function sortSnapshotsByAccountOrder(
  snapshots: AccountSnapshot[],
  accounts: AccountConfig[],
): AccountSnapshot[] {
  const byAccountId = new Map(snapshots.map((s) => [s.accountId, s]));
  const ordered: AccountSnapshot[] = [];
  for (const account of accounts) {
    const snap = byAccountId.get(account.accountId);
    if (snap) ordered.push(snap);
  }
  for (const snap of snapshots) {
    if (!ordered.includes(snap)) ordered.push(snap);
  }
  return ordered;
}

export async function reorderAccounts(
  kv: KVNamespace,
  accountIds: string[],
  ctx?: KvStoreContext,
): Promise<AccountConfig[] | null> {
  const accounts = await getAccounts(kv, ctx);
  if (accountIds.length !== accounts.length) return null;

  const idSet = new Set(accountIds);
  if (idSet.size !== accountIds.length) return null;
  for (const account of accounts) {
    if (!idSet.has(account.id)) return null;
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const reordered = accountIds.map((id) => byId.get(id)!);
  await saveAccounts(kv, reordered, ctx);
  return reordered;
}

type AccountUpdates = Partial<
  Pick<AccountConfig, 'name' | 'accountId' | 'apiToken' | 'enabled' | 'alertRules' | 'notificationChannelId'>
>;

export async function updateAccount(
  kv: KVNamespace,
  id: string,
  updates: AccountUpdates,
  defaultThreshold = 80,
  ctx?: KvStoreContext,
): Promise<AccountConfig | null> {
  const accounts = await getAccounts(kv, ctx);
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return null;

  const existing = accounts[index];
  let apiToken = existing.apiToken;
  if (updates.apiToken?.trim()) {
    const val = updates.apiToken.trim();
    const isMasked = val.includes('...');
    if (!isMasked) apiToken = val;
  }

  let alertRules: AccountAlertRule[] | undefined = existing.alertRules;
  if (updates.alertRules !== undefined) {
    const normalized = normalizeAlertRules(updates.alertRules, undefined, defaultThreshold);
    alertRules = normalized.length ? normalized : undefined;
  }

  let notificationChannelId = existing.notificationChannelId;
  if (updates.notificationChannelId !== undefined) {
    notificationChannelId = updates.notificationChannelId?.trim() || undefined;
  }

  accounts[index] = {
    ...existing,
    name: updates.name?.trim() || existing.name,
    accountId: updates.accountId?.trim() || existing.accountId,
    apiToken,
    enabled: updates.enabled ?? existing.enabled,
    notificationChannelId,
    alertRules,
    alerts: undefined,
  };
  await saveAccounts(kv, accounts, ctx);
  return accounts[index];
}

export async function getSnapshot(kv: KVNamespace): Promise<QuotaSnapshot | null> {
  const raw = await kv.get(SNAPSHOT_KEY, 'json');
  if (!raw || typeof raw !== 'object') return null;
  return raw as QuotaSnapshot;
}

export async function saveSnapshot(kv: KVNamespace, snapshot: QuotaSnapshot): Promise<void> {
  await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function maskAccount(
  account: AccountConfig,
  defaultThreshold = 80,
  channels?: NotificationChannel[],
): PublicAccount {
  const token = account.apiToken || '';
  const masked =
    token.length <= 8 ? '****' : `${token.slice(0, 4)}...${token.slice(-4)}`;
  const alertRules = normalizeAlertRules(account.alertRules, account.alerts, defaultThreshold);
  let notificationChannelId = account.notificationChannelId;
  let notificationChannelName: string | undefined;
  let notificationChannelInvalid = false;
  if (notificationChannelId && channels) {
    const channel = channels.find((c) => c.id === notificationChannelId);
    if (channel?.enabled) {
      notificationChannelName = channel.name;
    } else {
      notificationChannelInvalid = true;
      notificationChannelId = undefined;
    }
  }

  return {
    id: account.id,
    name: account.name,
    accountId: account.accountId,
    enabled: account.enabled,
    apiToken: masked,
    notificationChannelId,
    notificationChannelName,
    notificationChannelInvalid: notificationChannelInvalid || undefined,
    alertRules: alertRules.length ? alertRules : undefined,
  };
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function maskConfigValue(key: string, value: string): string {
  if (SENSITIVE_CONFIG_KEYS.has(key)) return maskSecret(value);
  return value;
}

export function maskChannel(channel: NotificationChannel): PublicNotificationChannel {
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(channel.config)) {
    config[key] = maskConfigValue(key, value);
  }
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    enabled: channel.enabled,
    config,
  };
}

export async function getChannels(kv: KVNamespace, ctx?: KvStoreContext): Promise<NotificationChannel[]> {
  const raw = await kv.get(CHANNELS_KEY, 'json');
  if (!raw || !Array.isArray(raw)) return [];
  const channels = raw as NotificationChannel[];
  return Promise.all(channels.map((channel) => decryptChannel(channel, ctx)));
}

export async function saveChannels(
  kv: KVNamespace,
  channels: NotificationChannel[],
  ctx?: KvStoreContext,
): Promise<void> {
  const stored = ctx && hasEncryptionKey(ctx)
    ? await Promise.all(channels.map((channel) => encryptChannel(channel, ctx)))
    : channels;
  await kv.put(CHANNELS_KEY, JSON.stringify(stored));
}

export async function addChannel(
  kv: KVNamespace,
  channel: NotificationChannel,
  ctx?: KvStoreContext,
): Promise<NotificationChannel> {
  const channels = await getChannels(kv, ctx);
  channels.push(channel);
  await saveChannels(kv, channels, ctx);
  return channel;
}

export async function updateChannel(
  kv: KVNamespace,
  id: string,
  updates: Partial<Pick<NotificationChannel, 'name' | 'enabled' | 'config'>>,
  ctx?: KvStoreContext,
): Promise<NotificationChannel | null> {
  const channels = await getChannels(kv, ctx);
  const index = channels.findIndex((c) => c.id === id);
  if (index === -1) return null;

  const existing = channels[index];
  const mergedConfig = { ...existing.config };
  if (updates.config) {
    for (const [key, value] of Object.entries(updates.config)) {
      if (!value) continue;
      const isMasked = value.includes('...') && SENSITIVE_CONFIG_KEYS.has(key);
      if (!isMasked) mergedConfig[key] = value;
    }
  }

  channels[index] = {
    ...existing,
    name: updates.name?.trim() || existing.name,
    enabled: updates.enabled ?? existing.enabled,
    config: mergedConfig,
  };
  await saveChannels(kv, channels, ctx);
  return channels[index];
}

export async function deleteChannel(kv: KVNamespace, id: string, ctx?: KvStoreContext): Promise<boolean> {
  const channels = await getChannels(kv, ctx);
  const next = channels.filter((c) => c.id !== id);
  if (next.length === channels.length) return false;
  await saveChannels(kv, next, ctx);

  const accounts = await getAccounts(kv, ctx);
  let accountsChanged = false;
  for (const account of accounts) {
    if (account.notificationChannelId === id) {
      account.notificationChannelId = undefined;
      accountsChanged = true;
    }
  }
  if (accountsChanged) await saveAccounts(kv, accounts, ctx);
  return true;
}

export async function toggleChannel(
  kv: KVNamespace,
  id: string,
  ctx?: KvStoreContext,
): Promise<NotificationChannel | null> {
  const channels = await getChannels(kv, ctx);
  const channel = channels.find((c) => c.id === id);
  if (!channel) return null;
  channel.enabled = !channel.enabled;
  await saveChannels(kv, channels, ctx);
  return channel;
}

export async function getChannelById(
  kv: KVNamespace,
  id: string,
  ctx?: KvStoreContext,
): Promise<NotificationChannel | null> {
  const channels = await getChannels(kv, ctx);
  return channels.find((c) => c.id === id) ?? null;
}

function normalizeRefreshIntervalMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed) && (ALLOWED_REFRESH_INTERVALS as readonly number[]).includes(parsed)) {
    return parsed;
  }
  return DEFAULT_REFRESH_INTERVAL_MINUTES;
}

export async function getDashboardConfig(kv: KVNamespace): Promise<DashboardConfig> {
  const raw = await kv.get(DASHBOARD_CONFIG_KEY, 'json');
  if (!raw || typeof raw !== 'object') {
    return { refreshIntervalMinutes: DEFAULT_REFRESH_INTERVAL_MINUTES };
  }
  const data = raw as Partial<DashboardConfig>;
  return {
    refreshIntervalMinutes: normalizeRefreshIntervalMinutes(data.refreshIntervalMinutes),
  };
}

export async function saveDashboardConfig(kv: KVNamespace, config: DashboardConfig): Promise<DashboardConfig> {
  const normalized: DashboardConfig = {
    refreshIntervalMinutes: normalizeRefreshIntervalMinutes(config.refreshIntervalMinutes),
  };
  await kv.put(DASHBOARD_CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function getAlertCooldown(kv: KVNamespace): Promise<AlertCooldownState> {
  const raw = await kv.get(ALERT_COOLDOWN_KEY, 'json');
  if (!raw || typeof raw !== 'object') return {};
  return raw as AlertCooldownState;
}

export async function saveAlertCooldown(kv: KVNamespace, state: AlertCooldownState): Promise<void> {
  await kv.put(ALERT_COOLDOWN_KEY, JSON.stringify(state));
}

const ALERT_TEST_COOLDOWN_PREFIX = 'alert-test:';
const ALERT_TEST_COOLDOWN_SECONDS = 10;
/** Cloudflare KV requires expirationTtl >= 60; rate limit window stays at 10s. */
const ALERT_TEST_KV_TTL_SECONDS = 60;

/** Acquire rate-limit slot before sending; writes timestamp immediately to reduce concurrent bypass. */
export async function acquireAlertTestRateLimit(
  kv: KVNamespace,
  key: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const kvKey = `${ALERT_TEST_COOLDOWN_PREFIX}${key}`;
  const last = await kv.get(kvKey);
  if (last) {
    const elapsed = Date.now() - parseInt(last, 10);
    const windowMs = ALERT_TEST_COOLDOWN_SECONDS * 1000;
    if (elapsed < windowMs) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((windowMs - elapsed) / 1000),
      };
    }
  }

  await kv.put(kvKey, String(Date.now()), {
    expirationTtl: ALERT_TEST_KV_TTL_SECONDS,
  });
  return { allowed: true };
}

const SNAPSHOT_REFRESH_LOCK_KEY = 'SNAPSHOT_REFRESH_LOCK';
const SNAPSHOT_REFRESH_COOLDOWN_SECONDS = 60;

export async function tryAcquireSnapshotRefreshLock(kv: KVNamespace): Promise<boolean> {
  const existing = await kv.get(SNAPSHOT_REFRESH_LOCK_KEY);
  if (existing) return false;
  await kv.put(SNAPSHOT_REFRESH_LOCK_KEY, String(Date.now()), {
    expirationTtl: SNAPSHOT_REFRESH_COOLDOWN_SECONDS,
  });
  return true;
}

export function kvStoreContext(env: Pick<Env, 'PASSWORD' | 'ENCRYPTION_KEY'>): KvStoreContext {
  return { PASSWORD: env.PASSWORD, ENCRYPTION_KEY: env.ENCRYPTION_KEY };
}
