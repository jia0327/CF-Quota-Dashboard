#!/usr/bin/env node
/**
 * Cross-platform one-click deploy for CF-Quota-Dashboard.
 * Run: npm run quick-deploy
 * Language: npm run quick-deploy -- --lang en  |  QUICK_DEPLOY_LANG=en
 *
 * Optional env (non-interactive):
 *   QUICK_DEPLOY_PASSWORD  — admin login code (required if no TTY)
 *   QUICK_DEPLOY_API_TOKEN   — Cloudflare API Token for quota fetch (optional; skip auto-add if unset)
 *   QUICK_DEPLOY_LANG        — zh | en
 *
 * Monitored-account API Token: after wrangler login the script tries POST
 * /client/v4/user/tokens to create a read-only token named cf-quota-dashboard.
 * Wrangler OAuth tokens lack "User API Tokens Write" and get HTTP 403 — see
 * docs/DEPLOY.md. Fallback: QUICK_DEPLOY_API_TOKEN env or interactive prompt.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const KV_TITLE = 'CF-Quota-Dashboard';
const WRANGLER_CONFIG = join(ROOT, 'wrangler.toml');

const isWin = process.platform === 'win32';
const TOTAL_STEPS = 9;
const WORKER_READY_ATTEMPTS = 15;
const WORKER_READY_INTERVAL_MS = 3000;
const POST_DEPLOY_SETTLE_MS = 5000;
const MONITORED_TOKEN_NAME = 'cf-quota-dashboard';
/** Read-only permission groups for the monitored account (Workers template + D1 Read). */
const MONITORED_TOKEN_PERMISSIONS = [
  'Account Analytics Read',
  'Account Settings Read',
  'D1 Read',
  'Workers Scripts Read',
  'Workers KV Storage Read',
  'Workers R2 Storage Read',
  'Cloudflare Pages Read',
  'Queues Read',
  'Hyperdrive Read',
  'Vectorize Read',
];

