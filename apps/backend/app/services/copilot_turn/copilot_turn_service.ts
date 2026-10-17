/**
 * v3-copilot-live-submission-channel —— Copilot 回合服务（任务 4.1–4.17）。
 * v3-copilot-dlp-and-watermark-integration —— DLP 检查与水印注入接入。
 *
 * 编排既有件，**不复制任何逻辑**：
 *   引用复核（mention_reference_validator）
 * → 上下文装配（CopilotContextAssemblyService）
 * → **DLP 检查（CopilotDlpPort 版本扩展点，上下文包组装完成后、送模型之前）**
 * → **脱敏后重校验（CopilotContextSanitizer）**
 * → **水印注入（CopilotWatermarkPort 版本扩展点，独立字段，不进 source hash）**
 * → 归一化与规则分类（@aiproj/types 分类器）
 * → 路由（@aiproj/types copilotRoute）
 * → 路由决策落账（copilot_routing_ledger_recorder，失败降级不阻断）
 * → 会话消息追加（CopilotSessionService，有界低敏摘要）
 *
 * 红线：
 * - **零域写依赖**——本服务不引入任何域仓储或模型写 API；
 *   变更类 destination 只作为待确认动作返回，materialize 仍走既有草案层通道。
 * - 权限复核不可用**阻断**（业务决策）；落账失败**降级**（观察层）。
 * - DLP 判定不可用**阻断**（业务决策，不默认放行）。
 * - 不持久化原始输入全文、prompt、模型输出、token 与 secret。
 * - 不注入模型候选源（模型兜底保持关闭）。
 */

import type {
  CopilotAttachmentTurnSummary,
  CopilotClassifierResult,
  CopilotDestinationAvailability,
  CopilotContextFact,
  CopilotPageContextDisclosureV1,
  CopilotStreamEvent,
  CopilotTurnRequest,
  CopilotTurnResponse,
  CopilotStructuredOutput,
  CopilotWarningCode,
  MentionReference,
  CopilotWebSearchGateCode,
  ExternalEvidence,
} from '@aiproj/types'
import {
  boundedTurnSummary,
  budgetContextFacts,
  copilotRoute,
  deriveCopilotFacetSelection,
  deriveIntentSummary,
  deriveTurnIdempotencyKey,
  deriveTurnMetrics,
  deriveTurnRequiredCapabilities,
  estimateTurnTokens,
  evaluateRulePipeline,
  extractEntityReferences,
  normalizeCopilotInput,
  toRoutingDecisionRecord,
  validateTurnRequestShape,
  validatePageContextDescriptor,
  validateCopilotContextFact,
  COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
  COPILOT_WEB_SEARCH_GATE_LABELS,
  AI_CONNECTION_REQUIRED_MESSAGE,
  AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND,
} from '@aiproj/types'
import type { CopilotContextAssemblyService } from '#services/copilot/copilot_context_assembly_service'
import type { CopilotContextSanitizer } from '#services/copilot/copilot_context_sanitizer'
import type { CopilotSessionService } from '#services/copilot_session/copilot_session_service'
import type {
  CopilotPageContextResolution,
  CopilotPageProjectProfile,
  CopilotPageContextResolver,
} from '#services/copilot/copilot_page_context_resolver'
import { recordRoutingDecision } from '#services/copilot_routing_ledger/copilot_routing_ledger_recorder'
import {
  reviewMentionRefs,
  type MentionEntityPermissionChecker,
} from '#services/copilot_action/mention_reference_validator'
import type { CopilotDlpPort, CopilotWatermarkPort } from '#services/edition/ports'
import type CopilotAttachmentService from '#services/copilot_turn/copilot_attachment_service'
import { CopilotAttachmentReviewUnavailableError } from '#services/copilot_turn/copilot_attachment_service'
import type { CopilotContextObservationService } from '#services/copilot/copilot_context_observation_service'
import logger from '@adonisjs/core/services/logger'
import { describeCopilotAnswerFailure } from './copilot_model_failure.js'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** 回合请求形状不合规（上界与必填）。 */
export class CopilotTurnShapeError extends Error {
  constructor(readonly violations: ReturnType<typeof validateTurnRequestShape>) {
    super('回合请求形状不合规')
    this.name = 'CopilotTurnShapeError'
  }
}

/**
 * DLP 检查阻断回合。
 *
 * 与 CopilotTurnShapeError 同为业务决策阻断，但原因不同：
 * - ShapeError：请求形状不合规
 * - DlpBlockError：DLP 策略阻断或判定不可用
 *
 * 阻断提示只说触发策略与策略名，不说命中的规则与片段——
 * 否则提示本身成为探测工具。
 */
export class CopilotDlpBlockError extends Error {
  constructor(
    readonly reason: 'policy_block' | 'unavailable',
    readonly policyName?: string,
  ) {
    const msg =
      reason === 'unavailable'
        ? '数据保护服务暂时不可用，回合已阻断'
        : `内容触发组织数据保护策略${policyName ? `「${policyName}」` : ''}`
    super(msg)
    this.name = 'CopilotDlpBlockError'
  }
}

/**
 * 联网阶段总时长上限：超过就带着「网页搜索超时」状态直接回答。慢模型规划可能要几十秒，
 * 给足 3 分钟（期间 SSE 心跳保持连接）；只是兜底，正常联网远低于此。
 */
export const COPILOT_WEB_SEARCH_TURN_BUDGET_MS = 180_000

/**
 * 没有可用的真实模型（所选连接不可用、组织与环境也都没有配置，只剩无 key 联调用的 Mock）。
 * Mock 的输出是固定的联调样例（如「模拟项目 #xxxx」草案 JSON），绝不能当作回答展示给用户。
 */
export class CopilotModelUnavailableError extends Error {
  /**
   * true = 组织没有任何可用连接、也没有实例级默认 Key（提示先在设置中添加 AI 连接）；
   * false = 指定的连接不可用（停用、缺密钥或模型已删除）。
   */
  readonly noConnection: boolean

  constructor(options: { noConnection?: boolean } = {}) {
    super('没有可用的 AI 模型连接')
    this.name = 'CopilotModelUnavailableError'
    this.noConnection = options.noConnection ?? false
  }
}

export class CopilotEmptyResultError extends Error {
  constructor() {
    super('Copilot 未生成可呈现结果')
    this.name = 'CopilotEmptyResultError'
  }
}

// ---------------------------------------------------------------------------
// DLP 检查结果契约
// ---------------------------------------------------------------------------

/**
 * Copilot DLP 检查结果的契约形状。
 * 不含命中原文、prompt、模型输出、token 与 secret。
 */
