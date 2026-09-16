# HTTP API 契约

## 通用规则

- JSON 编码使用 UTF-8。
- 时间戳统一为 UTC Unix 毫秒。
- 客户端可传 `X-Request-Id`；服务端会校验长度并回显为 `requestId`。
- 鉴权接口后续使用 `Authorization: Bearer <token>`。
- 日志必须脱敏 authorization、平台 code、anonymousCode、token 和 sessionKey。

## 成功响应

```json
{
  "code": 0,
  "msg": "ok",
  "timestamp": 1789520000000,
  "requestId": "request-id",
  "data": {}
}
```

## 错误响应

```json
{
  "code": "ROUTE_NOT_FOUND",
  "msg": "接口不存在",
  "timestamp": 1789520000000,
  "requestId": "request-id"
}
```

## `GET /health`

无需鉴权，不读取数据库，用于容器或函数运行状态探测。

响应数据：

```json
{
  "status": "ok",
  "service": "miao-travel-server",
  "version": "0.1.0",
  "environment": "development",
  "platform": "wechat",
  "persistence": "memory"
}
```

## `POST /v1/auth/platform-login`

无需 Bearer token。当前部署的平台由服务端 `PLATFORM` 固定，客户端不能通过请求参数切换平台。

微信请求：

```json
{
  "code": "wx.login 返回的一次性 code",
  "clientVersion": "3.4.2"
}
```

抖音已登录请求使用 `code`；匿名登录可以使用 `anonymousCode`。两者至少提供一个。

成功数据：

```json
{
  "token": "自有会话 token",
  "playerId": "服务端玩家 ID",
  "isNew": true,
  "isBanned": false,
  "banReason": "",
  "banExpire": 0,
  "whiteList": false,
  "data": "",
  "saveRevision": 0,
  "serverTime": 1789520000000
}
```

安全约束：响应不返回平台 openid、unionid、session_key 或 AppSecret；服务端仅保存平台身份和自有 token 的 SHA-256 哈希。`persistence` 仅表示仓储驱动，不包含数据库地址或凭据。

错误码：

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 缺少 code/anonymousCode 或字段格式错误 |
| 401 | `PLATFORM_CODE_INVALID` | 缺少可用平台凭证 |
| 401 | `PLATFORM_AUTH_REJECTED` | 平台拒绝或 code 已失效 |
| 401 | `PLATFORM_RESPONSE_INVALID` | 平台响应缺少必要身份字段 |
| 503 | `PLATFORM_AUTH_UNAVAILABLE` | 平台认证服务超时或不可用 |