const i18n = {
  zh: {
    title: 'CF-Quota-Dashboard — 一键部署',
    langPrompt: 'Language / 语言 [zh/en] (default: zh): ',
    invalidLang: (code) => `无效语言 "${code}"，请使用 zh 或 en。`,
    runLabel: '执行',
    step1: '检查 Node.js 与 npm…',
    cmdNotInstalled: (cmd) =>
      `\n未安装 ${cmd}。请从 https://nodejs.org/ 安装 Node.js 18+。`,
    step2: '安装依赖（如需要）…',
    modulesPresent: '  已存在 node_modules — 跳过 npm install',
    step3: 'Cloudflare 登录 — 若弹出浏览器请完成授权',
    wranglerLoginHint: '  （若已登录，wrangler 会很快确认。）',
    step4: (title) => `KV 命名空间 "${title}"…`,
    kvAlreadyConfigured: (id) => `  已找到 KV 命名空间: ${id}`,
    kvListing: '  正在查找 KV 命名空间…',
    kvCreating: '  正在创建 KV 命名空间…',
    kvCreated: (id) => `  已创建 KV 命名空间: ${id}`,
    kvUsingExisting: (id) => `  使用已有 KV 命名空间: ${id}`,
    kvMayExist: '  命名空间可能已存在 — 正在列出命名空间…',
    kvListFailed: '\n无法列出 KV 命名空间。请手动运行：',
    kvListFailedHint: '  npx wrangler kv namespace list',
    kvUnexpectedList: '\n列表输出异常。请运行: npx wrangler kv namespace list',
    kvMultiple: (title) =>
      `\n存在多个标题为 "${title}" 的 KV 命名空间。请选择一个 id 并写入 wrangler.toml：`,
    kvNotFound: (title) => `\n未找到 KV 命名空间 "${title}"。请手动创建：`,
    kvCreateManual: (title) => `  npx wrangler kv namespace create "${title}"`,
    kvPatched: (file) => `  已更新 ${file}`,
    passwordStepTitle: '管理员登录码（PASSWORD）— 稍后自动上传',
    passwordHint: '  请输入强密码 — 用于 /admin 登录。',
    passwordNoEchoHint: '  输入时屏幕不显示字符，属正常现象，输完按 Enter。',
    passwordPrompt: '  请输入管理员登录码: ',
    passwordEmpty: '\n登录码不能为空。',
    passwordNoTty:
      '\n非交互终端请设置环境变量 QUICK_DEPLOY_PASSWORD（见 docs/DEPLOY.md）。',
    apiTokenStepTitle: 'Cloudflare API Token — 稍后自动添加监控账号',
    step5: '正在部署 Worker…',
    step6: '正在上传 PASSWORD secret…',
    step7: '等待 Worker 部署生效…',
    step8: '添加默认监控账号…',
    step9: '完成！',
    deployFailed: '\n部署失败。',
    apiTokenHint:
      '  输入该 Cloudflare 账号的 API Token（用于拉取额度，可与部署 Token 相同）。',
    apiTokenPermissionsHint:
      '  创建 Token（详见 docs/DEPLOY.md）：\n' +
      '  1. https://dash.cloudflare.com/profile/api-tokens\n' +
      '  2. 使用模板 Edit Cloudflare Workers\n' +
      '  3. 令牌名称建议 cf-quota-dashboard\n' +
      '  4. 增加权限 Account → D1 → Read\n' +
      '  5. 将其余权限全部改为 Read\n' +
      '  6. 创建并复制 Token（Enter 跳过）',
    apiTokenSkipHint: '  输入时屏幕不显示字符；直接按 Enter 跳过此步。',
    apiTokenPrompt: '  API Token: ',
    apiTokenFromEnv: '  使用环境变量中的 API Token（QUICK_DEPLOY_API_TOKEN 或 CLOUDFLARE_API_TOKEN）',
    apiTokenAutoCreateTrying:
      '  正在尝试通过 Cloudflare API 自动创建只读 Token（cf-quota-dashboard）…',
    apiTokenAutoCreated: '  已自动创建只读 API Token，将用于添加监控账号。',
    apiTokenAutoCreateFailed: (err) =>
      `  无法自动创建 Token: ${err}（wrangler OAuth 不含 User API Tokens Write 权限）`,
    apiTokenAutoCreateNoAuth: '  未找到 wrangler 凭据 — 跳过自动创建。',
    apiTokenAutoCreateMissingGroups:
      '  无法解析 Token 权限组 — 跳过自动创建（需要 User API Tokens Read/Write）。',
    apiTokenSkippedNoTty:
      '  非交互终端未设置 QUICK_DEPLOY_API_TOKEN / CLOUDFLARE_API_TOKEN — 跳过自动添加账号。',
    apiTokenSkipped: '  已跳过 — 请稍后在 /admin 手动添加被监控账号。',
    apiTokenSkippedWarning:
      '  ⚠ 未提供 API Token — 无法自动添加监控账号，仪表盘将显示「暂无配额数据」。',
    whoamiFailed: '  无法读取 wrangler whoami — 跳过自动添加账号。',
    workerUrlResolved: (url) => `  Worker 地址: ${url}`,
    workerUrlFailed:
      '  无法确定 Worker URL（部署输出未含 workers.dev 地址，且 subdomain 查询失败）。',
    workerWaiting: (attempt, max) => `  Worker 尚未就绪，等待中 (${attempt}/${max})…`,
    workerNotReady: '  Worker 在超时时间内未就绪 — 跳过自动添加账号。',
    postDeploySettle: (seconds) => `部署已完成，等待 ${seconds} 秒让 Worker 生效…`,
    multipleAccountsHint: (n) =>
      `  wrangler 关联 ${n} 个账号，使用第一个（可设 CLOUDFLARE_ACCOUNT_ID 指定）。`,
    accountVerifyFailed: (err) => `  Token 校验失败: ${err}`,
    accountAddFailed: (err) => `  添加账号失败: ${err}`,
    accountAdded: (name, id) => `  已添加监控账号: ${name} (${id})`,
    accountRefreshing: '  正在拉取配额数据…',
    accountRefreshDone: (n) => `  配额刷新完成（${n} 个账号）`,
    accountRefreshFailed: (err) => `  配额刷新失败: ${err}（首次打开仪表盘时会自动拉取）`,
    accountRefreshSkipped: '  配额将在首次访问仪表盘时自动拉取。',
    accountAlreadyExists: (name, id) => `  监控账号已存在: ${name} (${id})`,
    setupStepFailed: (reason) => `  自动添加账号失败: ${reason}`,
    setupStepSuccess: '  默认监控账号配置完成。',
    successBanner: '  CF-Quota-Dashboard 部署成功！',
    successDashboard: '  仪表盘',
    successAdmin: '  管理面板',
    successNextAdded: '  默认账号已配置，打开仪表盘即可查看配额。',
    successNextManual: '  下一步：打开 /admin，使用 PASSWORD 登录并添加被监控账号。',
    commandFailed: (status, cmd, args) =>
      `\n命令失败 (exit ${status}): ${cmd} ${args.join(' ')}`,
  },
  en: {
    title: 'CF-Quota-Dashboard — quick deploy',
    langPrompt: 'Language / 语言 [zh/en] (default: zh): ',
    invalidLang: (code) => `Invalid language "${code}". Use zh or en.`,
    runLabel: 'RUN',
    step1: 'Checking Node.js and npm…',
    cmdNotInstalled: (cmd) =>
      `\n${cmd} is not installed. Install Node.js 18+ from https://nodejs.org/`,
    step2: 'Installing dependencies (if needed)…',
    modulesPresent: '  node_modules present — skipping npm install',
    step3: 'Cloudflare login — complete the browser prompt if it opens',
    wranglerLoginHint: '  (If already logged in, wrangler will confirm quickly.)',
    step4: (title) => `KV namespace "${title}"…`,
    kvAlreadyConfigured: (id) => `  Found KV namespace: ${id}`,
    kvListing: '  Looking up KV namespaces…',
    kvCreating: '  Creating KV namespace…',
    kvCreated: (id) => `  Created KV namespace: ${id}`,
    kvUsingExisting: (id) => `  Using existing KV namespace: ${id}`,
    kvMayExist: '  Namespace may already exist — listing namespaces…',
    kvListFailed: '\nFailed to list KV namespaces. Run manually:',
    kvListFailedHint: '  npx wrangler kv namespace list',
    kvUnexpectedList: '\nUnexpected list output. Run: npx wrangler kv namespace list',
    kvMultiple: (title) =>
      `\nMultiple KV namespaces titled "${title}". Pick one id and set wrangler.toml:`,
    kvNotFound: (title) => `\nKV namespace "${title}" not found. Create it manually:`,
    kvCreateManual: (title) => `  npx wrangler kv namespace create "${title}"`,
    kvPatched: (file) => `  Patched ${file}`,
    passwordStepTitle: 'Admin login code (PASSWORD) — uploaded automatically later',
    passwordHint: '  Enter a strong password — used for /admin login.',
    passwordNoEchoHint:
      '  Characters will not appear as you type — this is normal. Press Enter when done.',
    passwordPrompt: '  Enter admin login code: ',
    passwordEmpty: '\nLogin code cannot be empty.',
    passwordNoTty:
      '\nNon-interactive terminal: set QUICK_DEPLOY_PASSWORD (see docs/DEPLOY.md).',
    apiTokenStepTitle: 'Cloudflare API Token — auto-add monitored account later',
    step5: 'Deploying Worker…',
    step6: 'Uploading PASSWORD secret…',
    step7: 'Waiting for Worker to become ready…',
    step8: 'Adding default monitored account…',
    step9: 'Done!',
    deployFailed: '\nDeploy failed.',
    apiTokenHint:
      '  Enter the Cloudflare API Token for this account (quota fetch; may match your deploy token).',
    apiTokenPermissionsHint:
      '  Create token (see docs/DEPLOY.md):\n' +
      '  1. https://dash.cloudflare.com/profile/api-tokens\n' +
      '  2. Use template Edit Cloudflare Workers\n' +
      '  3. Name it cf-quota-dashboard\n' +
      '  4. Add Account → D1 → Read\n' +
      '  5. Change all other permissions to Read\n' +
      '  6. Create and copy the token (Enter to skip)',
    apiTokenSkipHint: '  Input is hidden; press Enter alone to skip.',
    apiTokenPrompt: '  API Token: ',
    apiTokenFromEnv:
      '  Using API token from env (QUICK_DEPLOY_API_TOKEN or CLOUDFLARE_API_TOKEN)',
    apiTokenAutoCreateTrying:
      '  Trying to auto-create a read-only token (cf-quota-dashboard) via Cloudflare API…',
    apiTokenAutoCreated: '  Auto-created read-only API token for monitored account setup.',
    apiTokenAutoCreateFailed: (err) =>
      `  Auto-create failed: ${err} (wrangler OAuth lacks User API Tokens Write)`,
    apiTokenAutoCreateNoAuth: '  No wrangler credentials found — skipping auto-create.',
    apiTokenAutoCreateMissingGroups:
      '  Could not resolve token permission groups — skipping auto-create (needs User API Tokens Read/Write).',
    apiTokenSkippedNoTty:
      '  Non-interactive terminal without QUICK_DEPLOY_API_TOKEN / CLOUDFLARE_API_TOKEN — skipping auto-add.',
    apiTokenSkipped: '  Skipped — add monitored accounts later in /admin.',
    apiTokenSkippedWarning:
      '  ⚠ No API Token — cannot auto-add monitored account; dashboard will show no quota data.',
    whoamiFailed: '  Could not read wrangler whoami — skipping auto-add.',
    workerUrlResolved: (url) => `  Worker URL: ${url}`,
    workerUrlFailed:
      '  Could not determine Worker URL (deploy output missing workers.dev URL and subdomain lookup failed).',
    workerWaiting: (attempt, max) => `  Worker not ready yet, waiting (${attempt}/${max})…`,
    workerNotReady: '  Worker did not become ready in time — skipping auto-add.',
    postDeploySettle: (seconds) => `Deploy finished — waiting ${seconds}s for Worker to become ready…`,
    multipleAccountsHint: (n) =>
      `  Wrangler has ${n} accounts; using the first (set CLOUDFLARE_ACCOUNT_ID to pick one).`,
    accountVerifyFailed: (err) => `  Token verification failed: ${err}`,
    accountAddFailed: (err) => `  Failed to add account: ${err}`,
    accountAdded: (name, id) => `  Added monitored account: ${name} (${id})`,
    accountRefreshing: '  Fetching quota data…',
    accountRefreshDone: (n) => `  Quota refresh done (${n} account(s))`,
    accountRefreshFailed: (err) =>
      `  Quota refresh failed: ${err} (will load on first dashboard visit)`,
    accountRefreshSkipped: '  Quotas will load on first dashboard visit.',
    accountAlreadyExists: (name, id) => `  Monitored account already exists: ${name} (${id})`,
    setupStepFailed: (reason) => `  Auto-add account failed: ${reason}`,
    setupStepSuccess: '  Default monitored account configured.',
    successBanner: '  CF-Quota-Dashboard deployed!',
    successDashboard: '  Dashboard',
    successAdmin: '  Admin     ',
    successNextAdded: '  Default account configured — open the dashboard to view quotas.',
    successNextManual: '  Next: open /admin, log in with your PASSWORD, add monitored accounts.',
    commandFailed: (status, cmd, args) =>
      `\nCommand failed (exit ${status}): ${cmd} ${args.join(' ')}`,
  },
};

