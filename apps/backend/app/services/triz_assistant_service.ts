import type {
  AiTrizAssistantRunStatus,
  AiTrizAssistantRouteDecision,
  AiTrizAssistantRecommendedAction,
  AiTrizAssistantClarificationPrompt,
  AiTrizAssistantWarningCode,
  AiTrizAssistantDegradedReason,
  AiTrizAssistantCostSummary,
  AiTrizAssistantResponse,
  AiTrizAssistantRunSummary,
  AiTrizAssistantRunDetail,
  AiTrizAssistantMessage,
  AiTrizAssistantMessageRole,
  AiTrizAssistantFeedbackResponse,
  AiTrizAssistantPreviewResponse,
  AiTrizAssistantSourceKind,
  AiTrizAssistantActorPermissions,
  AiTrizAssistantFeatureFlags,
  AiTrizAssistantContextPacket,
  AiTrizAssistantFeedbackReason,
  AiTrizAssistantAiNarrative,
} from '@aiproj/types'
import {
  generateAssistantRunId,
  generateAssistantMessageId,
  generateAssistantFeedbackId,
  computeAssistantIdempotencyKey,
  computeAssistantOutputHash,
  computeAssistantContextPacketHash,
  normalizeAssistantIntent,
  computeAssistantRouteScores,
  buildAssistantRecommendedAction,
  validateAssistantSubmitRequest,
  AI_TRIZ_ASSISTANT_SOURCE_KINDS,
  AI_TRIZ_ASSISTANT_DESTINATION_LABELS,
} from '@aiproj/types'
import TrizAssistantSourceAdapter from './triz_assistant_source_adapter.js'
import TrizAssistantRun from '#models/triz_assistant_run'
import TrizAssistantMessage from '#models/triz_assistant_message'
import TrizAssistantFeedback from '#models/triz_assistant_feedback'
import logger from '@adonisjs/core/services/logger'

// ---------------------------------------------------------------------------
// 服务配置
// ---------------------------------------------------------------------------

const DEFAULT_PAGE = 1
const DEFAULT_PER_PAGE = 20
const MAX_PER_PAGE = 100
const CONTEXT_BUDGET_SOURCES = 20

// ---------------------------------------------------------------------------
// 来源权限映射（从 actor 权限生成功能标志）
// ---------------------------------------------------------------------------

function buildFeatureFlags(
  permissions: AiTrizAssistantActorPermissions,
): AiTrizAssistantFeatureFlags {
  const evolutionTrendAvailable = permissions.sourcePermissions['evolution_trend_run'] !== false
  const knowledgeBaseAvailable = permissions.sourcePermissions['knowledge_summary'] !== false
  const skillSystemAvailable = permissions.sourcePermissions['skill_summary'] !== false
  return { evolutionTrendAvailable, knowledgeBaseAvailable, skillSystemAvailable }
}

// ---------------------------------------------------------------------------
// TrizAssistantService（§5.1–§5.8）
// ---------------------------------------------------------------------------

export default class TrizAssistantService {
  private sourceAdapter = new TrizAssistantSourceAdapter()

