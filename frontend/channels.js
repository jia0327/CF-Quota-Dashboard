import { requirePageAuth, setupNavAuth, authFetch, parseJsonResponse } from './auth.js';
import { startRateLimitCountdown } from './rate-limit.js';

const API_BASE = window.location.origin;

const TYPE_INFO = {
  wecom: {
    iconClass: 'fab fa-weixin',
    colorClass: 'channel-icon--wecom',
    bgClass: 'channel-icon-bg--wecom',
    label: '企业微信',
    desc: '适合企业微信群机器人',
  },
  feishu: {
    iconClass: 'fas fa-paper-plane',
    colorClass: 'channel-icon--feishu',
    bgClass: 'channel-icon-bg--feishu',
    label: '飞书',
    desc: '适合飞书群机器人',
  },
  dingtalk: {
    iconClass: 'fas fa-comment-dots',
    colorClass: 'channel-icon--dingtalk',
    bgClass: 'channel-icon-bg--dingtalk',
    label: '钉钉',
    desc: '适合钉钉自定义机器人',
  },
  webhook: {
    iconClass: 'fas fa-link',
    colorClass: 'channel-icon--webhook',
    bgClass: 'channel-icon-bg--webhook',
    label: 'Webhook',
    desc: '推送到自定义 HTTP 接口',
  },
  telegram: {
    iconClass: 'fab fa-telegram',
    colorClass: 'channel-icon--telegram',
    bgClass: 'channel-icon-bg--telegram',
    label: 'Telegram',
    desc: '通过 Bot 推送到聊天',
    badge: '海外',
  },
  email: {
    iconClass: 'fas fa-envelope',
    colorClass: 'channel-icon--email',
    bgClass: 'channel-icon-bg--email',
    label: 'Email',
    desc: '通过邮件中继发送告警',
    badge: '海外',
  },
};

const CONFIG_FIELDS = {
  wecom: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'password', required: true, placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' },
  ],
  feishu: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'password', required: true, placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/...' },
  ],
  dingtalk: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'password', required: true, placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...' },
  ],
  webhook: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'password', required: true, placeholder: 'https://your-service.com/webhook' },
    { key: 'customHeaders', label: 'Custom Headers (JSON)', type: 'text', required: false, placeholder: '{"Authorization":"Bearer xxx"}' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...' },
    { key: 'chatId', label: 'Chat ID', type: 'text', required: true, placeholder: '-1001234567890' },
  ],
  email: [
    { key: 'to', label: '收件人邮箱', type: 'email', required: true, placeholder: 'alerts@example.com' },
    { key: 'webhookUrl', label: '邮件中继 Webhook URL', type: 'password', required: true, placeholder: 'https://api.resend.com/emails or custom relay' },
  ],
};

function getTypeInfo(type) {
  return TYPE_INFO[type] || {
    iconClass: 'fas fa-bell',
    colorClass: 'channel-icon--muted',
    bgClass: 'channel-icon-bg--muted',
    label: type || '未知渠道',
    desc: '自定义通知渠道',
  };
}

function renderChannelIcon(type, size = 'md') {
  const info = getTypeInfo(type);
  return `
    <span class="channel-icon channel-icon--${size} ${info.bgClass}" aria-hidden="true">
      <i class="${info.iconClass} ${info.colorClass}"></i>
    </span>
  `;
}

function renderTypeButtons() {
  const container = document.getElementById('type-buttons');
  if (!container) return;

  container.innerHTML = Object.entries(TYPE_INFO).map(([type, info]) => `
    <button type="button" data-type="${type}" class="type-btn">
      ${renderChannelIcon(type, 'sm')}
      <span class="type-btn__label">${info.label}</span>
      ${info.badge ? `<span class="type-btn__badge">${info.badge}</span>` : ''}
    </button>
  `).join('');

  container.querySelectorAll('.type-btn').forEach((btn) => {
    btn.addEventListener('click', () => showForm(btn.getAttribute('data-type')));
  });
}

function renderConfigFields(type, values = {}) {
  const container = document.getElementById('config-fields');
  const fields = CONFIG_FIELDS[type] || [];
  container.innerHTML = fields.map((f) => `
    <div class="form-group">
      <label class="form-label form-label--sm">${f.label}</label>
      <input
        name="config_${f.key}"
        type="${f.type}"
        ${f.required ? 'required' : ''}
        class="glass-input glass-input--mono"
        placeholder="${f.placeholder || ''}"
        value="${values[f.key] || ''}"
      />
    </div>
  `).join('');
}

