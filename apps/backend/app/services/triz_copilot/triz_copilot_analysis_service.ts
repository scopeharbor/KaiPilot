// v3-triz-contradiction-copilot W2 任务 2.2 / 2.3 —— 矛盾求解分析编排服务。
//
// 职责（spec「AI-as-ARIZ 后台语义映射」「映射依据可查看与可改判」「澄清轮次与自主权预算硬上限」）：
// - `solve`：受理 PM 陈述 → 组装上下文包（1.3）→ 语义映射（1.4）→ Top 3 方案（1.5）→
//   落库**低敏**分析记录（2.1 表）→ 输出澄清状态与预算快照；
// - `override`：人工改判参数 → 知识包确定性重查候选原则 → 重产 Top 3 → 更新记录并置
//   `humanOverride=true` + 审计；**业务数据零变更**（只写本表）；
// - `list` / `findById`：组织 + 项目双隔离读取（跨组织统一 404）。
//
// 分层边界：Controller 只解析请求与格式化响应；本服务是业务与落库的唯一入口；
// Validator 只管入参形状；领域权限与组织隔离由 `TrizCopilotPolicy` 与
// `TrizContextPackService`（逐域裁剪）承担。
//
// 红线：AI 只建议不执行（本服务零业务表写入，除本 change 自有分析表）；RL-12（不存陈述原文 /
// prompt / 模型输出全文）；RL-13（真实模型默认关闭，经 1.4 的门与 `UnifiedBudgetGuard` 接线缝）；
// D7 硬上限经 `TrizCopilotBudget` 接线（不新建预算体系）。

import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import ProjectSignal from '#models/project_signal'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import TenantScope from '#services/tenant_scope'
import AuditService, { AuditEvent } from '#services/audit_service'
import { hashParameters } from '#services/ai_tools/ai_tools_audit_helper'
import TrizContextPackService, {
  TRIZ_CONTEXT_DOMAIN_ORDER,
  isContextRefWhitelisted,
  type TrizContextPack,
} from './triz_context_pack_service.js'
import {
  TRIZ_CONTRADICTION_TYPE_LABELS,
  TRIZ_MAPPING_LIMITS,
  resolveTrizMappingLimits,
  toTrizCandidatePrincipleRef,
  toTrizParameterRef,
  type TrizCandidatePrincipleRef,
  type TrizContradictionMappingDraft,
  type TrizContradictionMappingResult,
  type TrizContradictionType,
  type TrizMappingBudgetGate,
  type TrizMappingPath,
  type TrizMappingQualityFlag,
  type TrizParameterRef,
} from './triz_contradiction_mapping_service.js'
import TrizContradictionMappingService from './triz_contradiction_mapping_service.js'
import { searchByParameterPair } from './triz_knowledge_search_service.js'
import TrizSolutionDraftService, {
  toTrizSolutionLowSensitivityRecord,
  type TrizSolutionDraft,
  type TrizSolutionDraftSet,
  type TrizSolutionLowSensitivityRecord,
  type TrizSolutionSetBinding,
} from './triz_solution_draft_service.js'
import {
  TrizCopilotBudget,
  composeTrizBudgetGates,
  resolveTrizAutonomyBudgetLimits,
  trizBudgetRunTokenReason,
  type TrizAutonomyBudgetLimits,
  type TrizBudgetSnapshot,
} from './triz_copilot_budget.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 审计里的动作名（spec「反幻觉与低敏审计边界」第 2 条：动作名 + userId + org/project + 参数哈希 + 状态 + 耗时）。 */
export const TRIZ_COPILOT_ANALYSIS_TOOL_NAME = 'triz_copilot_analysis'
export const TRIZ_COPILOT_OVERRIDE_TOOL_NAME = 'triz_copilot_analysis_override'

export const TRIZ_COPILOT_LIST_DEFAULT_PER_PAGE = 20
export const TRIZ_COPILOT_LIST_MAX_PER_PAGE = 100

// ---------------------------------------------------------------------------
// 请求 / 结果契约
// ---------------------------------------------------------------------------

export interface TrizCopilotRequestContext {
  organizationId: number
  projectId: number
  user: User
  requestId?: string | null
}

export interface TrizCopilotSolveRequest extends TrizCopilotRequestContext {
  /** PM 的大白话陈述（原文只在本次请求内存活，落库前折算为 digest 与长度） */
  statement: string
  asOfDate?: string
  /** 澄清链上的上一轮记录 ID（第 2/3 轮由父记录继承已发生的澄清轮数） */
  parentAnalysisId?: number | null
  /** 来源被动雷达信号 ID（若传入则断言在同组织同项目中存在且未软删除，否则 422） */
  sourceSignalId?: number | null
  forceRulePath?: boolean
  /** 预算收紧（默认值不可上调） */
  budget?: Partial<TrizAutonomyBudgetLimits>
  limits?: Partial<TrizAutonomyBudgetLimits>
}