let t = i18n.zh;
/** Admin password collected early; submitted at step 5 via stdin. */
let adminPassword = '';
/** Cloudflare API Token for monitored account; resolved after wrangler login, used at step 7. */
let apiToken = '';

function setLang(code) {
  t = i18n[code] ?? i18n.zh;
}

function parseLangArg() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang' && args[i + 1]) {
      return args[i + 1].toLowerCase();
    }
  }
  return null;
}

async function resolveLanguage() {
  const chosen = parseLangArg() || process.env.QUICK_DEPLOY_LANG?.toLowerCase();

  if (chosen) {
    if (chosen !== 'zh' && chosen !== 'en') {
      console.error(i18n.en.invalidLang(chosen));
      process.exit(1);
    }
    setLang(chosen);
    return;
  }

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(i18n.zh.langPrompt);
  rl.close();
  releaseStdin();

  const lang = (answer.trim() || 'zh').toLowerCase();
  if (lang !== 'zh' && lang !== 'en') {
    console.error(i18n.en.invalidLang(lang));
    process.exit(1);
  }
  setLang(lang);
}

function log(step, message) {
  console.log(`\n[${step}] ${message}`);
}

/** Release stdin after readline so child processes (wrangler) can read TTY input. */
function releaseStdin() {
  if (!input.isTTY) return;
  input.setRawMode?.(false);
  input.pause();
  input.resume();
}

