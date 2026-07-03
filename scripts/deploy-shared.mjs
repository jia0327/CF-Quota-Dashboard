import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const KV_TITLE = 'CF-Quota-Dashboard';
export const WRANGLER_CONFIG = join(ROOT, 'wrangler.toml');
export const WORKER_READY_ATTEMPTS = 15;
export const WORKER_READY_INTERVAL_MS = 3000;
export const POST_DEPLOY_SETTLE_MS = 5000;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeWorkerUrl(workerUrl) {
  return workerUrl.replace(/\/+$/, '');
}

export function patchWranglerToml(kvId) {
  if (!existsSync(WRANGLER_CONFIG)) {
    throw new Error('wrangler.toml not found');
  }
  const content = readFileSync(WRANGLER_CONFIG, 'utf8');
  const updated = content.replace(/(^\s*id\s*=\s*")[^"]*(")/m, `$1${kvId}$2`);
  if (updated !== content) {
    writeFileSync(WRANGLER_CONFIG, updated, 'utf8');
    console.log(`  Patched wrangler.toml → KV id ${kvId}`);
  }
}

async function cfApi(token, path, options = {}) {
  const resp = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, errors: [{ message: text || `HTTP ${resp.status}` }] };
  }
  if (!resp.ok || !data.success) {
    const err = data.errors?.[0]?.message || `HTTP ${resp.status}`;
    throw new Error(err);
  }
  return data.result;
}

/** List → find by title → create if missing (same logic as quick-deploy). */
export async function resolveKvViaApi(token, accountId, title = KV_TITLE) {
  console.log(`  Resolving KV namespace "${title}"…`);
  const list = await cfApi(
    token,
    `/accounts/${accountId}/storage/kv/namespaces?per_page=100`,
  );
  const matches = (list ?? []).filter((ns) => ns.title === title);

  if (matches.length > 1) {
    throw new Error(
      `Multiple KV namespaces titled "${title}": ${matches.map((ns) => ns.id).join(', ')}`,
    );
  }
  if (matches.length === 1) {
    console.log(`  Using existing KV: ${matches[0].id}`);
    return matches[0].id;
  }

  console.log('  Creating KV namespace…');
  const created = await cfApi(token, `/accounts/${accountId}/storage/kv/namespaces`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  console.log(`  Created KV: ${created.id}`);
  return created.id;
}

export function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function extractWorkerUrl(deployOutput) {
  const text = stripAnsi(deployOutput);
  const httpsMatch = text.match(/https:\/\/[^\s"'<>]+\.workers\.dev[^\s"'<>]*/);
  if (httpsMatch) return httpsMatch[0].replace(/[)\],.]$/, '');

  const bareMatch = text.match(
    /(?:^|\s)([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\.workers\.dev)/im,
  );
  if (bareMatch) return `https://${bareMatch[1]}`;
  return null;
}

export async function resolveWorkerUrl(token, accountId, workerName, deployOutput) {
  const fromDeploy = extractWorkerUrl(deployOutput);
  if (fromDeploy) return fromDeploy;

  const subdomain = await cfApi(token, `/accounts/${accountId}/workers/subdomain`);
  if (subdomain?.subdomain) {
    return `https://${workerName}.${subdomain.subdomain}.workers.dev`;
  }
  return null;
}

export async function fetchAccountName(token, accountId) {
  const account = await cfApi(token, `/accounts/${accountId}`);
  return account?.name?.trim() || accountId;
}

export async function waitForWorkerReady(workerUrl) {
  const url = normalizeWorkerUrl(workerUrl);
  console.log(`  Waiting ${POST_DEPLOY_SETTLE_MS / 1000}s for Worker to propagate…`);
  await sleep(POST_DEPLOY_SETTLE_MS);

  for (let attempt = 1; attempt <= WORKER_READY_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${url}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '__deploy_probe__' }),
      });
      if (resp.status !== 404 && resp.status !== 503) {
        return true;
      }
    } catch {
      // still propagating
    }
    if (attempt < WORKER_READY_ATTEMPTS) {
      console.log(`  Worker not ready (${attempt}/${WORKER_READY_ATTEMPTS}), retrying…`);
      await sleep(WORKER_READY_INTERVAL_MS);
    }
  }
  return false;
}

