# @aiproj/sdk

开项 Kaiplan workspace 内 TypeScript SDK，覆盖 parity-verified `/api/v1` endpoint registry。

> **非公开发布**：本包为 `private: true`，仅面向本 monorepo 内的 TypeScript 消费者。
> 公开 npm 发布需独立授权；coverage 通过不等于允许发布。

## 范围

- transport：可注入 `fetch`、`baseUrl`、token provider、organization context provider。
- 错误：解析标准 `{ error: { code, message, details? } }` envelope，脱敏后抛出 `ApiErrorResponse`。
- 分页：列表返回 `{ data, meta }`（不解包）；单资源解包 `.data`；`204` → `undefined`。
- dedicated client：`projects`（list/get/create/update/archive/restore/archiveOrDelete）、`tasks`（listForProject/get/create/update/delete）。
- full API client：`client.api.<domain>.<operationId>()`，按 registry 覆盖普通 JSON endpoint。
- escape hatch：`client.rawRequest('/api/v1/...')` / `client.request(...)`，仅限 `/api/v1` 前缀，且不计入 full coverage。
- 复用 `@aiproj/types` 共享 DTO，不平行定义业务类型。

## 创建 client

```ts
import { AiprojClient } from '@aiproj/sdk'

const client = new AiprojClient({
  baseUrl: 'http://localhost:3333/api/v1',
  // 可选：注入测试用 fetch；生产用全局 fetch
  // fetch: customFetch,
  tokenProvider: () => getAccessToken(), // 同步或异步
  organizationContextProvider: () => currentOrgId(),
})
```

## 列出项目与项目任务

```ts
const { data, meta } = await client.projects.list({ status: 'active', page: 1, perPage: 20 })
const taskPage = await client.tasks.listForProject(projectId, { assigneeId: 5, sort: '+name' })
```

## 调用全域 endpoint

```ts
await client.api.identity.authMe()
await client.api.organization.organizationsIndex({ query: { page: 1, perPage: 20 } })
await client.api.planning.projectsTasksStatus({
  path: { projectId: 1, taskId: 2 },
  body: { status: 'completed' },
})
await client.api['schedule-resource-risk'].projectsGanttBaselineStore({
  path: { projectId: 1 },
  body: { previewToken: 'server-issued-token' },
})
```

`path` 参数替换 `:id` / `{id}`，`query` 复用 SDK 的确定性序列化，`body` 走共享 JSON transport。服务端仍负责 RBAC、组织隔离、Validator、审计、preview token 和人工确认边界。

## 处理类型化错误

```ts
import type { ApiErrorResponse } from '@aiproj/sdk'

try {
  await client.projects.get(99)
} catch (e) {
  const err = e as ApiErrorResponse
  // err.status / err.code / err.message / err.details
}
```

## 端点来源

所有 client 路径来自 `docs/v1/api/.endpoints-baseline.json` 和 `docs/v1/api/openapi.yaml` 的 parity gate。运行：

```bash
pnpm exec tsx scripts/check-openapi-coverage.ts v1 --inventory
pnpm --filter @aiproj/sdk run coverage:api
```

coverage report 写入 `packages/sdk/coverage-report.json`：

- `SDK-missing`：正式 `/api/v1` operation 没有 registry entry。
- `SDK-extra`：registry entry 不在当前正式 `/api/v1` inventory/OpenAPI 中。
- `test-missing`：`covered` entry 缺少已登记 fixture test id。
- `unsupported`：端点已登记但当前不安全或不适合 JSON wrapper，必须有 reason/owner。
- `deferred`：端点需要后续 typed helper，如 SSE streaming helper，必须有 reason/owner。
- `excluded`：按 policy 不属于 consumer SDK 覆盖面。
- `code-only` / `doc-only` / `inventory-stale`：route inventory、OpenAPI 和快照漂移，先修 API parity。

## 不做的事

- 不公开 npm 发布、不配置 npm token、不生成发布流水线。
- 不新增/修改后端 API、RBAC、审计或正式写入语义（写动作仍由后端 Policy/Validator 负责）。
- 不导入 `apps/frontend`、`apps/backend`、Zustand、Next.js、AdonisJS 运行态。
- 默认不做真实外部请求；测试全部使用 fixture/mock transport。

## 发布授权流程

> ⚠️ 真实 `npm publish` 是 **conditional 授权门**。未获用户明确授权前，只能运行 `npm publish --dry-run`。

### 授权前的必要条件

1. `v2-5-api-contract-current-route-inventory` — 路由盘点与 OpenAPI parity gate 完成
2. `v2-5-typescript-sdk-core` — SDK 核心包完成 ✅
3. `v2-5-typescript-sdk-full-api-coverage` — 完整 API endpoint 覆盖完成
4. 全部门禁通过：typecheck、tests、build、pack content safety
5. 成功运行 `npm publish --dry-run` 并产出证据

### 授权记录格式

执行真实 `npm publish` 前必须记录以下授权信息（低敏，不含 token/secret）：

```json
{
  "authorizedBy": "<用户名>",
  "authorizedAt": "<ISO 8601 时间戳>",
  "targetRegistry": "https://registry.npmjs.org/",
  "confirmedVersion": "0.1.0",
  "confirmedCommit": "<git commit SHA>",
  "branch": "<当前分支>",
  "notes": "<可选备注>"
}
```

### 证据存储

- Dry-run 证据：`release-evidence.json`（包含包名、版本、commit、门禁摘要、dry-run 状态、授权状态）
- 授权后发布证据：`release-evidence-publish.json`（同上 + 授权记录）
- 所有证据文件：**低敏**，不含 NPM_TOKEN、NODE_AUTH_TOKEN、Authorization headers、registry credentials、私钥或完整环境变量
- 证据文件应上传至 GitHub Actions Artifact 或存储于 `docs/v1/release-evidence/`

### 授权步骤

1. 确认前置 change 全部完成并通过验证
2. 运行 `pnpm --filter @aiproj/sdk typecheck && pnpm --filter @aiproj/sdk test`
3. 运行 `pnpm --filter @aiproj/sdk build`
4. 运行 `tsx scripts/release-dry-run.ts` 进行包内容安全检查
5. 运行 `npm publish --dry-run` 确认输出符合预期
6. 设置 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN` 环境变量
7. 在 GitHub Actions 中触发 `SDK Release Dry-Run` workflow，设置 `publish=true` 并填写 `confirmed_version` 和 `confirmed_commit`
8. 发布后生成并保存低敏发布证据

### 发布失败后的回退策略

- **Dry-run 失败**：修复失败的门禁项（包内容、构建、测试），重新运行 dry-run
- **发布后发现问题**：`npm deprecate @aiproj/sdk@<version> "此版本有已知问题，请升级到 <fixed-version>"`，然后发布 patch 修复版本
- **版本号错误**：`npm deprecate` 错误版本，发布正确的下一个版本（npm 不允许删除已传播版本）
- **patch-forward**：始终通过发布新版本修复，不依赖删除已传播的 tarball
