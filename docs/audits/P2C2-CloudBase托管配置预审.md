# P2C2 CloudBase 托管配置预审

日期：2026-09-16

## 页面核对

- GitHub 仓库为 `ZavierAmateur/miao-travel-server`，分支为 `main`，自动部署关闭。
- 服务名使用 `miao-travel-wechat`；访问端口 80 映射到容器服务端口 3000。
- 仓库根目录即构建目录，因此“目标目录”留空；Dockerfile 选择“有”，名称为 `Dockerfile`。
- CloudBase 新版部署页面提供“API Key 设置”托管注入，应优先于在普通文本环境变量中手工复制密钥。

## 兼容修正

后端继续支持本地变量 `CLOUDBASE_API_KEY`，同时兼容 CloudBase 官方文档和托管场景可能使用的 `CLOUDBASE_APIKEY`、`TCB_API_KEY`。三者只读取首个非空值，业务层仍只接收一个 `cloudbaseApiKey`，不会把变量值写入日志或响应。

## 验收边界

- 类型检查、lint、20 项单元测试、生产构建和依赖审计均通过。
- 本记录只证明部署配置与代码兼容，不代表云端服务已创建或发布。
- 创建服务后仍需验证构建日志、运行日志、默认 HTTPS 域名、数据库访问和真实微信登录。

## 后台影响

无 API、数据库或管理后台页面契约变化。管理员密钥仍必须与玩家 API Secret 分离。