function parseSessionCookieFromResponse(resp) {
  const collected = [];
  if (typeof resp.headers.getSetCookie === 'function') {
    collected.push(...resp.headers.getSetCookie());
  }
  const single = resp.headers.get('set-cookie');
  if (single) {
    for (const part of single.split(/,(?=\s*cfqd_session=)/)) {
      collected.push(part.trim());
    }
  }
  for (const cookie of collected) {
    const match = cookie.match(/cfqd_session=([^;\s]+)/);
    if (match?.[1]) return `cfqd_session=${match[1]}`;
  }
  return null;
}

async function workerApiLogin(workerUrl, password, maxAttempts = 8) {
  let lastError = 'Login failed';
  const url = normalizeWorkerUrl(workerUrl);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`${url}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await resp.json().catch(() => ({}));

    if (resp.ok) {
      const cookie = parseSessionCookieFromResponse(resp);
      if (cookie) return cookie;
      lastError = 'No session cookie in login response';
    } else {
      lastError = data.error || `HTTP ${resp.status}`;
      if ([401, 503, 404].includes(resp.status) && attempt < maxAttempts) {
        console.log(`  Login attempt ${attempt}/${maxAttempts} failed (${lastError}), retrying…`);
        await sleep(3000);
        continue;
      }
      throw new Error(lastError);
    }

    if (attempt < maxAttempts) {
      await sleep(3000);
    }
  }
  throw new Error(lastError);
}

async function workerApiFetch(workerUrl, path, cookie, options = {}) {
  const url = normalizeWorkerUrl(workerUrl);
  const resp = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...(options.headers ?? {}),
    },
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

/** Add deploy account as default monitored account (mirrors quick-deploy step 8). */
export async function setupDefaultAccount({
  workerUrl,
  adminPassword,
  apiToken,
  accountId,
  accountName,
}) {
  if (!apiToken?.trim()) {
    console.log('  No API token — skip auto-add (add account in /admin later)');
    return false;
  }

  const ready = await waitForWorkerReady(workerUrl);
  if (!ready) {
    console.error('  Worker not ready — skip auto-add');
    return false;
  }

  const url = normalizeWorkerUrl(workerUrl);
  const displayFallback = accountName?.trim() || accountId;

  try {
    const cookie = await workerApiLogin(url, adminPassword);

    const existing = await workerApiFetch(url, '/api/accounts', cookie);
    if (!existing.resp.ok) {
      throw new Error(existing.data.error || `HTTP ${existing.resp.status}`);
    }

    const alreadyConfigured = Array.isArray(existing.data)
      ? existing.data.some((a) => a.accountId === accountId)
      : false;

    if (alreadyConfigured) {
      console.log(`  Monitored account already exists: ${displayFallback} (${accountId})`);
      await workerApiFetch(url, '/cron/fetch', cookie, { method: 'POST' });
      return true;
    }

    const verify = await workerApiFetch(url, '/api/accounts/verify', cookie, {
      method: 'POST',
      body: JSON.stringify({ accountId, apiToken }),
    });
    if (!verify.resp.ok || !verify.data.ok) {
      throw new Error(verify.data.error || `HTTP ${verify.resp.status}`);
    }

    const displayName = verify.data.accountName?.trim() || displayFallback;
    const add = await workerApiFetch(url, '/api/accounts', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: displayName,
        accountId,
        apiToken,
        enabled: true,
      }),
    });
    if (!add.resp.ok) {
      throw new Error(add.data.error || `HTTP ${add.resp.status}`);
    }

    console.log(`  Added monitored account: ${displayName} (${accountId})`);
    await workerApiFetch(url, '/cron/fetch', cookie, { method: 'POST' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  Auto-add account failed: ${message}`);
    return false;
  }
}

export function getWorkerNameFromToml() {
  const content = readFileSync(WRANGLER_CONFIG, 'utf8');
  const match = content.match(/^name\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? 'cf-quota-dashboard';
}
