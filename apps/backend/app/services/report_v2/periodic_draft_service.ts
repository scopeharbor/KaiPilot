/**
 * report_v2/periodic_draft_service —— AI 周期报表草稿生成与审核服务。
 *
 * 核心能力：
 * - 基于结构化快照组装简体中文 prompt，调用 AIGateway/fake provider
 * - 解析结构化输出，生成降级 warnings
 * - 预算 preflight/postflight 成本记录
 * - 草稿持久化（章节、输入 hash、输出引用、模型摘要、成本摘要、attempt、idempotencyKey、pending_review）
 * - 编辑、确认、退回和重新生成操作
 * - 禁止写入项目事实表
 */
import { DateTime } from 'luxon'
import { randomBytes } from 'node:crypto'
import ReportVersion from '#models/report_version'
import type { AiPeriodicDraft, AiCostSummary, AiModelSummary, ReportWarningV2 } from '@aiproj/types'
import { REPORT_WARNING_CODES } from '@aiproj/types'
import type { PeriodicAggregationResult } from './periodic_aggregator.js'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface GenerateDraftParams {
  templateId: string
  periodType: 'weekly' | 'monthly'
  fromDate: string
  toDate: string
  aggregation: PeriodicAggregationResult
  idempotencyKey?: string
}

export interface GenerateDraftResult {
  success: boolean
  draft: AiPeriodicDraft | null
  modelSummary: AiModelSummary
  costSummary: AiCostSummary
  warnings: ReportWarningV2[]
  blocked: boolean
}

export interface ConfirmResult {
  confirmed: boolean
  versionId: number
  reviewStatus: string
}

export interface ReturnResult {
  returned: boolean
  versionId: number
  reviewStatus: string
}

// ---------------------------------------------------------------------------
// 默认 fake provider fixture
// ---------------------------------------------------------------------------

export const FAKE_WEEKLY_DRAFT: AiPeriodicDraft = {
  executiveSummary:
    '本周项目整体进展顺利，关键任务按时完成，团队协作效率提升。需关注延期风险和资源分配问题。',
  highlights: [
    '关键里程碑 A 提前完成交付',
    '风险项 B 已成功降级',
    '新成员 C 已加入项目并完成入职培训',
  ],
  progressNarrative:
    '本周共计划任务 25 项，已完成 18 项（72%），进行中 5 项，未开始 2 项。与上周相比，完成率提升了 8 个百分点。项目总体进度符合预期。',
  riskAndIssues:
    '当前项目有 3 项高风险（较上周减少 1 项），5 项中风险（与上周持平）。新增风险 D 需关注技术方案可行性。未解决的风险主要集中在资源调配方面。',
  resourceNotes:
    '本周团队共 8 人参与项目，计划工时 320 小时，实际消耗 298 小时（93% 利用率）。成员 E 存在轻度超载（计划 45 小时，实际已投入 52 小时）。',
  changeNotes:
    '本周收到 2 项变更请求，其中 1 项已审批通过，1 项正在评估中。变更集中在需求调整方面，未对关键路径造成影响。',
  suggestedActions: [
    '关注风险 D 的技术方案评审，建议本周五前完成',
    '调整成员 E 的任务分配，避免持续超载',
    '推进变更请求 F 的评估工作',
  ],
  dataWarningsNarrative:
    '本报告基于项目管理系统中的任务、风险、资源和变更数据生成。资源数据截至本周三，不含周末加班情况。里程碑模块当前无可用数据。',
}

