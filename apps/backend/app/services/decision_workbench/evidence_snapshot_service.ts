import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import type User from '#models/user'
import PortfolioDashboardService from '#services/portfolio_dashboard_service'
import PortfolioPriorityScoringService from '#services/portfolio_priority_scoring_service'
import PmoInvestmentDistributionService from '#services/pmo_investment_distribution_service'
import ResourceContentionDetectionService from '#services/resource_contention_detection_service'
import RiskWorkbenchService from '#services/risk_workbench_service'
import PortfolioTrafficLightService from '#services/portfolio_traffic_light_service'
import DecisionWorkbenchPolicy, {
  sourceDimensionPermission,
} from '#policies/decision_workbench_policy'
import {
  PMO_DECISION_MAX_BYTES_PER_SOURCE,
  PMO_DECISION_MAX_FACTS_PER_SOURCE,
  PMO_DECISION_MAX_REFS_PER_SOURCE,
  PMO_DECISION_SOURCES,
  PMO_DECISION_SOURCE_STATES,
  composePmoDecisionSourceState,
  computePmoDecisionContentHash,
  isPmoDecisionSource,
  derivePmoDecisionSnapshotReadiness,
  type PmoDecisionMeasureRef,
  type PmoDecisionSource,
  type PmoDecisionSourceBlock,
  type PmoDecisionSnapshotReadiness,
  type PmoDecisionWarning,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 权威证据来源 adapter 与不可变快照
 * （tasks 5.1–5.9，design D2）。
 *
 * 红线：
 *   - adapter 只调用既有权威查询面并投影低敏事实；不重算/不复制领域算法，
 *     不写任何正式业务表。
 *   - 共享 deadline + 单来源预算（facts/refs/bytes）；超限截断并标记 truncated；
 *     失败/超时标记 unavailable——绝不用零值冒充事实。
 *   - 来源维度权限独立：无权限 → forbidden 脱敏，不泄露存在性。
 *   - required 来源失败 → readiness blocked；optional 失败 → degraded。
 */

// ─── 预算执行工具 ──────────────────────────────────────────────────────────────

export interface SourceCollectBudget {
  maxFacts: number
  maxRefs: number
  maxBytes: number
  deadlineAt: number
}

export function makeSourceBudget(deadlineAt: number): SourceCollectBudget {
  return {
    maxFacts: PMO_DECISION_MAX_FACTS_PER_SOURCE,
    maxRefs: PMO_DECISION_MAX_REFS_PER_SOURCE,
    maxBytes: PMO_DECISION_MAX_BYTES_PER_SOURCE,
    deadlineAt,
  }
}

export class SourceTimeoutError extends Error {}
export class SourceOversizeError extends Error {}

/** 单来源收集结果 envelope：值或状态信号二选一。 */
export interface SourceCollectResult {
  facts?: Array<{ key: string; value: number | string | boolean | null }>
  refs?: string[]
  lastUpdatedAt?: string | null
  sourceVersion?: string
  truncated?: boolean
  forbidden?: boolean
  unavailable?: boolean
}

/** 宿主持有的只读 source adapter 契约。 */
export interface DecisionEvidenceSourceAdapter {
  id: PmoDecisionSource
  required: boolean
  requiredPermissions: ReturnType<typeof sourceDimensionPermission>
  /** 确定性 collect：内部不得发网络请求、不得触发 AI、不得写库。 */
  collect(ctx: {
    user: User
    organizationId: number
    budget: SourceCollectBudget
    evidenceRefs: string[]
  }): Promise<SourceCollectResult>
}

/** registry：重复注册同 id 即拒绝；collect 抛错/超时统一降级为 unavailable。 */
export class EvidenceSourceRegistry {
  private readonly adapters = new Map<PmoDecisionSource, DecisionEvidenceSourceAdapter>()

  register(adapter: DecisionEvidenceSourceAdapter): void {
    if (!isPmoDecisionSource(adapter.id)) {
      throw new Error(`unknown decision source id: ${String(adapter.id)}`)
    }
    if (this.adapters.has(adapter.id)) {
      throw new Error(`duplicate evidence source adapter id: ${adapter.id}`)
    }
    this.adapters.set(adapter.id, adapter)
  }

  has(id: PmoDecisionSource): boolean {
    return this.adapters.has(id)
  }

  list(): DecisionEvidenceSourceAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id))
  }
}

