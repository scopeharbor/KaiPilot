// @aiproj/types — V3 多租户有效租户识别与选择共享契约、低敏 hash 与类型守卫。
// 纯函数，零运行时外部依赖，前后端共享。
//
// 本模块定义"本次操作到底属于哪个租户、从哪里识别、如何处理歧义/过期/切换/
// super admin 全局视图"的识别链路契约：EffectiveTenantContext、TenantSelectionSnapshot、
// TenantScopeMode、TenantSelectionSource、TenantResolutionReason 与 warning codes。
// 所有派生值（scope hash、audit metadata、selection snapshot）必须先完成租户过滤，
// 再计算派生值，且只包含低敏字段，防止跨租户计数/hash/缓存命中泄漏存在性。
//
// 与 `v3-multitenant-isolation-architecture`（隔离执行层）的分工：本模块产出"识别结果"
// （effective tenant decision、selection snapshot、resolver 输入、非泄露错误语义），
// 隔离架构负责"统一隔离执行"（scoped query/cache/job/export enforcement）。隔离架构
// 消费本模块产出的 effective tenant context 与其 scope hash。
//
// 命名约定：为避免与 isolation-architecture / enterprise-dlp-engine /
// enterprise-encryption-helpers / enterprise-audit-enhancement / enterprise-compliance-readiness
// 已经或将要导出的通用 hash 在 barrel export 时冲突，本模块的标识符统一使用
// ti* 前缀（Tenant Identification），index.ts 使用显式 named export。

import {
  MULTITENANT_FORBIDDEN_KEYS,
  MULTITENANT_SCOPE_HASH_LENGTH,
  detectMultitenantForbiddenKeysDeep,
  mtComputeOrganizationScopeHash,
  mtComputePermissionSnapshotHash,
  mtComputeProjectScopeHash,
  mtComputeScopeHash,
  mtFnv1aHash,
  mtStableSerialize,
} from './multitenant-isolation-architecture.js'

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/**
 * 租户 scope mode：super admin 与普通请求在解析后的作用域形态。
 * - tenant            具体组织（或组织+可选项目）作用域；普通业务操作默认要求它。
 * - global-low-sensitive 明确允许的低敏全局视图（平台级健康/合规低敏汇总），须显式请求、
 *                      命中能力 allow-list 并写审计。
 * - system-maintenance  系统运维只读视图，仅允许低敏聚合诊断，须显式请求并写审计。
 */
export const TENANT_SCOPE_MODES = ['tenant', 'global-low-sensitive', 'system-maintenance'] as const
export type TenantScopeMode = (typeof TENANT_SCOPE_MODES)[number]

/**
 * 租户选择/识别来源：说明 effective tenant 是从哪里解析出来的，供审计与调试。
 * - auth_token        已验证 JWT/access token 声明的组织
 * - server_selection  服务端持久化/签发的 active organization selection
 * - resource_owner    路由资源归属 resolver 反推
 * - consistency_hint  客户端 body/query/header 一致性输入（仅作校验，不作事实源）
 * - super_admin_mode  super admin 显式全局/运维 scope mode
 */
export const TENANT_SELECTION_SOURCES = [
  'auth_token',
  'server_selection',
  'resource_owner',
  'consistency_hint',
  'super_admin_mode',
] as const
export type TenantSelectionSource = (typeof TENANT_SELECTION_SOURCES)[number]

/**
 * 租户解析结果 reason code（低敏，可安全进入审计与错误详情）。
 * 提供比隔离架构 reason set 更聚焦于"识别链路"的语义，但保持数值含义不泄露。
 */
