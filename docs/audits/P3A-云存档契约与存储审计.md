# P3A 云存档契约与存储审计

日期：2026-09-16

## 审计范围

- 前端统一存档导出结构、真实模块键和启动恢复顺序。
- 后端会话、CloudBase HTTP 仓储能力和免费资源约束。
- 原计划中的云存档、历史版本、管理后台诊断与回滚需求。

## 结论

1. 前端 `ControllerManager.getUserStorage(true, false)` 的固定结构为 `version/serialized/time/modules`，实际模块只有 `settings/tutorial/user/task/activitys`。
2. `secret` 不参与统一导出；局内 `record` 当前没有声明 `dataKey`，也不会上传。P3 不擅自扩大存档范围。
3. 每名玩家采用一份 `cloud_saves` 聚合文档，`_id` 直接使用内部 playerId。
4. CloudBase HTTP SDK 提供条件 `where(...).update(...)`；使用 `_id + revision` 比较并交换，受影响文档数为 1 才算成功。首次保存用固定 `_id` 新增，重复主键回读后映射为幂等或冲突。
5. 当前版和上一版保存在同一文档，一次条件更新原子轮换，取消独立 `cloud_save_history` 集合，减少读写和跨集合一致性成本。
6. 客户端设备时间仅用于诊断；并发依据只有服务端 revision。409 只返回云端摘要，客户端保留本地脏档并停止自动覆盖。

## 安全与资源边界

- 最大 512 KiB、最大 32 层、最多 20000 个 JSON 节点。
- 拒绝 `NaN/Infinity`、非 JSON 对象和 `__proto__/prototype/constructor`。
- 日志脱敏完整 save 与 idempotencyKey。
- Bearer token 只以 SHA-256 查询 session；每次读写主动检查撤销和过期时间。
- 仅保留当前和上一版本，不无限累积历史。

## 管理后台影响

- 云存档诊断页改为读取同一文档的当前版与 `previous`。
- 新增六个云存档/会话错误码过滤项。
- 回滚仍通过未来的独立管理 API 生成新 revision；后台不能直接写数据库或降低 revision。
- 管理后台继续等待 P3 玩家接口和真实数据库验收完成后再开发。