function promptHidden(promptText) {
  releaseStdin();

  if (!input.isTTY) {
    return Promise.resolve('');
  }

  return new Promise((resolve) => {
    output.write(promptText);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let password = '';
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\n' || char === '\r') {
          input.setRawMode(false);
          input.removeListener('data', onData);
          input.pause();
          output.write('\n');
          resolve(password);
          return;
        }
        if (char === '\u0003') {
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          password = password.slice(0, -1);
        } else if (char >= ' ') {
          password += char;
        }
      }
    };
    input.on('data', onData);
  });
}

function quoteCmdArg(arg) {
  const text = String(arg);
  if (!isWin) return text;
  if (/[\s"]/g.test(text)) {
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  return text;
}

/** Windows .cmd shims (npm/npx) need shell; pass a single command string to avoid DEP0190. */
function buildSpawnSpec(command, args = []) {
  const base = command.replace(/\.cmd$/, '');
  if (isWin && (base === 'npm' || base === 'npx')) {
    return {
      command: `${base} ${args.map(quoteCmdArg).join(' ')}`,
      args: [],
      shell: true,
    };
  }
  return { command, args, shell: false };
}

function formatSpawnResult(result) {
  if (result.error) {
    return {
      status: 1,
      stdout: '',
      stderr: result.error.message,
      output: result.error.message,
    };
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function runCapture(command, args = []) {
  const spec = buildSpawnSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: spec.shell,
    windowsHide: true,
  });
  return formatSpawnResult(result);
}

function runInteractive(command, args = []) {
  log(t.runLabel, [command, ...args].join(' '));
  releaseStdin();
  const spec = buildSpawnSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: spec.shell,
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error(t.commandFailed(result.status ?? 1, command, args));
    process.exit(result.status ?? 1);
  }
}

function runWithStdin(command, args, stdinText) {
  log(t.runLabel, [command, ...args].join(' '));
  releaseStdin();
  const spec = buildSpawnSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: ROOT,
    input: stdinText,
    encoding: 'utf8',
    shell: spec.shell,
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error(t.commandFailed(result.status ?? 1, command, args));
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
}

function checkPrerequisites() {
  log(`1/${TOTAL_STEPS}`, t.step1);
  for (const cmd of ['node', 'npm']) {
    const result = runCapture(cmd, ['--version']);
    if (result.status !== 0) {
      console.error(t.cmdNotInstalled(cmd));
      process.exit(1);
    }
    console.log(`  ${cmd} ${result.stdout.split('\n')[0]}`);
  }
}

function ensureDependencies() {
  log(`2/${TOTAL_STEPS}`, t.step2);
  const hasRootModules = existsSync(join(ROOT, 'node_modules', 'wrangler'));
  const hasWorkerModules = existsSync(join(ROOT, 'worker', 'node_modules'));
  if (hasRootModules && hasWorkerModules) {
    console.log(t.modulesPresent);
    return;
  }
  runInteractive('npm', ['install']);
}

function wranglerLogin() {
  log(`3/${TOTAL_STEPS}`, t.step3);
  console.log(t.wranglerLoginHint);
  runInteractive('npx', ['wrangler', 'login']);
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractIdFromText(text) {
  const json = parseJsonSafe(text);
  if (json?.id) return json.id;
  const idMatch = text.match(/id\s*=\s*"([^"]+)"/);
  if (idMatch) return idMatch[1];
  const uuidMatch = text.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return uuidMatch?.[0] ?? null;
}

function listKvNamespaces() {
  const list = runCapture('npx', ['wrangler', 'kv', 'namespace', 'list']);
  if (list.status !== 0) {
    console.error(t.kvListFailed);
    console.error(t.kvListFailedHint);
    if (list.stderr) console.error(list.stderr);
    process.exit(1);
  }

  const namespaces = parseJsonSafe(list.stdout);
  if (!Array.isArray(namespaces)) {
    console.error(t.kvUnexpectedList);
    process.exit(1);
  }
  return namespaces;
}

function findKvNamespacesByTitle(namespaces, title) {
  return namespaces.filter((ns) => ns.title === title);
}

function createKvNamespace(title) {
  const create = runCapture('npx', ['wrangler', 'kv', 'namespace', 'create', title]);
  const kvId = extractIdFromText(create.stdout || create.output);
  if (create.status === 0 && kvId) {
    return kvId;
  }
  return null;
}

function resolveKvNamespaceId() {
  log(`4/${TOTAL_STEPS}`, t.step4(KV_TITLE));

  console.log(t.kvListing);
  let namespaces = listKvNamespaces();
  let matches = findKvNamespacesByTitle(namespaces, KV_TITLE);

  let kvId = null;

  if (matches.length === 1) {
    kvId = matches[0].id;
    console.log(t.kvAlreadyConfigured(kvId));
  } else if (matches.length > 1) {
    console.error(t.kvMultiple(KV_TITLE));
    for (const ns of matches) {
      console.error(`  - ${ns.id}`);
    }
    process.exit(1);
  } else {
    console.log(t.kvCreating);
    kvId = createKvNamespace(KV_TITLE);
    if (kvId) {
      console.log(t.kvCreated(kvId));
    } else {
      console.log(t.kvMayExist);
      namespaces = listKvNamespaces();
      matches = findKvNamespacesByTitle(namespaces, KV_TITLE);
      if (matches.length === 1) {
        kvId = matches[0].id;
        console.log(t.kvUsingExisting(kvId));
      } else if (matches.length > 1) {
        console.error(t.kvMultiple(KV_TITLE));
        for (const ns of matches) {
          console.error(`  - ${ns.id}`);
        }
        process.exit(1);
      } else {
        console.error(t.kvNotFound(KV_TITLE));
        console.error(t.kvCreateManual(KV_TITLE));
        process.exit(1);
      }
    }
  }

  patchWranglerToml(kvId);
  return kvId;
}

function patchWranglerToml(kvId) {
  if (!existsSync(WRANGLER_CONFIG)) {
    console.error('\nwrangler.toml not found.');
    process.exit(1);
  }
  const content = readFileSync(WRANGLER_CONFIG, 'utf8');
  const updated = content.replace(
    /(^\s*id\s*=\s*")[^"]*(")/m,
    `$1${kvId}$2`,
  );
  if (updated !== content) {
    writeFileSync(WRANGLER_CONFIG, updated, 'utf8');
    console.log(t.kvPatched('wrangler.toml'));
  }
}

async function collectAdminPassword() {
  console.log(`\n${t.passwordStepTitle}`);
  console.log(t.passwordHint);
  console.log(t.passwordNoEchoHint);

  const fromEnv = process.env.QUICK_DEPLOY_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== '') {
    adminPassword = fromEnv.trim();
    return;
  }

  if (!input.isTTY) {
    console.error(t.passwordNoTty);
    process.exit(1);
  }

  const password = await promptHidden(t.passwordPrompt);
  if (!password.trim()) {
    console.error(t.passwordEmpty);
    process.exit(1);
  }
  adminPassword = password.trim();
}

function getWranglerAuthInfo() {
  const result = runCapture('npx', ['wrangler', 'auth', 'token', '--json']);
  if (result.status === 0) {
    const parsed = parseJsonSafe(result.stdout);
    if (parsed?.token) {
      return { token: parsed.token, type: parsed.type ?? 'unknown' };
    }
  }

  const token = getWranglerAuthToken();
  if (token) return { token, type: 'unknown' };
  return null;
}

async function fetchUserTokenPermissionGroups(authToken) {
  const resp = await fetch('https://api.cloudflare.com/client/v4/user/tokens/permission_groups', {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = parseJsonSafe(await resp.text());
  if (!resp.ok || !data?.success || !Array.isArray(data.result)) {
    return null;
  }
  return data.result;
}

function pickPermissionGroupIds(groups, wantedNames) {
  const ids = [];
  const wanted = wantedNames.map((name) => name.toLowerCase());
  for (const name of wanted) {
    const match = groups.find((group) => group.name?.toLowerCase() === name);
    if (match?.id) ids.push(match.id);
  }
  return ids;
}

/**
 * POST /client/v4/user/tokens — requires caller token with User API Tokens Write.
 * Wrangler OAuth (wrangler login) returns 403 here; OAuth scopes are deployment-only
 * (account:read, workers:write, d1:write, …) per workers-sdk DefaultScopes.
 * Docs: https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/
 * OAuth can call GET /accounts and D1 REST, but must not be stored in the Worker
 * (short-lived access token; refresh token stays in ~/.wrangler).
 */
async function tryAutoCreateMonitoredApiToken(authToken, accountId) {
  const groups = await fetchUserTokenPermissionGroups(authToken);
  if (!groups) {
    console.log(t.apiTokenAutoCreateMissingGroups);
    return null;
  }

  const permissionGroupIds = pickPermissionGroupIds(groups, MONITORED_TOKEN_PERMISSIONS);
  if (permissionGroupIds.length < 2) {
    console.log(t.apiTokenAutoCreateMissingGroups);
    return null;
  }

  const resp = await fetch('https://api.cloudflare.com/client/v4/user/tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: MONITORED_TOKEN_NAME,
      policies: [
        {
          effect: 'allow',
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: '*',
          },
          permission_groups: permissionGroupIds.map((id) => ({ id })),
        },
      ],
    }),
  });
  const data = parseJsonSafe(await resp.text());
  if (!resp.ok || !data?.success) {
    const err = data?.errors?.[0]?.message || `HTTP ${resp.status}`;
    console.log(t.apiTokenAutoCreateFailed(err));
    return null;
  }

  return data?.result?.value?.trim() || null;
}

