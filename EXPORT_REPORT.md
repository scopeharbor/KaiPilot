# 导出报告

本目录由私有主线按版本清单确定性导出（同一提交 + 同一清单 = 同一产物）。

## 来源

- 来源提交：`b5c02448dfef236df8c42a9b1df2744177c8e83e`
- 清单 SHA-256：`d653a26aec8a82ee575d9a4c5a8aa6735b61cd177e72043602a7c90fbe61d8d3`
- 关卡档位：`static`
- LICENSE：AGPL-3.0 官方原文（SHA-256 一致）

## 关卡结果

| 关卡 | 名称     | 结果 | 耗时   | 说明                                  |
| ---- | -------- | ---- | ------ | ------------------------------------- |
| 1    | 禁止引用 | 通过 | 5.2 秒 | 0 处                                  |
| 2    | 敏感信息 | 通过 | 5.4 秒 | 0 处；gitleaks 本机未安装，仅内置规则 |

## 统计

- 保留文件：6537 个
- 排除文件：4051 个（internal 3586，credentials 2，enterprise 435，platform 28）
- 剥离标记区块：191 个（enterprise 160，saas-gating 4，platform 26，internal 1）
- 品牌替换：180 个文件 416 处，素材 11 个
- 生成的公开文件：README.md、CONTRIBUTING.md、SECURITY.md、LICENSE、NOTICE
- 快照耗时：快照 1.4 分钟

## 发布参数

| 参数              | 说明                                                             | 状态                                               |
| ----------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `PUBLIC_REPO_URL` | 公开仓库地址（README 链接与 Compose 构建的「源代码」链接默认值） | 已填写：`https://github.com/scopeharbor/OpenXiang` |

> 发布参数已全部填写。

## Publication verification (2026-10-17)

- Exporter regression tests: 51 passed.
- Reference and built-in secret scans: passed; gitleaks was unavailable.
- Frozen lockfile verification: passed with pnpm 12.8.1.
- All 61 existing OpenXiang help screenshots match the reviewed overrides. New screenshot capture is paused.
- No populated demo database, local account configuration, screenshot runtime, or fake model server is included. Development seeders and test fixtures remain available as source code.
- The previous full quality gate and fresh-environment smoke test passed. The three subsequent application/test source changes match that base after canonical formatting.
- This publication reran targeted checks, not the complete quality suite; the export level above remains static.
- Public contributions use AGPL-3.0-only without a mandatory CLA. Closed-source reuse of external contributions requires separate author permission.