export interface TrizCopilotOverrideRequest extends TrizCopilotRequestContext {
  analysisId: number
  improvingParameter?: number
  worseningParameter?: number
  contradictionType?: TrizContradictionType
  /** 改判理由（只入审计哈希，不落正文，RL-12） */
  reason?: string | null
  budget?: Partial<TrizAutonomyBudgetLimits>
}

export interface TrizCopilotListRequest extends TrizCopilotRequestContext {
  page?: number
  perPage?: number
  path?: TrizMappingPath
  humanOverride?: boolean
}

export interface TrizCopilotListResult {
  data: TrizCopilotAnalysis[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface TrizCopilotClarificationState {
  /** 映射是否提出「信息不足、需要澄清」 */
  needed: boolean
  /** 本轮是否真的发起了追问（触顶时为 false） */
  asked: boolean
  /** 已完成（含本轮）的澄清轮数 */
  round: number
  maxRounds: number
  /** 澄清预算是否已用尽（触顶挂起） */
  exhausted: boolean
  prompt: string | null
  reason: string | null
}

export interface TrizCopilotSolveResult {
  record: TrizCopilotAnalysis
  analysis: TrizCopilotAnalysisDTO
  /** 本次映射草案（产品内容：参数依据 + 候选原则 + 置信度 + 路径） */
  mapping: {
    path: TrizMappingPath
    contradictionType: TrizContradictionType
    contradictionTypeLabel: string
    improvingParameter: TrizParameterRef | null
    worseningParameter: TrizParameterRef | null
    candidatePrinciples: TrizCandidatePrincipleRef[]
    confidence: number
    contextRefs: string[]
    sourceMappingIds: string[]
    sourceSections: string[]
    qualityFlags: string[]
    fallbackReasons: string[]
    needsClarification: boolean
  }
  /** Top 3 方案草案（含原则定义与实体绑定，供前端展开与确认落库） */
  solutions: TrizSolutionDraft[]
  solutionSet: TrizSolutionDraftSet
  clarification: TrizCopilotClarificationState
  budget: TrizBudgetSnapshot
  modelUsage: TrizContradictionMappingResult['modelUsage']
}

export interface TrizCopilotOverrideResult {
  record: TrizCopilotAnalysis
  analysis: TrizCopilotAnalysisDTO
  /** 改判前后的参数编号（同时进入审计） */
  change: {
    from: { improvingParameter: number | null; worseningParameter: number | null }
    to: { improvingParameter: number | null; worseningParameter: number | null }
  }
  solutions: TrizSolutionDraft[]
  solutionSet: TrizSolutionDraftSet
  budget: TrizBudgetSnapshot
}

// ---------------------------------------------------------------------------
// 响应投影（低敏：编号 / 枚举 / 有界标题 / 计数）
// ---------------------------------------------------------------------------

export interface TrizCopilotAnalysisDTO {
  id: number
  organizationId: number
  projectId: number
  createdBy: number
  parentAnalysisId: number | null
  sourceSignalId: number | null
  contradictionType: TrizContradictionType
  contradictionTypeLabel: string
  improvingParameter: TrizParameterRef | null
  worseningParameter: TrizParameterRef | null
  candidatePrinciples: TrizCandidatePrincipleRef[]
  path: TrizMappingPath
  confidence: number
  entityBinding: TrizSolutionSetBinding
  contextRefs: string[]
  qualityFlags: string[]
  fallbackReasons: string[]
  knowledgePackVersion: string
  statement: { digest: string; length: number; truncated: boolean }
  topSolutions: TrizSolutionLowSensitivityRecord
  humanOverride: boolean
  overrideBy: number | null
  overrideAt: string | null
  budget: TrizBudgetSnapshot
  createdAt: string | null
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// 依赖注入（测试可整体替换；缺省即容器单例）
// ---------------------------------------------------------------------------

export interface TrizCopilotAnalysisDeps {
  contextPackService?: TrizContextPackService
  mappingService?: TrizContradictionMappingService
  solutionDraftService?: TrizSolutionDraftService
  audit?: AuditService
  /**
   * 既有 `UnifiedBudgetGuard` 的接线缝（经 1.4 的 `createUnifiedBudgetGate` 适配）。
   * 与本地确定性 Token 门**取交**：注入一个放行的守卫也无法把上限抬到 4000 以上。
   */
  budgetGate?: TrizMappingBudgetGate
}

interface ResolvedDeps {
  contextPack: TrizContextPackService
  solutions: TrizSolutionDraftService
  audit: AuditService | null
}

export default class TrizCopilotAnalysisService {
  readonly #deps: TrizCopilotAnalysisDeps

  constructor(deps: TrizCopilotAnalysisDeps = {}) {
    this.#deps = deps
  }

  // ── 求解（受理并落库低敏记录） ──────────────────────────────────────

  /**
   * 受理并求解：陈述 → 上下文包 → 映射 → Top 3 → 落库低敏草案记录。
   *
   * 触顶（澄清第 3 轮 / 度量读取超限 / Token 预算不足）时**不停在空结果**：
   * 已得到的映射与方案照常返回，`clarification.exhausted` 与 `budget.reason` 给出中文说明。
   */
  async solve(request: TrizCopilotSolveRequest): Promise<TrizCopilotSolveResult> {
    const startedAt = Date.now()
    const deps = await this.#resolveDeps()
    const limits = resolveTrizAutonomyBudgetLimits(request.budget ?? request.limits)

    const parent = request.parentAnalysisId
      ? await this.#requireRecord(
          request.organizationId,
          request.projectId,
          request.parentAnalysisId,
        )
      : null

    if (request.sourceSignalId !== undefined && request.sourceSignalId !== null) {
      const signal = await TenantScope.forOrganization(
        ProjectSignal.query(),
        request.organizationId,
      )
        .where('project_id', request.projectId)
        .where('id', request.sourceSignalId)
        .whereNull('deleted_at')
        .first()
      if (!signal) {
        throw new ValidationException('来源信号不存在或不属于当前项目')
      }
    }

    const budget = new TrizCopilotBudget({
      limits,
      clarificationRounds: parent?.clarificationRounds ?? 0,
    })

    const contextPack = await deps.contextPack.assemble({
      organizationId: request.organizationId,
      projectId: request.projectId,
      user: request.user,
      asOfDate: request.asOfDate,
    })
    this.#chargeMetricReads(budget, contextPack)

    const mappingResult = await this.#mappingService(budget).map({
      organizationId: request.organizationId,
      projectId: request.projectId,
      actor: request.user,
      contextPack,
      statement: request.statement,
      forceRulePath: request.forceRulePath,
      traceId: request.requestId ?? null,
    })
    this.#recordTokenUsage(budget, mappingResult)

    const solutionSet = deps.solutions.build({
      mapping: mappingResult.mapping,
      contextPack,
    })

    const clarification = this.#settleClarification(budget, mappingResult.mapping)

    const record = await TrizCopilotAnalysis.create({
      organizationId: request.organizationId,
      projectId: request.projectId,
      createdBy: Number(request.user.id),
      parentAnalysisId: request.parentAnalysisId ?? null,
      sourceSignalId: request.sourceSignalId ?? null,
      contradictionType: mappingResult.mapping.contradictionType,
      improvingParameter: mappingResult.mapping.improvingParameter?.number ?? null,
      worseningParameter: mappingResult.mapping.worseningParameter?.number ?? null,
      candidatePrinciples: mappingResult.mapping.candidatePrinciples.map(
        (principle) => principle.number,
      ),
      topSolutions: toTrizSolutionLowSensitivityRecord(solutionSet) as unknown as Record<
        string,
        unknown
      >[],
      path: mappingResult.mapping.path,
      confidence: mappingResult.mapping.confidence,
      entityBinding: solutionSet.entityBinding,
      contextRefs: [...mappingResult.mapping.contextRefs],
      qualityFlags: mergeFlags(mappingResult.mapping.qualityFlags, solutionSet.qualityFlags),
      fallbackReasons: [...mappingResult.mapping.fallbackReasons],
      knowledgePackVersion: mappingResult.mapping.knowledgePackVersion,
      statementDigest: mappingResult.mapping.statementDigest,
      statementLength: mappingResult.mapping.statementLength,
      statementTruncated: mappingResult.mapping.statementTruncated,
      humanOverride: false,
      overrideBy: null,
      overrideAt: null,
      ...this.#budgetColumns(budget),
      deletedAt: null,
    })

    await this.#audit(deps, {
      event: AuditEvent.AI_TOOL_EXECUTED,
      status:
        clarification.exhausted || budget.state === 'exhausted' ? 'PREVIEW_GENERATED' : 'SUCCESS',
      userId: Number(request.user.id),
      organizationId: request.organizationId,
      projectId: request.projectId,
      requestId: request.requestId ?? null,
      toolName: TRIZ_COPILOT_ANALYSIS_TOOL_NAME,
      analysisId: Number(record.id),
      durationMs: Date.now() - startedAt,
      parameters: {
        statementDigest: mappingResult.mapping.statementDigest,
        statementLength: mappingResult.mapping.statementLength,
        path: mappingResult.mapping.path,
        contradictionType: mappingResult.mapping.contradictionType,
        budgetState: budget.state,
        clarificationRounds: budget.clarificationRounds,
        metricReadCount: budget.metricReadCount,
        sourceSignalId: request.sourceSignalId ?? null,
      },
      metadata: {
        path: mappingResult.mapping.path,
        contradictionType: mappingResult.mapping.contradictionType,
        budgetState: budget.state,
        fallbackReasons: [...mappingResult.mapping.fallbackReasons],
      },
      errorCode: null,
    })

    return {
      record,
      analysis: this.toDTO(record),
      mapping: toMappingView(mappingResult.mapping),
      solutions: solutionSet.solutions,
      solutionSet,
      clarification,
      budget: budget.snapshot(),
      modelUsage: mappingResult.modelUsage,
    }
  }

  // ── 人工改判并重算（业务数据零变更） ────────────────────────────────

  /**
   * 改判参数并重算：知识包确定性重查候选原则 → 重产 Top 3 → 更新记录 + 置人工改判 + 审计。
   *
   * 只写 `triz_copilot_analyses` 一行：任务 / 风险 / 变更请求等业务表零写入（spec 第 3 条）。
   */
  async override(request: TrizCopilotOverrideRequest): Promise<TrizCopilotOverrideResult> {
    const startedAt = Date.now()
    const deps = await this.#resolveDeps()
    const limits = resolveTrizAutonomyBudgetLimits(request.budget)
    const record = await this.#requireRecord(
      request.organizationId,
      request.projectId,
      request.analysisId,
    )

    if (request.improvingParameter === undefined && request.worseningParameter === undefined) {
      throw new ValidationException('改判必须至少提供改善参数或恶化参数')
    }

    const improvingNumber = request.improvingParameter ?? record.improvingParameter
    const worseningNumber = request.worseningParameter ?? record.worseningParameter
    const improving = improvingNumber === null ? null : this.#requireParameter(improvingNumber)
    const worsening = worseningNumber === null ? null : this.#requireParameter(worseningNumber)

    const budget = new TrizCopilotBudget({ limits })
    const contextPack = await deps.contextPack.assemble({
      organizationId: request.organizationId,
      projectId: request.projectId,
      user: request.user,
    })
    this.#chargeMetricReads(budget, contextPack)

    const mapping = buildOverrideMappingDraft({
      record,
      contextPack,
      improvingParameter: improving,
      worseningParameter: worsening,
      contradictionType:
        request.contradictionType ?? (record.contradictionType as TrizContradictionType),
      limits: resolveTrizMappingLimits(),
    })
    const solutionSet = deps.solutions.build({ mapping, contextPack })

    const from = {
      improvingParameter: record.improvingParameter,
      worseningParameter: record.worseningParameter,
    }
    const to = {
      improvingParameter: mapping.improvingParameter?.number ?? null,
      worseningParameter: mapping.worseningParameter?.number ?? null,
    }

    record.contradictionType = mapping.contradictionType
    record.improvingParameter = to.improvingParameter
    record.worseningParameter = to.worseningParameter
    record.candidatePrinciples = mapping.candidatePrinciples.map((principle) => principle.number)
    record.topSolutions = toTrizSolutionLowSensitivityRecord(solutionSet) as unknown as Record<
      string,
      unknown
    >[]
    record.path = mapping.path
    record.confidence = mapping.confidence
    record.entityBinding = solutionSet.entityBinding
    record.contextRefs = [...mapping.contextRefs]
    record.qualityFlags = mergeFlags(mapping.qualityFlags, solutionSet.qualityFlags)
    record.fallbackReasons = [...mapping.fallbackReasons]
    record.knowledgePackVersion = mapping.knowledgePackVersion
    record.humanOverride = true
    record.overrideBy = Number(request.user.id)
    record.overrideAt = DateTime.now()
    const columns = this.#budgetColumns(budget)
    record.clarificationRounds = columns.clarificationRounds
    record.metricReadCount = columns.metricReadCount
    record.tokenBudget = columns.tokenBudget
    record.estimatedTokens = columns.estimatedTokens
    record.actualTokens = columns.actualTokens
    record.budgetState = columns.budgetState
    record.budgetReason = columns.budgetReason
    await record.save()

    await this.#audit(deps, {
      event: AuditEvent.AI_TOOL_CONFIRMED,
      status: 'CONFIRMED',
      userId: Number(request.user.id),
      organizationId: request.organizationId,
      projectId: request.projectId,
      requestId: request.requestId ?? null,
      toolName: TRIZ_COPILOT_OVERRIDE_TOOL_NAME,
      analysisId: Number(record.id),
      durationMs: Date.now() - startedAt,
      parameters: {
        analysisId: record.id,
        fromImprovingParameter: from.improvingParameter,
        fromWorseningParameter: from.worseningParameter,
        toImprovingParameter: to.improvingParameter,
        toWorseningParameter: to.worseningParameter,
        contradictionType: mapping.contradictionType,
        reasonHash: request.reason ? hashParameters({ reason: request.reason }) : null,
      },
      // 改判前后参数编号必须可读（spec「映射依据可查看与可改判」第 3 条）；理由正文只留哈希（RL-12）。
      metadata: {
        fromImprovingParameter: from.improvingParameter,
        fromWorseningParameter: from.worseningParameter,
        toImprovingParameter: to.improvingParameter,
        toWorseningParameter: to.worseningParameter,
        contradictionType: mapping.contradictionType,
        humanOverride: true,
      },
      errorCode: null,
    })

    return {
      record,
      analysis: this.toDTO(record),
      change: { from, to },
      solutions: solutionSet.solutions,
      solutionSet,
      budget: budget.snapshot(),
    }
  }

  // ── 读取（组织 + 项目双隔离） ──────────────────────────────────────

  async list(request: TrizCopilotListRequest): Promise<TrizCopilotListResult> {
    const page = normalizePositive(request.page, 1)
    const perPage = Math.min(
      normalizePositive(request.perPage, TRIZ_COPILOT_LIST_DEFAULT_PER_PAGE),
      TRIZ_COPILOT_LIST_MAX_PER_PAGE,
    )

    const query = TenantScope.forOrganization(TrizCopilotAnalysis.query(), request.organizationId)
      .where('project_id', request.projectId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')

    if (request.path) query.where('path', request.path)
    if (request.humanOverride !== undefined) {
      query.where('human_override', request.humanOverride)
    }

    const countRows = (await query.clone().clearOrder().count('* as total')) as unknown as Array<{
      $extras: { total: number | string }
    }>
    const total = Number(countRows[0]?.$extras?.total ?? 0)
    const data = await query.offset((page - 1) * perPage).limit(perPage)

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0,
      },
    }
  }

  /** 详情与依据：跨组织 / 不存在统一 404（RL-05，不泄露存在性）。 */
  async findById(
    organizationId: number,
    projectId: number,
    analysisId: number,
  ): Promise<TrizCopilotAnalysis> {
    return this.#requireRecord(organizationId, projectId, analysisId)
  }

  toDTO(record: TrizCopilotAnalysis): TrizCopilotAnalysisDTO {
    const contradictionType = record.contradictionType as TrizContradictionType
    const candidateNumbers = Array.isArray(record.candidatePrinciples)
      ? record.candidatePrinciples
      : []
    return {
      id: Number(record.id),
      organizationId: Number(record.organizationId),
      projectId: Number(record.projectId),
      createdBy: Number(record.createdBy),
      parentAnalysisId: record.parentAnalysisId === null ? null : Number(record.parentAnalysisId),
      sourceSignalId: record.sourceSignalId === null ? null : Number(record.sourceSignalId),
      contradictionType,
      contradictionTypeLabel:
        TRIZ_CONTRADICTION_TYPE_LABELS[contradictionType] ?? String(record.contradictionType),
      improvingParameter:
        record.improvingParameter === null ? null : toTrizParameterRef(record.improvingParameter),
      worseningParameter:
        record.worseningParameter === null ? null : toTrizParameterRef(record.worseningParameter),
      candidatePrinciples: candidateNumbers
        .map((number, index) => toTrizCandidatePrincipleRef(Number(number), index + 1))
        .filter((entry): entry is TrizCandidatePrincipleRef => entry !== null),
      path: record.path as TrizMappingPath,
      confidence: Number(record.confidence),
      entityBinding: record.entityBinding as TrizSolutionSetBinding,
      contextRefs: asStringArray(record.contextRefs),
      qualityFlags: asStringArray(record.qualityFlags),
      fallbackReasons: asStringArray(record.fallbackReasons),
      knowledgePackVersion: String(record.knowledgePackVersion),
      statement: {
        digest: String(record.statementDigest),
        length: Number(record.statementLength),
        truncated: Boolean(record.statementTruncated),
      },
      topSolutions: normalizeStoredSolutions(record.topSolutions),
      humanOverride: Boolean(record.humanOverride),
      overrideBy: record.overrideBy === null ? null : Number(record.overrideBy),
      overrideAt: record.overrideAt ? record.overrideAt.toISO() : null,
      budget: {
        clarificationRounds: Number(record.clarificationRounds),
        metricReadCount: Number(record.metricReadCount),
        tokenBudget: Number(record.tokenBudget),
        estimatedTokens: Number(record.estimatedTokens),
        actualTokens: record.actualTokens === null ? null : Number(record.actualTokens),
        state: record.budgetState === 'exhausted' ? 'exhausted' : 'within_budget',
        reason: record.budgetReason ?? null,
      },
      createdAt: record.createdAt ? record.createdAt.toISO() : null,
      updatedAt: record.updatedAt ? record.updatedAt.toISO() : null,
    }
  }

  // ── 内部 ───────────────────────────────────────────────────────────

  async #resolveDeps(): Promise<ResolvedDeps> {
    return {
      contextPack: this.#deps.contextPackService ?? new TrizContextPackService(),
      solutions: this.#deps.solutionDraftService ?? new TrizSolutionDraftService(),
      audit: this.#deps.audit ?? (await this.#resolveAudit()),
    }
  }

  /** 审计服务缺省从容器解析；解析失败返回 null（审计旁路不可用不阻断业务终态）。 */
  async #resolveAudit(): Promise<AuditService | null> {
    try {
      return await app.container.make(AuditService)
    } catch {
      return null
    }
  }

  /**
   * 每次调用构造映射服务：预算门 = 本地确定性 Token 门 ∩（可选）既有守卫适配门。
   * 注入 `mappingService` 时以注入者为准（单测用 fixture，不经真实模型）。
   */
  #mappingService(budget: TrizCopilotBudget): TrizContradictionMappingService {
    if (this.#deps.mappingService) return this.#deps.mappingService
    const gates = [budget.tokenGate()]
    if (this.#deps.budgetGate) gates.push(this.#deps.budgetGate)
    return new TrizContradictionMappingService({
      budgetGate: composeTrizBudgetGates(gates),
    })
  }

  /** 度量读取按域计次：上下文包实际读取了几个域就是几次读取（读取前申请额度）。 */
  #chargeMetricReads(budget: TrizCopilotBudget, pack: TrizContextPack): void {
    const reads = TRIZ_CONTEXT_DOMAIN_ORDER.filter(
      (domain) => pack.domains[domain] !== undefined,
    ).length
    budget.requestMetricReads(reads)
  }

  #recordTokenUsage(budget: TrizCopilotBudget, mapping: TrizContradictionMappingResult): void {
    budget.recordEstimatedTokens(mapping.modelUsage.estimatedTokens)
    budget.recordActualTokens(mapping.modelUsage.totalTokens)
    if (mapping.mapping.fallbackReasons.includes('BUDGET_EXHAUSTED')) {
      budget.markExhausted(trizBudgetRunTokenReason(budget.limits.runTokens))
    }
  }

  /** 澄清结算：需要澄清时申请一轮额度；额度用尽则挂起并给出中文原因（不停在空结果）。 */
  #settleClarification(
    budget: TrizCopilotBudget,
    mapping: TrizContradictionMappingDraft,
  ): TrizCopilotClarificationState {
    const state: TrizCopilotClarificationState = {
      needed: mapping.needsClarification,
      asked: false,
      round: budget.clarificationRounds,
      maxRounds: budget.limits.clarificationRounds,
      exhausted: false,
      prompt: null,
      reason: null,
    }
    if (!mapping.needsClarification) return state

    const decision = budget.requestClarification()
    state.round = budget.clarificationRounds
    if (decision.allowed) {
      state.asked = true
      state.prompt = buildClarificationPrompt(mapping)
      return state
    }
    state.exhausted = true
    state.reason = decision.reason
    return state
  }

  #budgetColumns(budget: TrizCopilotBudget) {
    const snapshot = budget.snapshot()
    return {
      clarificationRounds: snapshot.clarificationRounds,
      metricReadCount: snapshot.metricReadCount,
      tokenBudget: snapshot.tokenBudget,
      estimatedTokens: snapshot.estimatedTokens,
      actualTokens: snapshot.actualTokens,
      budgetState: snapshot.state,
      budgetReason: snapshot.reason,
    }
  }

  #requireParameter(number: number): TrizParameterRef {
    const ref = toTrizParameterRef(number)
    if (!ref) {
      throw new ValidationException(`参数编号 ${number} 不在 TRIZ 39 个通用工程参数闭集内`)
    }
    return ref
  }

  async #requireRecord(
    organizationId: number,
    projectId: number,
    analysisId: number,
  ): Promise<TrizCopilotAnalysis> {
    const record = await TenantScope.forOrganization(TrizCopilotAnalysis.query(), organizationId)
      .where('project_id', projectId)
      .where('id', analysisId)
      .whereNull('deleted_at')
      .first()
    if (!record) {
      // 跨组织 / 不存在 / 已软删统一同一响应（RL-05：不泄露存在性）。
      throw new ResourceNotFoundException('分析记录不存在')
    }
    return record
  }

  /**
   * 统一落库一次结构化审计（spec「反幻觉与低敏审计边界」第 2 条）：
   * `toolName` / `userId` / `organizationId` / `projectId` / `parametersHash`(SHA-256) /
   * `status` / `durationMs` / `errorCode` + 领域低敏码（编号 / 枚举，无正文；RL-12）。
   */
  async #audit(
    deps: ResolvedDeps,
    input: {
      event:
        | typeof AuditEvent.AI_TOOL_EXECUTED
        | typeof AuditEvent.AI_TOOL_CONFIRMED
        | typeof AuditEvent.AI_TOOL_DENIED
      status: 'SUCCESS' | 'PREVIEW_GENERATED' | 'CONFIRMED' | 'REJECTED' | 'FAILED'
      userId: number
      organizationId: number
      projectId: number
      requestId: string | null
      toolName: string
      analysisId?: number | null
      durationMs: number
      parameters: Record<string, unknown>
      metadata?: Record<string, unknown>
      errorCode: string | null
    },
  ): Promise<void> {
    if (!deps.audit) return
    await deps.audit.log({
      event: input.event,
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      requestId: input.requestId,
      entityType: 'triz_copilot_analysis',
      entityId: input.analysisId ?? null,
      metadata: {
        toolName: input.toolName,
        parametersHash: hashParameters(input.parameters),
        status: input.status,
        durationMs: input.durationMs,
        errorCode: input.errorCode,
        ...(input.metadata ?? {}),
      },
    })
  }
}

