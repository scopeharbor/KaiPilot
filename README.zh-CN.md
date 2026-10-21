<p align="center">
  <img src="apps/frontend/public/branding/kaipilot-lockup-light.svg" alt="开项 KaiPilot" width="360" />
</p>

# 开项 KaiPilot

[English](README.md) | **简体中文**

**一句话启动项目，AI 生成完整计划——专业项目经理可控，新手也能用。**

开项是一个开源、可自托管的 AI 项目管理平台，简体中文原生。输入一句话描述，AI 生成项目章程、WBS、任务与验收标准的草案；你逐项审查确认后，它才变成正式项目。AI 只给建议，不会自动执行任何修改。

> 开项是 **智项** 的开源个人版；面向公司 IT 与管理部门的治理能力由 **智项企业版** 提供（见文末「企业版」）。

## 主要能力

| 领域       | 开项（本仓库）提供                                                              |
| ---------- | ------------------------------------------------------------------------------- |
| AI 立项    | 一句话生成项目草案、补充问题卡片、规则校验与反幻觉检查、人工审查后转为正式项目  |
| 计划与执行 | WBS、甘特图（含拖动试算 What-if）、看板、列表、日历、时间线；任务、里程碑、依赖 |
| 管理       | 风险登记、变更请求、资源与负载、报表、项目健康                                  |
| 多项目     | PMO 决策工作台、项目组合、OKR、战略执行驾驶舱、多项目依赖、跨项目资源           |
| AI 同事    | 在任意页面向 AI 提问、让它预览修改（确认后才落库）、矛盾求解（TRIZ）            |
| 知识与文档 | 知识库、文件库、OCR 与文档智能（自配提供方）                                    |
| 团队协作   | 组织、成员邀请、6 种角色与项目角色、审计日志、两步验证、Google 登录（自配凭据） |
| 集成与扩展 | GitHub / GitLab、Google 日历、Webhook、Web Push（自配凭据）；插件与 Skill       |
| 实例管理   | 用户管理、全局审计日志、编译器路由；命令行创建实例管理员                        |

AI 能力使用你自己的模型 Key：在「设置 → AI 连接」里添加 OpenAI 兼容或 Anthropic 等提供方。没有可用连接时，AI 草案、AI 同事、矛盾求解会提示「请先在设置中添加 AI 连接」，不会调用任何模型。

## 快速开始（本机）

需要 **Node.js 26**（`.nvmrc`）与 **pnpm 12**。Node 26 不再自带 Corepack，先执行 `npm install -g corepack@0.36.0`，再执行 `corepack enable`。

```bash
# 1. 安装依赖
pnpm install

# 2. 准备后端环境文件
cp apps/backend/.env.example apps/backend/.env
cd apps/backend
node ace generate:key          # 写入 APP_KEY
# 再把 .env 里的 JWT_ACCESS_SECRET 换成独立随机值，例如：
# node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

# 3. 建表（默认 SQLite，不需要数据库服务）
pnpm run codegen:indexes        # 全新目录必须先生成后端索引
node ace migration:run

# 4. 创建第一个管理员（按提示输入密码）
node ace admin:create-super --email you@example.com
cd ../..

# 5. 启动前后端
pnpm dev
```

产品介绍页在 <http://localhost:3000/welcome>。开始使用时打开 <http://localhost:3000>：

1. 用刚创建的账号登录；
2. 打开「设置 → AI 连接」，添加你的模型 Key；
3. 回到首页，用一句话描述你的项目，AI 生成草案，审查后确认为正式项目。

邀请同事：开项没有自助注册页，先由实例管理员在 `apps/backend` 执行 `node ace user:create --email 同事邮箱 --generate-password` 建立账号（密码只显示一次，转交对方），再到「设置 → 组织」里按邮箱邀请进组织。

发布包不预装示例项目、演示账号、数据库或本地假模型服务。首次启动请按以上步骤创建自己的管理员。

## 用 Docker Compose 部署

```bash
cp .env.compose.example .env.compose
# 按需修改 .env.compose，例如对外访问地址：
#   AIPROJ_PUBLIC_ORIGIN=https://pm.example.com
docker compose --env-file .env.compose up -d --build
```

默认拉起 edge、前端、后端、PostgreSQL 与 Redis，只对外开放一个端口（默认 80）。应用密钥在首次启动时自动生成并保存在数据卷里。改用 SQLite 单文件栈：`docker compose -f compose.sqlite.yaml up -d --build`。Google 登录默认不启用，需要时按 `.env.compose.example` 里的说明配置。

更多部署与运维说明见应用内帮助中心「部署与运维」。

## 开源协议

[AGPL-3.0](LICENSE)

## 关于代码里的 `aiproj`

`aiproj` 是项目的内部代号。包名（`@aiproj/*`）、环境变量前缀（`AIPROJ_`）、数据库名与本地存储键名都沿用它，以免打断已有部署；界面与文档里显示的产品名是「开项」。

## 参与贡献

维护者：**evil9369**。

欢迎提交 Issue 和 Pull Request，普通贡献无需签署 CLA，说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开提 Issue。

## 企业版

以下能力由 **智项企业版** 提供，不在本仓库中：

| 企业版提供                                      | 说明                                |
| ----------------------------------------------- | ----------------------------------- |
| 企业单点登录（SAML 2.0 / OIDC）与 SCIM 目录同步 | 对接公司身份系统，成员自动入离职    |
| 数据防泄漏（DLP）与导出水印                     | 敏感数据识别、处置与追溯            |
| KMS 密钥管理、合规准备度、企业审计增强          | 加密底座、合规证据与审计证据包      |
| 多租户治理控制台                                | 组织隔离、连接池与工作流的治理视图  |
| AI 质量与成本控制台（含实验）、AI 用量面板      | 模型质量、成本与用量的统一观测      |
| 发布信任中心、统一 AI 调用账本查看              | 发布门禁证据与 AI 调用审计          |
| 托管服务                                        | 由我们运维的 SaaS，内置平台 AI 连接 |

在开项里直接访问这些功能的页面地址，会看到「企业版提供」的说明页。
