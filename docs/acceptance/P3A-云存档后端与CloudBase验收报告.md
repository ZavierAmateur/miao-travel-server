# P3A 云存档后端与 CloudBase 验收报告

日期：2026-09-16

## 审计结论

- 单玩家单文档、revision 条件写、幂等键和内嵌上一版本符合 V1 低资源目标。
- 当前前端云存档白名单固定为 `settings/tutorial/user/task/activitys`。
- `secret` 与局内 `record` 当前不上传；后续如扩展必须重新审计结构和体积。

## 执行内容

- 新增 `GET /v1/save`、`PUT /v1/save` 和 Bearer session 鉴权。
- 新增 512 KiB、JSON 深度/节点、模块白名单、有限数字和原型污染校验。
- 新增内存仓储和 CloudBase HTTP 仓储；CloudBase 使用 `_id + revision` 条件更新。
- 新增幂等重放、409 冲突摘要、当前版/上一版原子轮换。
- 日志新增完整存档和幂等键脱敏。
- 数据库探针增加 `cloud_saves` 集合，并新增可自动清理的云存档行为探针。
- 同步 HTTP API、后端计划和管理后台计划。

## 自动验收

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：11 个测试文件、39 项测试全部通过。
- `npm run build`：通过。
- `git diff --check`：通过。

覆盖：空档读取、首次写入、读取、幂等重放、revision 冲突、CloudBase 条件更新并发失败、token 缺失/无效/过期、模块白名单、危险键和大小上限。

## 真实 CloudBase 验收

环境：微信 CloudBase，`cloudbase-http`，`ap-shanghai`，默认数据库。

1. `db:check:wechat` 确认 `players/sessions/cloud_saves` 三个集合可用，写入、读取和清理探针通过。
2. `save:check:wechat` 完成真实行为验证：
   - 首次写入：revision 1；
   - 同请求幂等重放：仍为 revision 1；
   - `_id + revision` 条件更新：revision 2；
   - 旧 baseRevision：返回冲突，当前 revision 2；
   - 上一版本：revision 1；
   - 验收结束后探针文档已删除。

## 尚未完成

- 新代码尚需推送并在 CloudBase Run 更新 Git 平台部署。
- 部署后需用微信开发者工具完成真实玩家首次 GET、首次 PUT、二次启动 GET 和退后台 PUT 验收。
- 抖音云环境与开发者工具验收仍留在后续平台阶段。
