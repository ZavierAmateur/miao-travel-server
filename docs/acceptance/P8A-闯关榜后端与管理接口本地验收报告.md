# P8A 闯关榜后端与管理接口验收报告

日期：2026-09-22

## 执行内容

- 新增 `level_leaderboard` 内存与 CloudBase HTTP 仓储。
- 云存档保存成功后同步当前关卡；资料更新后同步昵称头像；管理员回滚后同步回退关卡。
- 新增 `GET /admin/v1/leaderboards/level?page=N`，固定每页 20 条并返回连续排名与 `hasMore`。
- 新增历史存档一次性回填脚本和 CloudBase 集合探测。
- 非法关卡不会进入云存档或排行榜。

## 自动验收

- `npm run typecheck`：通过。
- 排行榜、云存档、用户资料和管理玩家专项测试覆盖了分页、投影和服务联动。
- `npm test`：22 个测试文件、89 项测试全部通过。
- `npm run lint`：通过。
- `npm run build`：生产 TypeScript 构建通过。

## 生产验收

- 用户已确认 CloudBase 云托管重新部署完成。
- `npm run db:check:wechat`：通过；生产环境 `level_leaderboard` 集合存在，CloudBase 读写探测成功。
- `npm run leaderboard:backfill:wechat`：通过；历史云存档成功投影 4 条，跳过 0 条，未修改原始云存档。
- 线上 `/health` 返回 HTTP 200。
- 线上 `GET /admin/v1/leaderboards/level?page=1` 未登录访问返回 HTTP 401 和 `ADMIN_AUTH_REQUIRED`，管理认证边界生效。

## 尚需人工验收

- 管理员登录后台后确认闯关榜显示 4 条历史玩家数据、名次和分页字段。
- 微信开放数据域好友榜需要至少两个真实微信账号验收好友关系、头像昵称、滚动与本人前 100 名外排名。
