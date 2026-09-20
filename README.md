# miao-travel-server

喵的旅行日记微信小游戏、抖音小游戏轻量后端。

当前阶段：微信 V1 开发与联调已经收口。已完成微信真实登录、`user` 白名单云存档、冲突/离线/强杀保护、启动配置、微信昵称头像资料、管理端玩家查询、存档诊断/回滚、封禁/解封和脱敏错误日志。简易管理后台按本地内部工具交付，通过 `npm run dev:cloud` 使用，不建设公网静态站点。抖音环境、广告、兑换码和正式灰度观察作为后续独立阶段，不阻塞微信 V1 开发验收。

登录服务可通过 `PERSISTENCE_DRIVER=memory|cloudbase-http` 切换仓储。生产环境禁止使用内存仓储；CloudBase 模式通过官方 JS SDK 的 HTTP API 访问内置文档数据库。平台 openid、unionid 和自有 token 均不以明文写入数据库。

## 本地运行

要求 Node.js 20.19 或更高版本。

```bash
npm install
cp .env.example .env
npm run dev
```

开发环境允许 `APP_ID`、`APP_SECRET` 为空；生产环境缺少它们会拒绝启动。真实密钥和 `CLOUDBASE_API_KEY` 只能配置在本地 `.env` 或云端 Secret 中，不得提交到 Git。

腾讯 CloudBase 内置文档数据库配置：

```bash
PERSISTENCE_DRIVER=cloudbase-http
CLOUDBASE_ENV_ID=控制台环境ID
CLOUDBASE_REGION=ap-shanghai
CLOUDBASE_API_KEY=服务端APIKey
CLOUDBASE_DATABASE_INSTANCE=(default)
CLOUDBASE_DATABASE_NAME=(default)
```

验证数据库集合和真实读写（探测记录会立即删除，且不会输出 API Key）：

```bash
npm run db:check
```

微信本地配置使用 `.env.wechat.local` 时可运行 `npm run db:check:wechat`。

## 管理员认证

V1 只保留 `admin`（超管）和 `operator`（运营）两个角色。管理员认证与玩家登录完全独立；同时配置以下环境变量后才启用 `/admin/v1/auth/*`：

```bash
ADMIN_BOOTSTRAP_ACCOUNT=root.admin
ADMIN_BOOTSTRAP_PASSWORD=至少12字符的初始密码
ADMIN_BOOTSTRAP_DISPLAY_NAME=超级管理员
ADMIN_WEB_ORIGIN=http://127.0.0.1:5173
```

首次启动会创建初始超管；已存在同账号时不会用环境变量覆盖密码。生产初始密码必须存入云端 Secret，创建完成后应按后续密码轮换流程移除或轮换。

V1 管理后台的错误日志使用 `admin_error_logs` 集合，只保存脱敏后的时间、requestId、接口模板、HTTP 状态、业务错误码和安全提示信息，不保存请求体、Cookie、Token、存档正文或错误堆栈。运行 `npm run db:check:wechat` 会自动检查并在缺失时创建该集合；运行 `npm run error-log:check:wechat` 会执行可回收的真实写入、详情读取和时间倒序列表探测。

## CloudBase Run 部署

仓库根目录已经提供生产用多阶段 `Dockerfile` 和 `.dockerignore`。微信首次云端部署的服务参数、环境变量与验收步骤见：`docs/deployment/CloudBase-Run微信部署说明.md`。

## 验证命令

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=moderate
```

健康检查：

```bash
curl -H 'X-Request-Id: local-check' http://127.0.0.1:3000/health
```

## 文档

- `喵的旅行日记后端开发计划-V1.md`
- `喵的旅行日记管理后台开发计划-V1.md`
- `docs/api.md`
- `docs/audits/`
- `docs/acceptance/`
- `docs/acceptance/P6-微信V1开发总体验收报告.md`
