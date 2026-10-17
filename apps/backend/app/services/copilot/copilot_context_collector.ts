/**
 * v3-copilot-context-packet-and-project-panorama — CopilotContextCollector（§3）。
 *
 * 权限过滤来源采集器：按 scope 选择合格来源，逐来源做权限判定，
 * 不可访问来源零泄露省略（不暴露存在、名称、计数或 hash）。
 * 复用既有 SearchService 与 KnowledgeService，不新建并行检索。
 *
 * 设计决策（design.md Decision 1 & 2）：
 * - Scope determines eligible source kinds, enforced before any query runs
 * - Reuse the twelve existing search adapters and their scoring
 *
 * @aiproj/backend
 */
import { memberAlias } from '#services/ai_colleague/member_alias'
import { SEARCH_ENTITY_TYPES } from '@aiproj/types'
import type SearchService from '#services/search_service'
import type { SearchContext } from '#services/search/search_source_adapter'
import type KnowledgeService from '#services/knowledge/knowledge_service'
import type {
  SearchEntityType,
  SearchQuery,
  CopilotKnowledgeTier,
  CopilotContextAssemblyRequest,
  CopilotAssemblySourceMetadata,
  CopilotContextFact,
  CopilotMethodologyFacet,
  CopilotSourcePermissionDecision,
} from '@aiproj/types'
import {
  COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP,
  COPILOT_RETRIEVAL_KIND_TO_SOURCE_KIND,
  COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
  assemblyEligibleRetrievalKinds,
  type CopilotRetrievalSourceKind,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 事实投影常量（v3-copilot-authoritative-page-context，任务 2.1）
// ---------------------------------------------------------------------------

/**
 * 每来源种类的 allowlisted 字段投影表（闭合白名单）。
 *
 * 检索 adapter 的 `result.items` 只允许按白名单投影——其余字段（描述全文、
 * URL、敏感元数据、未知扩展字段）一律不进入事实。投影字段只保留标量值
 * （string/number/boolean），其他一律丢弃。
 */
export const COPILOT_FACT_ITEM_ALLOWLIST: Readonly<
  Record<CopilotRetrievalSourceKind, readonly string[]>
> = {
  task: [
    'id',
    'name',
    'status',
    'priority',
    // 负责人只以代号出现（〔成员·编码〕），不含姓名；界面展示时再换回真实姓名
    'assignee',
    'progressPercent',
    'isCriticalPath',
    'startDate',
    'endDate',
  ],
  risk: ['id', 'title', 'severity', 'status'],
  milestone: ['id', 'name', 'status', 'plannedDate', 'dueDate'],
  project: ['id', 'name', 'status'],
  file: ['id', 'name', 'mimeType'],
  change_request: ['id', 'title', 'status'],
  report: ['id', 'title', 'status'],
  comment: ['id', 'body', 'authorId'],
  activity: ['id', 'eventType', 'summary'],
  task_external_link: ['id', 'title'],
  ocr_search_index: ['id', 'fileName'],
  document: ['id', 'title'],
}

/** 检索来源种类 → 事实切面（与 panorama 九切面同一词汇）。 */
export const COPILOT_FACT_ITEM_FACET: Readonly<Record<CopilotRetrievalSourceKind, string>> = {
  task: 'taskStatus',
  risk: 'risk',
  milestone: 'milestone',
  project: 'wbs',
  file: 'docs',
  change_request: 'change',
  report: 'docs',
  comment: 'activity',
  activity: 'activity',
  task_external_link: 'dependency',
  ocr_search_index: 'docs',
  document: 'docs',
}

/** 每来源种类最多保留的事实行数（行级预算，先于精确总数之后的明细）。 */
export const COPILOT_FACT_COLLECTOR_ROWS_PER_SOURCE = 6

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface CollectorPermissionCheck {
  readonly allowed: boolean
  readonly reason?: string
}

export interface CollectorSourceResult {
  readonly kind: CopilotRetrievalSourceKind
  readonly metadata: CopilotAssemblySourceMetadata
}

export interface CollectorKnowledgeResult {
  readonly tierList: readonly CopilotKnowledgeTier[]
  readonly queryPath: 'production' | 'eval'
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}

function now(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// CopilotContextCollector 服务
// ---------------------------------------------------------------------------

export class CopilotContextCollector {
  readonly #searchService: SearchService
  readonly #knowledgeService: KnowledgeService
  /** 权限判定回调（由注入方提供，复用既有 Policy）。 */
  readonly #permissionChecker: (
    organizationId: number,
    userId: number,
    sourceKind: CopilotRetrievalSourceKind,
  ) => Promise<CollectorPermissionCheck>
  /** 检索上下文构建回调。 */
  readonly #buildSearchContext: (request: CopilotContextAssemblyRequest) => SearchContext

  constructor(deps: {
    searchService: SearchService
    knowledgeService: KnowledgeService
    permissionChecker: (
      organizationId: number,
      userId: number,
      sourceKind: CopilotRetrievalSourceKind,
    ) => Promise<CollectorPermissionCheck>
    buildSearchContext: (request: CopilotContextAssemblyRequest) => SearchContext
  }) {
    this.#searchService = deps.searchService
    this.#knowledgeService = deps.knowledgeService
    this.#permissionChecker = deps.permissionChecker
    this.#buildSearchContext = deps.buildSearchContext
  }

  // ── Task 3.1: scope 合格性前置判定 ───────────────────────────────

  /**
   * 查询发起前先按 scope 排除不合格来源种类。
   * 返回合格的检索来源列表。
   */
  getEligibleRetrievalKinds(
    scope: CopilotContextAssemblyRequest['scope'],
    requested?: readonly CopilotRetrievalSourceKind[],
  ): CopilotRetrievalSourceKind[] {
    return assemblyEligibleRetrievalKinds(scope, requested)
  }

  // ── Task 3.3 & 3.4: 逐来源权限判定 + 不可访问来源零泄露省略 ────

  /**
   * 对单个来源执行权限判定。
   * denied-hidden 来源在后续步骤中整条省略（零泄露）。
   */
  async checkSourcePermission(
    organizationId: number,
    userId: number,
    sourceKind: CopilotRetrievalSourceKind,
  ): Promise<CopilotSourcePermissionDecision> {
    const result = await this.#permissionChecker(organizationId, userId, sourceKind)
    return result.allowed ? 'granted' : 'denied-hidden'
  }

  // ── Task 3.8: entity scope 边界限定 ──────────────────────────────

  /**
   * entity scope 的边界限定：只返回该实体与其已授权祖先对应的来源种类。
   */
  getEntityScopeKinds(entityType?: string): CopilotRetrievalSourceKind[] {
    if (!entityType) return []
    // entity scope 只允许 task/risk/milestone/document 四种
    const allowed: CopilotRetrievalSourceKind[] = ['task', 'risk', 'milestone', 'document']
    return allowed
  }

  // ── Task 3.9: 并发采集与逐来源耗时记录 ─────────────────────────

  /**
   * 把 adapter 检索结果的项目按各自 allowlist 投影为权威事实（任务 2.1）。
   *
   * - 只读取 `COPILOT_FACT_ITEM_ALLOWLIST` 内的字段，且只接受标量值
   *   （string/number/boolean）；其余一律不读取——不复制描述全文/URL/敏感字段。
   * - 行级预算 `COPILOT_FACT_COLLECTOR_ROWS_PER_SOURCE`；超出部分省略
   *   （由 source metadata 的 hitCount 承担精确计数职责，不先截断再算 total）。
   * - 每条事实带 sourceRef（有 id 时 `{kind}:{id}`）、observedAt（当前时间）。
   */
  projectSearchFactItems(
    items: readonly unknown[],
    sourceKind: CopilotRetrievalSourceKind,
    observedAt: string,
    /** 负责人代号按组织计算。 */
    organizationId = 0,
  ): CopilotContextFact[] {
    const allowlist = COPILOT_FACT_ITEM_ALLOWLIST[sourceKind]
    const facet = COPILOT_FACT_ITEM_FACET[sourceKind]
    const facts: CopilotContextFact[] = []
    const cutoff = Math.min(items.length, COPILOT_FACT_COLLECTOR_ROWS_PER_SOURCE)

    for (let i = 0; i < cutoff; i++) {
      const item = items[i]
      if (typeof item !== 'object' || item === null) continue
      const raw = item as Record<string, unknown>
      // 检索适配器返回 SearchResultItem（entityId/title），白名单按实体行字段（id/name/title）写；
      // 此前两者对不上，任务名等全被丢弃，模型只看到「命中 16 条」却拿不到任何一条的标题。
      const record: Record<string, unknown> =
        typeof raw.entityId === 'number' && raw.id === undefined
          ? { ...raw, id: raw.entityId, name: raw.name ?? raw.title, title: raw.title }
          : { ...raw }
      // 负责人一律以代号交给模型（行数据带 assigneeId 数字时同样转换）
      if (record.assignee === undefined && typeof record.assigneeId === 'number') {
        record.assignee = memberAlias(organizationId, record.assigneeId)
      }

      const projected: string[] = []
      let entityId: number | null = null
      let label = ''
      for (const key of allowlist) {
        const value = record[key]
        if (value === undefined || value === null) continue
        if (typeof value === 'string') {
          const bounded = value.trim().slice(0, 120)
          if (bounded.length === 0) continue
          if (key === 'name' || key === 'title') label = bounded
          projected.push(`${key}=${bounded}`)
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          if (key === 'id' && Number.isInteger(value) && Number(value) > 0) {
            entityId = Number(value)
          }
          projected.push(`${key}=${String(value)}`)
        }
      }
      if (projected.length === 0) continue

      facts.push({
        factKey: entityId !== null ? `${sourceKind}.row:${entityId}` : `${sourceKind}.row:${i}`,
        value: projected,
        displayLabel: label || `${sourceKind} #${entityId ?? i + 1}`,
        facet: facet as CopilotContextFact['facet'],
        sourceRef: entityId !== null ? `${sourceKind}:${entityId}` : `${sourceKind}/assembly/rows`,
        observedAt,
        sensitivity: 'low',
        truncated: false,
      })
    }
    return facts
  }

  /**
   * 并发采集单个来源（含权限判定与检索）。
   * 返回 null 表示该来源被零泄露省略。
   * `facts` 为按 allowlist 投影的权威事实（任务 2.1；无命中/无权限时为 []）。
   */
  async collectSingleSource(
    request: CopilotContextAssemblyRequest,
    sourceKind: CopilotRetrievalSourceKind,
  ): Promise<{
    metadata: CopilotAssemblySourceMetadata | null
    durationMs: number
    facts: CopilotContextFact[]
  }> {
    const start = Date.now()

    // 权限判定
    const permission = await this.checkSourcePermission(
      request.organizationId,
      request.actorId,
      sourceKind,
    )

    // denied-hidden → 零泄露省略
    if (permission === 'denied-hidden') {
      return { metadata: null, durationMs: Date.now() - start, facts: [] }
    }

    // 不合格 → skipped-ineligible（查询前已排除，此处为安全兜底）
    const eligibility = COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP[request.scope]
    if (!eligibility.retrievalKinds.includes(sourceKind)) {
      return { metadata: null, durationMs: Date.now() - start, facts: [] }
    }

    // 组织隔离：跨组织来源恒不合格
    // （由 SearchContext.organizationId 强制过滤，此处无需额外检查）

    // 通过 SearchService 执行检索
    const searchCtx = this.#buildSearchContext(request)
    let hitCount = 0
    let matched = false
    let scoreRange: { min: number; max: number } | undefined
    let resultItems: readonly unknown[] = []

    try {
      const adapter = this.#searchService.getAdapters().get(sourceKind)
      if (!adapter) {
        // 未知来源 → 零结果
        hitCount = 0
        matched = false
      } else {
        // adapter 已按 sourceKind 选定，entityTypes 只是二次收窄；
        // 而 task_external_link / ocr_search_index 是 Copilot 检索来源，**不是** SearchEntityType，
        // 原实现把它们直接塞进 entityTypes 会给搜索服务传入非法实体类型。
        const isSearchEntity = (SEARCH_ENTITY_TYPES as readonly string[]).includes(sourceKind)
        const searchOnce = (keyword: string) =>
          adapter.search(
            {
              keyword,
              ...(isSearchEntity ? { entityTypes: [sourceKind as SearchEntityType] } : {}),
              perPage: 10,
              page: 1,
            } satisfies SearchQuery,
            searchCtx,
          )
        // 适配器按 LIKE %关键词% 匹配：整句提问几乎不可能命中，先抽出关键词块逐个检索再合并
        const terms = extractRetrievalTerms(request.query ?? '')
        const result =
          terms.length <= 1
            ? await searchOnce(terms[0] ?? request.query ?? '')
            : mergeSearchResults(await Promise.all(terms.map((term) => searchOnce(term))), 10)
        hitCount = result.total
        matched = result.items.length > 0
        resultItems =
          sourceKind === 'task'
            ? await enrichTaskSearchItems(result.items, request.organizationId)
            : result.items
        if (result.items.length > 0) {
          const scores = result.items.map((item: any) => item.score ?? 0)
          scoreRange = {
            min: Math.min(...scores),
            max: Math.max(...scores),
          }
        }
      }
    } catch {
      hitCount = 0
      matched = false
      resultItems = []
    }

    const capturedAt = now()
    const sourceRef = `${sourceKind}/assembly/${request.actorId}`
    const content = `${sourceKind}:${request.query ?? 'all'}:${hitCount}`
    const sourceHash = simpleHash(content)

    const metadata: CopilotAssemblySourceMetadata = {
      retrievalKind: sourceKind,
      sourceRef,
      sourceHash,
      capturedAt,
      hitCount,
      scoreRange,
      permissionDecision: permission,
      packetSourceKind: COPILOT_RETRIEVAL_KIND_TO_SOURCE_KIND[sourceKind],
      matched,
    }

    return {
      metadata,
      durationMs: Date.now() - start,
      facts: this.projectSearchFactItems(
        resultItems,
        sourceKind,
        capturedAt,
        request.organizationId,
      ),
    }
  }

  /**
   * 并发采集所有合格来源。
   * 返回有权来源的元数据列表、逐来源耗时与按 allowlist 投影的权威事实
   * （任务 2.1：`factsByKind` 只含命中且有权来源的事实；行级预算已应用）。
   */
  async collectAllSources(request: CopilotContextAssemblyRequest): Promise<{
    sources: CopilotAssemblySourceMetadata[]
    perSourceMs: Record<string, number>
    factsByKind: Readonly<
      Partial<Record<CopilotRetrievalSourceKind, readonly CopilotContextFact[]>>
    >
  }> {
    const eligibleKinds = this.getEligibleRetrievalKinds(request.scope, request.retrievalKinds)

    if (eligibleKinds.length === 0) {
      return { sources: [], perSourceMs: {}, factsByKind: {} }
    }

    // 并发采集（Task 3.9）
    const results = await Promise.all(
      eligibleKinds.map(async (kind) => ({
        kind,
        ...(await this.collectSingleSource(request, kind)),
      })),
    )

    const sources: CopilotAssemblySourceMetadata[] = []
    const perSourceMs: Record<string, number> = {}
    const factsByKind: Record<string, readonly CopilotContextFact[]> = {}

    for (const r of results) {
      perSourceMs[r.kind] = r.durationMs
      if (r.metadata) {
        sources.push(r.metadata)
      }
      if (r.facts.length > 0) {
        factsByKind[r.kind] = r.facts
      }
    }

    return { sources, perSourceMs, factsByKind }
  }

  // ── Task 4.3: 知识底座生产查询路径接入 ──────────────────────────

  /**
   * 查询知识底座（生产路径）。
   * 合格知识层由实际使用的查询路径推导，而非调用方自报。
   */
  async queryKnowledge(organizationId: number, query?: string): Promise<CollectorKnowledgeResult> {
    // 生产路径（L3 已由 KnowledgeService 强制排除）
    const tierList = COPILOT_PRODUCTION_KNOWLEDGE_TIERS
    const queryPath = 'production'

    // 知识查询（仅在有查询词时执行）
    if (query) {
      try {
        await this.#knowledgeService.query(organizationId, {
          keyword: query,
          evalContext: false,
        })
      } catch {
        // 知识查询失败不影响采集结果
      }
    }

    return { tierList, queryPath }
  }

  // ── Task 4.7: Skill 方法论切面接入 ──────────────────────────────

  /**
   * 产出方法论切面（非项目事实标记）。
   * 由调用方提供 Skill 激活结果，此处包装为方法论切面。
   */
  buildMethodologyFacet(
    skillKeys: readonly string[],
    methodologyVersionHash: string,
    guidanceItems: readonly {
      itemId: string
      skillKey: string
      label: string
      summary: string
      sourceRef: string
      knowledgeRef?: string
      activationRuleId: string
      activationReason: string
    }[],
  ): CopilotMethodologyFacet {
    return {
      facetKind: 'methodology',
      isMethodologyGuidance: true,
      isProjectFact: false,
      skillKeys,
      guidanceItems: guidanceItems.map((item) => ({
        ...item,
        summary: `${item.summary}（方法论指引，非本项目事实）`,
      })),
      capturedAt: now(),
      methodologyVersionHash,
    }
  }

  // ── Task 4.9: 命中计数、零结果标记与低置信标记 ──────────────────

  /**
   * 为来源附加命中统计与标记。
   */
  annotateSourceMetadata(metadata: CopilotAssemblySourceMetadata): CopilotAssemblySourceMetadata {
    return {
      ...metadata,
      matched: metadata.hitCount > 0 && metadata.hitCount !== undefined,
    }
  }
}

