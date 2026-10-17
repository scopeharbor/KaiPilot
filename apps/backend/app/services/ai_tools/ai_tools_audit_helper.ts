// apps/backend — v3-ai-tools-orchestration-layer —— RL-12 合规审计辅助库（W1）。
//
// 恪守 RL-12（AI 观测禁存全文红线）：
// - 入参只以 SHA-256 十六进制摘要（`parametersHash`）落库；`stableStringify` 保证
//   同一逻辑入参（与键序无关）产生同一哈希；
// - `metadata` 仅含 toolName / parametersHash / status / durationMs / errorCode，
//   严禁写入 prompt 原文、入参明文 JSON 或业务结果数据集（design.md D5/§7）。
//
// 事件 → 既有 `audit_logs.action` CHECK 枚举映射（design D5，零新增迁移）：
// - AI_TOOL_EXECUTED → 'ai_generate'（只读执行 / 写预览生成）
// - AI_TOOL_CONFIRMED → 'apply'（人工确认落库）
// - AI_TOOL_DENIED     → 'reject'（越权/非法调用被拦截）

import { createHash } from 'node:crypto'
import AuditService, { AuditEvent } from '#services/audit_service'
import { inject } from '@adonisjs/core'

export type AiToolAuditStatus =
  'SUCCESS' | 'PREVIEW_GENERATED' | 'CONFIRMED' | 'REJECTED' | 'FAILED'

export type AiToolAuditKind = 'executed' | 'confirmed' | 'denied'

export interface AiToolAuditRecord {
  readonly kind: AiToolAuditKind
  readonly userId: number
  readonly organizationId: number
  readonly projectId?: number | null
  readonly requestId?: string | null
  readonly toolName: string
  readonly parameters: unknown
  readonly status: AiToolAuditStatus
  readonly durationMs: number
  readonly errorCode?: string | null
}

/** 稳定 JSON 序列化：对象键按字典序排序，数组保序（与 gantt previewToken 同一算法）。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** 入参规范化 SHA-256 哈希（RL-12：只存哈希，绝不存明文）。 */
export function hashParameters(parameters: unknown): string {
  return createHash('sha256')
    .update(stableStringify(parameters ?? {}))
    .digest('hex')
}

@inject()
export default class AiToolsAuditHelper {
  constructor(private audit: AuditService) {}

  /**
   * 统一落库一次 AI 工具审计事件。写入失败由 AuditService 内部兜底（非 strict），
   * 绝不阻断业务主流程；调用方 `await` 以支持测试断言。
   */
  async log(record: AiToolAuditRecord): Promise<void> {
    const event =
      record.kind === 'confirmed'
        ? AuditEvent.AI_TOOL_CONFIRMED
        : record.kind === 'denied'
          ? AuditEvent.AI_TOOL_DENIED
          : AuditEvent.AI_TOOL_EXECUTED
    await this.audit.log({
      event,
      userId: record.userId,
      organizationId: record.organizationId,
      projectId: record.projectId ?? null,
      entityType: 'ai_tool',
      entityId: null,
      requestId: record.requestId ?? null,
      metadata: {
        toolName: record.toolName,
        parametersHash: hashParameters(record.parameters),
        status: record.status,
        durationMs: record.durationMs,
        errorCode: record.errorCode ?? null,
      },
    })
  }
}
