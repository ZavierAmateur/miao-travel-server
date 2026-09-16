# P4C 云存档旧版本冲突验收报告

日期：2026-09-17

## 审计目标

- 用真实微信登录会话和真实 CloudBase Run 接口模拟第二台设备持有旧 revision 的写入。
- 验证 CAS 返回 409，旧设备不能覆盖较新的云档，也不会触发客户端自动重试覆盖。
- 测试通道只返回 HTTP 状态、业务码和 revision，不暴露 token、玩家 ID 或存档正文。

## 自动与构建验收

- 前端新增仅开发者工具可用的 `stale-save` 固定命令，使用 `cloudRevision - 1` 作为 baseRevision，独立于正式待上传队列。
- 全量前端测试 90 项通过；定向接入测试 18 项通过；`git diff --check` 通过。
- 微信构建完成，日志为 `build/logs/wechat-build-20260917-003242.log`。

## 微信真实服务验收

- 基线：`cloudRevision=18`、`localRevision=18`、模块仅为 `user`。
- 模拟旧设备请求使用 baseRevision 17，真实接口返回 HTTP 409，业务码 `SAVE_CONFLICT`，没有返回新 revision。
- 请求完成后客户端仍为 revision 18，`pendingRequest=false`、`retryAttempt=0`、`automaticSyncStopped=false`。
- CloudBase 数据库只读复核仍为 revision 18，证明冲突请求没有写入或覆盖云档。
- 验收结束后已清理测试命令、状态和故障注入键。

## 结论

P4C 旧 revision 冲突验收通过：服务端 CAS 能阻止旧设备覆盖新云档，客户端不会把 409 作为临时错误循环重试。P4 微信侧云存档故障演练完成，剩余抖音环境联调。
