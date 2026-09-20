# P5B5 管理接口 CloudBase 部署验收报告

## 验收时间与版本

- 日期：2026-09-20
- 环境：`cloud1-d3guut2kr1085b24f`
- 服务：`miao-travel-wechat`
- 最终版本：`miao-travel-wechat-011`
- 流量：100%
- 修复提交：`e682c53`

## 代码质量门禁

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：17 个测试文件、72 项测试全部通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- CloudBase 集合真实探测：8 个集合读写通过。

## 管理员认证与只读接口

通过公网 HTTPS 域名执行真实 HTTP 请求：

1. `POST /admin/v1/auth/login` 返回 200，并签发 HttpOnly Cookie。
2. `GET /admin/v1/auth/me` 返回 200，登录态可恢复。
3. `GET /admin/v1/players?limit=5` 返回 200。
4. 首条玩家详情返回 200，资料字段按契约返回，未在报告输出玩家身份数据。
5. `POST /admin/v1/auth/logout` 返回 200，会话撤销成功。

## 隔离玩家写操作验收

验收脚本创建唯一临时玩家、资料、玩家会话和两版云存档，执行完成后清理：

| 场景 | 结果 |
| --- | --- |
| 精确玩家查询 | HTTP 200，精确命中 1 条 |
| 玩家详情 | HTTP 200，资料存在，存档 revision=2 |
| 存档诊断 | HTTP 200，当前 revision=2、上一版 revision=1，识别 2 个字段变化 |
| 回滚上一版 | HTTP 200，来源 revision=1，新 revision=3 |
| 使用旧 expectedRevision 重复回滚 | HTTP 409，`SAVE_ROLLBACK_CONFLICT` |
| 临时封禁 | HTTP 200，状态变为 `banned` |
| 已有玩家会话读取云存档 | HTTP 403，`PLAYER_BANNED` |
| 解封 | HTTP 200，状态恢复 `active` |
| 解封后读取云存档 | HTTP 200 |
| 高风险操作审计 | 包含 `save.rollback`、`player.ban`、`player.unban` |
| 测试数据清理复查 | 唯一测试昵称剩余 0 条 |

## 验收结论

管理接口 A1～A3 所需后端能力已经在 CloudBase Run 真实环境通过：管理员登录、玩家查询、存档诊断、CAS 回档、封禁、解封和审计日志均可用。

## 当前保留边界

- 未对任何真实玩家执行回档、封禁或解封。
- 尚未进行大数据量玩家列表性能和组合索引压测。
- 游戏客户端对 `PLAYER_BANNED` 的正式提示，以及回档后的真实客户端同步体验仍需单独做微信端验收。
- V1 后台保持单管理员和简易页面，不开发管理员管理、多角色配置、会话管理、MFA 或 SSO。
