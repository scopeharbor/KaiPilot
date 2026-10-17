# 安全策略

## 报告漏洞

如果你发现了安全漏洞，**请不要公开提 Issue 或 Pull Request**，请通过 GitHub 私密漏洞报告提交：

[Report a vulnerability](https://github.com/scopeharbor/OpenXiang/security/advisories/new)

报告里请尽量写明：

- 受影响的版本或提交号；
- 漏洞类型与影响范围；
- 复现步骤或概念验证（请勿包含他人的真实数据）；
- 你希望在致谢里使用的署名（可选）。

本项目由个人维护，不承诺固定的响应或修复时间。修复前请不要公开漏洞细节；修复发布后，如你同意，我们会公开致谢。

## 支持的版本

只对公开仓库默认分支的最新版本提供安全修复。

## 自托管时的安全提醒

- 生产环境务必替换 `APP_KEY`、`JWT_ACCESS_SECRET` 等密钥（Docker Compose 会在首次启动时自动生成）；
- 不要使用演示账号（`admin@aiproj.local` 等）对外提供服务；
- 模型 Key、OAuth 凭据只放在服务器上，不要提交到仓库；
- 在 edge 前面自建反向代理终结 TLS。