export const TENANT_RESOLUTION_REASONS = [
  'RESOLVED',
  'NO_ACTIVE_ORGANIZATION',
  'ORGANIZATION_MISSING',
  'ORGANIZATION_DELETED',
  'NOT_A_MEMBER',
  'MEMBERSHIP_REMOVED',
  'MEMBERSHIP_STALE',
  'ROLE_STALE',
  'ORGANIZATION_MISMATCH',
  'ROUTE_ORGANIZATION_MISMATCH',
  'BODY_ORGANIZATION_MISMATCH',
  'RESOURCE_OWNERSHIP_MISMATCH',
  'SUPER_ADMIN_TENANT_SCOPE',
  'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE',
  'SUPER_ADMIN_SYSTEM_MAINTENANCE',
  'GLOBAL_NOT_ALLOWED',
  'AMBIGUOUS_TENANT',
  'RESOLVER_FAILED',
  'REPLAY_REJECTED',
] as const
export type TenantResolutionReason = (typeof TENANT_RESOLUTION_REASONS)[number]

/**
 * 识别链路可安全返回的 warning code（低敏，不泄露隐藏租户详情）。
 */
export const TENANT_WARNING_CODES = [
  'NO_ACTIVE_TENANT',
  'ORGANIZATION_HIDDEN',
  'MEMBERSHIP_STALE_REFRESH_REQUIRED',
  'ROLE_STALE_REFRESH_REQUIRED',
  'ROUTE_ORGANIZATION_MISMATCH',
  'BODY_ORGANIZATION_HINT_IGNORED',
  'RESOURCE_HIDDEN',
  'RESOURCE_OWNERSHIP_MISMATCH',
  'GLOBAL_LOW_SENSITIVE_ONLY',
  'SYSTEM_MAINTENANCE_ONLY',
  'REPLAY_STALE_OR_INVALID',
] as const
export type TenantWarningCode = (typeof TENANT_WARNING_CODES)[number]

/** 默认 scope hash 命名空间前缀（识别层，与隔离层 mt 前缀区分）。 */
export const TENANT_ID_HASH_NS = 'ti'

/** selection snapshot 的稳定序列化 schema 版本。 */
export const TENANT_SELECTION_SCHEMA_VERSION = '1'

// ──────────────────────────────────────────────
// 2. 核心契约类型
// ──────────────────────────────────────────────

/**
 * EffectiveTenantContext：识别链路的唯一输出 / 低敏租户决定。
 *
 * 后端中间件、解析服务、job builder、前端 API client 只传递本低敏决定，不传递原始 JWT、
 * 完整成员记录、隐藏资源名称、权限全集或外部 payload。
 */
export interface EffectiveTenantContext {
  /** actor 引用（低敏 actor token，如 `user:123`），不含原始凭证。 */
  actorRef: string
  /** 具体组织作用域（tenant 模式下必填；global/sys 模式下可为 null）。 */
  organizationId: number | null
  /** 可选项目作用域（项目级 API 使用）。 */
  projectId?: number | null
  /** 成员角色（owner/admin/member/viewer），仅 tenant 模式提供；可由服务端解析补充。 */
  membershipRole?: string | null
  /** 成员/角色新鲜度元数据（如 role version 的 hash），用于 stale 检测。 */
  membershipVersionHash?: string | null
  /** 解析后的 scope mode。 */
  scopeMode: TenantScopeMode
  /** 租户来源。 */
  selectionSource: TenantSelectionSource
  /** 解析 reason code。 */
  resolutionReason: TenantResolutionReason
  /** 确定性 low-sensitive scope hash（含 org + 可选 project）。 */
  scopeHash: string
  /** 解析时间戳（ISO 字符串）。 */
  resolvedAt: string
  /** 低敏 warning codes（可安全展示/写入审计）。 */
  warningCodes: TenantWarningCode[]
  /** 是否为 super admin。 */
  isSuperAdmin: boolean
}

/**
 * TenantSelectionSnapshot：后台作业/异步任务/长流程持久化的低敏租户选择快照。
 * 只允许包含低敏字段；执行前必须重新解析并比对 membership freshness。
 */
