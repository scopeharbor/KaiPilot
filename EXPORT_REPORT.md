# 导出报告

本目录由私有主线按版本清单确定性导出（同一提交 + 同一清单 = 同一产物）。

## 来源

- 来源提交：`bb9eb736770ed67926df910e73c78e189b190acd`
- 清单 SHA-256：`8193e24aa26c14d121a6723200abd68ac566f51c1900cb1f20c3a90582d9d61d`
- 关卡档位：`full`
- LICENSE：AGPL-3.0 官方原文（SHA-256 一致）

## 关卡结果

| 关卡 | 名称             | 结果 | 耗时      | 说明                                                                          |
| ---- | ---------------- | ---- | --------- | ----------------------------------------------------------------------------- |
| 1    | 禁止引用         | 通过 | 4.4 秒    | 0 处                                                                          |
| 2    | 敏感信息         | 通过 | 6.6 秒    | 0 处；gitleaks 本机未安装，仅内置规则                                         |
| 3    | 依赖重建         | 通过 | 2.4 秒    | lockfile regenerate                                                           |
| 4    | 质量门禁（完整） | 通过 | 70.5 分钟 | pnpm lint ✓；pnpm format:check ✓；pnpm typecheck ✓；pnpm build ✓；pnpm test ✓ |
| 5    | 全新迁移         | 通过 | 13.9 秒   | migration:run ✓；migration:rollback --batch=0 ✓                               |

## 统计

- 保留文件：6551 个
- 排除文件：4092 个（internal 3626，credentials 2，enterprise 436，platform 28）
- 剥离标记区块：191 个（enterprise 160，saas-gating 4，platform 26，internal 1）
- 品牌替换：180 个文件 416 处，素材 11 个
- 生成的公开文件：README.md、README.zh-CN.md、CONTRIBUTING.md、SECURITY.md、LICENSE、NOTICE、.github/PULL_REQUEST_TEMPLATE.md
- 个人版新增文件：`apps/frontend/app/welcome/page.tsx`、`apps/frontend/components/landing/KaiPilotLanding.tsx`、`apps/frontend/components/landing/KaiPilotWelcome.tsx`、`apps/frontend/components/landing/landing-content.ts`、`apps/frontend/components/landing/kaipilot-landing.css`、`apps/frontend/__tests__/kaipilot-landing.test.tsx`
- 快照耗时：快照 1.6 分钟

## 发布参数

| 参数              | 说明                                                             | 状态                                              |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `PUBLIC_REPO_URL` | 公开仓库地址（README 链接与 Compose 构建的「源代码」链接默认值） | 已填写：`https://github.com/scopeharbor/KaiPilot` |

> 发布参数已全部填写。
