/**
 * API v2 路由准入清单 (Route Admission Manifest)
 *
 * 每个 `/api/v2` 端点必须在路由注册前在此处登记完整元数据。
 * 准入清单是唯一事实来源：未登记的路由不被 API v2 覆盖门禁认可。
 *
 * 字段说明：
 * - id:               端点唯一标识（kebab-case）
 * - method:           HTTP 方法
 * - path:             完整 v2 路径（含 `/api/v2` 前缀）
 * - sourceCapability: 来源能力名称（对应 OpenSpec 能力）
 * - contractVersion:  使用的共享契约版本（或 'none'）
 * - v1Relationship:   与现有 v1 端点的关系（exact-copy / subset / enhanced / new）
 * - auth:             认证要求（'required' / 'optional' / 'none'）
 * - rbac:             RBAC 权限标识（或 'none'）
 * - orgIsolation:     组织隔离行为（'required' / 'inherited' / 'none'）
 * - sideEffectClass:  副作用分类（'read' / 'write' / 'ai-action' / 'compiler-action' / 'admin'）
 * - auditBehavior:    审计要求（'none' / 'read-log' / 'write-audit' / 'human-confirm'）
 * - featureFlag:      控制此端点的 feature flag 名
 * - fallback:         端点不可用时的降级行为
 * - verificationCmd:  验证命令
 * - status:           端点状态（'admitted' / 'experimental' / 'deprecated' / 'removed'）
 */

export interface V2RouteAdmission {
  /** 端点唯一标识 */
  id: string
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** 完整 v2 路径 */
  path: string
  /** 来源能力名称 */
  sourceCapability: string
  /** 使用的共享契约版本 */
  contractVersion: string
  /** 与 v1 的关系 */
  v1Relationship: 'exact-copy' | 'subset' | 'enhanced' | 'new'
  /** 认证要求 */
  auth: 'required' | 'optional' | 'none'
  /** RBAC 权限标识 */
  rbac: string
  /** 组织隔离行为 */
  orgIsolation: 'required' | 'inherited' | 'none'
  /** 副作用分类 */
  sideEffectClass: 'read' | 'write' | 'ai-action' | 'compiler-action' | 'admin'
  /** 审计要求 */
  auditBehavior: 'none' | 'read-log' | 'write-audit' | 'human-confirm'
  /** feature flag */
  featureFlag: string
  /** 降级行为说明 */
  fallback: string
  /** 验证命令 */
  verificationCmd: string
  /** 端点状态 */
  status: 'admitted' | 'experimental' | 'deprecated' | 'removed'
}

/**
 * API v2 路由准入注册表
 *
 * 新增 v2 端点时必须同时在此数组中添加对应条目。
 * 测试将通过 `validateAdmissionManifest()` 确保数组与真实注册路由一致性。
 */