export interface TenantSelectionSnapshot {
  schemaVersion: string
  actorRef: string
  organizationId: number | null
  projectId?: number | null
  scopeMode: TenantScopeMode
  selectionSource: TenantSelectionSource
  resolutionReason: TenantResolutionReason
  membershipVersionHash?: string | null
  scopeHash: string
  permissionSnapshotHash: string
  sourceRefs: string[]
  idempotencyKey: string
  requestId: string
  issuedAt: string
  /**
   * 签发时的 selection epoch（服务端 `tenant_selection_states.selection_epoch`）。
   *
   * 组织切换后失效旧句柄的唯一栅栏（§4.3）：消费时与服务端当前 epoch 比对，不等即 stale。
   * **缺省（旧格式快照）在消费侧一律判 stale**，而不是当成有效——切回原组织时 scope hash
   * 会复原，只有 epoch 拦得住。
   */
  selectionEpoch?: number | null
}

/**
 * 组织切换请求：客户端只提交目标组织意图（低敏 id），后端重新验证成员关系。
 * 客户端提交的 organizationId 仅作意图/一致性输入，绝不作为安全事实源。
 */
export interface OrganizationSelectionRequest {
  organizationId: number
  /** 可选的旧 scope hash，供审计记录 previous scope 用（不含隐藏数据）。 */
  previousScopeHash?: string | null
}

/**
 * 组织切换成功响应：返回刷新后的低敏 effective tenant context 与新的 scope hash。
 */
export interface OrganizationSelectionResponse {
  effectiveContext: EffectiveTenantContext
  scopeHash: string
}

/**
 * 低敏识别审计元数据（识别链路专用；隔离执行审计走 isolation 层）。
 */
export interface TenantIdentificationAuditMetadata {
  actorRef: string
  scopeHash: string
  organizationId: number | null
  projectId?: number | null
  scopeMode: TenantScopeMode
  selectionSource: TenantSelectionSource
  resolutionReason: TenantResolutionReason
  operation: string
  requestId: string
  idempotencyKey?: string | null
  timestamp: string
}

// ──────────────────────────────────────────────
// 3. 类型守卫
// ──────────────────────────────────────────────

export function isTenantScopeMode(v: unknown): v is TenantScopeMode {
  return TENANT_SCOPE_MODES.includes(v as TenantScopeMode)
}

export function isTenantSelectionSource(v: unknown): v is TenantSelectionSource {
  return TENANT_SELECTION_SOURCES.includes(v as TenantSelectionSource)
}

export function isTenantResolutionReason(v: unknown): v is TenantResolutionReason {
  return TENANT_RESOLUTION_REASONS.includes(v as TenantResolutionReason)
}

export function isTenantWarningCode(v: unknown): v is TenantWarningCode {
  return TENANT_WARNING_CODES.includes(v as TenantWarningCode)
}

// ──────────────────────────────────────────────
// 4. 确定性 hash 与合成器
// ──────────────────────────────────────────────

/**
 * 计算有效租户 context 的确定性 scope hash。
 * 必须以低敏字段（org + 可选 project + scopeMode）为输入，排除 raw token、secrets、
 * prompt、model output、外部 payload、路径等敏感字段。
 */
export function tiComputeEffectiveScopeHash(params: {
  organizationId?: number | string | null
  projectId?: number | string | null
  scopeMode?: TenantScopeMode
}): string {
  const base = mtComputeScopeHash({
    organizationId: params.organizationId == null ? 0 : params.organizationId,
    projectId: params.projectId ?? null,
  })
  const modeBucket = params.scopeMode === 'tenant' ? 'tenant' : 'global'
  const raw = `${TENANT_ID_HASH_NS}:eff:${base}:${modeBucket}`
  return mtFnv1aHash(raw).padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0')
}

/**
 * 对两个 EffectiveTenantContext 做按 key 稳定排列后判断是否同 hash。
 * 用于"同一 actor/org/project/scopeMode/freshness/reason 但不同 key 顺序"的一致性断言。
 */
export function tiEquivalentContextHashes(
  a: EffectiveTenantContext,
  b: EffectiveTenantContext,
): boolean {
  return tiSerializeContextKey(a) === tiSerializeContextKey(b)
}

function contextKeyScope(context: EffectiveTenantContext): string {
  return [
    context.actorRef,
    context.organizationId ?? 'null',
    context.projectId ?? 'null',
    context.scopeMode,
    context.membershipVersionHash ?? 'null',
    context.resolutionReason,
    context.selectionSource,
  ].join('|')
}

