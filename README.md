# miao-travel-server

喵的旅行日记微信小游戏、抖音小游戏轻量后端。

当前阶段：P2 微信真实登录已验收；P3A 云存档后端、CloudBase 条件写和前端接入代码已完成本地/真实数据库验收，待部署新服务版本并在微信开发者工具完成端到端存取验收。

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
