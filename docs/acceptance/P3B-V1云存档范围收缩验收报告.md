# P3B V1 云存档范围收缩验收报告

日期：2026-09-16

## 审计

- 已确认前端五个模块没有独立后端 API，之前由通用导出机制一并进入云档。
- 已确认 `record` 无 `dataKey`，从未进入云存档。
- 已确认强制本地落盘和 `user.saveTime` 联动可能误触发全量云同步。

## 执行

- 服务端 V1 持久化白名单收缩为 `user`。
- 兼容旧五模块请求，但先做完整输入校验，再只计算并保存 user-only 正文、hash 和 size。
- 没有 `user`、`user` 非对象或包含未知模块的请求继续拒绝。
- API、后端计划和管理后台计划均同步为 user-only 契约。

## 自动验收

- `CloudSaveValidation` 覆盖旧五模块归一化、缺少 user 拒绝、未知模块拒绝、大小和危险键校验。
- API 测试确认旧格式 PUT 后 GET 只返回 `modules.user`。
- 后端 11 个测试文件、43 项测试全部通过；typecheck、lint、build 和 `git diff --check` 均通过。

## 待部署验收

- 推送后在 CloudBase 控制台执行一次“更新 Git 平台部署”。
- 微信开发者工具用新前端强制上传一次，确认 revision 增加且测试状态中的 `cloudModuleKeys` 仅为 `user`。
- 冷启动再次读取，确认云端只返回 user，同时本地设置、引导、任务和活动不被旧云档覆盖。

结论：P3B 代码与契约验收通过；云端部署和微信真实请求证据完成后补充最终 revision。
