# P2A 双平台登录本地联调验收报告

日期：2026-09-16

## 阶段定义

P2 拆为：

- P2A：后端双平台 adapter、登录服务、会话契约、游戏前端接入和本地真实 HTTP 联调。
- P2B：配置平台云 Secret、持久化数据库和合法域名后，用微信/抖音真 code 完成开发者工具及真机验收。

本报告只验收 P2A，不宣称 P2 整体完成。

## 后端验收

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 通过，6 个测试文件、12 个测试 |
| `npm run build` | 通过 |
| `git diff --check` | 通过 |

覆盖内容：

- 微信 code2Session 成功与平台拒绝。
- 抖音 code 和 anonymousCode 身份归一化。
- 同一平台身份复用 playerId。
- 自有 token 只保存 SHA-256 哈希。
- 登录响应不包含 openid、platform session key 或 AppSecret。
- API 参数校验与统一错误响应。

## 真实 HTTP 验收

使用仅限测试环境的 mock 平台 gateway，在 `127.0.0.1:43128` 启动真实 Fastify 服务。

1. 首次 `POST /v1/auth/platform-login`：HTTP 200，`playerId=acceptance-player`，`isNew=true`，requestId 正确回显。
2. 同一身份再次登录：HTTP 200，相同 playerId，`isNew=false`。
3. 缺少 code/anonymousCode：HTTP 400，`code=INVALID_REQUEST`。
4. 响应未出现 mock openid 或 platform session key。
5. 验收后已停止临时监听进程。

## 游戏前端联合验收

- 全量 `node --test tests/*.test.mjs`：74 项通过，0 失败。
- 新增登录集成测试覆盖：抖音平台枚举、anonymousCode、后端路径、baseUrl 限制、超时、Bearer、游客降级和日志脱敏。
- `git diff --check` 通过。
- 三个原 CRLF SDK 文件保持统一 CRLF；`LoadingActivity.ts` 沿用既有混合行尾且未产生整文件 diff。
- Cocos 工程没有本地 `tsc`/`eslint` 可执行文件，因此本阶段未声明完成 Cocos TypeScript 编译；需在开发者工具/Creator 构建时补验。

## 安全验收

- 前端 SDK 拒绝绝对 URL，所有请求只允许拼接 `Env.baseUrl`，避免 Bearer token 外发。
- 登录请求不携带客户端指定 platform，服务端部署配置固定平台。
- 日志不再序列化完整登录响应和 token。
- 后端平台请求 URL 不进入业务响应。

## P2B 待完成

1. 确认微信、抖音云环境和数据库类型，实现持久化玩家/会话仓储。
2. 配置两平台 AppId、AppSecret、HTTPS 域名及合法域名白名单。
3. 微信开发者工具和真机使用真实 `wx.login` code 验收。
4. 抖音开发者工具和真机分别验收已登录 code 与 anonymousCode。
5. 验证服务重启后 playerId 和 session 仍然有效。

## 结论

P2A 本地实现和联合测试通过，可以分别提交后端与游戏前端。P2 整体仍为进行中，不能在完成 P2B 前标记完成。
