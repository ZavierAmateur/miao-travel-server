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

## 真实数据归一化记录

- 新前端对旧 revision 14 发起 user-only PUT，临时失败后复用同一请求自动重试成功，云档升至 revision 15。
- CloudBase 更新嵌套对象时保留未显式删除的旧字段，因此只根据 PUT 请求正文不能证明数据库已完成收缩。
- 经用户确认后，仅对唯一匹配的 revision 15 测试文档删除 `settings/tutorial/task/activitys`，实际匹配并修改 1 条记录。
- 脱敏查询复核：`save.modules.user` 存在且匹配 1 条；四个旧模块任一存在的查询匹配 0 条，未读取存档正文。
- 清理后客户端冷启动两次遇到云托管登录超时并按设计降级本地；待服务恢复后补充 GET 证据。

结论：P3B 代码、契约和当前测试云档 user-only 结构验收通过；后端 Git 平台更新部署以及客户端冷启动 GET 仍需完成。