function tiSerializeContextKey(context: EffectiveTenantContext): string {
  return mtStableSerialize({ key: contextKeyScope(context) })
}

/**
 * 构造 EffectiveTenantContext。
 * organizationId/scopeHash/resolvedAt 缺省时自动推导；inputs 必须已是低敏字段。
 */
export function buildEffectiveTenantContext(params: {
  actorRef: string
  organizationId?: number | null
  projectId?: number | null
  membershipRole?: string | null
  membershipVersionHash?: string | null
  scopeMode?: TenantScopeMode
  selectionSource: TenantSelectionSource
  resolutionReason: TenantResolutionReason
  isSuperAdmin?: boolean
  warningCodes?: TenantWarningCode[]
  resolvedAt?: string
  scopeHash?: string
}): EffectiveTenantContext {
  const scopeMode = params.scopeMode ?? 'tenant'
  const organizationId = params.organizationId ?? null
  const projectId = params.projectId ?? null
  const scopeHash =
    params.scopeHash ?? tiComputeEffectiveScopeHash({ organizationId, projectId, scopeMode })
  return {
    actorRef: params.actorRef,
    organizationId,
    projectId,
    membershipRole: params.membershipRole ?? null,
    membershipVersionHash: params.membershipVersionHash ?? null,
    scopeMode,
    selectionSource: params.selectionSource,
    resolutionReason: params.resolutionReason,
    scopeHash,
    resolvedAt: params.resolvedAt ?? new Date().toISOString(),
    warningCodes: params.warningCodes ?? [],
    isSuperAdmin: params.isSuperAdmin ?? false,
  }
}

/**
 * 从 effective tenant context 构造后台作业低敏 selection snapshot。
 * 所有输入必须已经是低敏引用（sourceRefs 为资源 hash 或低敏 id）。
 */
export function buildTenantSelectionSnapshot(params: {
  context: EffectiveTenantContext
  permissionSnapshotHash: string
  sourceRefs: string[]
  idempotencyKey: string
  requestId: string
  issuedAt?: string
  /** 签发时的服务端 selection epoch；缺省时消费侧按 stale 处理（fail closed）。 */
  selectionEpoch?: number | null
}): TenantSelectionSnapshot {
  return {
    selectionEpoch: params.selectionEpoch ?? null,
    schemaVersion: TENANT_SELECTION_SCHEMA_VERSION,
    actorRef: params.context.actorRef,
    organizationId: params.context.organizationId,
    projectId: params.context.projectId ?? null,
    scopeMode: params.context.scopeMode,
    selectionSource: params.context.selectionSource,
    resolutionReason: params.context.resolutionReason,
    membershipVersionHash: params.context.membershipVersionHash ?? null,
    scopeHash: params.context.scopeHash,
    permissionSnapshotHash: params.permissionSnapshotHash,
    sourceRefs: [...params.sourceRefs],
    idempotencyKey: params.idempotencyKey,
    requestId: params.requestId,
    issuedAt: params.issuedAt ?? new Date().toISOString(),
  }
}

/**
 * 组合两个 effective tenant context 的成员新鲜度（用于 switch 后的 previous/next 审计）。
 * 返回低敏 previous/next scope hash 对比，不暴露隐藏组织名或资源名。
 */
export function buildScopeSwitchAuditContext(params: {
  previousScopeHash?: string | null
  nextScopeHash: string
  actorRef: string
  requestId: string
  idempotencyKey?: string | null
  timestamp?: string
}): {
  actorRef: string
  previousScopeHash: string | null
  previousToNextChanged: boolean
  nextScopeHash: string
  requestId: string
  idempotencyKey: string | null
  timestamp: string
} {
  const previousScopeHash = params.previousScopeHash ?? null
  return {
    actorRef: params.actorRef,
    previousScopeHash,
    previousToNextChanged: previousScopeHash !== params.nextScopeHash,
    nextScopeHash: params.nextScopeHash,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey ?? null,
    timestamp: params.timestamp ?? new Date().toISOString(),
  }
}

