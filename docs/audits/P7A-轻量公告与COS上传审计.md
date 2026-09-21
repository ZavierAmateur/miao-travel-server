# P7A 轻量公告与 COS 上传审计

日期：2026-09-21

## 审计结论

- 公告是独立业务资源，不放入启动配置，也不为了少一次请求扩充已有接口。
- 公共端按常规方式提供分页列表和详情；管理端提供列表、详情、新增、全量更新、删除。
- 公告字段不包含 `revision`、`minimumClientVersion`、`maximumClientVersion`。
- 正文使用经过服务端清理的富文本；正文不内嵌图片，图片数组由客户端在正文下方按顺序展示。
- 图片先调用通用 `POST /admin/v1/files/upload`，后端上传腾讯 COS 并返回 URL 信息；不创建公告图片专用接口，前端不接触 COS 密钥。

## 数据结构

- `announcements`：`id/title/contentHtml/images/status/platforms/sortOrder/autoPopup/startsAt/endsAt/createdAt/updatedAt/createdBy/updatedBy`。
- `images` 每项只保留 `fileId/objectKey/url/alt`，不把二进制或 COS 密钥写入数据库。
- `draft` 不对公共端可见；`published` 仍需同时满足平台与生效时间。

## 安全与资源边界

- 富文本只允许基础排版标签与有限文本样式，丢弃脚本、事件属性和正文图片；所有已允许标签均可携带经过白名单验证的 `color/font-size/text-align`，以支持颜色与粗体、下划线等嵌套组合。
- 上传要求管理员 Cookie 和 `config:write`，按文件头识别 JPEG/PNG/WebP，单文件最大 5MB。
- COS 使用“公有读、私有写”；服务端密钥由部署 Secret 注入，日志和响应都不返回密钥。
- 首版公告总量低，CloudBase 仓储最多读取最近 500 条后在服务层筛选分页；若将来接近该量级，再增加索引与数据库游标分页，不在当前免费资源阶段提前复杂化。

## 后台影响检查

- 管理后台新增公告列表与编辑入口，复用 `config:read/config:write`，不扩充角色矩阵。
- 编辑页先走通用上传，再把返回的文件引用放入公告请求体。
- 游戏前端继续使用独立公告入口；后续接公共列表/详情，不修改启动配置请求。

## 本阶段不做

- 公告版本号、发布回滚、审批流、批量发布、阅读统计。
- 公告图片专用上传/删除接口、浏览器直传 COS、前端保存永久密钥。
- 自定义域名自动配置；COS 默认域名无法浏览器预览时，由部署阶段绑定自定义 HTTPS/CDN 域名并替换 `COS_PUBLIC_BASE_URL`。
