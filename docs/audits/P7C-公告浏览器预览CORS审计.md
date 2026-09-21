# P7C 公告浏览器预览 CORS 审计

## 故障链

1. Cocos 浏览器预览运行在 `http://localhost:7456`。
2. Web 平台通过 `XMLHttpRequest` 请求正式 CloudBase Run 公告接口。
3. 请求携带 `Content-Type: application/json` 和 `X-Client-Version`，浏览器先发起 CORS 预检。
4. 服务端仅为 `/admin/v1/*` 配置跨域响应，公共公告接口没有返回 `Access-Control-Allow-Origin`。
5. 浏览器在业务请求到达前拦截请求，前端最终得到 HTTP 0；正式接口本身可正常返回 HTTP 200。

## 修复边界

- 仅对 `/v1/announcements*` 公共只读接口开放浏览器预览跨域。
- 仅允许 `http://localhost:*`、`http://127.0.0.1:*` 和 `http://[::1]:*`。
- 仅允许 `GET/OPTIONS`，请求头仅放行 `Content-Type` 和 `X-Client-Version`。
- 不开放通配来源，不允许外部网站跨域访问，也不改变管理后台的独立来源校验。
- 微信小游戏的 `wx.cloud.callContainer` 调用路径保持不变。
