/**
 * v3-copilot-context-packet-and-project-panorama — CopilotContextAssemblyService（§1-8 主编排）。
 *
 * Copilot 上下文采集与组装服务：
 * - 按 scope 选择合格来源，逐来源权限判定，不可访问来源零泄露省略
 * - 复用既有十二类检索与四层知识底座（生产路径，排除 L3）
 * - Skill 方法论切面注入（非项目事实标记）
 * - 项目全景低敏聚合
 * - 确定性上下文预算与截断
 * - source hash 与新鲜度 stale 阻断
 * - 可解释来源回溯
 * - 「不知道就说不知道」护栏
 * - 组织隔离与低敏脱敏
 *
 * @aiproj/backend
 */
import type SearchService from '#services/search_service'
import type { SearchContext } from '#services/search/search_source_adapter'
import type KnowledgeService from '#services/knowledge/knowledge_service'
import type {
  CopilotContextAssemblyRequest,
  CopilotContextAssemblyResult,
  CopilotContextFact,
  CopilotAssemblySourceMetadata,
  CopilotMethodologyFacet,
  CopilotPanoramaFacetName,
  CopilotProjectPanorama,
  CopilotUncertaintyEntry,
  CopilotConclusionTraceEntry,
  CopilotWarningCode,
  CopilotRetrievalSourceKind,
} from '@aiproj/types'
import {
  COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP,
  COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
  validateCopilotContextAssembly,
} from '@aiproj/types'
import {
  CopilotContextCollector,
  type CollectorPermissionCheck,
} from './copilot_context_collector.js'
import { CopilotProjectPanoramaAggregator } from './copilot_project_panorama.js'
import { CopilotContextBudget } from './copilot_context_budget.js'
import { CopilotContextSanitizer } from './copilot_context_sanitizer.js'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 按检索来源声明序（COPILOT_RETRIEVAL_SOURCE_KINDS 序）摊平行级事实。
 * 顺序确定性：相同输入两次组装的 facts 顺序完全一致。
 */
export function flattenFactsByKind(
  factsByKind: Readonly<Partial<Record<CopilotRetrievalSourceKind, readonly CopilotContextFact[]>>>,
): CopilotContextFact[] {
  const order = [
    'task',
    'risk',
    'milestone',
    'project',
    'file',
    'change_request',
    'report',
    'comment',
    'activity',
    'task_external_link',
    'ocr_search_index',
    'document',
  ] as const
  const facts: CopilotContextFact[] = []
  for (const kind of order) {
    const bucket = factsByKind[kind]
    if (bucket && bucket.length > 0) facts.push(...bucket)
  }
  return facts
}

/**
 * 全景聚合 → 聚合型权威事实（任务 2.1/2.2）。
 *
 * 九切面每个产出低敏聚合事实（计数/分布/引用），**不含正文**；
 * observedAt 取切面捕获时间；sourceRef 统一 `project:{id}/panorama`。
 * 聚合事实必须排在行级事实之前（预算按序截断不破坏精确总数）。
 */