async function resolveApiToken() {
  console.log(`\n${t.apiTokenStepTitle}`);

  const fromEnv =
    process.env.QUICK_DEPLOY_API_TOKEN?.trim() ||
    process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (fromEnv) {
    apiToken = fromEnv;
    console.log(t.apiTokenFromEnv);
    return;
  }

  console.log(t.apiTokenAutoCreateTrying);
  const whoami = getWranglerWhoami();
  const account = whoami ? resolveDeployAccount(whoami) : null;
  const auth = getWranglerAuthInfo();

  if (auth?.token && account?.accountId) {
    const created = await tryAutoCreateMonitoredApiToken(auth.token, account.accountId);
    if (created) {
      apiToken = created;
      console.log(t.apiTokenAutoCreated);
      return;
    }
  } else if (!auth?.token) {
    console.log(t.apiTokenAutoCreateNoAuth);
  }

  console.log(t.apiTokenHint);
  console.log(t.apiTokenPermissionsHint);
  console.log(t.apiTokenSkipHint);

  if (!input.isTTY) {
    console.error(t.apiTokenSkippedNoTty);
    return;
  }

  const token = await promptHidden(t.apiTokenPrompt);
  apiToken = token.trim();
  if (!apiToken) {
    console.error(t.apiTokenSkippedWarning);
  }
}