function showForm(type, channel = null) {
  const section = document.getElementById('channel-form-section');
  const form = document.getElementById('channel-form');
  const title = document.getElementById('form-title');
  const panel = document.getElementById('channels-add-panel');
  const resolvedType = channel?.type || type;
  const info = getTypeInfo(resolvedType);

  section.classList.remove('hidden');
  form.reset();
  form.id.value = channel?.id || '';
  form.type.value = resolvedType;
  form.name.value = channel?.name || '';
  form.enabled.checked = channel ? channel.enabled : true;

  title.innerHTML = `
    <span class="channel-form-title">
      ${renderChannelIcon(resolvedType, 'sm')}
      <span>${channel ? `编辑渠道 · ${info.label}` : `新建渠道 · ${info.label}`}</span>
    </span>
  `;
  renderConfigFields(resolvedType, channel?.config || {});

  panel?.classList.add('channels-panel--highlight');
  window.setTimeout(() => panel?.classList.remove('channels-panel--highlight'), 1200);
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideForm() {
  document.getElementById('channel-form-section')?.classList.add('hidden');
}

function focusAddPanel() {
  hideForm();
  const panel = document.getElementById('channels-add-panel');
  panel?.classList.add('channels-panel--highlight');
  window.setTimeout(() => panel?.classList.remove('channels-panel--highlight'), 1200);
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function fetchChannels() {
  const resp = await fetch(`${API_BASE}/api/channels`);
  return resp.json();
}

function renderToggleSwitch(channel) {
  const onClass = channel.enabled ? ' toggle-switch--on' : '';
  const label = channel.enabled ? '禁用渠道' : '启用渠道';
  return `
    <button
      type="button"
      data-action="toggle"
      data-id="${channel.id}"
      class="toggle-switch${onClass}"
      aria-label="${label}"
      aria-pressed="${channel.enabled}"
      title="${label}"
    >
      <span class="toggle-switch__track" aria-hidden="true">
        <span class="toggle-switch__thumb"></span>
      </span>
    </button>
  `;
}

function renderChannelCard(channel) {
  const info = getTypeInfo(channel.type);
  const statusClass = channel.enabled ? 'channel-card__status--enabled' : 'channel-card__status--disabled';

  return `
    <article class="channel-card" data-id="${channel.id}" tabindex="0" role="button" aria-label="编辑 ${channel.name}">
      <div class="channel-card__main">
        ${renderChannelIcon(channel.type, 'sm')}
        <div class="channel-card__info">
          <div class="channel-card__title-row">
            <h3 class="channel-card__title">${channel.name}</h3>
            <span class="channel-card__status ${statusClass}">
              <span class="channel-card__status-dot" aria-hidden="true"></span>
              ${channel.enabled ? '已启用' : '已禁用'}
            </span>
          </div>
          <p class="channel-card__desc">${info.desc}</p>
        </div>
      </div>
      <div class="channel-card__actions">
        ${renderToggleSwitch(channel)}
        <button type="button" data-action="test" data-id="${channel.id}" class="btn btn-test-pill">测试</button>
        <button type="button" data-action="edit" data-id="${channel.id}" class="icon-btn icon-btn--sm" aria-label="编辑 ${channel.name}" title="编辑">
          <i class="fas fa-pen" aria-hidden="true"></i>
        </button>
        <button type="button" data-action="delete" data-id="${channel.id}" class="icon-btn icon-btn--sm icon-btn--danger" aria-label="删除 ${channel.name}" title="删除">
          <i class="fas fa-trash" aria-hidden="true"></i>
        </button>
      </div>
    </article>
  `;
}

function updateChannelCounts(channels) {
  const enabledEl = document.getElementById('enabled-count');
  const totalEl = document.getElementById('total-count');
  const enabled = channels.filter((c) => c.enabled).length;

  if (enabledEl) enabledEl.textContent = String(enabled);
  if (totalEl) totalEl.textContent = String(channels.length);
}

async function loadChannels(options = {}) {
  const { refreshBtn } = options;
  const list = document.getElementById('channels-list');

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.querySelector('i')?.classList.add('icon-btn--spin');
  }

  try {
    const channels = await fetchChannels();
    updateChannelCounts(channels);

    if (!channels.length) {
      list.innerHTML = `
        <div class="empty-state channels-list__empty">
          <div class="empty-state__icon"><i class="fas fa-bell-slash"></i></div>
          <p>尚未配置通知渠道</p>
          <p class="channels-panel__hint">从左侧选择渠道类型开始添加</p>
        </div>`;
      return;
    }

    list.innerHTML = channels.map(renderChannelCard).join('');
    bindChannelCardEvents(list);
  } catch {
    list.innerHTML = `
      <div class="empty-state channels-list__empty">
        <p>加载失败，请稍后重试</p>
      </div>`;
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.querySelector('i')?.classList.remove('icon-btn--spin');
    }
  }
}

function bindChannelCardEvents(list) {
  list.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAction(btn);
    });
  });

  list.querySelectorAll('.channel-card').forEach((card) => {
    const openEdit = async () => {
      const id = card.getAttribute('data-id');
      const channels = await fetchChannels();
      const channel = channels.find((c) => c.id === id);
      if (channel) showForm(channel.type, channel);
    };

    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openEdit();
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEdit();
      }
    });
  });
}

