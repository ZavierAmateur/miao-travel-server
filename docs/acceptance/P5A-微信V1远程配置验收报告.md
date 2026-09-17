# P5A 微信 V1 远程配置验收报告

## 审计与范围

- 本阶段只完成微信 V1 启动配置和云存档总开关；抖音、兑换码、完整管理后台均延期。
- 配置不是强启动依赖：网络、数据库或配置异常时，客户端继续使用旧缓存或内置安全默认值进入本地游戏。
- 写配置不开放公网接口，只提供需要 CloudBase 服务端凭据和显式确认值的本地 CLI。

## 后端执行

- 新增 `GET /v1/bootstrap-config`、稳定 ETag、应用层 304 和五分钟 TTL 契约。
- 新增 `remote_configs/bootstrap` 单文档仓储；内部保留 revision、updatedAt、updatedBy，匿名响应不暴露审计字段。
- 新增受保护发布命令 `npm run bootstrap:publish:wechat`，没有 `BOOTSTRAP_CONFIG_CONFIRM=PUBLISH` 时拒绝执行。
- `db:check:wechat` 已覆盖 `remote_configs` 集合创建与连通探测。

## 前端执行

- 冷启动通过 `wx.cloud.callContainer` 匿名拉取配置，最长等待三秒。
- 客户端按 1～15 分钟有界 TTL 缓存；拉取失败使用旧缓存或默认开启状态，不阻断本地游戏。
- 维护状态或 `cloudSaveEnabled=false` 时，本次运行不读取、不写入云存档；维护/最低版本提示在进入游戏后显示一次。
- V1 云存档范围仍只有 `user`，未恢复其他本地模块上传。

## 自动与构建验收

- 后端完整测试 49 项通过；typecheck、lint、build、依赖审计和 `git diff --check` 通过，依赖审计为 0 个已知漏洞。
- 前端完整 Node 测试 92 项通过，其中新增远程配置策略与接入测试；`git diff --check` 通过。
- 微信小游戏构建成功，产物目录为 `build/miao-travel-diary-wechat`，日志为 `build/logs/wechat-build-20260917-091126.log`。

## 真实 HTTP、数据库与微信验收

1. 本地真实服务请求返回 HTTP 200、revision 0 安全默认值；携带匹配应用 ETag 返回 HTTP 304。
2. 微信 CloudBase 已创建 `remote_configs`，真实读写探测和自动清理通过；安全配置发布为 revision 1：维护关闭、最低版本为空、云存档开启。
3. 新后端版本已部署至 `miao-travel-wechat`，公网请求返回 HTTP 200 和 revision 1。
4. CloudBase 公网网关实测覆盖应用缓存头并返回自身弱 ETag，条件请求仍为 200；因此生产端明确使用本地 TTL，不宣称网关 304 已生效。
5. 首次 CLI 部署只配置 `PUBLIC` 时，微信 `callContainer` 返回 `SERVICE_FORBIDDEN`；客户端按设计回退安全默认值且本地档可用。
6. 访问策略随即修正为 `PUBLIC,MINIAPP` 并重新部署。微信开发者工具随后真实缓存 revision 1，云存档读取恢复至 revision 21，状态为无待请求、无重试、未停写，云端模块仅 `user`。

## 验收边界

- 为避免中断共享微信环境，本阶段没有在线把正式 `cloudSaveEnabled` 切换为 false。关闭态由后端持久化配置测试、前端策略测试和静态接入测试覆盖。
- 真正面向用户关闭开关时，仍应按变更流程二次确认、记录原因，并在小范围账号验证后执行。

## 结论

P5A 微信 V1 远程配置实现、真实数据库、云端部署、开启态 `callContainer` 和原有云存档回归均通过。部署访问策略必须保持 `PUBLIC,MINIAPP`；下一阶段可进入封禁与最小管理 API。
