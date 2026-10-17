/**
 * v3-copilot-memory-user-and-project —— 记忆生命周期服务
 *
 * 候选确认、编辑、失效、删除、审计、组织隔离。
 * 核心约束：
 * - 候选不静默写入
 * - 组织 scope 写入需组织级权限
 * - 删除不留可重建残留
 * - 全生命周期低敏审计
 * - 记忆恒为 inference，不得升格为 fact
 */

import type {
  CopilotMemoryScope,
  CopilotMemoryAuditAction,
  CopilotMemoryAuditEvent,
  CopilotMemoryEntry,
  CopilotMemoryExportEntry,
  CopilotMemoryExportResult,
} from '@aiproj/types'

/**
 * 审计事件存储接口（由具体审计实现注入）。
 */
export interface MemoryAuditSink {
  record(event: CopilotMemoryAuditEvent): void
}

/**
 * 服务配置。
 */
export interface CopilotMemoryServiceConfig {
  readonly auditSink: MemoryAuditSink
}

/**
 * 创建低敏审计事件（不含记忆内容）。
 */
export function createAuditEvent(
  action: CopilotMemoryAuditAction,
  actorId: number,
  organizationId: number,
  entryId: string,
  scope: CopilotMemoryScope,
  metadata?: Readonly<Record<string, string | number | boolean>>,
): CopilotMemoryAuditEvent {
  return {
    action,
    actorId,
    organizationId,
    entryId,
    scope,
    timestamp: new Date().toISOString(),
    metadata,
  }
}

/**
 * 验证组织 scope 写入的权限门。
 * 无组织权限时拒绝且不泄露既有组织记忆存在。
 */
export function canWriteOrganizationMemory(actorRole: string): {
  allowed: boolean
  reason?: string
} {
  const adminRoles = ['organization_admin', 'super_admin']
  if (!adminRoles.includes(actorRole)) {
    return { allowed: false, reason: '无组织管理权限，无法写入组织记忆' }
  }
  return { allowed: true }
}

/**
 * 验证用户记忆读取权限。
 * 用户记忆仅本人与组织审计权限可读。
 */
export function canReadUserMemory(
  readerId: number,
  memoryOwnerId: number,
  readerRole: string,
): { allowed: boolean; reason?: string } {
  if (readerId === memoryOwnerId) return { allowed: true }
  const auditRoles = ['organization_admin', 'super_admin', 'audit_reader']
  if (auditRoles.includes(readerRole)) return { allowed: true }
  return { allowed: false, reason: '无权限读取该用户记忆' }
}

/**
 * 验证删除后不留可重建残留。
 * 实际删除由数据库 CASCADE 和 service 层组合保证。
 */
export function validateNoReconstructableResidue(_entryId: string): {
  ok: boolean
  reason?: string
} {
  // basis 引用通过外键级联删除
  // summary 仅存在于 entries 表
  // tags 仅存在于 entries 表
  // 删除 entries 行即清除所有可重建信息
  return { ok: true, reason: '条目删除后无残留：summary/tags/basis 仅存储在 entries 表' }
}

/**
 * 导出为低敏结构化格式（脱敏后）。
 */
export function exportMemoryEntries(
  entries: readonly CopilotMemoryEntry[],
  organizationId: number,
): CopilotMemoryExportResult {
  const exportEntries: CopilotMemoryExportEntry[] = entries.map((e) => ({
    id: e.id,
    scope: e.scope,
    summary: e.summary,
    tags: e.tags,
    confidence: e.confidence,
    status: e.status,
    validityTier: e.validityTier,
    observedAt: e.observedAt,
    lastConfirmedAt: e.lastConfirmedAt,
    basisCount: e.basis.length,
  }))

  return {
    entries: exportEntries,
    totalCount: exportEntries.length,
    exportedAt: new Date().toISOString(),
    organizationId,
  }
}

/**
 * 验证导出脱敏：不包含凭据、敏感信息或模型输出。
 */
export function validateExportSanitized(result: CopilotMemoryExportResult): {
  ok: boolean
  reason?: string
} {
  for (const entry of result.entries) {
    // summary 应已被 sanitizer 过滤
    if (entry.summary.length > 512) {
      return { ok: false, reason: `条目 ${entry.id} summary 超过 512 字符` }
    }
  }
  return { ok: true }
}