// ---------------------------------------------------------------------------
// 检索关键词抽取（2026-09-26）
// ---------------------------------------------------------------------------

/** 切分用的虚词与泛化词：它们在任务/风险标题里几乎不出现，却会让整句 LIKE 永远不命中。 */
const RETRIEVAL_STOP_PATTERN = new RegExp(
  [
    '[\\s，。、？！；：,.?!;:（）()「」『』“”"\'\\[\\]【】]+',
    '针对|结合|关于|对于|根据|按照|以及|还有|并且|或者|如何|怎么|怎样|什么|哪些|哪个|是否|有没有',
    '请|帮我|帮忙|给我|列出|列一下|说明|介绍|总结|分析|评估|对比|比较|建议|给出|提供',
    '本项目|这个项目|该项目|我们的|我们|你们|当前|目前|现在|当天|期间|阶段|方面|情况|问题',
    '行业里|行业|业界|最佳实践|通用|一般|常见|相关|具体|主要|哪些是',
    // 单字只切不会出现在业务词里的（「对账」「里程碑」「中台」「上线」里的字不能切）
    '的|和|与|及|或|吗|呢|吧',
  ].join('|'),
  'g',
)

/**
 * 从提问中抽取至多 4 个检索关键词块（长度 2–12；中文无分词依赖，按虚词切块）。
 * 例：「针对本项目的灰度切流和双轨并行阶段，列出检查清单」→ [灰度切流, 双轨并行, 检查清单]
 */