function setPasswordSecret() {
  log(`6/${TOTAL_STEPS}`, t.step6);
  runWithStdin(
    'npx',
    ['wrangler', 'secret', 'put', 'PASSWORD', '--config', 'wrangler.toml'],
    `${adminPassword}\n`,
  );
}

function deployWorker() {
  log(`5/${TOTAL_STEPS}`, t.step5);
  const result = runCapture('npm', ['run', 'deploy']);
  if (result.output) console.log(result.output);
  if (result.status !== 0) {
    console.error(t.deployFailed);
    process.exit(result.status);
  }
  return result.output;
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function extractWorkerUrl(deployOutput) {
  const text = stripAnsi(deployOutput);
  const httpsMatch = text.match(/https:\/\/[^\s"'<>]+\.workers\.dev[^\s"'<>]*/);
  if (httpsMatch) return httpsMatch[0].replace(/[)\],.]$/, '');

  const bareMatch = text.match(
    /(?:^|\s)([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\.workers\.dev)/im,
  );
  if (bareMatch) return `https://${bareMatch[1]}`;

  return null;
}

function getWorkerNameFromToml() {
  const content = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const match = content.match(/^name\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? 'cf-quota-dashboard';
}

function getWranglerAuthToken() {
  const fromEnv = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const configPaths = [
    join(process.env.APPDATA || '', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    join(process.env.LOCALAPPDATA || '', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.config', '.wrangler', 'config', 'default.toml'),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    const content = readFileSync(configPath, 'utf8');
    const oauth = content.match(/oauth_token\s*=\s*"([^"]+)"/);
    if (oauth?.[1]) return oauth[1];
    const api = content.match(/api_token\s*=\s*"([^"]+)"/);
    if (api?.[1]) return api[1];
  }

  return null;
}

async function fetchWorkersSubdomain(accountId, token) {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = parseJsonSafe(await resp.text());
  if (!resp.ok || !data?.success) {
    const err = data?.errors?.[0]?.message || `HTTP ${resp.status}`;
    console.error(`  Workers subdomain API: ${err}`);
    return null;
  }
  return data?.result?.subdomain ?? null;
}

async function resolveWorkerUrl(deployOutput, accountId) {
  const fromDeploy = extractWorkerUrl(deployOutput);
  if (fromDeploy) return fromDeploy;
  if (!accountId) return null;

  const authToken = getWranglerAuthToken();
  if (!authToken) return null;

  const subdomain = await fetchWorkersSubdomain(accountId, authToken);
  if (!subdomain) return null;
  return `https://${getWorkerNameFromToml()}.${subdomain}.workers.dev`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWorkerUrl(workerUrl) {
  return workerUrl.replace(/\/+$/, '');
}

async function waitForWorkerReady(workerUrl) {
  const url = normalizeWorkerUrl(workerUrl);
  console.log(`  ${t.postDeploySettle(Math.round(POST_DEPLOY_SETTLE_MS / 1000))}`);
  await sleep(POST_DEPLOY_SETTLE_MS);

  for (let attempt = 1; attempt <= WORKER_READY_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${url}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '__deploy_probe__' }),
      });
      // 404 = route not live yet; 503 = PASSWORD secret still propagating.
      if (resp.status !== 404 && resp.status !== 503) {
        return true;
      }
    } catch {
      // Worker may still be propagating after deploy.
    }
    if (attempt < WORKER_READY_ATTEMPTS) {
      console.log(t.workerWaiting(attempt, WORKER_READY_ATTEMPTS));
      await sleep(WORKER_READY_INTERVAL_MS);
    }
  }
  return false;
}