export function buildPanoramaContextFacts(panorama: CopilotProjectPanorama): CopilotContextFact[] {
  const f = panorama.facets
  const at = (facet: CopilotPanoramaFacetName) => panorama.facetCapturedAts[facet]
  const ref = `project:${panorama.projectId}/panorama`
  const facts: CopilotContextFact[] = []

  facts.push(
    {
      factKey: 'wbs.nodes',
      value: f.wbs.nodeCount,
      displayLabel: 'WBS 节点数',
      facet: 'wbs',
      sourceRef: ref,
      observedAt: at('wbs'),
      sensitivity: 'low',
    },
    {
      factKey: 'wbs.leafs',
      value: f.wbs.leafCount,
      displayLabel: 'WBS 叶子节点数',
      facet: 'wbs',
      sourceRef: ref,
      observedAt: at('wbs'),
      sensitivity: 'low',
    },
    {
      factKey: 'wbs.byLevel',
      value: f.wbs.byLevel,
      displayLabel: 'WBS 层级分布',
      facet: 'wbs',
      sourceRef: ref,
      observedAt: at('wbs'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'tasks.total',
      value: f.taskStatus.total,
      displayLabel: '任务总数',
      facet: 'taskStatus',
      sourceRef: ref,
      observedAt: at('taskStatus'),
      sensitivity: 'low',
    },
    {
      factKey: 'tasks.byStatus',
      value: f.taskStatus.byStatus,
      displayLabel: '任务状态分布',
      facet: 'taskStatus',
      sourceRef: ref,
      observedAt: at('taskStatus'),
      sensitivity: 'low',
    },
    {
      factKey: 'tasks.completionRatio',
      value: Math.round(f.taskStatus.completionRatio * 100) / 100,
      displayLabel: '任务完成比例',
      facet: 'taskStatus',
      sourceRef: ref,
      observedAt: at('taskStatus'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'deps.count',
      value: f.dependency.dependencyCount,
      displayLabel: '依赖数',
      facet: 'dependency',
      sourceRef: ref,
      observedAt: at('dependency'),
      sensitivity: 'low',
    },
    {
      factKey: 'deps.criticalPathLength',
      value: f.dependency.criticalPathLength,
      displayLabel: '关键路径长度',
      facet: 'dependency',
      sourceRef: ref,
      observedAt: at('dependency'),
      sensitivity: 'low',
    },
    {
      factKey: 'deps.hasCycle',
      value: f.dependency.hasCycle,
      displayLabel: '依赖是否存在环',
      facet: 'dependency',
      sourceRef: ref,
      observedAt: at('dependency'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'resource.assignments',
      value: f.resource.assignmentCount,
      displayLabel: '资源分配数',
      facet: 'resource',
      sourceRef: ref,
      observedAt: at('resource'),
      sensitivity: 'low',
    },
    {
      factKey: 'resource.overallLoadRatio',
      value: Math.round(f.resource.overallLoadRatio * 100) / 100,
      displayLabel: '整体负载比',
      facet: 'resource',
      sourceRef: ref,
      observedAt: at('resource'),
      sensitivity: 'low',
    },
    {
      factKey: 'resource.overallocatedUsers',
      value: f.resource.overallocatedUserCount,
      displayLabel: '超配用户数',
      facet: 'resource',
      sourceRef: ref,
      observedAt: at('resource'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'risks.total',
      value: f.risk.total,
      displayLabel: '风险总数',
      facet: 'risk',
      sourceRef: ref,
      observedAt: at('risk'),
      sensitivity: 'low',
    },
    {
      factKey: 'risks.bySeverity',
      value: f.risk.bySeverity,
      displayLabel: '风险严重程度分布',
      facet: 'risk',
      sourceRef: ref,
      observedAt: at('risk'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'milestones.total',
      value: f.milestone.total,
      displayLabel: '里程碑总数',
      facet: 'milestone',
      sourceRef: ref,
      observedAt: at('milestone'),
      sensitivity: 'low',
    },
    {
      factKey: 'milestones.overdue',
      value: f.milestone.overdueCount,
      displayLabel: '逾期里程碑数',
      facet: 'milestone',
      sourceRef: ref,
      observedAt: at('milestone'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'changes.total',
      value: f.change.total,
      displayLabel: '变更请求数',
      facet: 'change',
      sourceRef: ref,
      observedAt: at('change'),
      sensitivity: 'low',
    },
    {
      factKey: 'changes.byStatus',
      value: f.change.byStatus,
      displayLabel: '变更状态分布',
      facet: 'change',
      sourceRef: ref,
      observedAt: at('change'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'docs.documents',
      value: f.docs.documentCount,
      displayLabel: '文档数',
      facet: 'docs',
      sourceRef: ref,
      observedAt: at('docs'),
      sensitivity: 'low',
    },
    {
      factKey: 'docs.attachments',
      value: f.docs.attachmentCount,
      displayLabel: '附件数',
      facet: 'docs',
      sourceRef: ref,
      observedAt: at('docs'),
      sensitivity: 'low',
    },
  )
  facts.push(
    {
      factKey: 'activity.recent',
      value: f.activity.recentCount,
      displayLabel: '近期活动数',
      facet: 'activity',
      sourceRef: ref,
      observedAt: at('activity'),
      sensitivity: 'low',
    },
    {
      factKey: 'activity.byType',
      value: f.activity.byType ?? {},
      displayLabel: '活动类型分布',
      facet: 'activity',
      sourceRef: ref,
      observedAt: at('activity'),
      sensitivity: 'low',
    },
  )

  return facts
}

// ---------------------------------------------------------------------------
// 服务依赖接口
// ---------------------------------------------------------------------------

export interface CopilotContextAssemblyDeps {
  searchService: SearchService
  knowledgeService: KnowledgeService
  permissionChecker: (
    organizationId: number,
    userId: number,
    sourceKind: CopilotRetrievalSourceKind,
  ) => Promise<CollectorPermissionCheck>
  buildSearchContext: (request: CopilotContextAssemblyRequest) => SearchContext
  /** 可选：提供已激活的 Skill 方法论数据。 */
  skillActivation?: {
    skillKeys: readonly string[]
    methodologyVersionHash: string
    guidanceItems: readonly {
      itemId: string
      skillKey: string
      label: string
      summary: string
      sourceRef: string
      knowledgeRef?: string
      activationRuleId: string
      activationReason: string
      /** 知识条目所属层级（L1/L2/L3/L4），用于 §4 L3 排除断言。 */
      knowledgeTier?: string
    }[]
  }
}

// ---------------------------------------------------------------------------
// CopilotContextAssemblyService 服务
// ---------------------------------------------------------------------------

export class CopilotContextAssemblyService {
  readonly #collector: CopilotContextCollector
  readonly #panorama: CopilotProjectPanoramaAggregator
  readonly #budget: CopilotContextBudget
  readonly #sanitizer: CopilotContextSanitizer
  readonly #deps: CopilotContextAssemblyDeps

  constructor(deps: CopilotContextAssemblyDeps) {
    this.#deps = deps
    this.#collector = new CopilotContextCollector({
      searchService: deps.searchService,
      knowledgeService: deps.knowledgeService,
      permissionChecker: deps.permissionChecker,
      buildSearchContext: deps.buildSearchContext,
    })
    this.#panorama = new CopilotProjectPanoramaAggregator()
    this.#budget = new CopilotContextBudget()
    this.#sanitizer = new CopilotContextSanitizer()
  }

  // ── 主组装入口 ──────────────────────────────────────────────────

  /**
   * 执行完整的上下文采集与组装。
   *
   * 流程：
   * 1. Scope 合格性前置判定（Task 3.1）
   * 2. 并发采集合格来源（Task 3.9）
   * 3. 权限判定与零泄露省略（Task 3.3-3.4）
   * 4. 知识底座查询（生产路径，排除 L3）（Task 4.3）
   * 5. Skill 方法论切面注入（Task 4.7）
   * 6. 项目全景聚合（Task 5.1-5.4）
   * 7. 截断与预算（Task 6.1-6.2）
   * 8. 不确定表达（Task 7.3-7.4）
   * 9. 脱敏检查（Task 8.1）
   * 10. 校验（Task 2.10）
   */
  async assembleContext(
    request: CopilotContextAssemblyRequest,
  ): Promise<CopilotContextAssemblyResult> {
    const startTime = Date.now()
    const warnings: CopilotWarningCode[] = []

    // ── Step 1: Scope 合格性前置判定 ──────────────────────────────
    const eligibility = COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP[request.scope]

    // ── Step 2 & 3: 并发采集合格来源（含权限判定） ────────────────
    const { sources, perSourceMs, factsByKind } = await this.#collector.collectAllSources(request)

    // ── Step 4: 知识底座查询（生产路径） ──────────────────────────
    let knowledgeResult: {
      tierList: CopilotContextAssemblyResult['eligibleKnowledgeTiers']
      queryPath: 'production' | 'eval'
    } = {
      tierList: COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
      queryPath: 'production',
    }

    if (eligibility.knowledgeEligible && request.query) {
      knowledgeResult = await this.#collector.queryKnowledge(request.organizationId, request.query)
    }

    // ── Step 5: Skill 方法论切面注入 ──────────────────────────────
    // §4.1: 方法论注入前二次断言知识层合格性——生产路径下 L3 条目必须被排除
    let methodology: CopilotMethodologyFacet | undefined
    if (eligibility.methodologyEligible && this.#deps.skillActivation) {
      let guidanceItems = this.#deps.skillActivation.guidanceItems
      let l3ExcludedCount = 0

      // §4.1: 生产路径下，L3 合成评测知识条目必须被二次断言排除
      if (knowledgeResult.queryPath === 'production') {
        const filtered: (typeof guidanceItems)[number][] = []
        for (const item of guidanceItems) {
          if (item.knowledgeTier === 'L3') {
            l3ExcludedCount++
            // §4.4: 被剔除条目计数与原因记录
            warnings.push('EXTERNAL_CONTENT_REJECTED')
          } else {
            filtered.push(item)
          }
        }
        guidanceItems = filtered
      }

      // §3.4: 零激活时切面缺席而非空壳——过滤后若无剩余条目且无 skillKeys，跳过切面
      if (guidanceItems.length > 0 || this.#deps.skillActivation.skillKeys.length > 0) {
        methodology = this.#collector.buildMethodologyFacet(
          this.#deps.skillActivation.skillKeys,
          this.#deps.skillActivation.methodologyVersionHash,
          guidanceItems,
        )
      }
    }

    // ── Step 6: 项目全景聚合 ──────────────────────────────────────
    let panorama: CopilotProjectPanorama | undefined
    if (eligibility.panoramaEligible && request.includePanorama !== false) {
      try {
        panorama = await this.#panorama.buildProjectPanorama(
          request.attribution.projectId ?? '',
          request.organizationId,
        )
      } catch {
        // 全景聚合失败不影响上下文采集
        warnings.push('SOURCE_UNAVAILABLE')
      }
    }

    // ── Step 6b: 权威事实候选（任务 2.1/2.2）────────────────────────
    // 聚合事实（全景九切面）在前，行级事实（检索 allowlisted projection）在后——
    // 预算按序截断不会破坏精确总数（与 factKey 语义一致）。
    const contextFacts: CopilotContextFact[] = [
      ...(panorama ? buildPanoramaContextFacts(panorama) : []),
      ...flattenFactsByKind(factsByKind),
    ]

    // ── Step 7: 截断与预算 ────────────────────────────────────────
    const budget = this.#budget.computeBudget(request)
    const plan = this.#budget.planTruncation(sources, budget, 0)
    // 断言路由输入在截断后仍全部存活（返回值由 buildAssemblyResult 内部再次求值并写入结果）
    this.#budget.assertRoutingInputsPreserved(request, plan)

    // ── Step 8: 不确定表达 ────────────────────────────────────────
    const uncertainty = this.#buildUncertainty(sources, request)

    // ── Step 9: 结论回溯 ──────────────────────────────────────────
    const conclusionTrace = this.#buildConclusionTrace(sources, uncertainty)

    // ── Step 10: 构建 packetSources ───────────────────────────────
    const packetSources = sources.map((s) => ({
      sourceKind: s.packetSourceKind,
      sourceRef: s.sourceRef,
      sourceHash: s.sourceHash,
      lowSensitivitySummary: `${s.retrievalKind} 检索摘要（${s.hitCount} 条命中）`,
      freshness: {
        lastUpdatedAt: s.capturedAt,
        isStale: false,
      },
      routeHints: [] as any[],
      warnings: [] as any[],
    }))

    // ── Step 11: 构建组装结果 ─────────────────────────────────────
    const result = this.#budget.buildAssemblyResult({
      request,
      sources,
      packetSources,
      methodology,
      panorama,
      contextFacts,
      knowledgeQueryPath: knowledgeResult.queryPath,
      knowledgeTiers: knowledgeResult.tierList,
      uncertainty,
      conclusionTrace,
      totalMs: Date.now() - startTime,
      perSourceMs,
      warnings,
    })

    // ── Step 12: 脱敏检查 ────────────────────────────────────────
    const sanitizerResult = this.#sanitizer.sanitizeAssemblyResult(result)
    if (!sanitizerResult.safe) {
      warnings.push('EXTERNAL_CONTENT_REJECTED')
    }

    // ── Step 13: 校验 ────────────────────────────────────────────
    const validation = validateCopilotContextAssembly(result)
    if (!validation.ok) {
      // 校验失败不影响返回，但记录警告
      for (let i = 0; i < validation.errors.length; i += 1) {
        warnings.push('INVALID_OUTPUT')
      }
    }

    return result
  }

  // ── 内部方法 ────────────────────────────────────────────────────

  /**
   * 构建不确定表达条目。
   * Task 7.3-7.4: 零结果与低置信的明确不确定表达。
   */
  #buildUncertainty(
    sources: readonly CopilotAssemblySourceMetadata[],
    _request: CopilotContextAssemblyRequest,
  ): CopilotUncertaintyEntry[] {
    const uncertainty: CopilotUncertaintyEntry[] = []

    for (const source of sources) {
      if (!source.matched) {
        uncertainty.push({
          uncertaintyId: `unc-${source.retrievalKind}`,
          topic: `${source.retrievalKind} 检索`,
          kind: 'no-match',
          confidence: 0,
          sourceRefs: [],
        })
      }
    }

    return uncertainty
  }

  /**
   * 构建结论回溯条目。
   * Task 7.1: 结论到 source refs 的回溯映射。
   * Task 7.2: 无来源支撑不得作为事实输出。
   *
   * §5.3 结论回溯**不得指向方法论条目**：
   * 本方法仅从 `sources`（项目事实来源）构建结论，methodology 切面不参与。
   * 证据抽屉展开时，方法论条目不会出现在结论的 sourceRefs 中。
   */
  #buildConclusionTrace(
    sources: readonly CopilotAssemblySourceMetadata[],
    uncertainty: readonly CopilotUncertaintyEntry[],
  ): CopilotConclusionTraceEntry[] {
    const conclusions: CopilotConclusionTraceEntry[] = []

    // 从来源构建有支撑的结论
    for (const source of sources) {
      if (source.matched && source.hitCount > 0) {
        conclusions.push({
          conclusionId: `concl-${source.retrievalKind}`,
          statement: `项目包含 ${source.hitCount} 条 ${source.retrievalKind} 相关信息`,
          sourceRefs: [source.sourceRef],
          sourceHashes: [source.sourceHash],
          supported: true,
        })
      }
    }

    // 不确定条目作为无支撑结论
    for (const unc of uncertainty) {
      conclusions.push({
        conclusionId: `concl-unc-${unc.uncertaintyId}`,
        statement: `未能获取 ${unc.topic} 的相关信息`,
        sourceRefs: [],
        sourceHashes: [],
        supported: false,
      })
    }

    return conclusions
  }

  // ── 便捷方法 ────────────────────────────────────────────────────

  /**
   * 检查上下文包的新鲜度。
   * 返回 stale 的来源 ref 列表。
   */
  checkFreshness(
    result: CopilotContextAssemblyResult,
    currentHashesByRef: ReadonlyMap<string, string>,
  ): string[] {
    return this.#budget.checkBatchFreshness(result.sources, currentHashesByRef)
  }

  /**
   * 对推荐动作执行 stale 阻断。
   */
  applyStaleBlocking<
    T extends { sourceHashes: readonly string[]; isStale: boolean; staleReason?: string },
  >(actions: T[], staleHashes: ReadonlySet<string>): T[] {
    return this.#budget.applyStaleBlocking(actions, staleHashes)
  }

  /**
   * 清理组装结果中的敏感内容。
   */
  cleanResult(result: CopilotContextAssemblyResult): {
    cleaned: CopilotContextAssemblyResult
    removedFields: string[]
  } {
    return this.#sanitizer.cleanAssemblyResult(result)
  }
}
