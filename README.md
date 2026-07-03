# CF-Quota-Dashboard

<div align="center">

📊 **Cloudflare Workers 免费套餐多账号额度监控面板**

一个优雅、现代的 Cloudflare 免费额度监控仪表板，支持多账号汇总、多渠道告警与访问触发刷新

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)
[![GitHub](https://img.shields.io/badge/GitHub-jia0327%2FCF--Quota--Dashboard-181717?logo=github)](https://github.com/jia0327/CF-Quota-Dashboard)

</div>

---

## 📖 项目简介

**CF-Quota-Dashboard** 是一个基于 Cloudflare Workers 构建的免费额度监控面板。只需在**一个** Cloudflare 账号上部署 Worker，即可通过 KV 动态管理多个被监控账号，无需为每个账号单独配置 `wrangler.toml`。

### 为什么需要这个面板?

- ✅ **多账号管理** — 在一个面板中汇总 Workers、Pages、D1、KV、R2、AI 等 28 项免费额度指标
- ✅ **访问触发刷新** — 打开仪表盘或调用 API 时自动拉取最新数据，6 小时 Cron 兜底无人访问时的更新
- ✅ **按账号告警** — 为每个账号按服务勾选阈值规则，并选择通知渠道推送
- ✅ **精美界面** — Glassmorphism 毛玻璃设计，支持亮色/暗色主题切换
- ✅ **零成本部署** — 完全免费，部署在 Cloudflare Workers 上，支持 GitHub Actions 自动部署

---

## 🎯 快速体验

### 在线演示

👉 **[点击访问生产站点](https://cf-quota-dashboard.1732330472.workers.dev)**

| 项目 | 内容 |
|------|------|
| 🌐 站点地址 | https://cf-quota-dashboard.1732330472.workers.dev |
| 📊 仪表盘 | `/` — 公开查看跨账号汇总数据 |
| 🔐 管理面板 | `/admin` — 需设置 `PASSWORD` 后登录 |
| 📢 通知渠道 | `/channels` — 需登录后配置 |

> 💡 生产站点已启用密码保护。部署自己的实例后，使用 `wrangler secret put PASSWORD` 设置登录码即可访问管理功能。

---

## ✨ 功能特性

### 🎯 核心功能

- **28 项免费额度指标**
  - Workers、Pages、D1、KV、R2、Workers AI、Queues、Vectorize、Hyperdrive、Workflows、Durable Objects、Browser Run、Analytics Engine 等
  - 含 `pages_requests`（Pages Functions 日请求）；27 项可通过 API 采集
  - 可视化进度条与跨账号汇总

- **多账号 KV 管理**
  - 添加 / 编辑 / 删除 / 启用 / 禁用
  - 保存前 **Verify Credentials** 验证 Token
  - 账号变更后立即触发刷新

- **自动更新机制**
  - **访问触发**：`GET /api/snapshot` 或公开 API 在缓存过期时自动拉取
  - **Cron 兜底**：`0 */6 * * *` 每 6 小时定时刷新
  - **刷新预算**：每账号约 **10** 次 subrequest，单次最多 **50**（约 5 个账号）
  - 管理后台可配置刷新间隔（15 / 20 / 30 / 60 / 120 / 360 分钟）

- **按账号告警配置**
  - 在 `/admin` 编辑账号时，按服务（Workers、D1、KV、R2 等）勾选并设置阈值百分比
  - **默认不启用**，需手动配置；仅对已启用账号、已勾选服务生效
  - 推送去重：同一 UTC 日/月内同一指标最多推送一次（用量超过上次告警值时仍会再次推送）

- **多通道告警**（`/channels`）
  - 企业微信、飞书、钉钉、Webhook、Telegram、Email
  - 界面风格参考 [Uptime-Monitor](https://github.com/cmliu/Uptime-Monitor) 渠道管理
  - 支持渠道测试、启用/禁用、敏感字段掩码

- **管理认证**
  - 单一 `PASSWORD` 登录码（`/login` 单字段，无需用户名）
  - 未设置 `PASSWORD` 时为 **Dev 模式**，写操作无需认证
  - Session Cookie（`cfqd_session`）24 小时有效，存 KV

- **公开 API**
  - `GET /api/public/snapshot?token=` 供外部集成
  - Token 默认从 `PASSWORD` + `USERNAME` HMAC 派生

- **GitHub Actions**
  - 推送到 `master` 自动部署；支持手动 `workflow_dispatch`

### 🎨 界面特性

- **现代化设计**
  - Glassmorphism 毛玻璃风格
  - 流畅动画与渐变色彩

- **主题切换**
  - 右下角 🌙/☀️ 切换亮色/暗色主题
  - 自动检测系统偏好，偏好保存在 `localStorage`

- **响应式布局**
  - 适配桌面端与移动端
  - 自适应卡片与导航布局

---

## 🚀 快速部署

### 首次部署检查清单

部署前请逐项确认（生产环境建议全部勾选）：

| # | 步骤 | 说明 |
|---|------|------|
| 1 | 创建 KV 命名空间 | 绑定名必须为 `KV`；仓库内 `wrangler.toml` 使用占位符 `YOUR_KV_NAMESPACE_ID` |
| 2 | 绑定 KV 到 Worker | Dashboard 或 `wrangler.toml` 中 `binding = "KV"` |
| 3 | 设置 `PASSWORD` Secret | `wrangler secret put PASSWORD` 或 Dashboard 加密变量；**未设置 = Dev 模式** |
| 4 | 配置 `[vars]`（可选） | `USERNAME`、`ALERT_THRESHOLD`、刷新间隔等已有默认值 |
| 5 | 确认 Cron 触发器 | `0 */6 * * *`（每 6 小时兜底刷新，已在 `wrangler.toml` 配置） |
| 6 | 部署 Worker | `cd worker && npm run deploy` |
| 7 | 访问并验证 | 打开 `/` 看仪表盘；设置密码后访问 `/admin` 登录 |
| 8 | 添加被监控账号 | `/admin` → Verify Credentials → Save |

**生产站点示例：** https://cf-quota-dashboard.1732330472.workers.dev

---

### 方法一：通过 Wrangler CLI 部署（推荐）

#### 1. 克隆仓库并安装依赖

```bash
git clone https://github.com/jia0327/CF-Quota-Dashboard.git
cd CF-Quota-Dashboard/worker
npm install
```

#### 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create KV
```

终端会输出命名空间 `id`，例如 `cf1d02c604e0491f8b99c1fca40c5a7b`。

#### 3. 写入 KV 命名空间 ID

仓库中 `worker/wrangler.toml` 使用占位符，本地部署前需替换：

```toml
[[kv_namespaces]]
binding = "KV"          # ⚠️ 绑定名必须是大写 KV，不可修改
id = "YOUR_KV_NAMESPACE_ID"   # 替换为上一步输出的 id
```

**推荐：使用本地配置文件（不修改仓库模板）**

```bash
cp wrangler.toml wrangler.deploy.toml
# 编辑 wrangler.deploy.toml，将 YOUR_KV_NAMESPACE_ID 改为真实 id
```

后续部署使用：

```bash
npm run typecheck
npx wrangler deploy --config wrangler.deploy.toml
# 或：npm run deploy -- --config wrangler.deploy.toml
```

> `wrangler.deploy.toml` 含真实 ID，建议加入 `.gitignore`，勿提交到公开仓库。

#### 4. 设置 Secret（生产环境必须）

```bash
npx wrangler secret put PASSWORD
# 按提示输入管理员登录码（唯一凭据，登录页无需用户名）
```

可选：

```bash
npx wrangler secret put PUBLIC_API_TOKEN
# 自定义公开 API token；不设置则从 PASSWORD+USERNAME 派生
```

> Secret 不能写在 `wrangler.toml` 的 `[vars]` 中，只能通过 `wrangler secret put` 或 Dashboard 加密变量设置。

#### 5. 配置环境变量（可选）

`worker/wrangler.toml` 的 `[vars]` 段已有默认值，可按需修改：

```toml
[vars]
WEBHOOK_URL = ""                    # 可选：无 KV 渠道时的企微 webhook 回退
ALERT_THRESHOLD = "70"              # 告警阈值回退值（百分比）
USERNAME = "admin"                  # 内部会话标识（登录 UI 不展示）
ACCOUNT_CHECK_INTERVAL_MINUTES = "20"
MAX_EXTERNAL_SUBREQUESTS_PER_RUN = "50"
```

Cron 已在 `[triggers]` 中配置：`crons = ["0 */6 * * *"]`（每 6 小时执行一次兜底刷新）。

#### 6. 部署

```bash
npm run typecheck
npm run deploy
# 若使用 wrangler.deploy.toml：
# npm run deploy -- --config wrangler.deploy.toml
```

部署成功后终端会输出 Worker URL，例如 `https://cf-quota-dashboard.<subdomain>.workers.dev`。

#### 7. 本地开发（可选）

创建 `worker/.dev.vars`（已被 `.gitignore` 忽略）：

```env
PASSWORD=your-local-dev-password
```

```bash
npm run dev
# 访问 http://localhost:8787
```

---

### 方法二：通过 Cloudflare Dashboard 部署

#### 1. 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **创建应用程序** → **创建 Worker**
3. 命名（例如 `cf-quota-dashboard`）并部署

#### 2. 连接 GitHub（可选）

在 Worker 设置中连接 [jia0327/CF-Quota-Dashboard](https://github.com/jia0327/CF-Quota-Dashboard) 仓库，或手动上传 `worker/` 与 `frontend/` 目录代码。

#### 3. 创建 KV 命名空间（⚠️ 必须）

1. 左侧菜单 **KV** → **创建命名空间**
2. 命名为 `KV`（名称可自定义，便于识别）
3. 记下 **命名空间 ID**（CI 中对应 `KV_NAMESPACE_ID` Secret）

#### 4. 绑定 KV 到 Worker（⚠️ 必须）

1. Worker 页面 → **设置** → **变量**
2. **KV 命名空间绑定** → **添加绑定**
   - **变量名称**：`KV`（⚠️ 必须大写 `KV`）
   - **KV 命名空间**：选择刚创建的命名空间
3. 保存并部署

#### 5. 设置环境变量与 Secret（⚠️ 必须）

在 **设置** → **变量** 中：

| 变量名 | 类型 | 是否必须 | 说明 |
|--------|------|---------|------|
| `PASSWORD` | Secret（加密） | ✅ 生产必须 | 管理员登录码；未设置 = Dev 模式 |
| `USERNAME` | 环境变量 | ⚪ 可选 | 默认 `admin`，参与公开 API token 派生 |
| `ALERT_THRESHOLD` | 环境变量 | ⚪ 可选 | 默认 `70` |
| `ACCOUNT_CHECK_INTERVAL_MINUTES` | 环境变量 | ⚪ 可选 | 默认 `20` |
| `MAX_EXTERNAL_SUBREQUESTS_PER_RUN` | 环境变量 | ⚪ 可选 | 默认 `50`，上限 50 |

**添加 `PASSWORD` 步骤：**

1. 点击 **添加变量**
2. 变量名填 `PASSWORD`，勾选 **加密**
3. 输入强密码（建议 16+ 字符）
4. 保存并部署

#### 6. 配置 Cron 触发器（⚠️ 必须）

1. Worker 页面 → **触发器** → **Cron Triggers**
2. 添加：`0 */6 * * *`（每 6 小时）
3. 保存

> 若通过 Git 连接部署，`wrangler.toml` 中的 `[triggers]` 会在下次部署时同步。

#### 7. 验证部署

1. 访问 `https://<your-worker>.workers.dev/` — 应显示仪表盘
2. 访问 `/admin` — 若已设 `PASSWORD`，应跳转 `/login`
3. 登录后添加第一个被监控账号并 **Verify Credentials**

---

### 方法三：GitHub Actions 自动部署

工作流文件：`.github/workflows/deploy.yml`  
触发条件：推送到 `master` 分支，或 Actions 页手动 **Run workflow**（`workflow_dispatch`）。

#### 1. Fork / 克隆仓库

Fork [jia0327/CF-Quota-Dashboard](https://github.com/jia0327/CF-Quota-Dashboard) 到你的 GitHub 账号，或使用已有仓库。

#### 2. 创建 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. **Create Token** → **Edit Cloudflare Workers** 模板（或自定义）
3. 权限至少包含：**Account → Workers Scripts → Edit**、**Account → Workers KV Storage → Edit**
4. 复制 Token

#### 3. 获取 Account ID

Cloudflare Dashboard 右侧栏 → **Account ID**（托管 Worker 的账号）。

#### 4. 配置 Repository Secrets

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：

| Secret | 是否必须 | 说明 |
|--------|---------|------|
| `CLOUDFLARE_API_TOKEN` | ✅ 必须 | 上一步创建的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ 必须 | 托管 Worker 的 Account ID |
| `KV_NAMESPACE_ID` | ⚪ 可选 | KV 命名空间 ID；**未设置时 CI 自动查找或创建**标题为 `KV` 的命名空间 |
| `PASSWORD` | ⚪ 可选 | 管理员登录码；见下方「自动同步 PASSWORD」 |

#### 5. CI 部署流程

推送代码到 `master` 后，Actions 依次执行：

1. `npm ci` 安装依赖
2. `npm run typecheck` 类型检查
3. **Resolve KV namespace** — 将 `wrangler.toml` 中 `YOUR_KV_NAMESPACE_ID` 替换为真实 ID
4. `npx wrangler deploy` 部署 Worker
5. **（可选）** 若配置了 `PASSWORD` Secret，自动执行 `wrangler secret put PASSWORD`

#### 6. 首次 CI 部署后必做事项

> ⚠️ **重要**：若**未**在 GitHub Secrets 中配置 `PASSWORD`，CI **不会**设置 Worker 登录码，部署后 Worker 处于 **Dev 模式**。

**方式 A — 手动设置（默认）**

```bash
cd worker
npx wrangler secret put PASSWORD
```

或在 Cloudflare Dashboard → Worker → **设置** → **变量** → 添加加密变量 `PASSWORD`。

**方式 B — 通过 GitHub Secret 自动同步（可选）**

1. 在 Repository Secrets 中添加 `PASSWORD`（你的管理员登录码）
2. 下次 Actions 部署时会自动执行 `wrangler secret put PASSWORD`
3. 修改登录码后，重新触发 workflow 或推送 commit 即可更新

> Worker Secret 与 GitHub Secret 相互独立；仅在 CI 步骤中显式同步时才会写入 Cloudflare。

#### 7. 验证 CI 部署

1. Actions 页确认 workflow 绿色通过
2. 访问 `https://cf-quota-dashboard.<your-subdomain>.workers.dev/`
3. 确认 `/admin` 需登录（若已设置 `PASSWORD`）
4. 添加测试账号并验证数据刷新

---

## ⚙️ 配置说明

### 🔑 环境变量

| 变量名 | 类型 | 是否必须 | 默认值 | 说明 |
|--------|------|---------|--------|------|
| `PASSWORD` | Secret | ✅ 生产必须 | *(空)* | 管理员登录码。**未设置 = Dev 模式**，写 API 无需认证 |
| `USERNAME` | String | ⚪ 可选 | `admin` | 内部会话标识（登录页不展示；参与公开 API token HMAC 派生） |
| `ALERT_THRESHOLD` | String | ⚪ 可选 | `70` | 规范化告警规则时的阈值回退值 |
| `FREE_TIER_LIMITS` | String | ⚪ 可选 | 内置默认 | JSON 覆盖 `worker/src/free-tier-limits.ts` 中的限额 |
| `WEBHOOK_URL` | String | ⚪ 可选 | *(空)* | 旧版单 webhook；**仅当 KV 无通知渠道时**作为隐式企微渠道 |
| `ACCOUNT_CHECK_INTERVAL_MINUTES` | String | ⚪ 可选 | `20` | 快照缓存 TTL 回退值（分钟） |
| `MAX_EXTERNAL_SUBREQUESTS_PER_RUN` | String | ⚪ 可选 | `50` | 单次刷新最多对外 subrequest 数（Workers 单次调用上限 50） |
| `PUBLIC_API_TOKEN` | Secret/Var | ⚪ 可选 | HMAC 派生 | `GET /api/public/snapshot?token=` 的鉴权 token |

每个账号刷新约消耗 **10** 个外部 subrequest；默认 50 的预算通常可刷新约 **5** 个账号。响应中的 `refreshStats` 会显示实际消耗与跳过情况。

**⚠️ 重要提示：**

- 生产环境**必须**设置 `PASSWORD`，否则 Worker 处于 Dev 模式，所有写 API 对公网开放
- Secret 必须通过 `wrangler secret put` 或 Dashboard 加密变量设置，不能写在 `wrangler.toml` 的 `[vars]` 中

---

### 💾 KV 命名空间绑定

**⚠️ 这是最关键的配置步骤！**

#### 绑定要求

- **变量名称必须是**：`KV`（大写，不能改）
- **绑定类型**：KV 命名空间
- **用途**：存储以下数据

| KV Key | 说明 |
|--------|------|
| `ACCOUNTS` | 被监控账号配置（含 `alertRules`） |
| `QUOTA_SNAPSHOT` | 最新配额快照 |
| `NOTIFICATION_CHANNELS` | 通知渠道配置 |
| `DASHBOARD_CONFIG` | 仪表盘刷新间隔等配置 |
| `ALERT_COOLDOWN` | 告警推送去重状态 |
| `session:*` | 登录 Session |

#### KV 数据结构示例

**`ACCOUNTS`**（账号配置）：

```json
[
  {
    "id": "acc-1",
    "name": "主账号",
    "accountId": "6d7***************************90",
    "apiToken": "duN***********************************fs",
    "enabled": true,
    "alertRules": [
      { "metricKey": "workers_requests", "enabled": true, "thresholdPercent": 80 }
    ]
  }
]
```

**`QUOTA_SNAPSHOT`**（配额快照）：

```json
{
  "lastUpdated": "2026-07-03T12:00:00.000Z",
  "accounts": [
    {
      "accountId": "acc-1",
      "name": "主账号",
      "metrics": { "workers_requests": { "used": 80000, "limit": 100000, "pct": 80, "available": true } }
    }
  ]
}
```

---

## 📝 使用指南

### 首次访问

1. 部署完成后，访问 Worker 地址：`https://your-worker.workers.dev/`
2. 首页显示跨账号汇总配额数据（公开可读）
3. 若已设置 `PASSWORD`，访问 **账号管理**（`/admin`）或 **通知渠道**（`/channels`）会跳转 `/login`
4. 在登录页输入 **管理员登录码**（仅一个字段，无需用户名）

> 未设置 `PASSWORD` 时为 **Dev 模式**：导航栏显示 `Dev mode`，写操作无需登录。

### 添加 Cloudflare 账号

登录管理面板（`/admin`）后：

1. 点击 **添加账号**
2. 填写：
   - **账号名称**：自定义名称
   - **Account ID**：Cloudflare Dashboard 右侧可找到
   - **API Token**：只读 Token（见下方权限说明）
3. 点击 **Verify Credentials** 验证
4. 在 **告警设置** 区域按需勾选服务与阈值
5. 点击 **Save** 保存

**获取 Account ID：**

1. 登录 Cloudflare Dashboard
2. 选择任意域名或进入 Workers 页面
3. 页面右侧栏可见 **Account ID**

**创建 API Token：**

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 点击 **Create Token** → **Create Custom Token**
3. 为**被监控账号**配置只读权限（见 [API Token 权限](#api-token-权限)）
4. 复制生成的 Token

### 配置通知渠道

1. 访问 `/channels`（需登录）
2. 添加渠道：企业微信 / 飞书 / 钉钉 / Webhook / Telegram / Email
3. 点击 **测试** 验证配置
4. 启用需要的渠道

在 `/channels` 点击 **发送测试告警**，可向所有已启用渠道推送模拟告警消息。

### 配置刷新间隔

在 `/admin` 顶部的 **刷新设置** 中配置缓存 TTL（默认 20 分钟）。当快照 `lastUpdated` 超过该间隔时，访问仪表盘或 API 会自动触发配额拉取。

| 机制 | 触发条件 | 说明 |
|------|----------|------|
| 访问触发 | `GET /api/snapshot` / 公开 API，快照过期 | 用户打开仪表盘或外部集成拉取时刷新 |
| Cron 兜底 | `0 */6 * * *`（每 6 小时） | 长期无人访问时仍更新 |
| 账号变更 | 添加 / 删除 / 启用 / 禁用账号 | 配置变更后立即拉取 |

### 查看配额数据

- **仪表盘**（`/`）：跨账号汇总 + 各账号卡片
- **管理面板**（`/admin`）：账号列表、编辑、告警配置
- **公开 API**：`GET /api/public/snapshot?token=<token>`
  - 登录后访问 `GET /api/public/token` 获取 token

### 本地开发

```bash
cd worker
npm install
```

创建 `worker/.dev.vars`（已被 `.gitignore` 忽略）：

```env
PASSWORD=your-local-dev-password
```

```bash
npm run dev
# 访问 http://localhost:8787
```

| 场景 | 行为 |
|------|------|
| 未设置 `PASSWORD` | Dev 模式：写操作无需登录 |
| 设置了 `PASSWORD` | `/admin`、`/channels` 及写 API 需先登录 |

---

## 🔑 API Token 权限

在 Cloudflare Dashboard → **My Profile** → **API Tokens** 中，为**被监控账号**创建 **只读** Token。

**最低必需权限**（缺一不可）：

| 权限 | 用途 |
|------|------|
| **Account → Account Analytics → Read** | 大部分 GraphQL 用量（Workers、D1 读/写/存储、KV、R2 等） |
| **Account → D1 → Read** | REST 查询 D1 **数据库个数**（GraphQL 无法获取此项） |

**建议一并勾选**（按需）：

- Cloudflare Pages: Read
- Workers Scripts: Read
- Workers KV Storage: Read
- Workers R2 Storage: Read
- Queues: Read
- Hyperdrive: Read
- Vectorize: Read
- Account Settings: Read（Verify 时显示账号名）

---

## 🛣️ API 路由说明

| 路径 | 方法 | 说明 | 认证要求 |
|------|------|------|---------|
| `/` | GET | 仪表盘，显示跨账号汇总配额 | 无 |
| `/admin` | GET | 账号管理 | 页面需登录* |
| `/channels` | GET | 通知渠道管理 | 页面需登录* |
| `/login` | GET | 登录页 | 无 |
| `/api/me` | GET | 会话状态；Dev 模式返回 `devMode: true` | 无 |
| `/api/login` | POST | 登录（body: `{ "password": "..." }`） | 无 |
| `/api/logout` | POST | 登出 | 无 |
| `/api/snapshot` | GET | 最新配额快照；缓存过期时自动刷新 | 无 |
| `/api/config` | GET | 仪表盘刷新间隔等配置 | 无 |
| `/api/config` | PUT | 更新刷新间隔 | Cookie 认证† |
| `/api/public/snapshot?token=` | GET | 公开快照（外部集成） | Token 参数 |
| `/api/public/token` | GET | 查看/派生公开 API token | Cookie 认证 |
| `/api/accounts` | GET | 账号列表（Token 掩码） | 无 |
| `/api/accounts` | POST | 添加账号 | Cookie 认证† |
| `/api/accounts/verify` | POST | 验证 Account ID + Token | Cookie 认证† |
| `/api/accounts/:id` | PUT | 更新账号 / 告警规则 | Cookie 认证† |
| `/api/accounts/:id` | DELETE | 删除账号 | Cookie 认证† |
| `/api/alert-service-groups` | GET | 告警服务分组列表 | 无 |
| `/api/channels` | GET | 渠道列表（敏感字段掩码） | 无 |
| `/api/channels` | POST | 添加渠道 | Cookie 认证† |
| `/api/channels/:id` | PUT | 更新渠道 | Cookie 认证† |
| `/api/channels/:id` | DELETE | 删除渠道 | Cookie 认证† |
| `/api/channels/:id/toggle` | PATCH | 启用/禁用切换 | Cookie 认证† |
| `/api/channels/:id/test` | POST | 向单个渠道发送测试消息 | Cookie 认证† |
| `/api/alerts/test` | POST | 向所有已启用渠道发送测试告警 | Cookie 认证† |
| `/cron/fetch` | POST | 强制手动刷新 | Cookie 认证† |

\* 页面级：`authEnabled && !authenticated` 时前端重定向 `/login`。  
† API 级：未配置 `PASSWORD` 时 `requireAuth` 直接放行（Dev 模式）。

### 刷新预算响应示例

```json
{
  "lastUpdated": "2026-07-03T12:00:00.000Z",
  "accounts": ["..."],
  "refreshStats": {
    "refreshed": 2,
    "failed": 0,
    "cached": 1,
    "skippedByLimit": 0,
    "subrequestsUsed": 20
  },
  "alerted": false
}
```

---

## 📢 通知渠道配置

在 `/channels` 添加。KV key：`NOTIFICATION_CHANNELS`。  
当 KV 中存在渠道时，**优先于** `WEBHOOK_URL`；KV 为空且设置了 `WEBHOOK_URL` 时，告警走隐式企微渠道。

| 类型 | 配置字段 | 说明 |
|------|----------|------|
| **wecom** 企业微信 | `webhookUrl` | 群机器人 Webhook，Markdown 消息 |
| **feishu** 飞书 | `webhookUrl` | 群机器人 Webhook，纯文本 |
| **dingtalk** 钉钉 | `webhookUrl` | 自定义机器人 Webhook，Markdown |
| **webhook** | `webhookUrl`，可选 `customHeaders` | 通用 JSON payload |
| **telegram** | `botToken`，`chatId` | Telegram Bot API |
| **email** | `to`，`webhookUrl` | HTTP 邮件中继（Workers 不支持 SMTP） |

---

## 🔒 安全说明

### 认证机制

1. **Cookie 认证**
   - 登录成功后设置 `cfqd_session` HttpOnly + Secure + SameSite=Strict Cookie
   - Session 存 KV `session:*`，有效期 24 小时
   - 所有管理 API 需 Cookie 验证（Dev 模式除外）

2. **Token 认证**
   - 公开 API token 默认 = HMAC(`PASSWORD` + `USERNAME`)
   - 可通过 `PUBLIC_API_TOKEN` Secret 显式指定

### 安全建议

- ✅ 生产环境**必须**设置强密码登录码（建议 16+ 字符）
- ✅ 使用只读 API Token，而非 Global API Key
- ✅ 被监控账号 Token 存于 KV，API 响应仅返回掩码（`abcd...wxyz`）
- ✅ 托管 Worker 的 `CLOUDFLARE_API_TOKEN`（CI 用）与被监控账号 Token 职责分离
- ✅ 定期检查账号列表与通知渠道，删除不需要的配置
- ⚠️ 未设置 `PASSWORD` 时所有写 API 对公网开放（Dev 模式）

---

## 🎨 界面主题

### 暗色主题（默认）

- 深色背景配合柔和渐变
- 适合夜间查看

### 亮色主题

- 清新明亮的界面
- 适合白天使用

### 切换主题

- 点击右下角的 **🌙/☀️** 图标
- 主题偏好自动保存在浏览器 `localStorage`
- 首次访问自动检测系统偏好

---

## 🛠️ 技术栈

- **运行环境**：Cloudflare Workers（Hono 框架）
- **存储**：Cloudflare KV
- **前端**：原生 HTML + CSS + JavaScript（Workers Assets）
- **API**：Cloudflare GraphQL Analytics API + REST API
- **CI/CD**：GitHub Actions + Wrangler

---

## ❓ 常见问题

### 1. 部署后无法访问管理面板?

**检查清单：**

- ✅ 是否通过 `wrangler secret put PASSWORD` 或 Dashboard 加密变量设置了登录码？
- ✅ GitHub Actions 部署后是否执行了上述步骤（或配置了 `PASSWORD` Repository Secret）？
- ✅ 是否绑定了 KV 命名空间？
- ✅ KV 绑定的变量名是否为 `KV`（大写）？
- ✅ `wrangler.toml` 中 KV `id` 是否为真实 ID（非 `YOUR_KV_NAMESPACE_ID`）？
- ✅ Worker 是否成功部署？Cron `0 */6 * * *` 是否已生效？

### 2. GitHub Actions 部署成功但线上无密码保护?

Actions **默认不会**同步 Worker Secrets（除非在 Repository Secrets 中配置了 `PASSWORD`）。

**手动设置：**

```bash
cd worker && npx wrangler secret put PASSWORD
```

**或自动同步：** 在 GitHub → Settings → Secrets 添加 `PASSWORD`，重新运行 workflow。

### 3. CI 报 KV 或 `YOUR_KV_NAMESPACE_ID` 相关错误?

**原因：** `Resolve KV namespace` 步骤失败，或 `CLOUDFLARE_API_TOKEN` 缺少 KV 权限。

**解决：**

1. 确认 Secrets 中 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 正确
2. Token 需含 **Workers KV Storage → Edit** 权限
3. 或手动创建 KV 后，将命名空间 ID 写入 Secret `KV_NAMESPACE_ID`
4. 本地验证：`npx wrangler kv namespace list`

### 4. 提示 KV 相关错误?

**解决方法：**

1. 创建 KV 命名空间：`npx wrangler kv namespace create KV`
2. 在 Worker 设置中绑定 KV，**变量名称必须是 `KV`**
3. 保存并重新部署

### 5. 登录失败 / 写操作 401?

- 确认已通过 `wrangler secret put PASSWORD` 设置登录码（非 `[vars]`）
- 登录页只需输入 **管理员登录码**，无需账号名
- 本地 dev 检查 `worker/.dev.vars` 是否包含 `PASSWORD`
- 清除浏览器 Cookie 后重试

### 6. `/login` 返回 503 "Auth not configured"?

未设置 `PASSWORD` 时不应使用登录 API；此时为 Dev 模式，直接访问 `/admin` 即可。

### 7. 添加账号后无数据?

**原因：**

- API Token 权限不足
- Account ID 错误
- 刷新预算耗尽（`skippedByLimit > 0`）

**解决：**

1. 在 `/admin` 使用 **Verify Credentials** 检查 Token
2. 确认 Token 有 `Account → Account Analytics → Read` 权限
3. 打开仪表盘触发刷新，或点击 ↻ 强制手动刷新

### 8. 手动刷新后部分账号仍是旧数据?

单次最多刷新约 `MAX_EXTERNAL_SUBREQUESTS_PER_RUN / 10` 个账号（默认约 **5** 个），其余需再次访问 snapshot 或手动刷新。

### 9. 告警未收到?

- 检查 `/channels` 渠道是否 **已启用**
- 确认账号已在 `/admin` 勾选对应服务的告警规则，且账号已启用
- 确认指标 `pct` 已达规则阈值且 `available: true`
- 使用渠道 **测试** 按钮排查配置

### 10. 公开 API 403 / 503?

- **503**：未设置 `PASSWORD` 且未设置 `PUBLIC_API_TOKEN`
- **403**：`token` 不匹配；登录后访问 `GET /api/public/token` 获取正确 token

### 11. 如何迁移到新的 Worker?

```bash
# 导出
npx wrangler kv key get --binding=KV ACCOUNTS > accounts.json
npx wrangler kv key get --binding=KV NOTIFICATION_CHANNELS > channels.json

# 导入到新 Worker
npx wrangler kv key put --binding=KV ACCOUNTS --path=accounts.json
npx wrangler kv key put --binding=KV NOTIFICATION_CHANNELS --path=channels.json
```

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

## 🙏 致谢

- 感谢 [Cloudflare](https://www.cloudflare.com/) 提供的强大平台
- 界面与交互设计灵感来源于 [CF-Workers-UsagePanel](https://github.com/cmliu/CF-Workers-UsagePanel) 及社区额度监控方案
- 通知渠道管理 UI 参考 [Uptime-Monitor](https://github.com/cmliu/Uptime-Monitor) 风格
- 感谢所有提供建议和反馈的用户

---

<div align="center">

**[⬆ 回到顶部](#cf-quota-dashboard)**

Made with ❤️ by [jia0327](https://github.com/jia0327)

</div>