/**
 * 判断对象（含嵌套）是否包含识别审计禁止出现的敏感字段。
 * 复用隔离架构的 forbidden key 集合；返回 true 表示不可写入审计/响应。
 */
export function hasTenantIdForbiddenKeys(obj: unknown): boolean {
  return detectMultitenantForbiddenKeysDeep(obj).length > 0
}

/**
 * 导出隔离架构的通用 hash 助手别名，供识别层与前端消费方统一使用。
 * （识别层不重新实现 hash；直接复用隔离层已稳定的 mt* 实现。）
 */
export const tiComputeOrganizationScopeHash = mtComputeOrganizationScopeHash
export const tiComputePermissionHash = mtComputePermissionSnapshotHash
export const tiComputeProjectScopeHash = mtComputeProjectScopeHash

/** 识别审计禁止出现的字段键集合（复用隔离架构定义，forward 导出）。 */
export const TENANT_ID_FORBIDDEN_KEYS: readonly string[] = MULTITENANT_FORBIDDEN_KEYS

// ──────────────────────────────────────────────
// 5. 兼容映射：旧 ctx.tenant.organizationId → 新 effective tenant context
// ──────────────────────────────────────────────

/**
 * 旧 TenantContext 兼容输入（与后端 `ctx.tenant` 既有形状对齐）。
 * 既有 isolation-architecture 已让 `ctx.tenant` 携带 organizationId/projectId/scopeMode/
 * actorRef/isSuperAdmin；这里只取识别层需要的低敏字段，不引入后端运行时依赖。
 */
export interface LegacyTenantContextLike {
  organizationId: number | null
  projectId?: number | null
  scopeMode?: string | null
  actorRef?: string | null
  isSuperAdmin?: boolean
}

/**
 * 把旧 `ctx.tenant`（仅 organizationId 等最小字段）兼容映射为新 EffectiveTenantContext。
 *
 * 用于过渡期：既有 30+ controller 仍读 `ctx.tenant.organizationId`，本 helper 让它们能在
 * 不破坏既有契约的前提下获得识别层的 effective decision（含 scopeHash/reason/source）。
 * 旧 `scopeMode` 值（`'organization_scoped'`/`'system_global'` 等）归一化到识别层三态：
 *   - super admin 且无具体 org → `global-low-sensitive`（默认低敏全局，须显式 allow-list 才放行业务）
 *   - 否则 → `tenant`（具体组织作用域）
 *
 * 本函数不查库、不做 membership 校验；它只做形状映射，安全事实仍由 TenantResolutionService
 * 在中间件层产出。此处仅作"已有 ctx.tenant 时的低敏派生"。
 */
export function mapLegacyTenantContext(params: {
  legacy: LegacyTenantContextLike
  selectionSource?: TenantSelectionSource
  resolutionReason?: TenantResolutionReason
  membershipRole?: string | null
  membershipVersionHash?: string | null
  warningCodes?: TenantWarningCode[]
  resolvedAt?: string
}): EffectiveTenantContext {
  const { legacy } = params
  const isSuperAdmin = Boolean(legacy.isSuperAdmin)
  const organizationId = legacy.organizationId ?? null
  const projectId = legacy.projectId ?? null
  // 旧 scopeMode 归一化：super admin 无具体 org → global-low-sensitive；否则 tenant。
  const scopeMode: TenantScopeMode =
    isSuperAdmin && organizationId == null ? 'global-low-sensitive' : 'tenant'
  const selectionSource = params.selectionSource ?? 'auth_token'
  const resolutionReason = params.resolutionReason ?? 'RESOLVED'
  return buildEffectiveTenantContext({
    actorRef: legacy.actorRef ?? 'user:unknown',
    organizationId,
    projectId,
    membershipRole: params.membershipRole ?? null,
    membershipVersionHash: params.membershipVersionHash ?? null,
    scopeMode,
    selectionSource,
    resolutionReason,
    isSuperAdmin,
    warningCodes: params.warningCodes ?? [],
    resolvedAt: params.resolvedAt,
  })
}