// ---------------------------------------------------------------------------
// 纯函数：改判映射草案 / 展示投影 / 归一
// ---------------------------------------------------------------------------

/**
 * 改判后的映射草案：候选原则**只**来自知识包的确定性参数对检索（零 Token、零模型），
 * 参数与原则名称全部由知识包回填；矛盾类型由人工裁定（未给则沿用记录原值）。
 */
export function buildOverrideMappingDraft(args: {
  record: TrizCopilotAnalysis
  contextPack: TrizContextPack
  improvingParameter: TrizParameterRef | null
  worseningParameter: TrizParameterRef | null
  contradictionType: TrizContradictionType
  limits?: { maxCandidatePrinciples: number; maxContextRefs: number }
}): TrizContradictionMappingDraft {
  const { record, contextPack, improvingParameter, worseningParameter } = args
  const limits = {
    maxCandidatePrinciples:
      args.limits?.maxCandidatePrinciples ?? TRIZ_MAPPING_LIMITS.maxCandidatePrinciples,
    maxContextRefs: args.limits?.maxContextRefs ?? TRIZ_MAPPING_LIMITS.maxContextRefs,
  }
  const qualityFlags: TrizMappingQualityFlag[] = []

  const searches =
    improvingParameter && worseningParameter
      ? [searchByParameterPair(improvingParameter.number, worseningParameter.number)]
      : []
  const matched = searches.find((result) => result.matched) ?? null
  const principleNumbers: number[] = []
  for (const result of searches) {
    for (const mapping of result.mappings) {
      for (const number of mapping.principleNumbers) {
        if (!principleNumbers.includes(number)) principleNumbers.push(number)
      }
    }
  }

  const candidatePrinciples = principleNumbers
    .slice(0, limits.maxCandidatePrinciples)
    .map((number, index) => toTrizCandidatePrincipleRef(number, index + 1))
    .filter((entry): entry is TrizCandidatePrincipleRef => entry !== null)

  if (!improvingParameter || !worseningParameter) qualityFlags.push('PARAMETER_NOT_IN_PACK')
  if (candidatePrinciples.length === 0) {
    qualityFlags.push('NO_CANDIDATE_PRINCIPLE')
    qualityFlags.push('INSUFFICIENT_INPUT')
  }

  // 上下文引用复用原记录：只有仍在新上下文白名单内的引用被保留（反幻觉白名单不为改判放宽）。
  const storedRefs = asStringArray(record.contextRefs)
  const accepted = storedRefs.filter((ref) => isContextRefWhitelisted(contextPack, ref))
  const rejected = storedRefs.length - accepted.length
  if (rejected > 0) qualityFlags.push('CONTEXT_REFS_REJECTED')

  const confidence = matched && candidatePrinciples.length > 0 ? 0.8 : 0

  return {
    path: 'rule',
    contradictionType: args.contradictionType,
    contradictionTypeLabel: TRIZ_CONTRADICTION_TYPE_LABELS[args.contradictionType],
    improvingParameter,
    worseningParameter,
    candidatePrinciples,
    confidence,
    contextRefs: accepted.slice(0, limits.maxContextRefs),
    contextRefValidation: { accepted: accepted.length, rejected },
    sourceMappingIds: matched ? [matched.mappings[0]?.id ?? ''] : [],
    // 改判结果由人工裁定，来源章节标注沿用知识包命中映射的来源（RL-10 可追溯）。
    sourceSections: matched ? matched.mappings.map((mapping) => mapping.source) : [],
    requiresHumanConfirmation: true,
    persisted: false,
    // 人工已显式给出参数 ⇒ 不再追问澄清（澄清预算只服务于信息不足的自动链路）。
    needsClarification: candidatePrinciples.length === 0,
    fallbackReasons: [],
    qualityFlags,
    statementDigest: String(record.statementDigest),
    statementLength: Number(record.statementLength),
    statementTruncated: Boolean(record.statementTruncated),
    knowledgePackVersion: String(record.knowledgePackVersion),
  }
}

