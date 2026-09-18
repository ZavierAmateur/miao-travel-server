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

## 管理员认证 `/admin/v1/auth/*`

管理员认证与玩家 Bearer 会话完全独立。V1 角色仅为 `admin`（超管）和 `operator`（运营）。管理会话通过 `miao_admin_session` HttpOnly Cookie 传递，响应正文不返回 token。

### `POST /admin/v1/auth/login`

```json
{
  "account": "root.admin",
  "password": "管理员密码"
}
```

成功数据包含 `identity`（`id/account/displayName/role/permissions`）和 `expiresAt`，同时设置 `HttpOnly; SameSite=Strict` Cookie；生产环境额外设置 `Secure`。当前内部管理后台不限制登录失败次数，错误凭证始终返回同一错误。

### `GET /admin/v1/auth/me`

读取当前 Cookie 会话，返回管理员身份、角色、权限和过期时间。账号停用、会话撤销或过期均拒绝访问。

### `POST /admin/v1/auth/logout`

撤销服务端会话并清除 Cookie。登录和退出均写入 `admin_audit_logs`。

错误码：

| HTTP | code | 说明 |
|---|---|---|
| 401 | `ADMIN_AUTH_REQUIRED` | 缺少管理员会话 |
| 401 | `ADMIN_CREDENTIALS_INVALID` | 账号或密码错误，不区分账号是否存在 |
| 401 | `ADMIN_SESSION_INVALID` | 会话无效或已撤销 |
| 401 | `ADMIN_SESSION_EXPIRED` | 会话已过期 |
| 403 | `ADMIN_ACCOUNT_DISABLED` | 管理员账号已停用 |
| 403 | `ADMIN_ORIGIN_FORBIDDEN` | 写请求来源不是配置的管理后台域名；开发环境允许 localhost 与 127.0.0.1 同端口互换 |
| 409 | `SAVE_CONFLICT` | baseRevision 不是当前版本 |
| 413 | `SAVE_TOO_LARGE` | 存档超过 512 KiB |

## 管理端玩家查询

以下接口使用管理员 Cookie 会话并要求 `player:read` 权限。响应不会返回平台 openid、unionid、存档正文、幂等键或哈希。

### `GET /admin/v1/players`

查询参数：`playerId`（完整 ID 精确匹配）、`platform=wechat|bytedance`、`status=active|banned`、不透明 `cursor` 和 `limit`（1～50，默认 20）。返回 `items` 和下一页 `nextCursor`；没有下一页时为 `null`。

每项包含 `id/platform/status/createdAt/lastLoginAt`，有云存档时额外给出 `revision/clientVersion/clientSavedAt/serverSavedAt/sizeBytes` 摘要。玩家列表不加载昵称或头像。

### `GET /admin/v1/players/:playerId`

返回单个玩家的基础信息、只读昵称头像资料和云存档摘要。头像 URL 可能失效，前端必须提供占位；资料和存档不存在时对应字段为 `null`。

### `GET /admin/v1/players/:playerId/save`

要求 `save:read`。返回 `current`、`previous` 和 `changes`；两个版本只包含 revision、客户端版本、客户端/服务端保存时间、hash、大小和白名单内 `user` 字段。`changes` 按字段名给出上一版与当前值。

### `POST /admin/v1/players/:playerId/save-rollback`

要求 `save:rollback`（当前仅超管拥有）。请求体为 `{ "expectedRevision": 2, "reason": "误覆盖恢复" }`。服务端仅在当前 revision 等于 `expectedRevision` 时把内嵌 `previous` 恢复为正文，同时生成更大的新 revision，并将回滚前版本轮换为新的 `previous`。成功回滚写入管理审计。

### `POST /admin/v1/players/:playerId/ban`

要求 `player:ban`。临时封禁请求体为 `{ "type": "temporary", "expiresAt": 1789800000000, "reason": "异常行为", "note": "内部备注" }`；永久封禁不传 `expiresAt`，且仅 `admin` 可执行。已有玩家会话在下一次资料或云存档鉴权时返回 HTTP 403 `PLAYER_BANNED`。

### `POST /admin/v1/players/:playerId/unban`

要求 `player:ban`，请求体为 `{ "reason": "复核通过" }`。封禁、解封、回滚均记录管理员、目标玩家、requestId、IP、原因和必要操作元数据。

错误码：

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_CURSOR` | 分页游标无效 |
| 401 | `ADMIN_AUTH_REQUIRED` 等 | 管理员会话缺失、失效或过期 |
| 403 | `ADMIN_PERMISSION_DENIED` | 当前角色缺少 `player:read` |
| 404 | `PLAYER_NOT_FOUND` | 玩家不存在 |
| 404 | `SAVE_NOT_FOUND` | 玩家暂无云存档 |
| 409 | `SAVE_PREVIOUS_NOT_FOUND` | 没有可回滚的上一版本 |
| 409 | `SAVE_ROLLBACK_CONFLICT` | 回滚时当前 revision 已变化 |
| 403 | `PLAYER_BANNED` | 玩家已被封禁，玩家业务请求被拒绝 |

## `GET /v1/profile`

需要 Bearer token。玩家昵称头像与玩法云存档分离，每次登录成功后最多读取一次。资料尚未设置不是错误：

```json
{
  "exists": false,
  "nickName": "",
  "avatarUrl": "",
  "updatedAt": 0
}
```

存在资料时返回 `exists=true` 以及当前 `nickName/avatarUrl/updatedAt`。头像只保存微信返回的 HTTPS URL，不复制图片文件；用户更换微信头像后旧 URL 可能失效，需要再次主动同步。

## `PUT /v1/profile`

需要 Bearer token。只能由客户端在用户点击微信原生资料授权按钮并取得结果后调用：

```json
{
  "nickName": "旅行猫",
  "avatarUrl": "https://example.com/avatar.png"
}
```

规则：昵称去除首尾空白后为 1～32 个 Unicode 字符，不允许控制字符；头像可为空，否则必须为不超过 2048 字符的 HTTPS URL。额外字段会被 HTTP 校验层丢弃，服务端只保存上述两项及服务端生成的 `updatedAt`。请求日志对昵称和头像地址脱敏。

成功数据：

```json
{
  "nickName": "旅行猫",
  "avatarUrl": "https://example.com/avatar.png",
  "updatedAt": 1789520000000
}
```

错误码：

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 请求字段缺失或基础类型错误 |
| 400 | `INVALID_PROFILE` | 昵称或头像地址不符合资料规则 |
| 401 | `AUTH_REQUIRED` | 未携带 Bearer token |
| 401 | `SESSION_INVALID` | token 无效或已撤销 |
| 401 | `SESSION_EXPIRED` | token 已过期 |