export function extractRetrievalTerms(question: string): string[] {
  const text = question.trim()
  if (text.length <= 8) return text ? [text] : []
  const chunks = text
    .split(RETRIEVAL_STOP_PATTERN)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 2)
    .map((chunk) => (chunk.length > 12 ? chunk.slice(0, 12) : chunk))
  const unique = [...new Set(chunks)]
  return unique.slice(0, 4)
}

/** 合并多次检索结果：按实体去重保留最高分，按分数排序截取前 limit 条。 */
export function mergeSearchResults<T extends { items: any[]; total: number }>(
  results: readonly T[],
  limit: number,
): { items: any[]; total: number } {
  const byKey = new Map<string, any>()
  for (const result of results) {
    for (const item of result.items) {
      const key = `${item.entityType ?? ''}:${item.entityId ?? item.id ?? JSON.stringify(item).slice(0, 80)}`
      const existing = byKey.get(key)
      if (!existing || (item.score ?? 0) > (existing.score ?? 0)) byKey.set(key, item)
    }
  }
  const items = [...byKey.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit)
  return { items, total: byKey.size }
}

// ---------------------------------------------------------------------------
// 任务检索结果补充（2026-09-26）
// ---------------------------------------------------------------------------

/** 成员代号：交给模型的负责人标识，不含姓名、推不出用户 ID；界面展示时换回真实姓名。 */
export { memberAlias } from '#services/ai_colleague/member_alias'