/** 澄清追问文案（确定性；只提示方向，不夹带参数编号表或原则清单）。 */
export function buildClarificationPrompt(mapping: TrizContradictionMappingDraft): string {
  const missing: string[] = []
  if (!mapping.improvingParameter) missing.push('你希望改善的那一项（例如进度、质量、成本、人力）')
  if (!mapping.worseningParameter) missing.push('因此变差的那一项')
  if (missing.length === 0) {
    return '当前陈述还不足以定位可选的处理原则，请补充一句：这条矛盾里「谁和谁在互相对立」，以及最不能碰的那条底线是什么。'
  }
  return `当前陈述还不足以定位矛盾，请补充：${missing.join('；')}。用大白话说即可，不需要认识任何 TRIZ 术语。`
}

function toMappingView(mapping: TrizContradictionMappingDraft): TrizCopilotSolveResult['mapping'] {
  return {
    path: mapping.path,
    contradictionType: mapping.contradictionType,
    contradictionTypeLabel: mapping.contradictionTypeLabel,
    improvingParameter: mapping.improvingParameter,
    worseningParameter: mapping.worseningParameter,
    candidatePrinciples: mapping.candidatePrinciples,
    confidence: mapping.confidence,
    contextRefs: [...mapping.contextRefs],
    sourceMappingIds: [...mapping.sourceMappingIds],
    sourceSections: [...mapping.sourceSections],
    qualityFlags: [...mapping.qualityFlags],
    fallbackReasons: [...mapping.fallbackReasons],
    needsClarification: mapping.needsClarification,
  }
}