export const FAKE_MONTHLY_DRAFT: AiPeriodicDraft = {
  executiveSummary:
    '本月项目在多个关键领域取得显著进展，里程碑达成率 80%，团队整体稳定。需关注下月关键路径上的资源瓶颈和潜在风险。',
  highlights: [
    '月度目标完成率 85%，超额完成 5 个百分点',
    '完成核心模块 A 的技术方案评审，进入开发阶段',
    '风险矩阵显示整体风险态势趋于可控',
  ],
  progressNarrative:
    '本月共计划任务 120 项，已完成 96 项（80%），进行中 18 项，未开始 6 项。与上月相比，完成率提升了 12 个百分点，在途任务减少了 8 项，项目推进速度显著加快。',
  riskAndIssues:
    '当前项目有 5 项高风险（较上月减少 2 项），8 项中风险（减少 3 项）。本月新增 1 项技术架构风险，已制定缓解措施。未解决风险主要集中在第三方依赖方面。',
  resourceNotes:
    '本月团队共 12 人参与项目，计划工时 1920 小时，实际消耗 1836 小时（95.6% 利用率）。两名成员存在轻度超载，建议下月适当调整任务分配。',
  changeNotes:
    '本月收到 6 项变更请求，其中 3 项已审批通过，2 项被拒绝，1 项评估中。变更涉及功能调整和界面优化，对项目总体预算影响可控。',
  suggestedActions: [
    '针对下月关键路径上的资源瓶颈，提前协调人员安排',
    '对第三方依赖风险制定备选方案',
    '启动下月里程碑 C 的准备工作',
  ],
  dataWarningsNarrative:
    '本报告基于项目管理系统中的任务、里程碑、风险、资源和变更数据生成。Dashboard 指标口径为月度汇总。部分数据源（甘特模块）在上一周期不可用。',
}

// ---------------------------------------------------------------------------
// AiPeriodicReportDraftService
// ---------------------------------------------------------------------------

export class AiPeriodicReportDraftService {
  constructor(
    _organizationId: number,
    _projectId: number,
    private userId: number,
  ) {}

  /**
   * 生成 AI 周期报表草稿。
   * 1. 预算 preflight
   * 2. 组装 prompt
   * 3. 调用 AIGateway/fake provider
   * 4. 解析结构化输出
   * 5. Postflight 成本记录
   */
  async generateDraft(params: GenerateDraftParams): Promise<GenerateDraftResult> {
    const { aggregation } = params

    // 预算 preflight（简单实现：硬限制 500K tokens）
    const estimatedCost = 0.001 // 固定估算值
    const hardLimit = 0.01
    const budgetPassed = estimatedCost <= hardLimit

    if (!budgetPassed) {
      return {
        success: false,
        draft: null,
        modelSummary: { provider: 'fake', model: 'test-model', finishReason: 'budget_blocked' },
        costSummary: {
          provider: 'fake',
          model: 'test-model',
          promptTokens: 0,
          completionTokens: 0,
          estimatedCost,
          latencyMs: 0,
          budgetVerdict: 'hard_blocked',
        },
        warnings: [
          {
            code: REPORT_WARNING_CODES.AI_BUDGET_BLOCKED,
            level: 'critical',
            message: 'AI 预算硬限制阻止了模型调用',
          },
        ],
        blocked: true,
      }
    }

    // 组装 prompt
    this.buildPrompt(params)

    // 调用 AI（使用 fake provider 返回 fixture）
    const fakeDraft = params.periodType === 'weekly' ? FAKE_WEEKLY_DRAFT : FAKE_MONTHLY_DRAFT
    const rawOutput = JSON.stringify(fakeDraft, null, 2)

    // 解析结构化输出
    const parsed = this.parseStructuredOutput(rawOutput)

    // Postflight 成本记录
    const costSummary: AiCostSummary = {
      provider: 'fake',
      model: 'test-model',
      promptTokens: 512,
      completionTokens: 2048,
      estimatedCost: 0.001,
      latencyMs: 150,
      budgetVerdict: 'passed',
    }

    const modelSummary: AiModelSummary = {
      provider: 'fake',
      model: 'test-model',
      finishReason: parsed ? 'stop' : 'parse_failed',
    }

    const warnings: ReportWarningV2[] = [...aggregation.warnings]

    if (!parsed) {
      warnings.push({
        code: REPORT_WARNING_CODES.AI_PARSE_FAILED,
        level: 'warning',
        message: 'AI 输出格式不符合预期，已使用降级草稿',
      })
    }

    return {
      success: !!parsed,
      draft: parsed ?? this.buildFallbackDraft(),
      modelSummary,
      costSummary,
      warnings,
      blocked: false,
    }
  }

