// @aiproj/backend — TenantScopeModeService（v3-multitenant-tenant-identification §6）。
//
// spec「Super administrator scope mode MUST be explicit」：系统管理员**不默认**获得业务数据
// 全局视图。每个请求必须解析成三种显式 scope mode 之一：
//   - `tenant`               具体组织作用域；普通业务读写的唯一合法模式；
//   - `global-low-sensitive` 明确许可的低敏全局视图（平台级健康/合规低敏汇总）；
//   - `system-maintenance`   运维只读诊断。
// 后两者必须显式请求、命中**能力 allow-list**、只返回低敏聚合，并写审计。
//
// 与 `TenantScopeRegistry.assertGlobalAllowed(resourceType)`（isolation 层）的分工：
// 那一层管**资源**能否全局访问（当前 17 类全部 `allowSuperAdminGlobal: false`）；
// 本服务管**能力**能否以全局模式执行。两道都要过——资源级默认拒绝挡住"忘了登记的资源"，
// 能力级 allow-list 挡住"把业务操作伪装成诊断"。
//
// design Decision 4 的落点：默认解析为具体 tenant scope；全局模式是例外而非常态。

import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import TenantIdentificationAuditService from './tenant_identification_audit_service.js'
import type {
  EffectiveTenantContext,
  TenantScopeMode,
} from '@aiproj/types/multitenant-tenant-identification'

/**
 * 允许以 `global-low-sensitive` 模式执行的能力 allow-list。
 *
 * 收录标准（三条同时满足才可加入）：
 *  1. 只返回低敏聚合或健康状态，不含任何单租户业务内容、资源名称或隐藏计数；
 *  2. 只读——不写业务数据、不触发导出/AI/外部调用；
 *  3. 有明确的平台治理用途（否则该走具体组织 scope）。
 *
 * **刻意保持极小**。业务读写、AI 上下文装配、导出、DLP/KMS/合规/Compiler 操作
 * 一律不在此列（§6.2），它们即便由 super admin 发起也必须带具体组织。
 */
export const GLOBAL_LOW_SENSITIVE_CAPABILITIES = [
  // 平台级隔离健康诊断：返回各层是否就绪的枚举与计数，不含租户业务数据。
  'platform.isolation_health',
  // 平台级租户治理总览：低敏租户计数与状态分布（供 v3-multitenant-admin-console 消费）。
  'platform.tenant_overview',
] as const
export type GlobalLowSensitiveCapability = (typeof GLOBAL_LOW_SENSITIVE_CAPABILITIES)[number]

/** 允许以 `system-maintenance` 模式执行的能力 allow-list（只读运维诊断）。 */
export const SYSTEM_MAINTENANCE_CAPABILITIES = [
  'platform.migration_status',
  'platform.connection_budget_status',
] as const
export type SystemMaintenanceCapability = (typeof SYSTEM_MAINTENANCE_CAPABILITIES)[number]

/**
 * 需要具体组织 scope 的业务域（§6.2）。
 *
 * 明确列举而非"除 allow-list 外全部"，是为了让 §6.4 的测试能逐域断言，
 * 也让新增业务域时必须显式登记（漏登记会被 inventory 测试抓到）。
 */
export const TENANT_SCOPED_BUSINESS_DOMAINS = [
  'project',
  'task',
  'ai',
  'export',
  'dlp',
  'kms',
  'compliance',
  'compiler',
] as const
export type TenantScopedBusinessDomain = (typeof TENANT_SCOPED_BUSINESS_DOMAINS)[number]

export interface ScopeModeDecision {
  scopeMode: TenantScopeMode
  /** 是否需要具体组织（tenant 模式恒为 true）。 */
  requiresConcreteOrganization: boolean
  /** 命中的 allow-list 能力（全局/运维模式才有）。 */
  capability: string | null
}

@inject()
export default class TenantScopeModeService {
  constructor(
    private readonly identificationAudit: TenantIdentificationAuditService = new TenantIdentificationAuditService(),
  ) {}

  /** 能力是否在全局低敏 allow-list 内。 */
  isGlobalLowSensitiveAllowed(capability: string): capability is GlobalLowSensitiveCapability {
    return (GLOBAL_LOW_SENSITIVE_CAPABILITIES as readonly string[]).includes(capability)
  }

  /** 能力是否在运维只读 allow-list 内。 */
  isSystemMaintenanceAllowed(capability: string): capability is SystemMaintenanceCapability {
    return (SYSTEM_MAINTENANCE_CAPABILITIES as readonly string[]).includes(capability)
  }