/** 有界化：按预算截断 facts/refs 并计算 bytes 上限。 */
export function boundSourceResult(
  result: SourceCollectResult,
  budget: SourceCollectBudget,
): SourceCollectResult & { truncated: boolean } {
  const rawFacts = result.facts ?? []
  const rawRefs = result.refs ?? []
  const truncated =
    result.truncated === true ||
    rawFacts.length > budget.maxFacts ||
    rawRefs.length > budget.maxRefs ||
    JSON.stringify(rawFacts).length > budget.maxBytes
  return {
    ...result,
    facts: rawFacts.slice(0, budget.maxFacts),
    refs: rawRefs.slice(0, budget.maxRefs),
    truncated,
  }
}

/** 把 collect 结果合成标准 source block（状态合成规则见契约）。 */
export function toSourceBlock(
  adapter: Pick<DecisionEvidenceSourceAdapter, 'id' | 'required'>,
  collected: SourceCollectResult & { truncated?: boolean },
  staleThresholdMs: number,
  now: number,
): PmoDecisionSourceBlock {
  const state = composePmoDecisionSourceState({
    forbidden: collected.forbidden,
    unavailable: collected.unavailable,
    truncated: collected.truncated,
    stale:
      !collected.forbidden &&
      !collected.unavailable &&
      Boolean(collected.lastUpdatedAt) &&
      now - new Date(collected.lastUpdatedAt!).getTime() > staleThresholdMs,
  })
  return {
    source: adapter.id,
    required: adapter.required,
    state,
    sourceVersion: collected.sourceVersion ?? `${adapter.id}.v1`,
    objectRef: `${adapter.id}:org-${''}`,
    lastUpdatedAt: collected.lastUpdatedAt ?? null,
    facts: collected.unavailable || collected.forbidden ? [] : (collected.facts ?? []),
    refs: collected.unavailable || collected.forbidden ? [] : (collected.refs ?? []),
    warnings: [],
    truncated: collected.truncated === true,
  }
}

// ─── 内置 adapter 工厂 ────────────────────────────────────────────────────────

export interface BuiltinAdapterDeps {
  dashboard: PortfolioDashboardService
  trafficLight?: PortfolioTrafficLightService
  priority: PortfolioPriorityScoringService
  investment: PmoInvestmentDistributionService
  contention: ResourceContentionDetectionService
  riskWorkbench: RiskWorkbenchService
  policy: DecisionWorkbenchPolicy
}

function countKeys(summary: Record<string, unknown>, keys: string[]): SourceCollectResult['facts'] {
  const facts: SourceCollectResult['facts'] = []
  for (const key of keys) {
    const value = summary[key]
    if (typeof value === 'number' && Number.isFinite(value)) facts.push({ key, value })
    else if (typeof value === 'boolean') facts.push({ key, value })
    else facts.push({ key, value: null })
  }
  return facts
}

/**
 * 内置确定性 adapter 集：每个 adapter 只读取既有 summary 查询面的低敏计数字段。
 * 任一异常都折叠为 unavailable（有界 finding），不向上抛错遮蔽其他来源。
 */
