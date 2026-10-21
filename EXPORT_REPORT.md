# 导出报告

本目录由私有主线按版本清单确定性导出（同一提交 + 同一清单 = 同一产物）。

## 来源

- 来源提交：`24629270b11e0aa06ec1caae146ba683fcd6e2a9`
- 清单 SHA-256：`6d7d3933991acb6182f8473cf873a8592ea78c469e0e2e45175075465a5394f3`
- 关卡档位：`full`
- LICENSE：AGPL-3.0 官方原文（SHA-256 一致）

## 关卡结果

| 关卡 | 名称             | 结果 | 耗时      | 说明                                                                          |
| ---- | ---------------- | ---- | --------- | ----------------------------------------------------------------------------- |
| 1    | 禁止引用         | 通过 | 3.5 秒    | 0 处                                                                          |
| 2    | 敏感信息         | 通过 | 5.6 秒    | 0 处；gitleaks 本机未安装，仅内置规则                                         |
| 3    | 依赖重建         | 通过 | 2.3 秒    | lockfile regenerate                                                           |
| 4    | 质量门禁（完整） | 通过 | 48.3 分钟 | pnpm lint ✓；pnpm format:check ✓；pnpm typecheck ✓；pnpm build ✓；pnpm test ✓ |
| 5    | 全新迁移         | 通过 | 14.0 秒   | migration:run ✓；migration:rollback --batch=0 ✓                               |

## 统计

- 保留文件：6538 个
- 排除文件：4067 个（internal 3602，credentials 2，enterprise 435，platform 28）
- 剥离标记区块：191 个（enterprise 160，saas-gating 4，platform 26，internal 1）
- 品牌替换：180 个文件 416 处，素材 11 个
- 生成的公开文件：README.md、CONTRIBUTING.md、SECURITY.md、LICENSE、NOTICE、.github/PULL_REQUEST_TEMPLATE.md
- 快照耗时：快照 1.5 分钟

## 发布参数

| 参数              | 说明                                                             | 状态                                              |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `PUBLIC_REPO_URL` | 公开仓库地址（README 链接与 Compose 构建的「源代码」链接默认值） | 已填写：`https://github.com/scopeharbor/KaiPilot` |

> 发布参数已全部填写。

## 发布核验（2026-10-20）

- 本次以 `--gates full --release` 导出：五道关卡全部通过，质量门禁为完整档（lint、format:check、typecheck、build、test 全量），发布参数已全部填写。
- 导出工具回归测试 51/51 通过；引用与内置敏感信息扫描通过（gitleaks 本机未安装）。
- 产物复制到全新目录、按 README 从零安装运行，Playwright 冒烟 10 步全部通过：登录、添加 AI 连接、一句话生成并确认项目、甘特试算应用、建立并邀请成员、本地 canary 插件安装启用、企业页面说明与零请求、企业接口 404、全站品牌为「开项 KaiPilot」且没有旧名称与旧 logo。AI 只用本机假模型。
- 61 张帮助截图在全新个人版环境里以「开项 KaiPilot」界面与新 logo 重新截取。
- CI 的 test、coverage、e2e 作业先运行 `node scripts/prepare-backend-env.mjs --if-missing`，按示例文件生成 `apps/backend/.env`（本机 SQLite、随机密钥）；`.gitignore` 不再放行任何真实环境文件。
- 发布包不含演示数据库、本机账号配置、截图运行环境或假模型服务；开发种子与测试 fixture 仍以源码形式保留。
- 外部贡献按 AGPL-3.0-only 提供，不要求 CLA；闭源再利用外部贡献须另行取得作者授权。
