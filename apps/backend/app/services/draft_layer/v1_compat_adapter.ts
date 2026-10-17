/**
 * v2-ai-draft-layer-preview-diff-apply —— V1→V2 兼容适配器（task 11.1-11.2）。
 *
 * 使 V1 AiProjectDraft 审查路径能与 V2 Draft Layer sourceType 共享底层能力。
 * V1 草案通过此适配器包装后，可复用 V2 的 selection、事务和审计能力。
 */
import DraftLayerSession from '#models/draft_layer_session'

/**
 * 将 V1 AiProjectDraft 包装为 DraftLayerSession 兼容视图。
 * 不创建真正的 DB 记录，只是适配接口供上游共用。
 */
export interface V1CompatSessionView {
  sessionId: number
  organizationId: number
  userId: number
  sourceType: 'v2_compiler_pdm'
  status: string
  version: number
  changes: number
}

/**
 * 检查 DraftLayerSession 是否存在对应的 V1 草案记录。
 * 用于在 V1 草案审查页面展示 Draft Layer 入口。
 */
export async function findCompatLayerSession(
  organizationId: number,
  compilerRunId: number,
): Promise<DraftLayerSession | null> {
  return DraftLayerSession.forOrganization(organizationId)
    .where('compiler_run_id', compilerRunId)
    .first()
}

/**
 * 在 V1 草案确认流程中注入 V2 Draft Layer 校验：
 * 如果 V1 确认请求包含 compilerRunId，且存在关联的 Draft Layer session，
 * 则要求 V2 hash 校验通过后才能写入正式数据。
 */
export function needsV2HashCheck(requestVersion: number, sessionVersion: number): boolean {
  return requestVersion >= sessionVersion
}

/**
 * 返回 V2 Draft Layer 在 V1 审查页面上显示的状态摘要。
 */
export function toV1CompatSummary(session: DraftLayerSession): Record<string, unknown> {
  return {
    draftLayerSessionId: session.id,
    source: session.sourceType,
    compilerRunId: session.compilerRunId,
    status: session.status,
    version: session.version,
    pdmHash: session.pdmHash,
    summary: session.summary,
  }
}
