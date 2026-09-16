# P2C1 CloudBase Run 部署包验收报告

日期：2026-09-16

## 已通过

- `docker build --pull -t miao-travel-server:p2c .` 成功。
- 最终镜像约 90 MB，运行用户为非 root 的 `node`。
- 镜像只包含生产运行环境，环境配置中没有 AppSecret 或 CloudBase API Key。
- 使用本地微信配置启动容器，并显式覆盖 `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3000`。
- 容器映射端口后的 `GET /health` 返回 HTTP 200，响应确认 `production/wechat/cloudbase-http`。
- Docker 健康状态变为 `healthy`；发送 SIGINT 后应用执行优雅关闭。
- CloudBase CLI 3.8.2 命令可用；账号未登录时明确拒绝访问，没有创建或修改云端服务。

## 尚未完成

- CloudBase 控制台或 CLI 登录授权。
- 创建 `miao-travel-wechat` 服务并在云端 Secret 中配置环境变量。
- 默认 HTTPS 域名、微信合法域名、真实 `wx.login` code 和真机联合验收。

## 结论

P2C1 容器部署包本地验收通过，可以提交推送。真实云端发布属于 P2C2，必须在账号授权和 Secret 配置完成后单独执行、验收、中文提交并推送。
