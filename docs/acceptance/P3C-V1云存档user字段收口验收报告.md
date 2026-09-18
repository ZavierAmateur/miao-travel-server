# P3C V1 云存档 user 字段收口验收报告

日期：2026-09-18

## 审计结论

- 已确认前端 PUT 请求正文正确，旧字段残留由 CloudBase 嵌套对象更新合并造成。
- 已确认修复必须继续保留 `_id + revision` 条件更新，不能用无条件覆盖替代 CAS。
- 已确认服务端此前只有模块级 `user` 收口，缺少 user 内部字段白名单。

## 执行内容

- CloudBase 数据库抽象增加 `command.set()`；已有云档更新时整体替换 `save` 和 `previous`。
- 服务端增加 29 个 V1 user 字段白名单，与微信前端 `PlayerCloudSave.ts` 保持一致。
- 旧客户端请求仍执行完整安全和大小校验，但白名单外 user 字段不会参与持久化、hash 和 size。
- 真实数据库探针新增“旧字段在下一次更新后必须消失”的断言。
- API 契约、后端开发计划和管理后台开发计划同步更新。

## 自动验收

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：13 个测试文件、50 项测试全部通过。
- `npm run build`：通过。
- `git diff --check`：通过。

## 真实环境与部署验收

- [x] `npm run save:check:wechat` 真实 CloudBase 临时探针通过：首次写入 revision 1、幂等重放保持 revision 1、整体替换更新为 revision 2、旧 revision 冲突仍返回 revision 2，且当前版不再包含首版写入的 `todayPlayCount`；随机探针文档已自动清理。
- [x] 已以中文提交 `d09473e`（`修复云存档废弃字段残留并收紧服务端白名单`）推送到 `origin/main`。
- [ ] CloudBase 控制台执行“更新 Git 平台部署”并发布新版本。
- [ ] 微信开发者工具重新登录后成功 PUT，新 revision 增加。
- [ ] 随后 GET 的当前 `save.modules.user` 仅含 29 个白名单字段。

当前结论：代码、自动测试、真实数据库临时探针和提交推送已通过；云端部署和真实玩家 GET 尚未完成，暂不标记 P3C 最终验收通过。