function getWranglerWhoami() {
  const result = runCapture('npx', ['wrangler', 'whoami', '--json']);
  if (result.status !== 0) return null;
  return parseJsonSafe(result.stdout);
}

function resolveDeployAccount(whoami) {
  if (!whoami?.accounts?.length) return null;

  const preferredId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (preferredId) {
    const match = whoami.accounts.find((a) => a.id === preferredId);
    if (match) return { accountId: match.id, name: match.name };
  }

  if (whoami.accounts.length > 1) {
    console.log(t.multipleAccountsHint(whoami.accounts.length));
  }

  const first = whoami.accounts[0];
  return { accountId: first.id, name: first.name };
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`${workerUrl}/api/login`, {
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
      if (resp.status === 401 || resp.status === 503 || resp.status === 404) {
        if (attempt < maxAttempts) {
          console.log(`  Login attempt ${attempt}/${maxAttempts} failed (${lastError}), retrying…`);
          await sleep(3000);
          continue;
        }
      }
      throw new Error(lastError);
    }

    if (attempt < maxAttempts) {
      console.log(`  Login attempt ${attempt}/${maxAttempts}: ${lastError}, retrying…`);
      await sleep(3000);
    }
  }

  throw new Error(lastError);
}

async function workerApiFetch(workerUrl, path, cookie, options = {}) {
  const resp = await fetch(`${workerUrl}${path}`, {
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

async function triggerQuotaRefresh(workerUrl, cookie) {
  console.log(t.accountRefreshing);
  const refresh = await workerApiFetch(workerUrl, '/cron/fetch', cookie, {
    method: 'POST',
  });
  if (!refresh.resp.ok) {
    console.error(t.accountRefreshFailed(refresh.data.error || `HTTP ${refresh.resp.status}`));
    return false;
  }

  const count = refresh.data.accounts?.length ?? 0;
  console.log(t.accountRefreshDone(count));
  return true;
}

async function setupDefaultAccount(workerUrl) {
  if (!apiToken) {
    console.error(t.apiTokenSkippedWarning);
    return false;
  }

  const url = normalizeWorkerUrl(workerUrl);

  const whoami = getWranglerWhoami();
  if (!whoami) {
    console.error(t.whoamiFailed);
    return false;
  }

  const account = resolveDeployAccount(whoami);
  if (!account) {
    console.error(t.whoamiFailed);
    return false;
  }

  try {
    const cookie = await workerApiLogin(url, adminPassword);

    const existing = await workerApiFetch(url, '/api/accounts', cookie);
    if (!existing.resp.ok) {
      console.error(t.setupStepFailed(existing.data.error || `HTTP ${existing.resp.status}`));
      return false;
    }

    const alreadyConfigured = Array.isArray(existing.data)
      ? existing.data.some((a) => a.accountId === account.accountId)
      : false;

    if (alreadyConfigured) {
      console.log(t.accountAlreadyExists(account.name, account.accountId));
      await triggerQuotaRefresh(url, cookie);
      console.log(t.setupStepSuccess);
      return true;
    }

    const verify = await workerApiFetch(url, '/api/accounts/verify', cookie, {
      method: 'POST',
      body: JSON.stringify({
        accountId: account.accountId,
        apiToken,
      }),
    });
    if (!verify.resp.ok || !verify.data.ok) {
      console.error(
        t.accountVerifyFailed(verify.data.error || `HTTP ${verify.resp.status}`),
      );
      return false;
    }

    const displayName = verify.data.accountName?.trim() || account.name;
    const add = await workerApiFetch(url, '/api/accounts', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: displayName,
        accountId: account.accountId,
        apiToken,
        enabled: true,
      }),
    });
    if (!add.resp.ok) {
      console.error(t.accountAddFailed(add.data.error || `HTTP ${add.resp.status}`));
      return false;
    }

    console.log(t.accountAdded(displayName, account.accountId));
    await triggerQuotaRefresh(url, cookie);
    console.log(t.setupStepSuccess);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(t.setupStepFailed(message));
    return false;
  }
}

