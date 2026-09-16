# miao-travel-server

喵的旅行日记微信小游戏、抖音小游戏轻量后端。

当前阶段：P2A 双平台登录本地联调。云数据库、平台真 code 与真机验收将在 P2B 完成，云存档在 P3 完成。

P2A 已实现双平台登录和游戏前端本地联调，但玩家/会话仍使用内存仓储。服务会主动拒绝在 `production` 环境使用内存仓储，完成云数据库适配前不能部署生产。

## 本地运行

要求 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env
npm run dev
```

开发环境允许 `APP_ID`、`APP_SECRET` 为空；生产环境缺少它们会拒绝启动。真实密钥只能配置在本地 `.env` 或云端 Secret 中，不得提交到 Git。

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
