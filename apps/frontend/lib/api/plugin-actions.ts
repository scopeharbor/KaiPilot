/**
 * v3-plugin-action-preview-boundary —— 前端 PluginAction 统一边界 API。
 *
 * 封装插件动作提案的详情/预览/决策/确认四端点；
 * 确认必须携带服务器签发的一次性句柄（客户端不派生任何 authority 字段）。
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type { PluginActionPreview } from '@aiproj/types'

export interface PluginActionDetailDto {
  proposalUid: string
  status: 'proposed' | 'previewed' | 'rejected' | 'discarded' | 'applied' | 'stale'
  preview: PluginActionPreview | null
}

export interface PluginActionConfirmOutcomeDto {
  status: 'applied' | 'modified' | 'idempotent_replay'
  receipt: {
    proposalId: string
    status: 'applied' | 'modified'
    idempotencyKey: string
    writtenRefs: readonly string[]
    auditLogId: number
    auditCreatedAt: string
    appliedAt: string
  } | null
  message: string
}

export interface PluginActionDecisionDto {
  proposalUid: string
  status: PluginActionDetailDto['status']
}

/** GET /plugin-actions/:proposalUid —— 详情（含最新预览）。 */
export function getPluginAction(
  organizationId: string | number,
  proposalUid: string,
): Promise<{ data: PluginActionDetailDto }> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-actions/${proposalUid}`)
}

/** POST /plugin-actions/:proposalUid/preview —— 生成/刷新标准预览。 */
export function previewPluginAction(
  organizationId: string | number,
  proposalUid: string,
): Promise<{ data: PluginActionPreview }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-actions/${proposalUid}/preview`,
    { method: 'POST' },
  )
}

/** POST /plugin-actions/:proposalUid/decision —— reject/discard/modify。 */
export function decidePluginAction(
  organizationId: string | number,
  proposalUid: string,
  payload:
    | { decision: 'reject' | 'discard' }
    | { decision: 'modify'; userModifiedValue: Record<string, unknown> },
): Promise<{ data: PluginActionDecisionDto }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-actions/${proposalUid}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
}

/** POST /plugin-actions/:proposalUid/confirm —— 一次性句柄确认执行。 */
export function confirmPluginAction(
  organizationId: string | number,
  proposalUid: string,
  handle: string,
): Promise<{ data: PluginActionConfirmOutcomeDto }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-actions/${proposalUid}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle }),
    },
  )
}