function printSuccess(workerUrl, accountAdded) {
  log(`9/${TOTAL_STEPS}`, t.step9);
  const url =
    workerUrl ?? 'https://cf-quota-dashboard.<your-subdomain>.workers.dev';

  console.log('\n========================================');
  console.log(t.successBanner);
  console.log('========================================');
  console.log(`${t.successDashboard} : ${url}`);
  console.log(`${t.successAdmin} : ${url}/admin`);
  console.log(accountAdded ? t.successNextAdded : t.successNextManual);
  console.log('========================================\n');
}

async function main() {
  await resolveLanguage();
  console.log(`\n${t.title}\n`);
  await collectAdminPassword();

  checkPrerequisites();
  ensureDependencies();
  wranglerLogin();
  await resolveApiToken();
  resolveKvNamespaceId();
  const deployOutput = deployWorker();
  setPasswordSecret();

  const whoami = getWranglerWhoami();
  const accountId = whoami ? resolveDeployAccount(whoami)?.accountId : null;
  const workerUrl = await resolveWorkerUrl(deployOutput, accountId);

  let accountAdded = false;
  if (workerUrl) {
    console.log(t.workerUrlResolved(workerUrl));

    log(`7/${TOTAL_STEPS}`, t.step7);
    const ready = await waitForWorkerReady(workerUrl);
    if (!ready) {
      console.error(t.workerNotReady);
    } else if (apiToken) {
      log(`8/${TOTAL_STEPS}`, t.step8);
      accountAdded = await setupDefaultAccount(workerUrl);
    } else {
      console.error(t.apiTokenSkippedWarning);
    }
  } else {
    console.error(t.workerUrlFailed);
    if (!apiToken) {
      console.error(t.apiTokenSkippedWarning);
    }
  }

  printSuccess(workerUrl, accountAdded);
}

main();
