/**
 * report_v2/ai_draft_service —— V2 AI 周报/月报草稿服务。
 *
 * 设计原则（D5）：
 * - AI 只输入结构化聚合数据 + 脱敏模板提示
 * - 输出候选正文、摘要、亮点、风险提示和建议行动文案
 * - 保存为报表版本 aiDraft/reviewStatus
 * - 用户确认只标记版本可用，不修改项目数据
 * - 默认使用 fake provider，测试不调用真实模型
 */
import ReportVersion from '#models/report_version'
import type { ReportAiReviewStatus, ReportWarningV2 } from '@aiproj/types'

// ---------------------------------------------------------------------------
// AI 输入构造
// ---------------------------------------------------------------------------

export interface AiDraftInput {
  templateId: string
  projectName: string
  dateRange: { fromDate?: string; toDate?: string }
  dataSources: Record<string, unknown>
  warnings: ReportWarningV2[]
}

/**
 * 构造 AI 输入：只使用结构化聚合数据、sourceHash、warnings 和脱敏模板提示。
 */
export function buildAiInput(
  templateId: string,
  projectName: string,
  dateRange: { fromDate?: string; toDate?: string },
  dataSources: Record<string, unknown>,
  warnings: ReportWarningV2[],
): AiDraftInput {
  return {
    templateId,
    projectName,
    dateRange,
    dataSources,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Fake Provider（默认测试用）
// ---------------------------------------------------------------------------

export interface AiDraftOutput {
  draft: string
  summary: string
  highlights: string[]
  riskHints: string[]
  suggestedActions: string[]
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  estimatedCost: number
  latencyMs: number
}

/**
 * Fake AI provider：返回固定中文模板草稿（用于测试和默认降级）。
 */
export function fakeAiDraft(input: AiDraftInput, now?: Date): AiDraftOutput {
  const dateStr = (now ?? new Date()).toISOString().slice(0, 10)

  return {
    draft: `# ${input.projectName} — ${input.templateId === 'project-weekly' ? '周报' : '月报'}

## 总体摘要
项目 **${input.projectName}** 在 ${input.dateRange.fromDate ?? dateStr} 至 ${input.dateRange.toDate ?? dateStr} 期间保持正常推进。

## 关键数据
- 总任务数：${(input.dataSources as Record<string, unknown>).totalTasks ?? '—'}
- 完成率：${(input.dataSources as Record<string, unknown>).completedPercent ?? '—'}%
- 逾期任务：${(input.dataSources as Record<string, unknown>).overdueTaskCount ?? '0'}

## 风险提示
${input.warnings.length > 0 ? input.warnings.map((w) => `- ${w.message}`).join('\n') : '- 暂无重大风险'}

## 建议行动
1. 持续跟踪逾期任务和即将到期里程碑
2. 关注资源负载均衡
3. 定期审查风险状态

---
*本报告由 AI 辅助生成，仅供参考。最终版本需人工确认。*`,
    summary: `${input.projectName} 项目整体推进正常，完成率 ${(input.dataSources as Record<string, unknown>).completedPercent ?? '—'}%。`,
    highlights: ['项目核心指标稳定'],
    riskHints: input.warnings.map((w) => w.message),
    suggestedActions: ['关注逾期任务', '检查里程碑状态'],
    provider: 'fake',
    model: 'fake-model',
    promptTokens: 100,
    completionTokens: 200,
    estimatedCost: 0,
    latencyMs: 5,
  }
}

// ---------------------------------------------------------------------------
// 草稿管理
// ---------------------------------------------------------------------------

/**
 * 生成 AI 草稿（当前使用 fake provider，后续接入 AIGateway）。
 * 返回草稿 + 成本记录。
 */
export async function generateAiDraft(
  versionId: number,
  input: AiDraftInput,
): Promise<AiDraftOutput> {
  const output = fakeAiDraft(input)

  // 保存 AI 草稿到版本
  await ReportVersion.query()
    .where('id', versionId)
    .update({
      aiDraft: output.draft,
      aiReviewStatus: 'pending_review',
      aiCostRef: JSON.stringify({
        provider: output.provider,
        model: output.model,
        promptTokens: output.promptTokens,
        completionTokens: output.completionTokens,
        estimatedCost: output.estimatedCost,
        latencyMs: output.latencyMs,
      }),
    })

  return output
}

/**
 * 人工确认 AI 草稿。确认只标记版本可用，不修改项目数据。
 */
export async function confirmAiDraft(
  versionId: number,
  userId: number,
  options?: { editedDraft?: string },
): Promise<{ versionId: number; aiReviewStatus: ReportAiReviewStatus; confirmedAt: string }> {
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = {
    aiReviewStatus: 'confirmed',
    confirmedAt: now,
    confirmedBy: userId,
  }

  if (options?.editedDraft) {
    updateData.aiDraft = options.editedDraft
  }

  await ReportVersion.query().where('id', versionId).update(updateData)

  return { versionId, aiReviewStatus: 'confirmed', confirmedAt: now }
}

// ---------------------------------------------------------------------------
// Budget Guard（简化版）
// ---------------------------------------------------------------------------

export interface BudgetStatus {
  hardLimit: number
  softLimit: number
  currentSpend: number
  blocked: boolean
  warning: boolean
}

/**
 * 预算守卫。AI 报表调用前做 preflight 检查。
 * 硬预算超限阻止调用；软预算超限产生 warning。
 */
export function checkBudget(
  estimatedCost: number,
  hardLimit: number = 1000, // 默认硬预算（分）
  softLimit: number = 500, // 默认软预算（分）
  currentSpend: number = 0,
): BudgetStatus {
  const totalIfRun = currentSpend + estimatedCost

  return {
    hardLimit,
    softLimit,
    currentSpend,
    blocked: totalIfRun > hardLimit,
    warning: totalIfRun > softLimit && totalIfRun <= hardLimit,
  }
}