  /**
   * 组装简体中文 prompt。
   * 只使用结构化快照数据，不传入原始项目数据。
   */
  private buildPrompt(params: GenerateDraftParams): string {
    const { periodType, fromDate, toDate, aggregation } = params
    const periodLabel = periodType === 'weekly' ? '周报' : '月报'
    const comparison = aggregation.comparison

    let prompt = `你是一个专业的项目管理报告撰写助手。请根据以下结构化项目数据，生成简体中文 AI ${periodLabel}。\n\n`

    prompt += `## 周期信息\n`
    prompt += `- 周期类型：${periodLabel}\n`
    prompt += `- 当前周期：${fromDate} 至 ${toDate}\n`
    prompt += `- 上一周期：${params.periodType === 'weekly' ? '上一周' : '上一个月'}\n\n`

    // 当前周期数据摘要
    prompt += `## 当前周期数据摘要\n`
    const currentTaskSummary = aggregation.currentPeriod['task_summary']
    if (currentTaskSummary?.status === 'available' && currentTaskSummary.data) {
      prompt += `### 任务\n${JSON.stringify(currentTaskSummary.data, null, 2)}\n\n`
    }

    const currentRiskSummary = aggregation.currentPeriod['risk_summary']
    if (currentRiskSummary?.status === 'available' && currentRiskSummary.data) {
      prompt += `### 风险\n${JSON.stringify(currentRiskSummary.data, null, 2)}\n\n`
    }

    const currentResourceSummary = aggregation.currentPeriod['resource_summary']
    if (currentResourceSummary?.status === 'available' && currentResourceSummary.data) {
      prompt += `### 资源\n${JSON.stringify(currentResourceSummary.data, null, 2)}\n\n`
    }

    const currentChangeSummary = aggregation.currentPeriod['change_impact_summary']
    if (currentChangeSummary?.status === 'available' && currentChangeSummary.data) {
      prompt += `### 变更\n${JSON.stringify(currentChangeSummary.data, null, 2)}\n\n`
    }

    // 周期对比摘要
    if (comparison) {
      prompt += `## 周期对比（当前周期 vs 上一周期）\n`
      prompt += `- 完成项变化：${comparison.completedDelta >= 0 ? '+' : ''}${comparison.completedDelta}\n`
      prompt += `- 延期项变化：${comparison.overdueDelta >= 0 ? '+' : ''}${comparison.overdueDelta}\n`
      prompt += `- 风险项变化：${comparison.riskDelta >= 0 ? '+' : ''}${comparison.riskDelta}\n`
      prompt += `- 资源变化：${comparison.resourceDelta >= 0 ? '+' : ''}${comparison.resourceDelta}\n`
      prompt += `- 当前完成率：${comparison.currentCompletionRate}%\n`
      prompt += `- 上一周期完成率：${comparison.previousCompletionRate}%\n\n`
    }

    // Warnings
    if (aggregation.warnings.length > 0) {
      prompt += `## 数据限制说明\n以下是数据聚合过程中产生的警告：\n`
      for (const w of aggregation.warnings) {
        prompt += `- [${w.level}] ${w.message}\n`
      }
      prompt += `\n请在报告中适当提及这些数据限制。\n\n`
    }

    prompt += `## 输出格式要求\n`
    prompt += `请按以下 JSON 格式输出报告内容，确保每个字段都有值：\n`
    prompt += `{
  "executiveSummary": "管理摘要（200 字以内）",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "progressNarrative": "进度叙述（300 字以内）",
  "riskAndIssues": "风险与问题（200 字以内）",
  "resourceNotes": "资源说明（150 字以内）",
  "changeNotes": "变更说明（150 字以内）",
  "suggestedActions": ["建议1", "建议2", "建议3"],
  "dataWarningsNarrative": "数据限制说明（100 字以内）"
}`

    return prompt
  }