  /**
   * 解析请求的 scope mode（§6.1）。
   *
   * 不传 `requestedCapability` → 一律 `tenant`（默认最小可见面）。
   * 传了但不在 allow-list → 也回落到 `tenant`：解析阶段不抛异常，
   * 由 `assertGlobalMode` 在真正要执行全局操作时拒绝并审计。
   */
  resolveScopeMode(params: {
    decision: EffectiveTenantContext
    requestedCapability?: string | null
  }): ScopeModeDecision {
    const capability = params.requestedCapability ?? null

    // 非 super admin 永远是 tenant 模式——全局视图不对普通角色开放。
    if (!params.decision.isSuperAdmin || !capability) {
      return { scopeMode: 'tenant', requiresConcreteOrganization: true, capability: null }
    }

    if (this.isGlobalLowSensitiveAllowed(capability)) {
      return {
        scopeMode: 'global-low-sensitive',
        requiresConcreteOrganization: false,
        capability,
      }
    }

    if (this.isSystemMaintenanceAllowed(capability)) {
      return { scopeMode: 'system-maintenance', requiresConcreteOrganization: false, capability }
    }

    // 请求了全局但能力未许可 → 回落 tenant（fail closed 的默认）。
    return { scopeMode: 'tenant', requiresConcreteOrganization: true, capability: null }
  }

  /**
   * 断言普通业务操作有具体组织 scope（§6.2）。
   *
   * 对 **super admin 同样生效**——这是本任务的要点：管理员做项目/任务/AI/导出/DLP/KMS/
   * 合规/Compiler 操作时，必须先选定组织，不能凭 `system_global` 拿到跨租户业务数据。
   *
   * 拒绝用 404 而非 403：403 会告诉调用方"这个资源存在但你的 scope 不对"，
   * 在跨租户语境下仍是存在性泄露。
   */
  async assertConcreteTenantScope(params: {
    decision: EffectiveTenantContext
    domain: TenantScopedBusinessDomain
    operation: string
    requestId: string
    userId?: number | null
  }): Promise<number> {
    const organizationId = params.decision.organizationId
    // 0 是历史兼容值（isolation-architecture 核准时定性过的隐式全局通道），同样不接受。
    if (organizationId !== null && organizationId !== 0) {
      return organizationId
    }

    await this.identificationAudit.recordDenial({
      actorRef: params.decision.actorRef,
      userId: params.userId ?? null,
      organizationId: null,
      projectId: null,
      scopeMode: params.decision.scopeMode,
      selectionSource: params.decision.selectionSource,
      resolutionReason: 'NO_ACTIVE_ORGANIZATION',
      scopeHash: params.decision.scopeHash,
      operation: `${params.domain}.${params.operation}`,
      requestId: params.requestId,
    })
    throw new ResourceNotFoundException('资源不存在')
  }

  /**
   * 断言一次全局低敏 / 运维模式操作被许可，并写审计（§6.3）。
   *
   * 三道检查：actor 必须是 super admin、能力必须在对应 allow-list、模式必须与能力匹配。
   * 任一不过 → `PERMISSION_DENIED` + `GLOBAL_NOT_ALLOWED` 审计（这里用 403 而非 404：
   * 被拒的是"以全局模式执行某平台能力"，不涉及具体租户资源的存在性）。
   */
  async assertGlobalMode(params: {
    decision: EffectiveTenantContext
    capability: string
    scopeMode: Extract<TenantScopeMode, 'global-low-sensitive' | 'system-maintenance'>
    operation: string
    requestId: string
    userId?: number | null
  }): Promise<void> {
    const allowed =
      params.scopeMode === 'global-low-sensitive'
        ? this.isGlobalLowSensitiveAllowed(params.capability)
        : this.isSystemMaintenanceAllowed(params.capability)

    if (!params.decision.isSuperAdmin || !allowed) {
      await this.identificationAudit.recordDenial({
        actorRef: params.decision.actorRef,
        userId: params.userId ?? null,
        organizationId: params.decision.organizationId,
        projectId: null,
        scopeMode: params.decision.scopeMode,
        selectionSource: params.decision.selectionSource,
        resolutionReason: 'GLOBAL_NOT_ALLOWED',
        scopeHash: params.decision.scopeHash,
        operation: `${params.capability}.${params.operation}`,
        requestId: params.requestId,
      })
      throw new PermissionDeniedException('该操作不允许全局作用域')
    }

    // 许可的全局访问必须自审计（spec「Global low-sensitive mode is audited」）：
    // actor、模式、操作、reason code、requestId、时间戳。
    await this.identificationAudit.recordGlobalMode({
      actorRef: params.decision.actorRef,
      userId: params.userId ?? null,
      organizationId: null,
      projectId: null,
      scopeMode: params.scopeMode,
      selectionSource: 'super_admin_mode',
      resolutionReason:
        params.scopeMode === 'global-low-sensitive'
          ? 'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE'
          : 'SUPER_ADMIN_SYSTEM_MAINTENANCE',
      scopeHash: params.decision.scopeHash,
      operation: `${params.capability}.${params.operation}`,
      requestId: params.requestId,
    })
  }
}