  /**
   * 提交消息 — 核心编排流水线。
   * ContextCollector → IntentClassifier → ToolRouter → ActionBuilder → Response
   */
  async submitMessage(
    organizationId: number,
    projectId: number,
    actorId: number,
    message: string,
    permissions: AiTrizAssistantActorPermissions,
    options?: { selectedSourceRefs?: string[]; idempotencyKey?: string; enableAi?: boolean },
  ): Promise<AiTrizAssistantResponse> {
    const validation = validateAssistantSubmitRequest({ message })
    if (!validation.valid) {
      throw new Error(`验证失败: ${validation.errors.join(', ')}`)
    }

    const enableAi = options?.enableAi === true && permissions.canTriggerAi

    // ── Stage 1: Context Collection ──
    const allSourceKinds = [...AI_TRIZ_ASSISTANT_SOURCE_KINDS] as AiTrizAssistantSourceKind[]
    const featureFlags = buildFeatureFlags(permissions)
    const { summaries, warnings: adapterWarnings } = await this.sourceAdapter.collect(
      organizationId,
      projectId,
      allSourceKinds,
      featureFlags,
    )

    // 权限过滤：只保留 actor 可读的来源
    const authorizedSummaries = summaries.filter(
      (s) => permissions.sourcePermissions[s.sourceKind] !== false,
    )

    // 预算截断
    const truncated = authorizedSummaries.length > CONTEXT_BUDGET_SOURCES
    const boundedSummaries = truncated
      ? authorizedSummaries.slice(0, CONTEXT_BUDGET_SOURCES)
      : authorizedSummaries

    const contextPacket: AiTrizAssistantContextPacket = {
      contextHash: computeAssistantContextPacketHash(boundedSummaries),
      sources: boundedSummaries,
      sourceOrdering: boundedSummaries.map((s) => s.sourceKind),
      truncated,
      truncationWarning: truncated
        ? `上下文截断：共 ${authorizedSummaries.length} 个来源，仅纳入 ${CONTEXT_BUDGET_SOURCES} 个`
        : undefined,
      permissions,
      featureFlags,
    }

    // ── Stage 2: Intent Classification ──
    const intent = normalizeAssistantIntent(message)

    // ── Stage 3: Tool Routing ──
    const routeDecisions = computeAssistantRouteScores({
      intent,
      sourceKinds: boundedSummaries.map((s) => s.sourceKind),
      permissions,
      featureFlags,
    })

    // ── Stage 4: Action Building ──
    const actionWarnings: AiTrizAssistantWarningCode[] = []
    const allWarnings: AiTrizAssistantWarningCode[] = [
      ...adapterWarnings.map((w) => w.code),
      ...actionWarnings,
    ]

    const recommendedActions: AiTrizAssistantRecommendedAction[] = routeDecisions
      .filter((d) => d.confidence === 'high' || d.confidence === 'medium')
      .slice(0, 5)
      .map((d) => {
        return buildAssistantRecommendedAction({
          destination: d.destination,
          actionType: d.confidence === 'high' ? 'open_review' : 'navigate',
          sourceRefs: d.sourceRefs,
          sourceHashes: d.sourceHashes,
          requiredPermissions: ['triz_assistant:view'],
          requiresUserConfirmation: true,
          lowSensitivitySummary: `${AI_TRIZ_ASSISTANT_DESTINATION_LABELS[d.destination]}: ${d.reason}`,
        })
      })

    const clarificationPrompts: AiTrizAssistantClarificationPrompt[] =
      intent === 'missing_information'
        ? [
            {
              promptId: `clarify_${Date.now().toString(36)}`,
              question: '需要补充哪些信息才能继续分析？',
              purpose: '识别缺口信息以提供更精准的 TRIZ 工具推荐',
              quickOptions: ['补充项目约束', '提供技术参数', '描述具体矛盾'],
              relatedIntent: 'missing_information',
              sourceRefs: [],
            },
          ]
        : []

    // ── Stage 5: Response Assembly ──
    const runId = generateAssistantRunId()
    const messageId = generateAssistantMessageId()

    // ── Optional: AI Narration (§5.6) ──
    let aiNarrative: AiTrizAssistantAiNarrative | undefined
    let isFallback = false
    let costSummary: AiTrizAssistantCostSummary | undefined

    if (enableAi) {
      try {
        aiNarrative = await this.generateAiNarrative(contextPacket, routeDecisions, {
          budgetGuard: true,
        })
        if (aiNarrative.isFallback) {
          isFallback = true
          allWarnings.push('AI_FALLBACK')
        }
        costSummary = aiNarrative.costSummary
      } catch {
        allWarnings.push('AI_PROVIDER_ERROR')
        isFallback = true
        aiNarrative = {
          text: routeDecisions[0]?.reason ?? '确定性建议已生成',
          isFallback: true,
          degradedReason: 'provider_error',
          validationStatus: 'not_validated',
        }
      }
    }

    const response: AiTrizAssistantResponse = {
      runId,
      messageId,
      intent,
      routeDecisions,
      recommendedActions,
      clarificationPrompts,
      aiNarrative,
      warnings: allWarnings,
      fallback: isFallback,
      reviewRequired: true,
      costSummary,
      auditRefs: {
        runId,
        routeIds: routeDecisions.map((r) => r.routeId),
        actionIds: recommendedActions.map((a) => a.actionId),
        sourceRefKinds: boundedSummaries.map((s) => s.sourceKind),
        sourceHashPrefixes: boundedSummaries.map((s) => s.sourceHash.slice(0, 8)),
        warningCodes: allWarnings,
        fallbackState: isFallback,
      },
      createdAt: new Date().toISOString(),
    }

    // ── 持久化（低敏摘要） ──
    try {
      const idempotencyKey =
        options?.idempotencyKey ??
        computeAssistantIdempotencyKey(
          message,
          boundedSummaries.map((s) => s.sourceHash),
          actorId,
        )

      // 幂等检查
      const existing = await TrizAssistantRun.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('idempotency_key', idempotencyKey)
        .first()

      if (existing) {
        return response
      }

      const run = await TrizAssistantRun.create({
        organizationId,
        projectId,
        actorId,
        runId,
        status: 'completed',
        intent,
        intentSummary: message.slice(0, 512),
        routeDecisionsJson: routeDecisions,
        recommendedActionsJson: recommendedActions,
        clarificationPromptsJson: clarificationPrompts,
        inputSignature: computeAssistantIdempotencyKey(message, [], 0).slice(0, 128),
        outputHash: computeAssistantOutputHash(response),
        idempotencyKey,
        sourceRefsJson: boundedSummaries.map((s) => s.sourceRef),
        sourceHashPrefixesJson: boundedSummaries.map((s) => s.sourceHash.slice(0, 8)),
        warningCodesJson: allWarnings,
        isFallback: false,
        degradedReason: null,
        reviewRequired: true,
        messageCount: 1,
      })

      await TrizAssistantMessage.create({
        organizationId,
        projectId,
        runDbId: run.id,
        runId,
        messageId,
        role: 'user' as AiTrizAssistantMessageRole,
        contentSummary: message.slice(0, 1024),
        sourceRefsJson: boundedSummaries.map((s) => s.sourceRef),
      })
    } catch (err) {
      logger.error({ err, runId }, 'Failed to persist assistant run')
    }

    return response
  }