export const V2_ROUTE_ADMISSION_MANIFEST: V2RouteAdmission[] = [
  // ── 发现/能力 ──────────────────────────────────────────────
  {
    id: 'v2-capabilities',
    method: 'GET',
    path: '/api/v2/capabilities',
    sourceCapability: 'api-v2-surface',
    contractVersion: 'none',
    v1Relationship: 'new',
    auth: 'optional',
    rbac: 'none',
    orgIsolation: 'none',
    sideEffectClass: 'read',
    auditBehavior: 'none',
    featureFlag: 'API_V2_ENABLED',
    fallback: 'Feature-disabled 响应',
    verificationCmd:
      'pnpm --filter @aiproj/backend test tests/functional/api_v2_capabilities.spec.ts',
    status: 'admitted',
  },

  // ── Compiler 运行生命周期（读取） ──────────────────────────
  {
    id: 'v2-compiler-runs-list',
    method: 'GET',
    path: '/api/v2/ai/compiler/runs',
    sourceCapability: 'project-compiler-foundation',
    contractVersion: 'compiler-run-v1',
    v1Relationship: 'subset',
    auth: 'required',
    rbac: 'compiler:runs:list',
    orgIsolation: 'required',
    sideEffectClass: 'read',
    auditBehavior: 'read-log',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限 → 403 标准错误',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_compiler.spec.ts',
    status: 'admitted',
  },
  {
    id: 'v2-compiler-runs-show',
    method: 'GET',
    path: '/api/v2/ai/compiler/runs/:id',
    sourceCapability: 'project-compiler-foundation',
    contractVersion: 'compiler-run-v1',
    v1Relationship: 'subset',
    auth: 'required',
    rbac: 'compiler:runs:show',
    orgIsolation: 'required',
    sideEffectClass: 'read',
    auditBehavior: 'read-log',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/不存在 → 404/403 标准错误',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_compiler.spec.ts',
    status: 'admitted',
  },
  {
    id: 'v2-compiler-runs-events',
    method: 'GET',
    path: '/api/v2/ai/compiler/runs/:id/events',
    sourceCapability: 'compiler-run-executor-wiring',
    contractVersion: 'compiler-event-v1',
    v1Relationship: 'subset',
    auth: 'required',
    rbac: 'compiler:runs:events',
    orgIsolation: 'required',
    sideEffectClass: 'read',
    auditBehavior: 'read-log',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/不存在 → 404/403 标准错误',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_compiler.spec.ts',
    status: 'admitted',
  },

  // ── Compiler 运行生命周期（操作） ──────────────────────────
  {
    id: 'v2-compiler-runs-start',
    method: 'POST',
    path: '/api/v2/ai/compiler/runs',
    sourceCapability: 'compiler-run-executor-wiring',
    contractVersion: 'compiler-run-v1',
    v1Relationship: 'subset',
    auth: 'required',
    rbac: 'compiler:runs:start',
    orgIsolation: 'required',
    sideEffectClass: 'compiler-action',
    auditBehavior: 'write-audit',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/不可用 → 403/503 标准错误',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_compiler.spec.ts',
    status: 'admitted',
  },
  {
    id: 'v2-compiler-runs-resume',
    method: 'POST',
    path: '/api/v2/ai/compiler/runs/:id/resume',
    sourceCapability: 'compiler-run-executor-wiring',
    contractVersion: 'compiler-run-v1',
    v1Relationship: 'subset',
    auth: 'required',
    rbac: 'compiler:runs:resume',
    orgIsolation: 'required',
    sideEffectClass: 'compiler-action',
    auditBehavior: 'write-audit',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/不可恢复 → 403/409 标准错误',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_compiler.spec.ts',
    status: 'admitted',
  },
  {
    id: 'v2-compiler-runs-replay',
    method: 'POST',
    path: '/api/v2/ai/compiler/runs/:id/replay',
    sourceCapability: 'compiler-resume-replay-wiring',
    contractVersion: 'compiler-run-v1',
    v1Relationship: 'new',
    auth: 'required',
    rbac: 'compiler:runs:replay',
    orgIsolation: 'required',
    sideEffectClass: 'compiler-action',
    auditBehavior: 'write-audit',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/不存在 → 403/404 标准错误',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_compiler.spec.ts',
    status: 'admitted',
  },

  // ── 流式进度（StreamingProgressEnvelope） ──────────────────
  {
    id: 'v2-streaming-replay',
    method: 'GET',
    path: '/api/v2/streaming/replay/:draftId',
    sourceCapability: 'streaming-progress-contract',
    contractVersion: 'streaming-progress-envelope-v1',
    v1Relationship: 'enhanced',
    auth: 'required',
    rbac: 'streaming:replay',
    orgIsolation: 'required',
    sideEffectClass: 'read',
    auditBehavior: 'read-log',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/不存在 → 404/403；reset-required 响应',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_streaming.spec.ts',
    status: 'admitted',
  },
  {
    id: 'v2-streaming-reset-required',
    method: 'GET',
    path: '/api/v2/streaming/status/:draftId',
    sourceCapability: 'streaming-progress-contract',
    contractVersion: 'streaming-progress-envelope-v1',
    v1Relationship: 'enhanced',
    auth: 'required',
    rbac: 'streaming:status',
    orgIsolation: 'required',
    sideEffectClass: 'read',
    auditBehavior: 'none',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/不存在 → 404/403',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_streaming.spec.ts',
    status: 'admitted',
  },

  // ── Gantt What-if（P1，仅当契约就绪后启用） ───────────────
  {
    id: 'v2-gantt-whatif-list',
    method: 'GET',
    path: '/api/v2/projects/:projectId/gantt/whatif',
    sourceCapability: 'gantt-what-if-local-session',
    contractVersion: 'whatif-session-v1',
    v1Relationship: 'new',
    auth: 'required',
    rbac: 'gantt:whatif:list',
    orgIsolation: 'required',
    sideEffectClass: 'read',
    auditBehavior: 'read-log',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/无会话 → 404/403',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_gantt.spec.ts',
    status: 'experimental',
  },
  {
    id: 'v2-gantt-whatif-show',
    method: 'GET',
    path: '/api/v2/projects/:projectId/gantt/whatif/:sessionId',
    sourceCapability: 'gantt-what-if-local-session',
    contractVersion: 'whatif-session-v1',
    v1Relationship: 'new',
    auth: 'required',
    rbac: 'gantt:whatif:show',
    orgIsolation: 'required',
    sideEffectClass: 'read',
    auditBehavior: 'read-log',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/无会话 → 404/403',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_gantt.spec.ts',
    status: 'experimental',
  },
  {
    id: 'v2-gantt-whatif-apply',
    method: 'POST',
    path: '/api/v2/projects/:projectId/gantt/whatif/:sessionId/apply',
    sourceCapability: 'gantt-what-if-impact-summary',
    contractVersion: 'whatif-session-v1',
    v1Relationship: 'new',
    auth: 'required',
    rbac: 'gantt:whatif:apply',
    orgIsolation: 'required',
    sideEffectClass: 'write',
    auditBehavior: 'human-confirm',
    featureFlag: 'API_V2_ENABLED',
    fallback: '无权限/预览过期/阻塞 → 403/409 并保留现有进度',
    verificationCmd: 'pnpm --filter @aiproj/backend test tests/functional/api_v2_gantt.spec.ts',
    status: 'experimental',
  },
]

/**
 * 校验：每个 v2 端点必须包含所有必需字段
 */
export function validateAdmissionManifest(
  manifest: V2RouteAdmission[] = V2_ROUTE_ADMISSION_MANIFEST,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const seen = new Set<string>()

  for (const entry of manifest) {
    const key = `${entry.method} ${entry.path}`

    if (!entry.id) errors.push(`条目缺少 id: ${key}`)
    if (!entry.path.startsWith('/api/v2/')) errors.push(`路径非 /api/v2 前缀: ${key}`)
    if (seen.has(key)) errors.push(`重复条目: ${key}`)
    seen.add(key)

    if (!['admitted', 'experimental', 'deprecated', 'removed'].includes(entry.status)) {
      errors.push(`无效 status: ${entry.id} => ${entry.status}`)
    }

    if (
      !['read', 'write', 'ai-action', 'compiler-action', 'admin'].includes(entry.sideEffectClass)
    ) {
      errors.push(`无效 sideEffectClass: ${entry.id} => ${entry.sideEffectClass}`)
    }

    if (!['none', 'read-log', 'write-audit', 'human-confirm'].includes(entry.auditBehavior)) {
      errors.push(`无效 auditBehavior: ${entry.id} => ${entry.auditBehavior}`)
    }
  }

  return { valid: errors.length === 0, errors }
}
