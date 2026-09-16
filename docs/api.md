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
  "platform": "wechat"
}
```