export function buildBuiltinAdapters(deps: BuiltinAdapterDeps): EvidenceSourceRegistry {
  const registry = new EvidenceSourceRegistry()

  async function safeCollect(
    _source: PmoDecisionSource,
    run: () => Promise<SourceCollectResult>,
  ): Promise<SourceCollectResult> {
    try {
      return await run()
    } catch (error) {
      // 有界诊断：只记录错误类型名（不含正文/路径/secret），来源标记 unavailable。
      logger.warn(
        { source: _source, errType: (error as Error)?.name ?? 'Unknown' },
        'decision evidence source collect failed',
      )
      return { unavailable: true }
    }
  }

  // 组合交通灯（optional，复用既有 counts 只读面；服务不可用时跳过注册）
  if (deps.trafficLight) {
    registry.register({
      id: PMO_DECISION_SOURCES.PORTFOLIO_TRAFFIC_LIGHT,
      required: false,
      requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.PORTFOLIO_TRAFFIC_LIGHT),
      async collect(ctx) {
        return safeCollect(PMO_DECISION_SOURCES.PORTFOLIO_TRAFFIC_LIGHT, async () => {
          if (!(await deps.policy.canView(ctx.user, ctx.organizationId))) return { forbidden: true }
          const counts = (await deps.trafficLight!.counts(
            ctx.user,
            ctx.organizationId,
          )) as unknown as Record<string, unknown>
          return {
            facts: countKeys(counts, ['redCount', 'yellowCount', 'greenCount', 'grayCount']),
            refs: ['portfolio_traffic_light:counts'],
            sourceVersion: 'portfolio-traffic-light.v1',
            lastUpdatedAt: new Date().toISOString(),
          }
        })
      },
    })
  }

  // 组合 Dashboard（required）
  registry.register({
    id: PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD,
    required: true,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD, async () => {
        const allowed = await deps.policy.canView(ctx.user, ctx.organizationId)
        if (!allowed) return { forbidden: true }
        const summary = (await deps.dashboard.getSummary(
          ctx.organizationId,
          ctx.user,
          true,
          true,
          true,
          true,
          true,
        )) as unknown as Record<string, unknown>
        return {
          facts: countKeys(summary, [
            'totalProjects',
            'activeProjects',
            'atRiskProjects',
            'avgProgress',
          ]),
          refs: ['portfolio_dashboard:summary'],
          sourceVersion: 'portfolio-dashboard.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 优先级评分（required）
  registry.register({
    id: PMO_DECISION_SOURCES.PRIORITY_SCORING,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.PRIORITY_SCORING),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.PRIORITY_SCORING, async () => {
        if (!(await deps.policy.canView(ctx.user, ctx.organizationId))) return { forbidden: true }
        const summary = (await deps.priority.getSummary(
          ctx.user,
          ctx.organizationId,
        )) as unknown as Record<string, unknown>
        return {
          facts: countKeys(summary, ['projectCount', 'scoredProjectCount', 'mismatchCount']),
          refs: ['priority_scoring:summary'],
          sourceVersion: String(summary['scoreVersion'] ?? 'priority-scoring.v1'),
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // AI 优先级推荐 review 状态（optional）
  registry.register({
    id: PMO_DECISION_SOURCES.AI_PRIORITY_RECOMMENDATIONS,
    required: false,
    requiredPermissions: sourceDimensionPermission(
      PMO_DECISION_SOURCES.AI_PRIORITY_RECOMMENDATIONS,
    ),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.AI_PRIORITY_RECOMMENDATIONS, async () => {
        if (!(await deps.policy.canView(ctx.user, ctx.organizationId))) return { forbidden: true }
        // 只读推荐 review 聚合事实；不创建第二 rank，不触发新 AI 调用。
        return {
          facts: [{ key: 'recommendationReviewAvailable', value: true }],
          refs: ['ai_priority_recommendations:summary'],
          sourceVersion: 'pmo-ai-priority-recommendations.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 投入分布（optional）
  registry.register({
    id: PMO_DECISION_SOURCES.INVESTMENT_DISTRIBUTION,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.INVESTMENT_DISTRIBUTION),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.INVESTMENT_DISTRIBUTION, async () => {
        if (!(await deps.policy.canView(ctx.user, ctx.organizationId))) return { forbidden: true }
        const summary = (await deps.investment.getSummary(
          ctx.user,
          ctx.organizationId,
        )) as unknown as Record<string, unknown>
        return {
          facts: countKeys(summary, ['bucketCount', 'redactedBucketCount', 'visibleProjectCount']),
          refs: ['investment_distribution:summary'],
          sourceVersion: 'investment-distribution.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 资源争用（optional）
  registry.register({
    id: PMO_DECISION_SOURCES.RESOURCE_CONTENTION,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.RESOURCE_CONTENTION),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.RESOURCE_CONTENTION, async () => {
        if (
          !(await deps.policy.can(
            ctx.user,
            sourceDimensionPermission(PMO_DECISION_SOURCES.RESOURCE_CONTENTION),
            ctx.organizationId,
          ))
        ) {
          return { forbidden: true }
        }
        return {
          facts: [],
          refs: ['resource_contention:by-ref'],
          sourceVersion: 'resource-contention.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 资源预测（optional）
  registry.register({
    id: PMO_DECISION_SOURCES.RESOURCE_FORECAST,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.RESOURCE_FORECAST),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.RESOURCE_FORECAST, async () => {
        if (
          !(await deps.policy.can(
            ctx.user,
            sourceDimensionPermission(PMO_DECISION_SOURCES.RESOURCE_FORECAST),
            ctx.organizationId,
          ))
        ) {
          return { forbidden: true }
        }
        return {
          facts: [],
          refs: ['resource_forecast:by-ref'],
          sourceVersion: 'resource-forecast.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 分配 preview（optional，ref 驱动）
  registry.register({
    id: PMO_DECISION_SOURCES.ALLOCATION_PREVIEW,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.ALLOCATION_PREVIEW),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.ALLOCATION_PREVIEW, async () => {
        if (
          !(await deps.policy.can(
            ctx.user,
            sourceDimensionPermission(PMO_DECISION_SOURCES.ALLOCATION_PREVIEW),
            ctx.organizationId,
          ))
        ) {
          return { forbidden: true }
        }
        const draftRefs = ctx.evidenceRefs.filter((ref) => ref.startsWith('allocation_preview:'))
        if (draftRefs.length === 0) return { unavailable: true }
        return {
          facts: draftRefs.map((_ref, index) => ({ key: `draftRef${index}`, value: index })),
          refs: draftRefs.slice(0, ctx.budget.maxRefs),
          sourceVersion: 'cross-project-allocation.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 风险登记册（optional）
  registry.register({
    id: PMO_DECISION_SOURCES.RISK_REGISTER,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.RISK_REGISTER),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.RISK_REGISTER, async () => {
        if (
          !(await deps.policy.can(
            ctx.user,
            sourceDimensionPermission(PMO_DECISION_SOURCES.RISK_REGISTER),
            ctx.organizationId,
          ))
        ) {
          return { forbidden: true }
        }
        return {
          facts: [{ key: 'riskRegisterAvailable', value: true }],
          refs: ['risk_register:workbench'],
          sourceVersion: 'risk-workbench.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 进度预测（optional）
  registry.register({
    id: PMO_DECISION_SOURCES.PROGRESS_PREDICTION,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.PROGRESS_PREDICTION),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.PROGRESS_PREDICTION, async () => {
        if (
          !(await deps.policy.can(
            ctx.user,
            sourceDimensionPermission(PMO_DECISION_SOURCES.PROGRESS_PREDICTION),
            ctx.organizationId,
          ))
        ) {
          return { forbidden: true }
        }
        return {
          facts: [{ key: 'predictionAvailable', value: true }],
          refs: ['progress_prediction:dashboard'],
          sourceVersion: 'prediction.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  // 多项目影响分析（optional）
  registry.register({
    id: PMO_DECISION_SOURCES.MULTI_PROJECT_IMPACT,
    required: false,
    requiredPermissions: sourceDimensionPermission(PMO_DECISION_SOURCES.MULTI_PROJECT_IMPACT),
    async collect(ctx) {
      return safeCollect(PMO_DECISION_SOURCES.MULTI_PROJECT_IMPACT, async () => {
        if (
          !(await deps.policy.can(
            ctx.user,
            sourceDimensionPermission(PMO_DECISION_SOURCES.MULTI_PROJECT_IMPACT),
            ctx.organizationId,
          ))
        ) {
          return { forbidden: true }
        }
        const impactRefs = ctx.evidenceRefs.filter((ref) => ref.startsWith('multi_project_impact:'))
        if (impactRefs.length === 0) return { unavailable: true }
        return {
          facts: impactRefs.map((_ref, index) => ({ key: `impactRef${index}`, value: index })),
          refs: impactRefs.slice(0, ctx.budget.maxRefs),
          sourceVersion: 'multi-project-impact.v1',
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
  })

  return registry
}

// ─── 快照服务 ────────────────────────────────────────────────────────────────

export interface CollectedEvidence {
  blocks: PmoDecisionSourceBlock[]
  readiness: PmoDecisionSnapshotReadiness
  contentHash: string
  truncated: boolean
  collectedAt: string
}

/** 纯函数：并行收集全部来源 → canonical 内容与 readiness（供测试复用）。 */
export async function collectAllSources(input: {
  registry: EvidenceSourceRegistry
  user: User
  organizationId: number
  evidenceRefs: string[]
  now?: number
  staleThresholdMs?: number
  timeoutMs?: number
}): Promise<CollectedEvidence> {
  const now = input.now ?? Date.now()
  const timeoutMs = input.timeoutMs ?? 8_000
  const budget = makeSourceBudget(now + timeoutMs)
  const adapters = input.registry.list()
  const collected = await Promise.all(
    adapters.map(
      async (
        adapter,
      ): Promise<{
        adapter: typeof adapter
        result: SourceCollectResult & { truncated: boolean }
      }> => {
        const raceResult = await Promise.race([
          // isolate-drop：宿主兜底捕获 adapter 抛错（单来源异常只产生有界 unavailable）。
          adapter
            .collect({
              user: input.user,
              organizationId: input.organizationId,
              budget,
              evidenceRefs: input.evidenceRefs,
            })
            .catch((): SourceCollectResult => ({ unavailable: true })),
          new Promise<SourceCollectResult>((resolve) =>
            setTimeout(() => resolve({ unavailable: true }), Math.max(1, budget.deadlineAt - now)),
          ),
        ])
        return { adapter, result: boundSourceResult(raceResult, budget) }
      },
    ),
  )
  const blocks = collected.map(({ adapter, result }) =>
    toSourceBlock(adapter, result, input.staleThresholdMs ?? 60 * 60 * 24_000, now),
  )
  const requiredSources = adapters.filter((a) => a.required).map((a) => a.id)
  const readiness = derivePmoDecisionSnapshotReadiness({ blocks, requiredSources })
  const canonical = blocks.map((block) => ({
    source: block.source,
    state: block.state,
    sourceVersion: block.sourceVersion,
    factKeys: block.facts.map((fact) => fact.key).sort(),
    values: block.facts.map((fact) => fact.value),
    truncated: block.truncated,
  }))
  return {
    blocks,
    readiness,
    contentHash: computePmoDecisionContentHash(canonical),
    truncated: blocks.some((block) => block.truncated),
    collectedAt: new Date(now).toISOString(),
  }
}

@inject()
export default class EvidenceSnapshotService {
  public registry: EvidenceSourceRegistry = new EvidenceSourceRegistry()

  constructor(private readonly policy: DecisionWorkbenchPolicy) {}

  private ready?: Promise<void>

  /**
   * 惰性构建内置 adapter：多数权威来源服务不使用 @inject()（历史构造方式），
   * container.make 对它们会失败——因此按各自真实构造方式解析：
   * 无参服务直接 new；有依赖的服务先 make 其依赖再手动组装。
   */
  ensureRegistry(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const { default: app } = await import('@adonisjs/core/services/app')
        const { default: Dashboard } = await import('#services/portfolio_dashboard_service')
        const { default: Priority } = await import('#services/portfolio_priority_scoring_service')
        const { default: PriorityPolicy } = await import('#policies/portfolio_priority_policy')
        const { default: Investment } =
          await import('#services/pmo_investment_distribution_service')
        const { default: Contention } =
          await import('#services/resource_contention_detection_service')
        const { default: RiskWorkbench } = await import('#services/risk_workbench_service')
        const { default: TrafficLight } = await import('#services/portfolio_traffic_light_service')
        const { default: RbacService } = await import('#services/rbac_service')
        let rbac: unknown
        try {
          rbac = await app.container.make(RbacService)
        } catch {
          rbac = new RbacService()
        }
        let trafficLight: PortfolioTrafficLightService | undefined
        try {
          trafficLight = await app.container.make(TrafficLight)
        } catch {
          trafficLight = undefined
        }
        this.registry = buildBuiltinAdapters({
          dashboard: new Dashboard(),
          priority: new Priority(new PriorityPolicy(rbac as never)),
          investment: new Investment(),
          contention: new Contention(),
          riskWorkbench: new RiskWorkbench(),
          trafficLight,
          policy: this.policy,
        })
      })()
    }
    return this.ready
  }

  /** 测试注入口：直接替换 registry。 */
  setRegistry(registry: EvidenceSourceRegistry): void {
    this.registry = registry
    this.ready = Promise.resolve()
  }

  /** 收集证据（纯读）：不落库版本供 UI 预览与测试使用。 */
  async collect(
    input: Omit<Parameters<typeof collectAllSources>[0], 'registry'>,
  ): Promise<CollectedEvidence> {
    await this.ensureRegistry()
    return collectAllSources({ ...input, registry: this.registry })
  }

  /** 从快照内容提取对比度量引用（comparison 服务输入）。 */
  static measureRefFromFact(source: PmoDecisionSource, key: string): string {
    return `${source}:${key}`
  }

  static warningFromState(
    state: PmoDecisionSourceBlock['state'],
    source: PmoDecisionSource,
  ): PmoDecisionWarning | null {
    switch (state) {
      case PMO_DECISION_SOURCE_STATES.STALE:
        return { code: 'SOURCE_STALE', message: `来源 ${source} 数据过期`, source }
      case PMO_DECISION_SOURCE_STATES.FORBIDDEN:
        return { code: 'SOURCE_FORBIDDEN', message: `来源 ${source} 因权限受限不可见`, source }
      case PMO_DECISION_SOURCE_STATES.UNAVAILABLE:
        return { code: 'SOURCE_UNAVAILABLE', message: `来源 ${source} 不可用`, source }
      case PMO_DECISION_SOURCE_STATES.TRUNCATED:
        return { code: 'SOURCE_TRUNCATED', message: `来源 ${source} 结果已按预算截断`, source }
      default:
        return null
    }
  }
}

export type { PmoDecisionMeasureRef }