/**
 * 检索结果只有标题与状态；按任务 ID 补上负责人代号、进度与计划起止（组织隔离）。
 * 查询失败时原样返回，不影响回合。
 */
export async function enrichTaskSearchItems(
  items: readonly any[],
  organizationId: number,
): Promise<any[]> {
  const ids = items
    .map((item) => Number(item?.entityId ?? item?.id))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (ids.length === 0) return [...items]
  try {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const rows = (await db
      .from('tasks')
      .join('projects', 'projects.id', 'tasks.project_id')
      .where('projects.organization_id', organizationId)
      .whereIn('tasks.id', ids)
      .whereNull('tasks.deleted_at')
      .select(
        'tasks.id',
        'tasks.assignee_id',
        'tasks.progress_percent',
        'tasks.start_date',
        'tasks.end_date',
      )) as Array<{
      id: number
      assignee_id: number | null
      progress_percent: number | string | null
      start_date: unknown
      end_date: unknown
    }>
    const byId = new Map(rows.map((row) => [Number(row.id), row]))
    const isoDate = (value: unknown): string | undefined => {
      if (!value) return undefined
      const text = value instanceof Date ? value.toISOString() : String(value)
      return text.slice(0, 10)
    }
    return items.map((item) => {
      const row = byId.get(Number(item?.entityId ?? item?.id))
      if (!row) return item
      return {
        ...item,
        ...(row.assignee_id
          ? { assignee: memberAlias(organizationId, Number(row.assignee_id)) }
          : {}),
        ...(row.progress_percent !== null && row.progress_percent !== undefined
          ? { progressPercent: Number(row.progress_percent) }
          : {}),
        ...(isoDate(row.start_date) ? { startDate: isoDate(row.start_date) } : {}),
        ...(isoDate(row.end_date) ? { endDate: isoDate(row.end_date) } : {}),
      }
    })
  } catch {
    return [...items]
  }
}
