# P2C2 CloudBase Run 云端基础验收报告

日期：2026-09-16

## 部署结果

- 服务：`miao-travel-wechat`
- 版本：`miao-travel-wechat-001`
- 状态：正常，当前版本承载 100% 流量。
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

## 安全发现

CloudBase CLI 的 `cloudrun detail --json` 会在 `ServerConfig.EnvParams` 中返回环境变量原文。后续诊断禁止直接输出该命令的完整结果，必须在展示前删除或脱敏 `EnvParams`。

部署期间使用的微信 AppSecret 和 CloudBase 服务端 API Key 已进入诊断/截图上下文，必须轮换后再进行正式登录验收。任何验收报告和 Git 提交不得保存旧值或新值。

## 尚未完成

1. 轮换微信 AppSecret，并发布只更新环境变量的新版本。
2. 轮换 CloudBase 服务端 API Key，通过控制台托管注入新 Key。
3. 将默认 HTTPS 域名加入微信小游戏 request 合法域名。
4. 使用新鲜 `wx.login` code 完成 `code2Session -> players -> sessions` 全链路。
5. 验证同一微信账号第二次登录复用 playerId 且 `isNew=false`。
6. 同步前端生产 `baseUrl`，完成开发者工具及真机游客降级验收。

## 结论

P2C2 云端容器部署与公网健康检查通过，但因凭据轮换和真实登录尚未完成，本阶段保持“进行中”。