function renderAlertTestResults(container, channels) {
  if (!container) return;
  if (!channels?.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = channels.map((ch) => {
    const info = getTypeInfo(ch.channelType);
    const statusClass = ch.ok ? 'alert-test-result--ok' : 'alert-test-result--fail';
    const statusLabel = ch.ok ? '成功' : '失败';
    const errorLine = ch.error
      ? `<span class="alert-test-result__error">${ch.error}</span>`
      : '';
    return `
      <div class="alert-test-result ${statusClass}">
        <span><strong>${ch.channelName}</strong> · ${info.label}</span>
        <span class="chip ${ch.ok ? 'chip--success' : 'chip--danger'}">${statusLabel}</span>
        ${errorLine}
      </div>
    `;
  }).join('');
}

async function sendTestAlert(options = {}) {
  const { accountId, messageEl, resultsEl, buttonEl } = options;
  if (messageEl) {
    messageEl.textContent = '';
    messageEl.className = 'form-message channels-page-header__message';
  }
  if (resultsEl) {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
  }

  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.dataset.originalText = buttonEl.dataset.originalText || buttonEl.textContent.trim();
    buttonEl.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> 发送中…';
  }

  let rateLimited = false;
  try {
    const resp = await authFetch(`${API_BASE}/api/alerts/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(accountId ? { accountId } : {}),
    });
    const data = await parseJsonResponse(resp);

    if (resp.status === 429) {
      rateLimited = true;
      await startRateLimitCountdown({
        buttonEl,
        messageEl,
        retryAfterSeconds: data.retryAfterSeconds,
        buttonLabel: '发送测试告警',
      });
      return;
    }
    if (!resp.ok) throw new Error(data.error || '发送失败');

    if (messageEl) {
      messageEl.textContent = data.message || '测试告警已发送';
      messageEl.className = `form-message channels-page-header__message ${data.ok ? 'form-message--success' : 'form-message--error'}`;
    }
    renderAlertTestResults(resultsEl, data.channels);
  } catch (err) {
    if (messageEl) {
      messageEl.textContent = err.message || '发送失败';
      messageEl.className = 'form-message channels-page-header__message form-message--error';
    }
  } finally {
    if (buttonEl && !rateLimited) {
      buttonEl.disabled = false;
      buttonEl.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> 发送测试告警';
    }
  }
}

async function handleAction(btn) {
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');
  const channels = await fetchChannels();
  const channel = channels.find((c) => c.id === id);
  if (!channel) return;

  if (action === 'edit') {
    showForm(channel.type, channel);
    return;
  }

  if (action === 'delete') {
    if (!confirm(`删除渠道「${channel.name}」？`)) return;
    await authFetch(`${API_BASE}/api/channels/${id}`, { method: 'DELETE' });
    loadChannels();
    return;
  }

  if (action === 'toggle') {
    btn.disabled = true;
    try {
      await authFetch(`${API_BASE}/api/channels/${id}/toggle`, { method: 'PATCH' });
      await loadChannels();
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === 'test') {
    btn.disabled = true;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = '发送中…';
    let rateLimited = false;
    try {
      const resp = await authFetch(`${API_BASE}/api/channels/${id}/test`, { method: 'POST' });
      const data = await parseJsonResponse(resp);
      if (resp.status === 429) {
        rateLimited = true;
        await startRateLimitCountdown({
          buttonEl: btn,
          retryAfterSeconds: data.retryAfterSeconds,
          buttonLabel: '测试',
        });
        return;
      }
      if (!resp.ok) throw new Error(data.error || '测试失败');
      alert(data.message || '测试消息已发送');
    } catch (err) {
      alert(`测试失败: ${err.message}`);
    } finally {
      if (!rateLimited) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || '测试';
      }
    }
  }
}

function collectConfig(type, form) {
  const config = {};
  for (const field of CONFIG_FIELDS[type] || []) {
    const value = form[`config_${field.key}`]?.value?.trim();
    if (value) config[field.key] = value;
  }
  return config;
}

async function submitChannelForm(e) {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById('form-message');
  const id = form.id.value;
  const type = form.type.value;
  const payload = {
    type,
    name: form.name.value.trim(),
    enabled: form.enabled.checked,
    config: collectConfig(type, form),
  };

  try {
    const url = id ? `${API_BASE}/api/channels/${id}` : `${API_BASE}/api/channels`;
    const method = id ? 'PUT' : 'POST';
    const resp = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Save failed');

    if (msg) {
      msg.textContent = '保存成功';
      msg.className = 'form-message form-message--success';
    }
    hideForm();
    loadChannels();
  } catch (err) {
    if (msg) {
      msg.textContent = err.message;
      msg.className = 'form-message form-message--error';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const nav = document.getElementById('nav-auth');
  if (nav) setupNavAuth(nav);
  await requirePageAuth();

  renderTypeButtons();

  document.getElementById('cancel-form')?.addEventListener('click', hideForm);
  document.getElementById('channel-form')?.addEventListener('submit', submitChannelForm);

  document.getElementById('add-channel-btn')?.addEventListener('click', focusAddPanel);

  document.getElementById('refresh-channels-btn')?.addEventListener('click', () => {
    loadChannels({ refreshBtn: document.getElementById('refresh-channels-btn') });
  });

  document.getElementById('test-all-alerts-btn')?.addEventListener('click', () => {
    sendTestAlert({
      messageEl: document.getElementById('test-all-message'),
      resultsEl: document.getElementById('test-all-results'),
      buttonEl: document.getElementById('test-all-alerts-btn'),
    });
  });

  loadChannels();
});