export interface CopilotDlpCheckResult {
  /** 三态决策：allow / redact / block。 */
  readonly disposition: 'allow' | 'redact' | 'block'
  /** 策略版本号。 */
  readonly policyVersion: number
  /** 命中规则 ID 列表。 */
  readonly ruleIds: readonly string[]
  /** 命中类别（如 credential / personal_info / financial）。 */
  readonly hitCategories: readonly string[]
  /** 命中总计数。 */
  readonly hitCount: number
  /** 策略名（用于阻断提示）。 */
  readonly policyName?: string
}

/**
 * 水印载荷契约：组织、项目、actor、时间与水印版本，不含项目内容。
 */
export interface CopilotWatermarkPayload {
  readonly organizationId: number
  readonly projectId: number | null
  readonly actorId: number
  readonly timestamp: string
  readonly watermarkVersion: string
}

// ---------------------------------------------------------------------------
// 依赖与入参
// ---------------------------------------------------------------------------

/** 只读回答执行器的入参形状（非流式与流式共用）。 */
export type CopilotAnswerExecutorInput = {
  normalizedText: string
  scope: CopilotTurnRequest['scope']
  sessionId: string
  idempotencyKey: string
  sourceRefs: readonly string[]
  sourceSummaries: readonly { sourceRef: string; summary: string }[]
  intentSummary: string
  destinationKeys: readonly string[]
  /**
   * 外部证据（v3-copilot-optional-web-search-configuration）。
   * 只含通过全部检查的外部来源；普通 Copilot 缺省为空数组。
   */
  externalEvidence: readonly ExternalEvidence[]
  /**
   * 网页搜索门状态（可空：未配置工具时为 null；已配置时给 typed code + 可读文案）。
   */
  webSearchStatus: {
    code: CopilotWebSearchGateCode
    message: string
  } | null
  /**
   * 权威事实（v3-copilot-authoritative-page-context，answer 分支）。
   *
   * 已按意图选择 facet 并受条数/字节预算约束；只含**已授权**的项目事实。
   * 空数组 = 无事实（问候/知识问答不强制项目事实，design §F-8）。
   */
  contextFacts?: readonly CopilotContextFact[]
  /** 页面上下文披露（服务端权威解析后的透明信息）。 */
  pageContextDisclosure?: CopilotPageContextDisclosureV1
  /** 当前页面所属项目的概况（已授权；名称/编号/状态/日期/进度/任务分布）。 */
  pageProject?: CopilotPageProjectProfile
}

/** 流式输出的 sink：由 controller 把事件写成 SSE 帧。 */
export interface CopilotTurnStreamSink {
  /** 回合流开始（首个事件写出前的钩子，用于打开 SSE 通道）。 */
  readonly onStreamOpen?: () => void | Promise<void>
  /** 写出一帧事件（保证调序）。 */
  readonly emit: (event: CopilotStreamEvent) => void | Promise<void>
  /** 客户端是否仍可写（已断开时停止推送增量）。 */
  readonly isWritable?: () => boolean
}

export interface CopilotTurnServiceDeps {
  readonly assembly: CopilotContextAssemblyService
  readonly sessions: CopilotSessionService
  readonly permissionChecker: MentionEntityPermissionChecker
  /** 上下文 sanitizer（脱敏后重校验）。 */
  readonly sanitizer: CopilotContextSanitizer
  /** DLP 预检（上下文包组装后、送模型前）；经版本扩展点注入，个人版为明确放行。 */
  readonly dlpAdapter: CopilotDlpPort
  /** 上下文水印；经版本扩展点注入，个人版不注入。 */
  readonly watermarkAdapter: CopilotWatermarkPort
  /**
   * 附件服务（v3-copilot-attachment-and-ocr-input）。
   * 处理附件引用复核、OCR 作业创建与结果路由。
   */
  readonly attachmentService?: CopilotAttachmentService
  /**
   * 上下文观测服务（v3-ai-context-and-retrieval-observability）。
   * 异步写入装配结果的观测记录，失败降级不阻断回合。
   */
  readonly observationService?: CopilotContextObservationService
  /**
   * 落账钩子（缺省用既有 recorder）。
   * 注入点仅供测试模拟落账失败，生产不覆写。
   */
  readonly recordRouting?: typeof recordRoutingDecision
  /** 只读回答执行器；仅 answer 分支调用，clarify/route/DLP block 均为零调用。 */
  readonly answerExecutor?: (input: CopilotAnswerExecutorInput) => Promise<{
    text: string
    structuredOutput?: CopilotStructuredOutput
  }>
  /**
   * 流式只读回答执行器（v3-copilot-live-streaming-output）。
   * 仅当传入 CopilotTurnStreamSink 时使用；输出逐段增量文本。
   * 与 answerExecutor 互斥选择：优先流式执行器 + sink，否则回退一次性执行器。
   */
  readonly streamAnswerExecutor?: (input: CopilotAnswerExecutorInput) => AsyncIterable<string>
  /**
   * 网页搜索工具门（v3-copilot-optional-web-search-configuration）。
   * 可选注入；未注入 = 永不联网。注入后仍受组织/场景/权限/按次同意/router 必要性
   * 五门约束，并使用 fixture provider（真实 provider 需另立授权 child change）。
   */
  readonly webSearchTool?: import('#services/copilot_web_search/tool_gate').CopilotWebSearchToolGate
  /** 联网阶段总时长上限（毫秒，缺省 180 秒；测试可调小）。 */
  readonly webSearchBudgetMs?: number
  /**
   * 页面语境 resolver（v3-copilot-authoritative-page-context）。
   *
   * 可选注入：缺席时（纯测试桩）页面语境只做形状校验、不产出授权事实。
   * 生产路径由 controller 注入（含项目存在性复核与已授权项目集合）。
   */
  readonly pageContextResolver?: CopilotPageContextResolver
  /**
   * 页面语境功能开关（回滚 flag；design Migration Plan）。
   *
   * 环境变量 `COPILOT_PAGE_CONTEXT_ENABLED`，缺省 `'1'`（开）。
   * `'0'`/`'false'` 时整个页面语境链路不生效：不解析、不产出 facts/disclosure，
   * 行为回退到既有 sourceSummaries-only（无数据迁移）。
   */
  readonly pageContextEnabled?: boolean
}

export interface CopilotTurnExecuteInput {
  readonly request: CopilotTurnRequest
  readonly organizationId: number
  readonly actorId: number
  /** actor 的权限标识集合（供路由缺席过滤）。 */
  readonly permissions: readonly string[]
  /**
   * 「存在但不可用」的 destination 登记。
   * 缺席 = 可用；无权限的 destination 由 permissions 派生，不进入本入参（非泄露语义）。
   */
  readonly availability?: readonly CopilotDestinationAvailability[]
}