/** 质量标记合并（映射 + 方案），保序去重。 */
export function mergeFlags(
  mappingFlags: readonly string[],
  solutionFlags: readonly string[],
): string[] {
  const merged: string[] = []
  for (const flag of [...mappingFlags, ...solutionFlags]) {
    if (!merged.includes(flag)) merged.push(flag)
  }
  return merged
}

/** 归一化 `top_solutions` JSON：容忍空值 / 老记录 / PG 字符串化 JSON / 裸数组。 */
export function normalizeStoredSolutions(raw: unknown): TrizSolutionLowSensitivityRecord {
  const parsed: unknown = typeof raw === 'string' ? safeJsonParse(raw) : raw
  const source: Record<string, unknown> =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { solutions: Array.isArray(parsed) ? parsed : [] }
  const solutions = Array.isArray(source.solutions) ? source.solutions : []
  return {
    path: (source.path as TrizMappingPath) ?? 'rule',
    entityBinding: (source.entityBinding as TrizSolutionSetBinding) ?? 'none',
    solutions: solutions
      .filter((entry): entry is Record<string, unknown> =>
        Boolean(entry && typeof entry === 'object'),
      )
      .map((entry) => ({
        index: Number(entry.index ?? 0),
        principleNumber: Number(entry.principleNumber ?? 0),
        title: String(entry.title ?? ''),
        score: Number(entry.score ?? 0),
        entityRefs: Array.isArray(entry.entityRefs) ? entry.entityRefs.map(String) : [],
      })),
    excludedPrincipleNumbers: asNumberArray(source.excludedPrincipleNumbers),
    contextRefValidation: {
      accepted: Number(
        (source.contextRefValidation as { accepted?: unknown } | undefined)?.accepted ?? 0,
      ),
      rejected: Number(
        (source.contextRefValidation as { rejected?: unknown } | undefined)?.rejected ?? 0,
      ),
    },
    qualityFlags: asStringArray(
      source.qualityFlags,
    ) as TrizSolutionLowSensitivityRecord['qualityFlags'],
    knowledgePackVersion: String(source.knowledgePackVersion ?? ''),
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : fallback
}