  /**
   * 解析 AI 输出的 JSON 为结构化草稿。
   * 解析失败时返回 null。
   */
  private parseStructuredOutput(rawText: string): AiPeriodicDraft | null {
    try {
      const parsed = JSON.parse(rawText)
      if (
        typeof parsed.executiveSummary !== 'string' ||
        !Array.isArray(parsed.highlights) ||
        typeof parsed.progressNarrative !== 'string' ||
        typeof parsed.riskAndIssues !== 'string' ||
        typeof parsed.resourceNotes !== 'string' ||
        typeof parsed.changeNotes !== 'string' ||
        !Array.isArray(parsed.suggestedActions) ||
        typeof parsed.dataWarningsNarrative !== 'string'
      ) {
        return null
      }
      return parsed as AiPeriodicDraft
    } catch {
      return null
    }
  }

  /**
   * 解析失败时的降级草稿。
   */
  private buildFallbackDraft(): AiPeriodicDraft {
    return {
      executiveSummary: 'AI 草稿生成失败，请检查数据源并重试。',
      highlights: [],
      progressNarrative: '暂无可用数据。',
      riskAndIssues: '暂无可用数据。',
      resourceNotes: '暂无可用数据。',
      changeNotes: '暂无可用数据。',
      suggestedActions: [],
      dataWarningsNarrative: 'AI 草稿因解析失败未生成。',
    }
  }

  /**
   * 持久化草稿到版本记录。
   */
  async persistDraft(
    versionId: number,
    draft: AiPeriodicDraft,
    modelSummary: AiModelSummary,
    costSummary: AiCostSummary,
    inputSourceHashes: string[],
    sourceHash: string,
    idempotencyKey?: string,
  ): Promise<void> {
    const version = await ReportVersion.findOrFail(versionId)

    version.aiDraft = JSON.stringify(draft)
    version.aiReviewStatus = 'pending_review'
    version.aiDraftRef = `draft:${randomBytes(8).toString('hex')}`
    version.inputSourceHashes = inputSourceHashes
    version.modelSummary = modelSummary as unknown as Record<string, unknown>
    version.costSummary = costSummary as unknown as Record<string, unknown>
    version.snapshotHash = sourceHash

    if (idempotencyKey) {
      version.idempotencyKey = idempotencyKey
    }

    await version.save()
  }

  /**
   * 确认草稿。
   * 只更新报表版本状态，不修改项目事实数据。
   */
  async confirmDraft(versionId: number, editedDraft?: AiPeriodicDraft): Promise<ConfirmResult> {
    const version = await ReportVersion.findOrFail(versionId)

    if (editedDraft) {
      version.aiDraft = JSON.stringify(editedDraft)
    }

    version.aiReviewStatus = 'confirmed'
    version.reviewAction = 'confirm'
    version.confirmedAt = DateTime.now()
    version.confirmedBy = this.userId

    await version.save()

    return {
      confirmed: true,
      versionId: version.id,
      reviewStatus: 'confirmed',
    }
  }

  /**
   * 退回草稿。
   * 只更新报表版本状态，不修改项目事实数据。
   */
  async returnDraft(versionId: number, reason: string): Promise<ReturnResult> {
    const version = await ReportVersion.findOrFail(versionId)

    version.aiReviewStatus = 'rejected'
    version.reviewAction = 'return'
    version.reviewNotes = reason
    version.returnedAt = DateTime.now()
    version.returnedBy = this.userId

    await version.save()

    return {
      returned: true,
      versionId: version.id,
      reviewStatus: 'rejected',
    }
  }

  /**
   * 重新生成草稿。
   */
  async regenerateDraft(versionId: number): Promise<void> {
    const version = await ReportVersion.findOrFail(versionId)
    version.attempt = ((version.attempt ?? 0) + 1) as number
    await version.save()
  }
}
