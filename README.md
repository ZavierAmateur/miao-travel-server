# miao-travel-server

喵的旅行日记微信小游戏、抖音小游戏轻量后端。

当前阶段：P2B1 云持久化代码已实现，等待 CloudBase 环境 ID、MongoDB 外部连接串和真实 `wx.login` code 完成 P2B2 云端/真机验收。云存档在 P3 完成。

登录服务可通过 `PERSISTENCE_DRIVER=memory|mongo` 切换仓储。生产环境禁止使用内存仓储；Mongo 模式会在启动时连接数据库、执行 ping，并幂等确保玩家/会话索引。平台 openid、unionid 和自有 token 均不以明文写入数据库。

## 本地运行

要求 Node.js 20.19 或更高版本。

```bash
npm install
cp .env.example .env
npm run dev
```

开发环境允许 `APP_ID`、`APP_SECRET` 为空；生产环境缺少它们会拒绝启动。真实密钥和 `CLOUD_DATABASE_URI` 只能配置在本地 `.env` 或云端 Secret 中，不得提交到 Git。

腾讯 CloudBase 文档型数据库使用 MongoDB 官方驱动的外部连接能力。云环境配置：

```bash
PERSISTENCE_DRIVER=mongo
CLOUD_DATABASE_URI=mongodb://控制台提供的私密连接串
CLOUD_DATABASE_NAME=miao_travel
```

验证数据库连通性和索引（不会输出连接串）：

```bash
npm run db:check
```

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
