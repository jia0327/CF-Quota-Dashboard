#!/usr/bin/env node
/**
 * GitHub Actions deploy — same outcome as npm run quick-deploy:
 *   KV resolve → deploy → PASSWORD secret → auto-add monitored account
 *
 * Required env (GitHub Secrets):
 *   CLOUDFLARE_API_TOKEN  — same token as 前置条件 (deploy + monitor)
 *   CLOUDFLARE_ACCOUNT_ID
 *   PASSWORD
 */

import { spawnSync } from 'child_process';
import {
  fetchAccountName,
  getWorkerNameFromToml,
  patchWranglerToml,
  resolveKvViaApi,
  resolveWorkerUrl,
  ROOT,
  setupDefaultAccount,
} from './deploy-shared.mjs';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    input: options.input,
    shell: false,
  });
  if (result.status !== 0) {
    if (result.stderr) console.error(result.stderr);
    if (result.stdout) console.error(result.stdout);
    console.error(`Command failed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

async function main() {
  const token = requireEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const password = requireEnv('PASSWORD');

  console.log('\n=== CF-Quota-Dashboard — GitHub Actions deploy ===\n');

  console.log('[1/4] Resolve KV namespace');
  const kvId = await resolveKvViaApi(token, accountId);
  patchWranglerToml(kvId);

  console.log('[2/4] Deploy Worker');
  const deploy = run('npm', ['run', 'deploy']);
  const deployOutput = `${deploy.stdout ?? ''}${deploy.stderr ?? ''}`;

  console.log('[3/4] Upload PASSWORD secret');
  run('npx', ['wrangler', 'secret', 'put', 'PASSWORD', '--config', 'wrangler.toml'], {
    input: `${password}\n`,
  });

  console.log('[4/4] Post-deploy setup');
  const workerName = getWorkerNameFromToml();
  const workerUrl = await resolveWorkerUrl(token, accountId, workerName, deployOutput);
  if (!workerUrl) {
    console.error('  Could not determine Worker URL — skip auto-add');
    process.exit(0);
  }
  console.log(`  Worker URL: ${workerUrl}`);

  const accountName = await fetchAccountName(token, accountId);
  const added = await setupDefaultAccount({
    workerUrl,
    adminPassword: password,
    apiToken: token,
    accountId,
    accountName,
  });

  console.log('\n========================================');
  console.log('  Deploy complete');
  console.log('========================================');
  console.log(`  Dashboard : ${workerUrl}`);
  console.log(`  Admin     : ${workerUrl}/admin`);
  console.log(
    added
      ? '  Default monitored account configured.'
      : '  Add monitored account in /admin if needed.',
  );
  console.log('========================================\n');
}

main();
