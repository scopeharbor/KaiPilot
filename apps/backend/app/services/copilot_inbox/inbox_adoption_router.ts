import { CopilotActionBuilder } from '#services/copilot_action/action_builder'
import type { InboxAdoptionRouter } from './inbox_state_service.js'

/**
 * 收件箱采纳路由 —— 转交已交付的 Copilot 动作边界。
 *
 * spec 要求：「Adoption MUST materialize through the shipped Copilot action boundary's
 * preview, diff, dry-run, confirmation and apply flow」，且收件箱自身
 * 「MUST contain no domain write dependency」。
 *
 * `CopilotActionBuilder.materializeAction` 正是那条通道：它**只写
 * `ai_draft_layer_sessions` / `ai_draft_layer_changes`，不写任何正式业务表**，
 * 产出的草案层会话就是用户随后复核、确认、应用的对象。本路由只调用它，
 * 收件箱侧不持有任何领域写入依赖。
 *
 * **变更集刻意留空**（`changeInputs: []`）。收件箱按 spec 只存来源引用、不存建议正文，
 * 而五个来源存的都是描述性内容（PMO 的 `suggestedAction`、诊断项的 `suggestedAction`、
 * 信号的 `evidence`），**没有任何一个存了 `targetRef` / `operation` / `value` 这种
 * 处方式变更**。把自由文本翻译成变更集是 AI 动作卡管线的职责，不是收件箱能确定性完成的：
 * 凭空编一份变更集比留空危险得多。留空的会话是真实存在、可复核的——
 * 用户在草案层里基于来源引用补齐要改什么，再走既有的 dry-run / 确认 / 应用。
 */
export class CopilotActionBoundaryAdoptionRouter implements InboxAdoptionRouter {
  constructor(private readonly builder: CopilotActionBuilder = new CopilotActionBuilder()) {}

  async startAdoptionPreview(params: {
    entryId: string
    sourceRefs: readonly { sourceKind: string; sourceId: string }[]
    organizationId: number
    projectId: number
    actorId: number
  }): Promise<{ sessionId: string }> {
    const { session } = await this.builder.materializeAction({
      organizationId: params.organizationId,
      userId: params.actorId,
      actionCardId: `inbox-entry:${params.entryId}`,
      normalizedActionInput: `采纳收件箱建议（条目 ${params.entryId}，项目 ${params.projectId}）`,
      // 采纳是终态迁移、每个条目只会发生一次，用条目本身作幂等锚点即可。
      idempotencyKey: `inbox-adopt:${params.organizationId}:${params.entryId}`,
      // 低敏溯源：只带「来源种类:来源 ID」，不含任何建议正文或证据。
      sourceSignaturePrefixes: params.sourceRefs.map((ref) => `${ref.sourceKind}:${ref.sourceId}`),
      reliedOnSubstitutedDefaults: false,
      changeInputs: [],
    })

    return { sessionId: String(session.id) }
  }
}
