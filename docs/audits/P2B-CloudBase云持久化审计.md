# P2B CloudBase 云持久化审计

日期：2026-09-16

> 历史说明：本报告记录 P2B1 当时的 MongoDB 外连判断。P2B2 已确认目标产品是 CloudBase 内置文档数据库并改用官方 HTTP API，当前结论以 `P2B2-CloudBase-HTTP适配审计.md` 为准。

## 审计范围

- P2A 玩家、会话仓储接口及生产启动保护。
- 腾讯 CloudBase 文档型数据库的服务端接入方式。
- 云数据库中的平台身份、会话和管理后台查询需求。
- 新增生产依赖的安全审计。

## 发现

1. P2A 启动入口固定使用内存仓储，生产环境会按设计拒绝启动，但尚无可替换的云实现。
2. 玩家仓储以 `(platform, appId, openId)` 定位身份；若直接落库会保存明文 openid，不符合最小化存储原则。
3. 同一身份并发首次登录时，简单“先查后写”可能生成两个候选 playerId；仓储必须返回唯一键下最终落库的规范玩家。
4. CloudBase 文档型数据库当前官方说明兼容 MongoDB 协议并提供外部连接配置，可使用 MongoDB 官方驱动。
5. 试装 `@cloudbase/node-sdk@3.18.3` 后，`npm audit` 报告 4 个高危和 1 个中危传递依赖问题，涉及旧 axios 与原型污染相关包；该 SDK 已从依赖中移除，未进入交付版本。
6. 当前仍缺 CloudBase 环境 ID和私密 MongoDB 连接串，无法在本阶段声称真实云数据库已验证。

## 执行决定

- 增加 `memory|mongo` 显式仓储驱动；生产环境继续禁止 `memory`。
- 使用 MongoDB 官方驱动直连 CloudBase 文档型数据库，连接串只从云端 Secret/环境变量读取。
- `players._id` 使用平台身份组合的 SHA-256，`sessions._id` 使用自有 token 的 SHA-256；不落库明文 openid、unionid 或 token。
- 玩家 upsert 使用原子 `findOneAndUpdate + upsert`，仓储返回最终规范 playerId。
- 建立内部 playerId 唯一索引、后台检索组合索引、会话查询索引和过期 TTL 索引。
- 启动时连接、ping 并幂等确保索引；失败时服务不监听端口，避免假健康。

## 风险与回滚

- 外部连接能力、网络白名单和共享实例权限需在目标 CloudBase 控制台实测；若不允许创建索引，改为部署前脚本/控制台创建，但索引定义保持一致。
- CloudBase 当前文档型数据库仅支持上海地域；计算服务应选同地域以降低延迟和公网费用。
- 回滚可把开发/测试的 `PERSISTENCE_DRIVER` 改回 `memory`；生产环境不允许此降级，以免静默丢失玩家身份。
- 数据库连接串轮换只改 Secret，不改代码；日志与健康接口不得输出连接串。

## 后台影响

有。管理后台按 playerId 查询；openid 仅允许后端哈希后的精确匹配，不能模糊搜索或展示明文。玩家状态/最近登录组合索引已预留；真实环境索引与备份能力在 P2B2 后继续同步。

## 官方核对入口

- CloudBase 文档型数据库与外部连接：<https://cloud.tencent.com/document/product/876/46897>
- CloudBase 服务端 Node SDK：<https://cloud.tencent.com/document/product/876/47058>
- CloudBase 环境与产品概述：<https://cloud.tencent.com/document/product/876/18431>
