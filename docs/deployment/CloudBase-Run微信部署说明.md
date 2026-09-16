# CloudBase Run 微信后端部署说明

日期：2026-09-16

## 1. 部署目标

- CloudBase 环境：使用微信环境对应的现有环境 ID。
- 服务名：`miao-travel-wechat`。
- 容器端口：`3000`。
- 访问策略：`PUBLIC`，供小游戏现有 HTTPS 客户端调用。
- 最小副本数：`0`，避免空闲常驻消耗试用额度。
- 最大副本数：`1`，首版先限制资源上限；容量验收后再调整。

## 2. 首次部署推荐流程

首次部署优先使用 CloudBase 控制台的“云函数/托管”创建服务，因为创建页面可以同时配置环境变量，避免先发布一个缺少 Secret、无法启动的版本。

1. 进入目标 CloudBase 环境，选择“云函数/托管”。
2. 新建容器型服务，服务名填写 `miao-travel-wechat`。
3. 选择本地代码/文件夹上传，代码目录选择本仓库根目录；Dockerfile 路径为根目录的 `Dockerfile`。
4. 服务端口填写 `3000`，访问类型选择公网访问。
5. 最小实例数填 `0`，最大实例数填 `1`。
6. 按下表配置环境变量。Secret 只在控制台填写，不复制到部署包、Git、构建日志或截图。
7. 发布后先访问 `/health`，再执行真实 `wx.login` 联调。

## 3. 云端环境变量

| 变量 | 云端值/要求 |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | 必须是 `0.0.0.0`，不能沿用本地的 `127.0.0.1` |
| `PORT` | `3000`，并与服务端口一致 |
| `PLATFORM` | `wechat` |
| `APP_ID` | 微信小游戏 AppId |
| `APP_SECRET` | 微信小游戏最新 AppSecret，使用 Secret 管理 |
| `LOG_LEVEL` | 首版使用 `info` |
| `PERSISTENCE_DRIVER` | `cloudbase-http` |
| `CLOUDBASE_ENV_ID` | 目标 CloudBase 环境 ID |
| `CLOUDBASE_REGION` | 当前环境使用 `ap-shanghai` |
| `CLOUDBASE_API_KEY` / `CLOUDBASE_APIKEY` / `TCB_API_KEY` | 服务端 API Key，三者只需一个；优先使用控制台“API Key 设置”的托管注入变量名 |
| `CLOUDBASE_DATABASE_INSTANCE` | `(default)` |
| `CLOUDBASE_DATABASE_NAME` | `(default)` |

聊天中曾出现过 AppSecret。正式上线前先在微信公众平台轮换，再把新值写入 CloudBase Secret；旧值不得继续用于正式环境。

## 4. 后续 CLI 更新

完成一次 CLI 登录：

```bash
npx -y -p @cloudbase/cli@3.8.2 tcb login
```

首次服务和 Secret 已在控制台创建后，可从仓库根目录更新代码：

```bash
npx -y -p @cloudbase/cli@3.8.2 tcb cloudrun deploy \
  --env-id <CLOUDBASE_ENV_ID> \
  --service-name miao-travel-wechat \
  --source . \
  --port 3000 \
  --min-num 0 \
  --max-num 1 \
  --open-access-types PUBLIC \
  --wait
```

不要使用 `--force` 跳过首次确认；先核对环境、服务名、端口、访问策略和副本数。

## 5. 上线验收

1. 默认域名的 `GET /health` 返回 HTTP 200，响应中 `environment=production`、`platform=wechat`、`persistence=cloudbase-http`。
2. 将 HTTPS 域名加入微信小游戏 request 合法域名，并同步到前端生产 `baseUrl`。
3. 用新鲜的 `wx.login` code 请求 `POST /v1/auth/platform-login`；code 不得写入日志或验收文档。
4. 同一微信账号连续登录两次，playerId 相同，第二次 `isNew=false`。
5. CloudBase `players`、`sessions` 中不存在明文 openid、unionid、token、AppSecret 或 API Key。
6. 验证服务缩容到 0 后可以冷启动；记录首次响应耗时，但登录失败仍允许前端游客降级。
7. 验收完成后归档服务版本、后端 commit、前端 commit、默认域名、requestId 和测试结论，不归档 Secret。