  /**
   * 列表 runs — 分页、排序、组织隔离。
   */
  async listRuns(
    organizationId: number,
    projectId: number,
    query: {
      page?: number
      perPage?: number
      status?: string
      sort?: string
    } = {},
  ): Promise<{
    data: AiTrizAssistantRunSummary[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = query.page ?? DEFAULT_PAGE
    const perPage = Math.min(query.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE)

    let q = TrizAssistantRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (query.status && query.status.length > 0) {
      q = q.where('status', query.status)
    }

    const sort = query.sort ?? '-createdAt'
    if (sort.startsWith('-')) {
      q = q.orderBy(sort.slice(1), 'desc')
    } else {
      q = q.orderBy(sort, 'asc')
    }

    const result = await q.paginate(page, perPage)

    const data: AiTrizAssistantRunSummary[] = result.all().map((r) => ({
      runId: r.runId,
      status: r.status as AiTrizAssistantRunStatus,
      intentSummary: r.intentSummary,
      messageCount: r.messageCount,
      destinationTypes: r.routeDecisionsJson.slice(0, 5).map((d) => d.destination),
      warningCodes: r.warningCodesJson,
      fallback: r.isFallback,
      costSummary: r.costSummaryJson ?? undefined,
      createdAt: r.createdAt.toISO()!,
      updatedAt: r.updatedAt?.toISO() ?? r.createdAt.toISO()!,
    }))

    return {
      data,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /**
   * Run 详情。
   */
  async getRunDetail(
    organizationId: number,
    projectId: number,
    runId: string,
  ): Promise<AiTrizAssistantRunDetail> {
    const run = await TrizAssistantRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_id', runId)
      .first()

    if (!run) throw new Error('RESOURCE_NOT_FOUND')

    const messages = await TrizAssistantMessage.query()
      .where('organization_id', organizationId)
      .where('run_id', runId)
      .orderBy('created_at', 'asc')

    const messageDTOs: AiTrizAssistantMessage[] = messages.map((m) => ({
      messageId: m.messageId,
      runId: m.runId,
      role: m.role as AiTrizAssistantMessageRole,
      content: m.contentSummary,
      sourceRefs: m.sourceRefsJson,
      createdAt: m.createdAt.toISO()!,
    }))

    return {
      runId: run.runId,
      status: run.status as AiTrizAssistantRunStatus,
      messages: messageDTOs,
      createdAt: run.createdAt.toISO()!,
      updatedAt: run.updatedAt?.toISO() ?? run.createdAt.toISO()!,
    }
  }

  /**
   * 记录反馈。
   */
  async recordFeedback(
    organizationId: number,
    projectId: number,
    actorId: number,
    runId: string,
    reason: string,
    comment?: string,
  ): Promise<AiTrizAssistantFeedbackResponse> {
    const run = await TrizAssistantRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_id', runId)
      .first()

    if (!run) throw new Error('RESOURCE_NOT_FOUND')

    const feedbackId = generateAssistantFeedbackId()

    await TrizAssistantFeedback.create({
      organizationId,
      projectId,
      actorId,
      feedbackId,
      runId,
      messageId: run.runId,
      reason: reason as AiTrizAssistantFeedbackReason,
      comment: comment ?? null,
    })

    return {
      feedbackId,
      runId,
      messageId: run.runId,
      reason: reason as AiTrizAssistantFeedbackReason,
      recorded: true,
    }
  }

  /**
   * Preview/Handoff — 验证 source hash 后返回预览数据。
   */
  async previewAction(
    organizationId: number,
    projectId: number,
    actionId: string,
    sourceHashes: string[],
  ): Promise<AiTrizAssistantPreviewResponse> {
    const run = await TrizAssistantRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')
      .first()

    if (!run) throw new Error('RESOURCE_NOT_FOUND')

    const action = run.recommendedActionsJson.find((a) => a.actionId === actionId)
    if (!action) throw new Error('RESOURCE_NOT_FOUND')

    const currentSourceHashPrefixes = run.sourceHashPrefixesJson

    // Stale 检查
    const isStale = sourceHashes.some(
      (h) => !currentSourceHashPrefixes.some((prefix) => h.startsWith(prefix)),
    )

    return {
      actionId: action.actionId,
      destination: action.destination,
      staleBlocked: isStale,
      staleReason: isStale ? '来源数据已变更，建议刷新后重新审查' : undefined,
      previewData: action.handoffInput ?? {},
      sourceRefs: action.sourceRefs,
      sourceHashes: action.sourceHashes,
      requiresUserConfirmation: action.requiresUserConfirmation,
    }
  }

  /**
   * 可选 AI 叙述（§5.6）— 通过 AIGateway 生成中文解释，退化为确定性 fallback。
   *
   * 三道闸：
   * 1. 权限闸：缺少 ai:trigger → 直接回退
   * 2. 预算闸：AIGateway 不可用 → 回退
   * 3. 反幻觉闸：引用不在 context packet 中的 hash → 拒绝叙述
   *
   * AI 叙述不能改变任何确定性字段。
   */
  async generateAiNarrative(
    _contextPacket: AiTrizAssistantContextPacket,
    routeDecisions: AiTrizAssistantRouteDecision[],
    options?: { budgetGuard?: boolean },
  ): Promise<AiTrizAssistantAiNarrative> {
    // 默认 deterministic fallback（不调用真实模型）
    if (options?.budgetGuard !== false) {
      const topDecision = routeDecisions[0]
      let fallbackReason: AiTrizAssistantDegradedReason = 'budget_exceeded'
      let fallbackText = 'AI 增强叙述不可用：预算保护'
      if (topDecision) {
        fallbackText = `推荐使用 ${AI_TRIZ_ASSISTANT_DESTINATION_LABELS[topDecision.destination]}`
        fallbackReason = 'budget_exceeded'
      }

      return {
        text: fallbackText,
        isFallback: true,
        degradedReason: fallbackReason,
        provider: 'none',
        model: 'deterministic-fallback',
        validationStatus: 'not_validated',
      }
    }

    // 如果预算门禁解除但仍无 real provider → 回退
    const topDecision = routeDecisions[0]
    return {
      text: topDecision
        ? `建议：${topDecision.reason}。如需 AI 增强分析，请配置模型连接后重试。`
        : 'AI 叙述不可用：无模型连接',
      isFallback: true,
      degradedReason: 'provider_error',
      provider: 'none',
      model: 'deterministic-fallback',
      costSummary: {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        latencyMs: 0,
      },
      validationStatus: 'not_validated',
    }
  }
}
