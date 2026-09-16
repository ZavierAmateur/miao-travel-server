# miao-travel-server

喵的旅行日记微信小游戏、抖音小游戏轻量后端。

当前阶段：P0/P1 基础工程。平台登录、云存档和前端接口接入将在后续阶段实现。

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
