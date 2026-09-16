# P2B2 CloudBase HTTP 真实连通验收报告

日期：2026-09-16

## 已通过

- 配置审计通过：微信环境已提供环境 ID、地域、服务端 API Key、默认实例和默认数据库；验收日志未输出任何密钥。
- `npm run typecheck`、`npm run lint`、`npm run build` 通过。
- `npm test` 通过：7 个测试文件、19 个用例。
- CloudBase 官方 JS SDK 安装后依赖审计为 0 个漏洞；MongoDB 驱动已移除。
- `npm run db:check:wechat` 真实执行成功：`players`、`sessions` 集合可访问；随机探测记录写入、读回后已删除。
- 真实读写返回 CloudBase requestId，证明请求到达目标环境，而非内存替身。
- 单元测试确认数据库调用不含明文 openid、unionid；相同身份稳定派生相同 playerId；会话只以 token 哈希为文档主键。
- 本地真实 HTTP 回归通过：首次登录 HTTP 200 且 `isNew=true`；相同身份再次登录 HTTP 200、复用 playerId 且 `isNew=false`；缺少 code 的请求返回 HTTP 400 和 `INVALID_REQUEST`。验收服务随后已停止。

## 尚未完成

1. 需要微信开发者工具或真机产生有效且未使用的 `wx.login` code，验证真实 `code2Session -> players -> sessions` 完整链路。
2. 需要验证同一微信账号连续登录返回相同 playerId、第二次 `isNew=false`，并在控制台抽查无明文敏感标识。
3. 需要完成合法域名、HTTPS、游客降级、token 持久化和真机网络异常场景。
4. 抖音环境与凭据尚未配置，需在对应阶段重复隔离验收。

## 结论

P2B2 的 CloudBase 内置文档数据库适配与真实读写连通验收通过，可以提交推送。P2 登录阶段仍需真实微信 code 和开发者工具/真机联合验收后才能整体关闭。
