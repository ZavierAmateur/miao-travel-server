# CloudBase Run 微信后端部署说明

日期：2026-09-16

## 1. 部署目标

- CloudBase 环境：使用微信环境对应的现有环境 ID。
- 服务名：`miao-travel-wechat`。
- 容器端口：`3000`。
- 访问策略：`PUBLIC,MINIAPP`；公网仅用于运维测试，微信小游戏通过 `wx.cloud.callContainer` 调用。
- 最小副本数：`0`，避免空闲常驻消耗试用额度。
- 最大副本数：`1`，首版先限制资源上限；容量验收后再调整。

## 2. 首次部署推荐流程

首次部署优先使用 CloudBase 控制台的“云函数/托管”创建服务，因为创建页面可以同时配置环境变量，避免先发布一个缺少 Secret、无法启动的版本。

1. 进入目标 CloudBase 环境，选择“云函数/托管”。
2. 新建容器型服务，服务名填写 `miao-travel-wechat`。
3. 选择本地代码/文件夹上传，代码目录选择本仓库根目录；Dockerfile 路径为根目录的 `Dockerfile`。
4. 服务端口填写 `3000`，访问类型同时启用公网访问和小程序/小游戏调用。
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
| `COS_SECRET_ID` | 腾讯云 API 密钥 ID，使用 Secret 管理 |
| `COS_SECRET_KEY` | 腾讯云 API 密钥 Key，使用 Secret 管理 |
| `COS_BUCKET` | `miao-1487859276` |
| `COS_REGION` | `ap-guangzhou` |
| `COS_PUBLIC_BASE_URL` | `https://miao-1487859276.cos.ap-guangzhou.myqcloud.com`；以后绑定自定义 HTTPS 域名时替换 |

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
  --open-access-types PUBLIC,MINIAPP \
  --wait
```

不要使用 `--force` 跳过首次确认；先核对环境、服务名、端口、访问策略和副本数。禁止只填 `PUBLIC`，否则公网健康检查正常但 `wx.cloud.callContainer` 会返回 `SERVICE_FORBIDDEN`。

## 5. 上线验收

1. 默认域名的 `GET /health` 返回 HTTP 200，响应中 `environment=production`、`platform=wechat`、`persistence=cloudbase-http`。
2. 将 HTTPS 域名加入微信小游戏 request 合法域名，并同步到前端生产 `baseUrl`。
3. 用新鲜的 `wx.login` code 请求 `POST /v1/auth/platform-login`；code 不得写入日志或验收文档。
4. 同一微信账号连续登录两次，playerId 相同，第二次 `isNew=false`。
5. CloudBase `players`、`sessions` 中不存在明文 openid、unionid、token、AppSecret 或 API Key。
6. 验证服务缩容到 0 后可以冷启动；记录首次响应耗时，但登录失败仍允许前端游客降级。

注意：CloudBase 按文档 ID 读取不存在记录时会抛出 `DOCUMENT_NOT_FOUND`。首次玩家登录和无效会话查询必须把该错误视为“未找到”；权限、网络、配额等错误不得按空记录吞掉。
7. 验收完成后归档服务版本、后端 commit、前端 commit、默认域名、requestId 和测试结论，不归档 Secret。

## 6. CLI 诊断安全

`tcb cloudrun detail --json` 的 `ServerConfig.EnvParams` 可能包含全部环境变量原文。禁止把完整输出复制到工单、聊天、日志或验收报告。必须先删除 `EnvParams`，或仅提取域名、规格、副本数、端口和版本等非敏感字段。
## 7. 远程启动配置

P5A 起需要 `remote_configs` 集合和固定文档 `bootstrap`。`npm run db:check:wechat` 会确保集合存在。

首次初始化或后续更新时，在本地安全环境执行：

```bash
BOOTSTRAP_CONFIG_CONFIRM=PUBLISH \
BOOTSTRAP_UPDATED_BY=operator-name \
BOOTSTRAP_MAINTENANCE_ENABLED=false \
BOOTSTRAP_CLOUD_SAVE_ENABLED=true \
npm run bootstrap:publish:wechat
```

可选变量：`BOOTSTRAP_MAINTENANCE_MESSAGE`、`BOOTSTRAP_MINIMUM_CLIENT_VERSION`。命令不会输出 CloudBase API Key；不要把 `.env.wechat.local` 或命令行凭据提交到 Git。

## 8. 玩家头像昵称资料

P5B1 起需要 `player_profiles` 集合。部署新代码前后均可执行：

```bash
npm run db:check:wechat
npm run profile:check:wechat
```

第一条命令会确保集合存在；第二条只写入随机 `profile-probe-*` 文档，验证首次写入、读取、更新，并在 `finally` 中删除测试文档。命令不输出昵称头像以外的玩家数据，也不会访问现有玩家资料。部署后还需在微信开发者工具由用户点击资料页刷新按钮，验收真实授权、`PUT /v1/profile`、冷启动 `GET /v1/profile` 和首页头像刷新。

## 9. 公告和 COS 上传

公告阶段新增 `announcements` 集合，部署前运行 `npm run db:check:wechat` 会在缺失时创建。通用上传接口由服务器使用 `COS_SECRET_ID/COS_SECRET_KEY` 写入 COS；密钥不得配置在管理后台或小游戏前端。存储桶保持“公有读、私有写”，并给该服务端密钥配置尽量小的对象上传权限。

## 闯关榜部署

排行榜阶段新增 `level_leaderboard` 集合。部署新代码前执行：

```bash
npm run db:check:wechat
```

新云存档和微信资料会自动更新榜单。首次部署后执行一次历史回填：

```bash
npm run leaderboard:backfill:wechat
```

后台接口为 `GET /admin/v1/leaderboards/level?page=1`，固定每页 20 条。小游戏中的微信好友榜使用开放数据域，不读取该集合，也不会把微信好友关系写入服务器。

COS 默认域名可以先用于接口联调。控制台已经提示 2024 年以后创建的存储桶默认域名可能不能直接在浏览器预览，正式展示前应绑定自定义 HTTPS 或 CDN 域名，并把 `COS_PUBLIC_BASE_URL` 更新为该域名；公告数据结构和接口不需要调整。
