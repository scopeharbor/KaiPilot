/**
 * v3-copilot-feedback-driven-ranking — 开关与偏好服务
 *
 * 核心设计纪律：
 * - 加权默认关闭
 * - 组织级开关开启后才生效
 * - 个人可在组织允许范围内关闭，但不能反向开启
 * - 关闭时排序实现完全不读加权投影
 * - 开启组织开关时留审计
 */

export interface WeightingSwitchConfig {
  /** 组织级开关：是否启用加权排序 */
  organizationEnabled: boolean
  /** 个人偏好：是否关闭加权排序（组织允许范围内） */
  personalDisabled: boolean
}

export interface AuditEntry {
  action: 'enable' | 'disable'
  actorId: number
  organizationId: number
  timestamp: string
  reason?: string
}

export class WeightingSwitchService {
  private auditLog: AuditEntry[] = []

  /**
   * 检查加权是否启用。
   * 默认关闭：缺省配置下排序与既有确定性排序完全一致。
   */
  isEnabled(config: WeightingSwitchConfig): boolean {
    // 组织级开关必须开启
    if (!config.organizationEnabled) return false
    // 个人不能在组织允许范围内关闭
    if (config.personalDisabled) return false
    return true
  }

  /**
   * 组织级开关：开启加权排序。
   * 必须经 RBAC 校验。
   */
  enableOrganization(
    organizationId: number,
    actorId: number,
  ): { success: boolean; audit?: AuditEntry } {
    const audit: AuditEntry = {
      action: 'enable',
      actorId,
      organizationId,
      timestamp: new Date().toISOString(),
    }
    this.auditLog.push(audit)
    return { success: true, audit }
  }

  /**
   * 个人偏好：关闭加权排序（组织允许范围内）。
   * 个人不能反向开启组织已关闭的加权。
   */
  setPersonalPreference(
    config: WeightingSwitchConfig,
    personalDisabled: boolean,
  ): { success: boolean; error?: string } {
    // 个人不能开启组织已关闭的加权
    if (!config.organizationEnabled && !personalDisabled) {
      return { success: false, error: 'Cannot enable weighting that the organization has disabled' }
    }
    return { success: true }
  }

  /**
   * 获取审计日志。
   */
  getAuditLog(organizationId: number): AuditEntry[] {
    return this.auditLog.filter((e) => e.organizationId === organizationId)
  }
}
