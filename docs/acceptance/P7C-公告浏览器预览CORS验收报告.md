# P7C 公告浏览器预览 CORS 验收报告

日期：2026-09-21

## 执行内容

- 为公共公告列表和详情增加本机浏览器预览 CORS 响应。
- 支持携带 `Content-Type`、`X-Client-Version` 的预检请求。
- 保留管理接口来源校验和微信云托管调用方式。

## 自动验收

- `http://localhost:7456` 公告预检返回 HTTP 204，并返回对应来源、方法和请求头许可。
- `http://127.0.0.1:7456` 公告 GET 返回 HTTP 200，并返回对应来源许可。
- 非本机来源不返回 `Access-Control-Allow-Origin`。
- 公告 API 既有增删改查、平台和启停隔离、富文本清理测试继续通过。

## 部署后验收

CloudBase Run 重新部署后，在 Cocos 浏览器预览中点击公告，列表和详情应不再出现 CORS 错误。微信开发者工具仍通过 `wx.cloud.callContainer` 请求，无需配置普通 `request` 域名。
