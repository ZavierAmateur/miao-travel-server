# HTTP API 契约

## 通用规则

- JSON 编码使用 UTF-8。
- 时间戳统一为 UTC Unix 毫秒。
- 客户端可传 `X-Request-Id`；服务端会校验长度并回显为 `requestId`。
- 鉴权接口使用 `Authorization: Bearer <token>`。
- 日志必须脱敏 authorization、平台 code、anonymousCode、token、sessionKey、完整存档和幂等键。

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

生产环境的 `persistence` 值为 `cloudbase-http`；CloudBase 环境 ID、API Key、实例和数据库名均不通过业务接口返回。

错误码：

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 缺少 code/anonymousCode 或字段格式错误 |
| 401 | `PLATFORM_CODE_INVALID` | 缺少可用平台凭证 |
| 401 | `PLATFORM_AUTH_REJECTED` | 平台拒绝或 code 已失效 |
| 401 | `PLATFORM_RESPONSE_INVALID` | 平台响应缺少必要身份字段 |
| 503 | `PLATFORM_AUTH_UNAVAILABLE` | 平台认证服务超时或不可用 |

## `GET /v1/bootstrap-config`

无需鉴权。客户端冷启动拉取一次并按 `cacheTtlSeconds` 缓存；请求失败不得阻断本地游戏。

成功数据：

```json
{
  "configRevision": 1,
  "maintenance": {
    "enabled": false,
    "message": ""
  },
  "minimumClientVersion": "",
  "features": {
    "cloudSaveEnabled": true
  },
  "cacheTtlSeconds": 300
}
```

应用响应包含基于配置正文计算的 `ETag` 和 `Cache-Control: public, max-age=300`。直连应用且 `If-None-Match` 匹配时返回 HTTP 304。当前 CloudBase 公网网关会覆盖这些缓存响应头，因此微信生产客户端以响应中的 `cacheTtlSeconds` 做本地缓存，不能依赖网关 304。配置不存在时返回 revision 0 的安全默认值；内部 `updatedAt/updatedBy` 不通过匿名接口返回。

## `GET /v1/save`

需要 Bearer token。每次冷启动登录成功后读取一次；不存在云存档不是错误。

不存在时的成功数据：

```json
{
  "exists": false,
  "revision": 0,
  "serverSavedAt": 0,
  "save": null
}
```

存在时额外返回 `hash` 和完整 `save`：

```json
{
  "exists": true,
  "revision": 3,
  "serverSavedAt": 1789520000000,
  "hash": "sha256 hex",
  "save": {
    "version": "3.4.2",
    "serialized": 1,
    "time": 1789519999000,
    "modules": {
      "user": {}
    }
  }
}
```

## `PUT /v1/save`

需要 Bearer token。请求体：

```json
{
  "baseRevision": 3,
  "clientVersion": "3.4.2",
  "clientSavedAt": 1789519999000,
  "idempotencyKey": "客户端为本次快照生成且重试时复用的唯一键",
  "save": {
    "version": "3.4.2",
    "serialized": 1,
    "time": 1789519999000,
    "modules": {
      "user": {}
    }
  }
}
```

保存成功数据：

```json
{
  "revision": 4,
  "serverSavedAt": 1789520000000,
  "hash": "sha256 hex",
  "duplicate": false
}
```

相同幂等键和相同请求重放返回同一个 revision，`duplicate=true`。写入仅在 `baseRevision` 等于当前 revision 时成功；冲突返回 HTTP 409 和当前云端的 `revision/serverSavedAt/hash` 摘要，客户端不得自动覆盖。

限制：JSON UTF-8 编码后最多 512 KiB；`serialized` 必须为 1；V1 必须包含对象类型的 `user` 模块，服务端只持久化 `user`。为兼容已经发布的旧客户端，请求可以暂时携带 `settings/tutorial/task/activitys`，但这些模块会在校验后被丢弃。其他模块仍拒绝；同时拒绝危险原型键、非有限数字、过深或节点过多的数据。

V1 `modules.user` 字段白名单固定为：

```text
saveTime, undoCount, refreshCount, bombCount, winnerStreakCount,
todaySuccessCount, animals, todayVideoForEnergyCount, sevenSignProgress,
sevenSignTodayState, refreshAnimalId, todayAnimalId, levelMaxProgress,
subscribeStae, adFreeCount, level, energy, energyTimer, energyInfinite,
gold, star, totalRechargeAmount, totalGoodBuyCounts, todayGoodBuyCounts,
todayGoodsBuyTime, firstSevenAwardGot, myMiniProgramDaily, desktopDaily,
todayAdReliveCount
```

未列入白名单的 user 字段会被服务端丢弃。CloudBase 条件更新使用整对象替换语义，因此一次成功 PUT 后，当前 `save` 中这次请求已省略的历史 user 字段会被实际删除；`revision` 条件写、幂等与 409 冲突规则不变。

错误码：

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 请求字段缺失或基础类型错误 |
| 400 | `INVALID_SAVE` | 存档结构、模块或数值不合法 |
| 401 | `AUTH_REQUIRED` | 未携带 Bearer token |
| 401 | `SESSION_INVALID` | token 无效或已撤销 |
| 401 | `SESSION_EXPIRED` | token 已过期 |
| 409 | `SAVE_CONFLICT` | baseRevision 不是当前版本 |
| 413 | `SAVE_TOO_LARGE` | 存档超过 512 KiB |
