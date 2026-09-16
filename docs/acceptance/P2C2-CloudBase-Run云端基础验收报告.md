# P2C2 CloudBase Run 云端基础验收报告

日期：2026-09-16

## 部署结果

- 服务：`miao-travel-wechat`
- 版本：`miao-travel-wechat-002`
- 状态：正常，`002` 当前承载 100% 流量。
- 默认域名：`https://miao-travel-wechat-314735-10-1488607878.sh.run.tcloudbase.com`
- 容器规格：0.25 核 / 0.5 GB。
- 副本范围：最小 0、最大 1；运行模式为始终自动扩缩容。
- 容器端口：3000；公网访问开启，内网地址和私有网络关闭。
- 日志采集：`stdout`。

## 已通过

- GitHub `main` 分支源码构建成功。
- Docker 镜像构建及推送成功，CloudBase 虚拟服务创建成功。
- 公网 HTTPS `GET /health` 返回 HTTP 200。
- 健康响应确认 `environment=production`、`platform=wechat`、`persistence=cloudbase-http`。
- 本次健康请求总耗时约 0.35 秒，未观察到明显冷启动阻塞。
- 轮换凭据并发布 `002` 后，公网 HTTPS `GET /health` 再次返回 HTTP 200，总耗时约 0.20 秒。
- 无效测试 code 请求登录接口返回 HTTP 401 和 `PLATFORM_AUTH_REJECTED`，确认请求已经到达微信 code2Session 且错误映射正常。
- 新服务端 API Key 完成 `players`、`sessions` 集合的真实临时记录写入、读取和清理。
- 修复数据库探测脚本把“集合存在但探针文档不存在”误判为失败的问题；新增 3 项回归测试。
- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 全部通过，共 8 个测试文件、23 项测试。

## 安全发现

CloudBase CLI 的 `cloudrun detail --json` 会在 `ServerConfig.EnvParams` 中返回环境变量原文。后续诊断禁止直接输出该命令的完整结果，必须在展示前删除或脱敏 `EnvParams`。

部署期间曾进入诊断/截图上下文的微信 AppSecret 和 CloudBase 服务端 API Key 已轮换，`002` 使用轮换后的配置。任何验收报告和 Git 提交不得保存旧值或新值；后续截图必须隐藏环境变量值。

## 尚未完成

1. 将默认 HTTPS 域名加入微信小游戏 request 合法域名。
2. 使用新鲜 `wx.login` code 完成 `code2Session -> players -> sessions` 全链路。
3. 验证同一微信账号第二次登录复用 playerId 且 `isNew=false`。
4. 同步前端生产 `baseUrl`，完成开发者工具及真机游客降级验收。

## 结论

P2C2 的 `002` 版本、凭据轮换、公网健康检查、微信错误链路和数据库读写探测通过；真实微信登录及前端联调尚未完成，本阶段保持“进行中”。