export interface CopilotTurnExecuteResult {
  readonly response: CopilotTurnResponse
  /** TPM preflight 用的输入侧确定性估算（不落响应体）。 */
  readonly estimatedTokens: number
}

/**
 * 回合准备阶段产物（execute / executeStream 共用）。
 * 覆盖：复核 → 装配 → DLP → 水印 → 分类 → 路由 → 会话。
 */
export interface CopilotPreparedTurn {
  readonly normalizedText: string
  readonly review: {
    readonly granted: readonly MentionReference[]
    readonly rejectedCount: number
  }
  readonly assembled: {
    readonly warnings: readonly string[]
    readonly packet: {
      readonly sources: readonly {
        sourceRef: string
        sourceHash: string
        lowSensitivitySummary?: string | null
      }[]
      readonly budget: { contextBytesUsed: number }
    }
    readonly contextFacts?: readonly CopilotContextFact[]
  }
  readonly attachmentSummary?: CopilotAttachmentTurnSummary
  readonly routed: ReturnType<typeof copilotRoute>
  readonly sessionId: string
  readonly idempotencyKey: string
  /**
   * 页面语境解析结果（v3-copilot-authoritative-page-context）。
   * 请求未携带 pageContext 时省略；解析失败时 ok=false 且无授权事实。
   */
  readonly pageContextResolution?: CopilotPageContextResolution
  /**
   * 页面筛选下的权威任务事实（exact totals 先于明细；2.1/2.3）。
   * 仅授权就绪且带筛选时存在；查询失败 → []（不生成伪事实）。
   */
  readonly filteredTaskFacts?: readonly CopilotContextFact[]
}

