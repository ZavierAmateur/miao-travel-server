# P2B2 CloudBase HTTP 适配审计

日期：2026-09-16

## 审计结论

1. 用户实际启用的是 CloudBase 内置文档数据库，不是需连接串的 MongoDB 外部实例；P2B1 的 `mongodb` 驱动实现不适用。
2. CloudBase NoSQL HTTP API 使用环境 ID、地域、实例名、数据库名和服务端 API Key；API Key 只能保存在服务端 Secret/环境变量中。
3. `@cloudbase/node-sdk@3.18.3` 的旧依赖审计存在 4 个高危和 1 个中危问题，不进入交付版本。
4. `@cloudbase/js-sdk@3.9.4` 在 Node.js 提供数据库 HTTP API 通道，本项目安装后的 `npm audit --audit-level=moderate` 为 0 个漏洞。
5. 免费资源优先：登录只做必要文档读写，不建立常驻连接池，不加入 Redis、定时心跳或额外事务。

## 执行决定

- 仓储驱动改为 `memory|cloudbase-http`，彻底移除 Mongo 连接串和 MongoDB 官方驱动。
- CloudBase 配置统一使用 `CLOUDBASE_ENV_ID`、`CLOUDBASE_REGION`、`CLOUDBASE_API_KEY`、`CLOUDBASE_DATABASE_INSTANCE`、`CLOUDBASE_DATABASE_NAME`。
- `players._id` 继续使用平台身份组合的 SHA-256；内部 playerId 从该哈希单向派生为稳定 UUID 形态，解决并发首次登录产生不同账号的问题，同时不暴露 openid。
- `sessions._id` 仅保存自有 token 的 SHA-256；会话正文只含 playerId 和生命周期字段。
- 提供可回收的真实数据库探测：确保 `players`、`sessions` 集合存在，随机写入、读回并删除探测记录。

## 风险与后续

- 当前只完成微信 CloudBase 环境的数据库连通；真实微信一次性 code 仍需开发者工具或真机产生。
- 会话过期字段已经保存，TTL/普通索引需在 P3 结合 CloudBase 实际索引能力配置并验收；业务鉴权读取时仍必须主动检查 `expiresAt`，不能只依赖物理清理。
- `.env.wechat.local` 被 `.gitignore` 排除并限制为当前用户可读写；部署时改用 CloudBase Secret/环境变量。
- 聊天中曾出现过微信 AppSecret，正式上线前应在微信公众平台轮换并同步云端 Secret。

## 后台影响

有。后台不能再依赖 Mongo 外连、TTL 索引或连接串；玩家精确身份检索继续由后端哈希完成。内部 playerId 现在是稳定派生值，仍作为后台公开查询主键。后台计划已同步记录本次存储实现变化。
