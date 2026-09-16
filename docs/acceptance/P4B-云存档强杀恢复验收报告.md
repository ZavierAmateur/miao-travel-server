# P4B 云存档强杀恢复验收报告

日期：2026-09-17

## 审计目标

- 验证云上传失败并等待重试时进程被直接关闭，不会破坏本地存档或云端已有版本。
- 验证重新启动后可从本地 revision 继续同步，且不会恢复已退出 V1 范围的模块。
- 本次不修改玩家资源、奖励或关卡数据，只通过开发者工具测试桥立即落盘并触发 user-only 上传。

## 真实演练

1. 基线云端和本地 revision 为 16，模块仅为 `user`。
2. 注入 HTTP 408 超时并触发上传，返回 revision 0；状态为 `pendingRequest=true`、`retryAttempt=1`、`automaticSyncStopped=false`。
3. 在请求待重试时直接关闭微信项目窗口，模拟小游戏进程被杀。
4. 重新打开项目后清除故障：本地和云端已知 revision 均为 16，无残留内存请求，客户端仍允许继续同步。
5. 再次触发 user-only 上传成功，revision 由 16 增至 17；待处理、重试和停写状态全部清零。
6. 最终冷启动后云档正常读取并因启动后的玩家状态变化自动同步至 revision 18；云端模块仍只有 `user`。
7. 验收结束后清理故障、命令和状态测试键。

## 验收结论

- 进程被杀没有让客户端错误清除本地档或覆盖既有云档。
- 内存中的待重试请求会随进程结束消失，但落盘数据与本地 revision 保留；重新登录后可安全生成新请求继续同步。
- 最终状态：`cloudRevision=18`、`localRevision=18`、`pendingRequest=false`、`retryAttempt=0`、`automaticSyncStopped=false`、`cloudModuleKeys=["user"]`。

P4B 微信开发者工具强杀恢复验收：通过。P4 仍需完成双设备旧 revision 冲突和抖音环境联调。