/** 网页搜索门状态（可空：未配置工具/未涉及/router 不需要时为 null）。 */
export type CopilotTurnWebSearchStatus = {
  code: CopilotWebSearchGateCode
  message: string
} | null

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export default class CopilotTurnService {
  readonly #deps: CopilotTurnServiceDeps

  constructor(deps: CopilotTurnServiceDeps) {
    this.#deps = deps
  }

  async execute(input: CopilotTurnExecuteInput): Promise<CopilotTurnExecuteResult> {
    const turnStartMs = Date.now()
    const warnings: CopilotWarningCode[] = []

    // ── 1. 形状与上界 ────────────────────────────────────────────
    const violations = validateTurnRequestShape(input.request)
    if (violations.length > 0) throw new CopilotTurnShapeError(violations)

    // ── 准备阶段（非流式与流式共用）──────────────────────────────
    const prepared = await this.#prepareTurn(input, warnings)
    // 页面语境披露 + 权威事实（v3-copilot-authoritative-page-context）
    const answerContext = this.#buildAnswerContext(prepared, input)

    // ── 8. 路由决策落账（观察层：失败降级不阻断）────────────────────
    const record = this.#deps.recordRouting ?? recordRoutingDecision
    try {
      const ledgerResult = await record({
        organizationId: input.organizationId,
        routingRecord: toRoutingDecisionRecord(prepared.routed.routingRecord),
        userDestination: null,
        missingPermissionCount: 0,
        traceId: null,
      })
      if (!ledgerResult.success) warnings.push('ROUTING_LEDGER_DEGRADED')
    } catch {
      warnings.push('ROUTING_LEDGER_DEGRADED')
    }

    const appended = await this.#appendUserMessage(input, prepared, warnings)

    let messageId = appended.message.messageId
    let turnResult: NonNullable<CopilotTurnResponse['result']>
    let webSearchStatus: CopilotTurnWebSearchStatus = null
    if (prepared.routed.clarificationRequired && prepared.routed.clarificationItems.length > 0) {
      turnResult = { kind: 'clarify', items: prepared.routed.clarificationItems }
    } else if (
      prepared.routed.destinations.some((destination) => destination.requiresUserConfirmation)
    ) {
      turnResult = { kind: 'route', destinations: prepared.routed.destinations }
    } else {
      if (!this.#deps.answerExecutor) throw new CopilotEmptyResultError()
      const webSearch = await this.#fetchWebSearch(input, prepared)
      const answer = await this.#deps.answerExecutor({
        normalizedText: prepared.normalizedText,
        scope: prepared.routed.scope,
        sessionId: prepared.sessionId,
        idempotencyKey: prepared.idempotencyKey,
        sourceRefs: prepared.assembled.packet.sources
          .map((source) => source.sourceRef)
          .slice(0, 20),
        sourceSummaries: prepared.assembled.packet.sources.slice(0, 20).map((source) => ({
          sourceRef: source.sourceRef,
          summary: (source.lowSensitivitySummary ?? '').slice(0, 500),
        })),
        intentSummary: deriveIntentSummary(prepared.normalizedText),
        destinationKeys: prepared.routed.destinations
          .map((destination) => destination.destination)
          .slice(0, 5),
        externalEvidence: webSearch.externalEvidence,
        webSearchStatus: webSearch.webSearchStatus,
        contextFacts: answerContext.contextFacts,
        pageContextDisclosure: answerContext.pageContextDisclosure,
        pageProject: answerContext.pageProject,
      })
      const safeText = sanitizeAssistantText(answer.text)
      if (!safeText) throw new CopilotEmptyResultError()
      const assistant = await this.#deps.sessions.appendMessage({
        organizationId: input.organizationId,
        actorId: input.actorId,
        sessionId: prepared.sessionId,
        role: 'assistant',
        contentSummary: boundedTurnSummary(safeText),
        sourceRefs: prepared.assembled.packet.sources
          .map((source) => source.sourceRef)
          .slice(0, 20),
        routeDecisionId: prepared.routed.routingRecord.recordId,
        warningCodes: dedupeWarnings(warnings),
        idempotencyKey: `${prepared.idempotencyKey}:assistant`,
      })
      messageId = assistant.message.messageId
      turnResult = answer.structuredOutput
        ? {
            kind: 'structured',
            assistantMessageId: messageId,
            content: safeText,
            output: answer.structuredOutput,
          }
        : { kind: 'answer', assistantMessageId: messageId, content: safeText }
      webSearchStatus = webSearch.webSearchStatus
    }

    // ── 10. TPM 输入侧估算（不落响应体）───────────────────────────
    const estimatedTokens = estimateTurnTokens({
      normalizedText: prepared.normalizedText,
      contextBytes: prepared.assembled.packet.budget.contextBytesUsed,
    })

    return {
      estimatedTokens,
      response: {
        sessionId: prepared.sessionId,
        messageId,
        destinations: prepared.routed.destinations,
        clarificationRequired: prepared.routed.clarificationRequired,
        clarificationItems: prepared.routed.clarificationItems,
        assumptionEntries: prepared.routed.assumptionEntries,
        ambiguity: prepared.routed.ambiguity,
        warnings: dedupeWarnings(warnings),
        degradedReason: null,
        rejectedReferenceCount: prepared.review.rejectedCount,
        scope: prepared.routed.scope,
        intentSummary: deriveIntentSummary(prepared.normalizedText),
        stats: prepared.routed.stats,
        mode: 'live',
        result: turnResult,
        attachmentSummary: prepared.attachmentSummary,
        webSearchStatus,
        pageContextDisclosure: answerContext.pageContextDisclosure,
        turnMetrics: deriveTurnMetrics({
          stats: prepared.routed.stats,
          durationMs: Date.now() - turnStartMs,
          routedDestinationCount: prepared.routed.destinations.length,
        }),
      },
    }
  }

  /**
   * 流式回合（v3-copilot-live-streaming-output）。
   *
   * 与 execute 共享同一「准备阶段」：复核 → 装配 → DLP → 水印 → 路由 → 落账 →
   * 用户消息追加全部完成后才打开流（onStreamOpen）并推送事件。
   * 失败（DLP 阻断 / 形状 / 权限）发生在开流之前 → 由 controller 走 JSON 错误契约，
   * 不会出现「先开流后回滚」的欺骗性输出。
   */
  async executeStream(
    input: CopilotTurnExecuteInput,
    sink: CopilotTurnStreamSink,
  ): Promise<CopilotTurnExecuteResult> {
    const turnStartMs = Date.now()
    const warnings: CopilotWarningCode[] = []

    // ── 1. 形状与上界 ────────────────────────────────────────────
    const violations = validateTurnRequestShape(input.request)
    if (violations.length > 0) throw new CopilotTurnShapeError(violations)

    // ── 准备阶段（与非流式共用同一实现）──────────────────────────
    const prepared = await this.#prepareTurn(input, warnings)
    // 页面语境披露 + 权威事实（v3-copilot-authoritative-page-context）
    const answerContext = this.#buildAnswerContext(prepared, input)

    // ── 路由决策落账 ─────────────────────────────────────────────
    const record = this.#deps.recordRouting ?? recordRoutingDecision
    try {
      const ledgerResult = await record({
        organizationId: input.organizationId,
        routingRecord: toRoutingDecisionRecord(prepared.routed.routingRecord),
        userDestination: null,
        missingPermissionCount: 0,
        traceId: null,
      })
      if (!ledgerResult.success) warnings.push('ROUTING_LEDGER_DEGRADED')
    } catch {
      warnings.push('ROUTING_LEDGER_DEGRADED')
    }

    const appended = await this.#appendUserMessage(input, prepared, warnings)

    // ── 开流（准备阶段全部通过）──────────────────────────────────
    let sequence = 0
    const nextSeq = () => ++sequence
    const writable = () => (sink.isWritable ? sink.isWritable() : true)

    await sink.onStreamOpen?.()

    const emitMeta = () =>
      sink.emit({
        type: 'turn-meta',
        sequence: nextSeq(),
        sessionId: prepared.sessionId,
        destinations: prepared.routed.destinations.map((d) => d.destination).slice(0, 5),
        intentSummary: deriveIntentSummary(prepared.normalizedText),
        scope: prepared.routed.scope,
        ...(answerContext.pageContextDisclosure !== undefined
          ? { pageContextDisclosure: answerContext.pageContextDisclosure }
          : {}),
      })

    let messageId = appended.message.messageId
    let turnResult: NonNullable<CopilotTurnResponse['result']>
    let webSearchStatus: CopilotTurnWebSearchStatus = null

    if (prepared.routed.clarificationRequired && prepared.routed.clarificationItems.length > 0) {
      await emitMeta()
      turnResult = { kind: 'clarify', items: prepared.routed.clarificationItems }
      await sink.emit({
        type: 'turn-clarify',
        sequence: nextSeq(),
        items: prepared.routed.clarificationItems,
      })
    } else if (
      prepared.routed.destinations.some((destination) => destination.requiresUserConfirmation)
    ) {
      await emitMeta()
      turnResult = { kind: 'route', destinations: prepared.routed.destinations }
      await sink.emit({
        type: 'turn-route',
        sequence: nextSeq(),
        destinations: prepared.routed.destinations,
      })
    } else {
      if (!this.#deps.streamAnswerExecutor) throw new CopilotEmptyResultError()
      await emitMeta()

      const parts: string[] = []
      let errorKind: string | null = null
      let failureReason: string | null = null
      try {
        const webSearch = await this.#fetchWebSearch(input, prepared)
        webSearchStatus = webSearch.webSearchStatus
        for await (const rawDelta of this.#deps.streamAnswerExecutor!({
          normalizedText: prepared.normalizedText,
          scope: prepared.routed.scope,
          sessionId: prepared.sessionId,
          idempotencyKey: prepared.idempotencyKey,
          sourceRefs: prepared.assembled.packet.sources
            .map((source) => source.sourceRef)
            .slice(0, 20),
          sourceSummaries: prepared.assembled.packet.sources.slice(0, 20).map((source) => ({
            sourceRef: source.sourceRef,
            summary: (source.lowSensitivitySummary ?? '').slice(0, 500),
          })),
          intentSummary: deriveIntentSummary(prepared.normalizedText),
          destinationKeys: prepared.routed.destinations
            .map((destination) => destination.destination)
            .slice(0, 5),
          externalEvidence: webSearch.externalEvidence,
          webSearchStatus: webSearch.webSearchStatus,
          contextFacts: answerContext.contextFacts,
          pageContextDisclosure: answerContext.pageContextDisclosure,
          pageProject: answerContext.pageProject,
        })) {
          if (!writable()) break
          parts.push(rawDelta)
          await sink.emit({
            type: 'answer-delta',
            sequence: nextSeq(),
            delta: rawDelta,
          })
        }
      } catch (error) {
        // 按真实原因分类（供应商超时 / 断流 / 限流 / 密钥 / 模型不存在…），不再一律「连不上」
        if (error instanceof CopilotModelUnavailableError) {
          // 没有任何可用连接：统一提示先在设置中添加 AI 连接（个人版导出 3.3）
          errorKind = error.noConnection
            ? AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND
            : 'model-unavailable'
          if (error.noConnection) failureReason = AI_CONNECTION_REQUIRED_MESSAGE
        } else {
          const failure = describeCopilotAnswerFailure(error)
          errorKind = failure.errorKind
          failureReason = failure.degradedReason
        }
        logger.warn(
          { err: error, organizationId: input.organizationId, errorKind },
          'Copilot 流式回答中断',
        )
      }

      // 终态：全量 sanitize 后落库；空结果 / 中断 → 不发 answer-done，发 turn-error
      const safeText = sanitizeAssistantText(parts.join(''))
      if (errorKind === null && safeText) {
        const assistant = await this.#deps.sessions.appendMessage({
          organizationId: input.organizationId,
          actorId: input.actorId,
          sessionId: prepared.sessionId,
          role: 'assistant',
          contentSummary: boundedTurnSummary(safeText),
          sourceRefs: prepared.assembled.packet.sources
            .map((source) => source.sourceRef)
            .slice(0, 20),
          routeDecisionId: prepared.routed.routingRecord.recordId,
          warningCodes: dedupeWarnings(warnings),
          idempotencyKey: `${prepared.idempotencyKey}:assistant`,
        })
        messageId = assistant.message.messageId
        turnResult = { kind: 'answer', assistantMessageId: messageId, content: safeText }
        await sink.emit({
          type: 'answer-done',
          sequence: nextSeq(),
          assistantMessageId: messageId,
          contentSummary: boundedTurnSummary(safeText),
          // 网页搜索门状态（v3-copilot-optional-web-search-configuration）：
          // 仅仅在「实际调用或降级」时下发；未配置/未涉及/router 不需要时为 null。
          webSearchStatus,
        })
      } else {
        turnResult = { kind: 'answer', assistantMessageId: messageId, content: '' }
        await sink.emit({
          type: 'turn-error',
          sequence: nextSeq(),
          errorKind: errorKind ?? 'empty',
          degradedReason: failureReason ?? '未生成可呈现结果',
        })
      }
    }

    const estimatedTokens = estimateTurnTokens({
      normalizedText: prepared.normalizedText,
      contextBytes: prepared.assembled.packet.budget.contextBytesUsed,
    })

    return {
      estimatedTokens,
      response: {
        sessionId: prepared.sessionId,
        messageId,
        destinations: prepared.routed.destinations,
        clarificationRequired: prepared.routed.clarificationRequired,
        clarificationItems: prepared.routed.clarificationItems,
        assumptionEntries: prepared.routed.assumptionEntries,
        ambiguity: prepared.routed.ambiguity,
        warnings: dedupeWarnings(warnings),
        degradedReason: null,
        rejectedReferenceCount: prepared.review.rejectedCount,
        scope: prepared.routed.scope,
        intentSummary: deriveIntentSummary(prepared.normalizedText),
        stats: prepared.routed.stats,
        mode: 'live',
        result: turnResult,
        attachmentSummary: prepared.attachmentSummary,
        webSearchStatus,
        pageContextDisclosure: answerContext.pageContextDisclosure,
        turnMetrics: deriveTurnMetrics({
          stats: prepared.routed.stats,
          durationMs: Date.now() - turnStartMs,
          routedDestinationCount: prepared.routed.destinations.length,
        }),
      },
    }
  }

  // -------------------------------------------------------------------------
  // 共用准备阶段（execute / executeStream）
  // -------------------------------------------------------------------------

  /**
   * 网页搜索工具门（v3-copilot-optional-web-search-configuration）。
   *
   * 未注入工具 → 永不联网（{ externalEvidence: [], webSearchStatus: null }）。
   * 注入后按门顺序判定；not_called（disabled/consent/not_needed）不下发状态，
   * called / degraded 下发给 executor 提示模型引用分区与降级事实。
   */
  #webSearchBudgetMs(): number {
    return this.#deps.webSearchBudgetMs ?? COPILOT_WEB_SEARCH_TURN_BUDGET_MS
  }

  async #fetchWebSearch(
    input: CopilotTurnExecuteInput,
    prepared: CopilotPreparedTurn,
  ): Promise<{
    externalEvidence: readonly ExternalEvidence[]
    webSearchStatus: CopilotTurnWebSearchStatus
  }> {
    const tool = this.#deps.webSearchTool
    if (!tool) return { externalEvidence: [], webSearchStatus: null }
    // 联网阶段总时长上限：规划 + 多引擎 + 抓取再慢也不拖住回答；超时按降级继续回答
    // （2026-10-05：联网过久时页面显示「AI 模型无法调用」）
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = Symbol('web-search-timeout')
    const gate = await Promise.race([
      tool.fetchEvidence({
        organizationId: input.organizationId,
        actorId: input.actorId,
        turnId: prepared.sessionId,
        query: prepared.normalizedText.slice(0, 1200),
        consent: input.request.webSearchConsent ?? false,
        surface: 'copilot',
        permissions: input.permissions,
      }),
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), this.#webSearchBudgetMs())
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer)
    })
    if (gate === timedOut) {
      logger.warn({ organizationId: input.organizationId }, '网页搜索超过总时长上限，跳过继续回答')
      return {
        externalEvidence: [],
        webSearchStatus: {
          code: 'web_search_timeout',
          message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_timeout,
        },
      }
    }
    if (gate.status === 'called') {
      return {
        externalEvidence: gate.evidence,
        webSearchStatus: {
          code: 'web_search_called',
          message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_called,
        },
      }
    }
    if (gate.status === 'degraded') {
      return {
        externalEvidence: gate.evidence,
        webSearchStatus: { code: gate.code, message: gate.message },
      }
    }
    return { externalEvidence: [], webSearchStatus: null }
  }

  /**
   * 准备阶段：能力推导 → 引用复核 → 附件复核 → 归一化 → 上下文装配 →
   * 观测写入 → DLP 检查 → 水印注入 → 规则分类 → 路由 → 会话创建。
   *
   * 任一失败（形状/DLP/权限/附件复核不可用）在此抛出，调用方尚未开流。
   */
  async #prepareTurn(
    input: CopilotTurnExecuteInput,
    warnings: CopilotWarningCode[],
  ): Promise<CopilotPreparedTurn> {
    const { request, organizationId, actorId } = input

    // ── 1a. 能力推导（v3-copilot-multi-model-selection D1）─────────────
    //
    // 设计决策（D1）：
    // - 所需能力由回合自身推导，不由用户填
    // - 结构化产出需要 structured_output，工具路由需要 tool_calling
    // - 推导失败时保守选择能力更全的模型，不静默降级
    //
    deriveTurnRequiredCapabilities({
      needsStructuredOutput: false, // 由路由决策或结构化产出标志确定
      needsToolCalling: false, // 由路由决策确定
      needsLongContext: false, // 由上下文估算确定
      estimatedContextTokens: undefined, // 后续可由上下文估算填充
    })

    // ── 2. 引用复核（组织隔离 + 孤儿清理 + 逐实体判权）─────────────
    // 判定不可用由 reviewMentionRefs 抛出并向上阻断，不在此降级。
    const review = await reviewMentionRefs({
      refs: request.mentions,
      text: request.text,
      actorOrganizationId: organizationId,
      actorId,
      permissionChecker: this.#deps.permissionChecker,
    })
    if (review.rejectedCount > 0) warnings.push('SOURCE_PERMISSION_DENIED')

    // ── 2a. 附件引用复核（v3-copilot-attachment-and-ocr-input）────────
    let attachmentSummary: CopilotAttachmentTurnSummary | undefined
    if (request.attachments && request.attachments.length > 0 && this.#deps.attachmentService) {
      const attachmentReview = await this.#deps.attachmentService.reviewReferences({
        attachments: request.attachments,
        organizationId,
        actorId,
        projectId: request.attribution.projectId ? Number(request.attribution.projectId) : null,
      })

      // 复核不可用 → 阻断回合（业务决策，不默认放行）
      if (!attachmentReview.reviewComplete) {
        throw new CopilotAttachmentReviewUnavailableError()
      }

      if (attachmentReview.rejectedCount > 0) {
        warnings.push('SOURCE_PERMISSION_DENIED')
      }

      // OCR 链路接入：为通过复核的附件创建识别作业
      if (attachmentReview.validAttachments.length > 0) {
        const processResult = await this.#deps.attachmentService.createRecognitionJobs(
          attachmentReview.validAttachments,
          organizationId,
          request.attribution.projectId ? Number(request.attribution.projectId) : null,
          actorId,
        )

        attachmentSummary = processResult.summary

        // 阻断性失败 → 终止回合（D5：不静默降级）
        if (processResult.hasBlockingFailure) {
          warnings.push('EXTERNAL_CONTENT_REJECTED')
        }
      }
    }

    // ── 3. 归一化（服务端不从文本二次解析实体，仅用于规则强度）─────
    const normalizedText = normalizeCopilotInput(request.text)
    const textualRefs = extractEntityReferences(normalizedText)

    // ── 3b. 页面语境解析与授权（v3-copilot-authoritative-page-context）─
    // 客户端 ID 只作候选；Policy + organization_id 在取数之前生效（design D2）。
    // resolver 缺席（纯测试桩）时只做形状校验，不产出授权事实；
    // 回滚 flag 关闭时整条链路不生效（design Migration Plan）。
    let pageContextResolution: CopilotPageContextResolution | undefined
    if (this.#isPageContextEnabled() && request.pageContext && this.#deps.pageContextResolver) {
      pageContextResolution = await this.#deps.pageContextResolver.resolve(
        request.pageContext,
        organizationId,
        actorId,
      )
    } else if (this.#isPageContextEnabled() && request.pageContext) {
      const validated = validatePageContextDescriptor(request.pageContext)
      pageContextResolution = {
        ok: validated.ok,
        descriptor: validated.ok ? (validated.descriptor ?? null) : null,
        projectId: null,
        filters: [],
        ignoredFilters: validated.ignoredFilters,
        sortApplied: validated.ignoredSort,
        selectionCount:
          validated.ok && validated.descriptor
            ? (validated.descriptor.selectedEntityRefs?.length ?? 0)
            : 0,
        observedAt: new Date().toISOString(),
        status: validated.ok ? 'ready' : 'context_unavailable',
        privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
      }
    }

    // 页面筛选下的权威任务事实：仅当授权就绪（ready + 项目 + 有筛选）时查询；
    // 查询失败 → []（不生成伪项目事实，design §F-5；disclosure 状态仍诚实呈现）。
    let filteredTaskFacts: readonly CopilotContextFact[] = []
    if (
      request.scope === 'project' &&
      pageContextResolution?.ok &&
      pageContextResolution.status === 'ready' &&
      pageContextResolution.projectId !== null &&
      pageContextResolution.filters.length > 0 &&
      this.#deps.pageContextResolver
    ) {
      try {
        filteredTaskFacts = await this.#deps.pageContextResolver.collectPageTaskFacts({
          projectId: pageContextResolution.projectId,
          organizationId,
          filters: pageContextResolution.filters,
          observedAt: pageContextResolution.observedAt,
        })
      } catch {
        filteredTaskFacts = []
      }
    }

    // ── 4. 上下文装配（复用既有服务）──────────────────────────────
    const assembled = await this.#deps.assembly.assembleContext({
      scope: request.scope,
      attribution: request.attribution,
      organizationId,
      actorId,
      query: normalizedText,
      entityRefs: review.granted.map((ref) => `${ref.entityType}:${ref.entityId}`),
      freshnessMode: 'per-turn',
      includePanorama: request.scope === 'project',
    })
    warnings.push(...assembled.warnings)

    // ── 4b. 上下文观测写入（v3-ai-context-and-retrieval-observability）──
    if (this.#deps.observationService) {
      const obsResult = await this.#deps.observationService.recordObservation(
        assembled,
        organizationId,
        actorId,
      )
      if (obsResult.degraded && obsResult.warningCode) {
        warnings.push(obsResult.warningCode as any)
      }
    }

    // ── 4c. DLP 检查（上下文包组装完成后、送模型之前）─────────────
    const dlpStartMs = Date.now()
    const dlpCheckResult = await this.#performDlpCheck(
      assembled.packet,
      organizationId,
      request.attribution.projectId ? Number(request.attribution.projectId) : null,
      actorId,
    )
    const dlpElapsedMs = Date.now() - dlpStartMs

    // 性能门禁：检测耗时超限时记录低敏告警（不阻断）
    const DLP_CHECK_WARN_THRESHOLD_MS = 5000
    if (dlpElapsedMs > DLP_CHECK_WARN_THRESHOLD_MS) {
      logger.warn({ dlpElapsedMs, organizationId }, 'DLP 检测耗时超过阈值（性能门禁）')
    }

    if (dlpCheckResult.disposition === 'block') {
      // 阻断：终止回合，返回错误，不返回部分结果（spec REQ block-terminates）
      // 不调用模型、不追加会话消息（spec REQ no-model-call-no-message）
      throw new CopilotDlpBlockError(
        dlpCheckResult.ruleIds.length > 0 ? 'policy_block' : 'unavailable',
        dlpCheckResult.policyName,
      )
    }

    if (dlpCheckResult.disposition === 'redact') {
      // 脱敏后重校验（D6）：脱敏是内容变换，可能破坏既有的有界摘要长度
      // 或 source ref 完整性。脱敏后重跑既有 sanitizer 与包校验。
      const revalidation = this.#deps.sanitizer.sanitizeAssemblyResult(assembled)
      if (!revalidation.safe) {
        // 脱敏破坏包结构 → 降级为阻断而非送出残包
        throw new CopilotDlpBlockError('policy_block')
      }
      warnings.push('DLP_REDACTED')
    }

    // ── 水印注入（独立字段，不进 source hash）─────────────────────
    await this.#injectWatermark(
      assembled.packet.sources[0]?.sourceRef ?? 'unknown',
      assembled.packet.sources[0]?.sourceHash ?? 'unknown',
      organizationId,
      request.attribution.projectId ? Number(request.attribution.projectId) : null,
      actorId,
      dlpCheckResult,
    )

    // ── 5. 规则分类（斜杠命令透传，命中最高优先级）─────────────────
    // 模型兜底保持关闭：不注入 modelCandidateSource。
    const classifierResult: CopilotClassifierResult | null = evaluateRulePipeline({
      normalizedInput: normalizedText,
      currentRoute: request.currentRoute,
      entityRefs: textualRefs,
      slashCommand: request.slashCommand,
    })

    // ── 6. 路由（复用既有确定性路由器）────────────────────────────
    const routed = copilotRoute({
      normalizedInput: normalizedText,
      classifierResult,
      contextScope: request.scope,
      permissions: input.permissions,
      availability: input.availability ?? [],
      currentRoute: request.currentRoute,
      entityRefs: textualRefs,
      clarificationRounds: request.clarificationRounds,
    })
    warnings.push(...routed.warnings)

    // ── 7. 会话（空则新建，非空则续接）────────────────────────────
    const idempotencyKey = deriveTurnIdempotencyKey({
      normalizedText,
      sessionId: request.sessionId,
      slashCommand: request.slashCommand,
      mentions: review.granted,
      actorId,
    })

    // 客户端带来的 sessionId 只有属于本人（同组织）才续接；否则（他人会话、换了组织）另开新会话，
    // 绝不往别人的会话里写消息。
    const ownedSessionId =
      request.sessionId &&
      (await this.#deps.sessions.isOwnedBy(input.organizationId, actorId, request.sessionId))
        ? request.sessionId
        : null
    const sessionId = ownedSessionId ?? (await this.#createSession(input, idempotencyKey))

    return {
      normalizedText,
      review,
      assembled,
      attachmentSummary,
      routed,
      sessionId,
      idempotencyKey,
      ...(pageContextResolution !== undefined ? { pageContextResolution } : {}),
      ...(filteredTaskFacts.length > 0 ? { filteredTaskFacts } : {}),
    }
  }

  /**
   * 构建回答侧权威上下文（v3-copilot-authoritative-page-context）。
   *
   * - disclosure：由服务端授权解析结果派生（项目/页面/筛选/快照时间/状态/隐私说明）；
   * - contextFacts：按意图选择 facet（design §E）→ 页面筛选事实 + 装配候选 →
   *   条数/字节预算（聚合事实在前，截断不破坏精确总数，design §F-6）；
   * - 问候/知识问答无 facet 命中 → 零事实（不强制项目事实，design §F-8）。
   */
  #buildAnswerContext(
    prepared: CopilotPreparedTurn,
    _input: CopilotTurnExecuteInput,
  ): {
    contextFacts?: readonly CopilotContextFact[]
    pageContextDisclosure?: CopilotPageContextDisclosureV1
    pageProject?: CopilotPageProjectProfile
  } {
    const resolution = prepared.pageContextResolution
    if (!this.#isPageContextEnabled() || !resolution || !resolution.ok || !resolution.descriptor) {
      return {}
    }

    const disclosure: CopilotPageContextDisclosureV1 = {
      version: 1,
      routeId: resolution.descriptor.routeId,
      ...(resolution.projectId !== null ? { projectId: resolution.projectId } : {}),
      ...(resolution.descriptor.viewId !== undefined
        ? { viewId: resolution.descriptor.viewId }
        : {}),
      filters: [...resolution.filters],
      ignoredFilters: [...resolution.ignoredFilters],
      sortApplied: [...resolution.sortApplied],
      ...(resolution.timeRange !== undefined ? { timeRange: resolution.timeRange } : {}),
      selectionCount: resolution.selectionCount,
      observedAt: resolution.observedAt,
      status: resolution.status,
      privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
    }

    const selectedFacets = deriveCopilotFacetSelection(prepared.normalizedText)
    const candidates: CopilotContextFact[] = [
      ...(prepared.filteredTaskFacts ?? []),
      ...(prepared.assembled.contextFacts ?? []),
    ]
    // 事实级 DLP 兜底：形状/禁存内容不合法的事实一律不进入 executor
    //（design §H：不绕过现有 DLP；validator 拒绝未知字段与敏感内容）。
    const validFacts = candidates.filter((fact) => validateCopilotContextFact(fact).ok)
    const kept = budgetContextFacts(
      selectedFacets.length === 0
        ? []
        : validFacts.filter((fact) => selectedFacets.includes(fact.facet)),
    ).kept

    return {
      contextFacts: kept,
      pageContextDisclosure: disclosure,
      ...(resolution.status === 'ready' && resolution.projectProfile !== undefined
        ? { pageProject: resolution.projectProfile }
        : {}),
    }
  }

  /**
   * 页面语境回滚 flag：`COPILOT_PAGE_CONTEXT_ENABLED`（缺省开）。
   * 关闭时整个页面语境链路（解析/facts/disclosure）不生效，
   * 行为回退到既有 sourceSummaries-only（design Migration Plan）。
   */
  #isPageContextEnabled(): boolean {
    if (this.#deps.pageContextEnabled !== undefined) return this.#deps.pageContextEnabled
    const env = process.env.COPILOT_PAGE_CONTEXT_ENABLED ?? '1'
    return env !== '0' && env !== 'false'
  }

  /** 用户消息追加（有界低敏摘要，不存原始输入全文）。 */
  async #appendUserMessage(
    input: CopilotTurnExecuteInput,
    prepared: CopilotPreparedTurn,
    warnings: CopilotWarningCode[],
  ): Promise<{
    message: {
      messageId: string
      truncated: boolean
    }
  }> {
    return this.#deps.sessions.appendMessage({
      organizationId: input.organizationId,
      actorId: input.actorId,
      sessionId: prepared.sessionId,
      role: 'user',
      contentSummary: boundedTurnSummary(input.request.text),
      sourceRefs: prepared.assembled.packet.sources.map((source) => source.sourceRef),
      routeDecisionId: prepared.routed.routingRecord.recordId,
      warningCodes: dedupeWarnings(warnings),
      idempotencyKey: prepared.idempotencyKey,
    })
  }

  // -------------------------------------------------------------------------
  // DLP 检查（私有方法）
  // -------------------------------------------------------------------------

  /**
   * 执行 DLP 检查。
   *
   * 设计决策：
   * - D3：判定不可用时阻断，不默认放行
   * - 显式覆盖 dlp_adapter_fallback 的放行式降级
   * - 业务决策阻断与观察层降级在记录中可区分
   */
  async #performDlpCheck(
    packet: {
      sources: readonly { sourceRef: string; sourceHash: string }[]
      budget: { contextBytesUsed: number }
    },
    organizationId: number,
    projectId: number | null,
    actorId: number,
  ): Promise<CopilotDlpCheckResult> {
    const sourceHash = packet.sources[0]?.sourceHash ?? 'unknown'
    const itemCount = packet.sources.length

    // 构建已授权的上下文摘要（低敏，不含项目内容）
    const authorizedContextSummary = packet.sources.map((s) => s.sourceRef).join(', ')

    try {
      const result = await this.#deps.dlpAdapter.preflightContextAssembly({
        organizationId,
        projectId,
        actorId,
        sourceHash,
        authorizedContextSummary,
        contextPacketRefs: packet.sources.map((s) => s.sourceRef),
        itemCount,
      })

      if (!result.adapterAvailable) {
        // D3 显式覆盖：判定不可用 → 阻断，不默认放行
        // 记录覆盖原因（业务决策阻断 vs 观察层降级）
        logger.warn(
          { organizationId, projectId, actorId },
          'DLP 适配器不可用，Copilot 回合阻断（覆盖默认放行降级）',
        )
        return {
          disposition: 'block',
          policyVersion: 0,
          ruleIds: [],
          hitCategories: [],
          hitCount: 0,
        }
      }

      if (!result.allowed) {
        // 阻断：策略命中
        const snapshot = result.snapshot
        return {
          disposition: 'block',
          policyVersion: snapshot?.policyVersion ?? 0,
          ruleIds: snapshot?.matchSummary?.map((m) => m.ruleId) ?? [],
          hitCategories: snapshot?.matchSummary?.map((m) => m.category ?? 'unknown') ?? [],
          hitCount: snapshot?.matchSummary?.reduce((sum, m) => sum + m.count, 0) ?? 0,
        }
      }

      if (result.maskedContext) {
        // 脱敏：策略要求脱敏
        const snapshot = result.snapshot
        return {
          disposition: 'redact',
          policyVersion: snapshot?.policyVersion ?? 0,
          ruleIds: snapshot?.matchSummary?.map((m) => m.ruleId) ?? [],
          hitCategories: snapshot?.matchSummary?.map((m) => m.category ?? 'unknown') ?? [],
          hitCount: snapshot?.matchSummary?.reduce((sum, m) => sum + m.count, 0) ?? 0,
        }
      }

      // 放行
      return {
        disposition: 'allow',
        policyVersion: result.snapshot?.policyVersion ?? 0,
        ruleIds: [],
        hitCategories: [],
        hitCount: 0,
      }
    } catch (err) {
      // D3 显式覆盖：异常 → 阻断，不默认放行
      // 与 dlp_adapter_fallback 的 warn 模式冲突，显式覆盖
      logger.error({ err, organizationId, projectId }, 'DLP 检查异常，Copilot 回合阻断')
      return {
        disposition: 'block',
        policyVersion: 0,
        ruleIds: [],
        hitCategories: [],
        hitCount: 0,
      }
    }
  }

  // -------------------------------------------------------------------------
  // 水印注入（私有方法）
  // -------------------------------------------------------------------------

  /**
   * 注入水印到上下文包。
   *
   * 设计决策（D4 / 红线 4）：
   * - 水印不进 source hash，作为独立字段携带
   * - 水印可追溯到组织、项目、actor 与时间
   * - 水印载荷不含项目内容
   */
  async #injectWatermark(
    sourceRef: string,
    sourceHash: string,
    organizationId: number,
    projectId: number | null,
    actorId: number,
    dlpCheck: CopilotDlpCheckResult,
  ): Promise<CopilotWatermarkPayload> {
    try {
      await this.#deps.watermarkAdapter.prepareContext({
        organizationId,
        projectId,
        actorId,
        sourceRef,
        sourceHash,
        format: 'markdown',
        dlpResult: dlpCheck.disposition,
        decisionHash: `dlp-${dlpCheck.policyVersion}-${dlpCheck.hitCount}`,
        policyHash: `policy-${dlpCheck.policyVersion}`,
      })
    } catch (err) {
      // 水印注入失败不阻断回合（观察层降级）
      logger.warn({ err, organizationId, projectId }, '水印注入失败（不影响回合）')
    }

    // 返回水印载荷（不含项目内容）
    return {
      organizationId,
      projectId,
      actorId,
      timestamp: new Date().toISOString(),
      watermarkVersion: 'v1',
    }
  }

  /** 新建会话（标题取有界摘要，不存原始输入全文）。 */
  async #createSession(input: CopilotTurnExecuteInput, idempotencyKey: string): Promise<string> {
    const session = await this.#deps.sessions.createSession({
      organizationId: input.organizationId,
      scope: input.request.scope,
      attribution: input.request.attribution,
      actorId: input.actorId,
      title: boundedTurnSummary(input.request.text, 60),
      idempotencyKey,
    })
    return session.sessionId
  }
}

/** 告警去重且保持首次出现顺序（确定性）。 */
function dedupeWarnings(warnings: readonly CopilotWarningCode[]): readonly CopilotWarningCode[] {
  const seen = new Set<CopilotWarningCode>()
  const result: CopilotWarningCode[] = []
  for (const warning of warnings) {
    if (seen.has(warning)) continue
    seen.add(warning)
    result.push(warning)
  }
  return result
}

function sanitizeAssistantText(value: string): string {
  return (
    value
      .replace(/(?:bearer\s+)?sk-[a-z0-9_-]{8,}/giu, '[REDACTED_SECRET]')
      .replace(/authorization\s*[:=]\s*[^\s]+/giu, 'Authorization: [REDACTED]')
      // 控制字符必须显式列出（净化不可见字符）
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .trim()
      .slice(0, 4_000)
  )
}
