/**
 * V3 Document Intelligence Workbench — 项目级文档智能工作台共享契约
 *
 * 服务端权威 read model 的封闭 DTO、维度状态词表、attention facet、
 * entrypoint 描述符、URL 状态契约与配套纯函数。
 *
 * 红线（见 openspec/changes/v3-document-intelligence-workbench/design.md）：
 * - 不复制任何 owning 领域状态机；只投影既有 current/superseded/stale 判定结果。
 * - 维度失败不得合成 false-zero / false-ready：unavailable/hidden/truncated 永远显式保留。
 * - entrypoint 只承载 opaque scoped refs 与宿主面板描述，不携带 callback、
 *   preview token、confirm handle 或可绕过 Policy 的授权材料。
 * - URL 只允许 allowlist 枚举值与 opaque 数字标识；文件名、正文、OCR 文本、
 *   hash、prompt、provider payload 一律禁止进入 URL。
 */

// ---------------------------------------------------------------------------
// 封闭枚举词表
// ---------------------------------------------------------------------------

/** 工作台来源类型：原生文档与可识别附件统一清单但不混淆能力 */
export const DOCUMENT_INTELLIGENCE_SOURCE_KINDS = ['native_document', 'attachment'] as const
export type DocumentIntelligenceSourceKind = (typeof DOCUMENT_INTELLIGENCE_SOURCE_KINDS)[number]

/** 聚合维度状态词表（design D6）。`not_applicable` 表示该源类型不具备此维度能力。 */
export const DOCUMENT_INTELLIGENCE_DIMENSION_STATES = [
  'ready',
  'empty',
  'unavailable',
  'hidden',
  'stale',
  'blocked',
  'truncated',
  'not_applicable',
] as const
export type DocumentIntelligenceDimensionState =
  (typeof DOCUMENT_INTELLIGENCE_DIMENSION_STATES)[number]

/** 聚合维度键 */
export const DOCUMENT_INTELLIGENCE_DIMENSIONS = [
  'ocr_job',
  'accepted_extraction',
  'search_index',
  'structured_snapshot',
  'entity_link',
  'governance',
] as const
export type DocumentIntelligenceDimension = (typeof DOCUMENT_INTELLIGENCE_DIMENSIONS)[number]

/** 各维度的状态快照 */
export type DocumentIntelligenceDimensionStates = Record<
  DocumentIntelligenceDimension,
  DocumentIntelligenceDimensionState
>

/** attention facets（spec：至少覆盖 review needed / processing / failed / stale / governance blocked / ready for downstream） */
export const DOCUMENT_INTELLIGENCE_ATTENTION_FACETS = [
  'needs_review',
  'processing',
  'failed',
  'stale',
  'governance_blocked',
  'ready_for_downstream',
] as const
export type DocumentIntelligenceAttentionFacet =
  (typeof DOCUMENT_INTELLIGENCE_ATTENTION_FACETS)[number]

/** 宿主面板 surface（design D3 封闭集合） */
export const DOCUMENT_INTELLIGENCE_SURFACES = [
  'review',
  'search_index',
  'structured_extraction',
  'entity_linking',
  'governance',
  'document_reader',
] as const
export type DocumentIntelligenceSurface = (typeof DOCUMENT_INTELLIGENCE_SURFACES)[number]

/** 低敏 reason code 词表 */
export const DOCUMENT_INTELLIGENCE_REASON_CODES = [
  'none',
  'permission_denied',
  'privacy_blocked',
  'retention_hold',
  'retention_expired',
  'lifecycle_superseded',
  'lifecycle_purged',
  'stale_source',
  'source_hidden',
  'unsupported_mime',
  'no_accepted_extraction',
  'dimension_failed',
  'truncated_by_budget',
  'audit_restricted',
  'profile_invalid',
  'profile_disabled',
  'unknown_surface',
] as const
export type DocumentIntelligenceReasonCode = (typeof DOCUMENT_INTELLIGENCE_REASON_CODES)[number]

/** 计数口径：exact = 全量精确；page = 仅当前页范围内统计（诚实标注，不冒充全量） */
export const DOCUMENT_INTELLIGENCE_COUNT_MODES = ['page', 'exact'] as const
export type DocumentIntelligenceCountMode = (typeof DOCUMENT_INTELLIGENCE_COUNT_MODES)[number]

/** 排序键 allowlist */
export const DOCUMENT_INTELLIGENCE_SORT_KEYS = ['updated_at', 'created_at', 'source_ref'] as const
export type DocumentIntelligenceSortKey = (typeof DOCUMENT_INTELLIGENCE_SORT_KEYS)[number]

export type DocumentIntelligenceSortDirection = 'asc' | 'desc'

/** 分页上界：超过即 VALIDATION_ERROR（Validator 层），此处为纯函数兜底 */
export const DOCUMENT_INTELLIGENCE_MAX_PER_PAGE = 100

// ---------------------------------------------------------------------------
// 类型守卫（fail-closed：未知值一律拒绝）
// ---------------------------------------------------------------------------

export function isDocumentIntelligenceSourceKind(
  value: unknown,
): value is DocumentIntelligenceSourceKind {
  return (
    typeof value === 'string' &&
    (DOCUMENT_INTELLIGENCE_SOURCE_KINDS as readonly string[]).includes(value)
  )
}

export function isDocumentIntelligenceDimensionState(
  value: unknown,
): value is DocumentIntelligenceDimensionState {
  return (
    typeof value === 'string' &&
    (DOCUMENT_INTELLIGENCE_DIMENSION_STATES as readonly string[]).includes(value)
  )
}

export function isDocumentIntelligenceAttentionFacet(
  value: unknown,
): value is DocumentIntelligenceAttentionFacet {
  return (
    typeof value === 'string' &&
    (DOCUMENT_INTELLIGENCE_ATTENTION_FACETS as readonly string[]).includes(value)
  )
}

export function isDocumentIntelligenceSurface(
  value: unknown,
): value is DocumentIntelligenceSurface {
  return (
    typeof value === 'string' &&
    (DOCUMENT_INTELLIGENCE_SURFACES as readonly string[]).includes(value)
  )
}

export function isDocumentIntelligenceReasonCode(
  value: unknown,
): value is DocumentIntelligenceReasonCode {
  return (
    typeof value === 'string' &&
    (DOCUMENT_INTELLIGENCE_REASON_CODES as readonly string[]).includes(value)
  )
}

export function isDocumentIntelligenceCountMode(
  value: unknown,
): value is DocumentIntelligenceCountMode {
  return (
    typeof value === 'string' &&
    (DOCUMENT_INTELLIGENCE_COUNT_MODES as readonly string[]).includes(value)
  )
}

export function isDocumentIntelligenceSortKey(
  value: unknown,
): value is DocumentIntelligenceSortKey {
  return (
    typeof value === 'string' &&
    (DOCUMENT_INTELLIGENCE_SORT_KEYS as readonly string[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// Entrypoint：宿主面板描述，不是新的写入抽象（design D3）
// ---------------------------------------------------------------------------

/** 确认归属的 owning capability（封闭映射；只读 surface 无确认归属） */
export const DOCUMENT_INTELLIGENCE_CONFIRMATION_OWNERS = {
  review: 'ocr-review-confirmation-flow',
  search_index: 'ocr-document-search-indexing',
  structured_extraction: 'ocr-structured-extraction',
  entity_linking: 'ocr-entity-linking',
  governance: null,
  document_reader: null,
} as const satisfies Record<DocumentIntelligenceSurface, string | null>

export type DocumentIntelligenceOwningCapability = string

/**
 * 解析 surface 的确认归属。未知 surface fail-closed 返回 null 并给出 unknown_surface。
 * 不接受 callback / preview token / confirm handle —— 它们不是本契约的一部分，
 * 由 TypeScript 结构保证（EntrypointDescriptor 无此类字段）。
 */
export function resolveConfirmationOwnedBy(surface: unknown): {
  ok: boolean
  owner: DocumentIntelligenceOwningCapability | null
  reasonCode: DocumentIntelligenceReasonCode
} {
  if (!isDocumentIntelligenceSurface(surface)) {
    return { ok: false, owner: null, reasonCode: 'unknown_surface' }
  }
  return { ok: true, owner: DOCUMENT_INTELLIGENCE_CONFIRMATION_OWNERS[surface], reasonCode: 'none' }
}

/** opaque scoped refs：仅数字/字符串 id 引用，不含内容字段 */
export interface DocumentIntelligenceEntrypointRefs {
  sourceKind: DocumentIntelligenceSourceKind
  sourceId: number
  /** 审查面板所需 job 引用（opaque） */
  jobId?: number
  /** 下游面板所需当前 accepted extraction 引用（opaque） */
  extractionId?: number
}

/** 宿主面板入口描述符 */
export interface DocumentIntelligenceEntrypointDescriptor {
  surface: DocumentIntelligenceSurface
  enabled: boolean
  /** enabled=false 时必填的低敏原因 */
  reasonCode: DocumentIntelligenceReasonCode | null
  refs: DocumentIntelligenceEntrypointRefs
  /** 该动作的确认由哪个 owning capability 执行；只读 surface 为 null */
  confirmationOwnedBy: DocumentIntelligenceOwningCapability | null
}

/**
 * 构造封闭 entrypoint。serverDenied=true 时强制 enabled=false 且带 reasonCode；
 * client 声明无法覆盖服务端裁决（spec Scenario: Client claims a forbidden action）。
 */
export function buildEntrypointDescriptor(params: {
  surface: DocumentIntelligenceSurface
  serverAllowed: boolean
  denialReasonCode?: DocumentIntelligenceReasonCode
  refs: DocumentIntelligenceEntrypointRefs
}): DocumentIntelligenceEntrypointDescriptor {
  const owned = resolveConfirmationOwnedBy(params.surface)
  const enabled = params.serverAllowed && owned.ok
  return {
    surface: params.surface,
    enabled,
    reasonCode: enabled ? null : (params.denialReasonCode ?? owned.reasonCode),
    refs: params.refs,
    confirmationOwnedBy: owned.owner,
  }
}

// ---------------------------------------------------------------------------
// 来源摘要 / 详情 DTO
// ---------------------------------------------------------------------------

/** 低敏 job 引用 */
export interface DocumentIntelligenceJobRef {
  jobId: number
  status: string
  createdAt: string
  succeededPages: number | null
  totalPages: number | null
}

/** 低敏 extraction 引用（无正文、无 hash 内容） */
export interface DocumentIntelligenceExtractionRef {
  extractionId: number
  lifecycle: 'current' | 'superseded'
  confirmedAt: string | null
}

/** 声明式 profile provenance（identity/version/source/status/receipt refs，无可执行内容） */
export interface DocumentIntelligenceProfileProvenance {
  identity: string
  version: string
  provenanceKind: 'builtin' | 'enabled_plugin' | 'organization_owned'
  status: 'active' | 'disabled' | 'invalid' | 'missing'
  receiptRef: string | null
}

/** 能力摘要（native document 与 attachment 各自独立归因） */
export interface DocumentIntelligenceCapabilitySummary {
  /** 原生文档正文是否可读（native_document 才可能为 true） */
  documentBodyReadable: boolean
  /** Markdown 导入/导出能力 */
  markdownReadable: boolean
  /** MIME 是否在既有 OCR 输入契约内 */
  ocrSupportedMime: boolean
  mimeType: string | null
}

/** 来源行摘要（列表响应单元） */
export interface DocumentIntelligenceSourceSummary {
  sourceKind: DocumentIntelligenceSourceKind
  sourceId: number
  /** 低敏显示名（隐藏源时为通用描述） */
  displayName: string
  capabilities: DocumentIntelligenceCapabilitySummary
  status: DocumentIntelligenceDimensionState
  attentionFacets: DocumentIntelligenceAttentionFacet[]
  dimensionStates: DocumentIntelligenceDimensionStates
  warningReasons: DocumentIntelligenceReasonCode[]
  latestJob: DocumentIntelligenceJobRef | null
  currentExtraction: DocumentIntelligenceExtractionRef | null
  entrypoints: DocumentIntelligenceEntrypointDescriptor[]
  profileProvenance: DocumentIntelligenceProfileProvenance | null
  updatedAt: string | null
  createdAt: string | null
}

/** 详情响应：证据与治理视图（仍低敏——hash 摘要/计数/时间戳/reason codes） */
export interface DocumentIntelligenceSourceDetail extends DocumentIntelligenceSourceSummary {
  evidence: {
    sourceHashPrefix: string | null
    jobCount: number | null
    extractionCount: number | null
    providerSummary: string | null
    costSummaryPresent: boolean
    freshness: { lastActivityAt: string | null }
    /**
     * 下游 receipt 的低敏计数视图。null 表示该维度不可用或不适用——
     * 绝不用 0 表示「读不到」（spec：Neighbor summary is unavailable）。
     */
    downstream: {
      searchIndexStatus: string | null
      structuredSnapshotCurrentCount: number | null
      structuredSnapshotSupersededCount: number | null
      entityLinkActiveCount: number | null
      entityLinkSupersededCount: number | null
      entityLinkHiddenTargetCount: number | null
    }
  }
  governance: {
    permissionDecision: DocumentIntelligenceDimensionState
    privacyStatus: DocumentIntelligenceDimensionState
    retentionHoldActive: boolean | null
    /** 过期/待清除/被 hold 阻断的记录数；null = 不可读，不是 0 */
    retentionExpiredCount: number | null
    auditAccess: 'available' | 'restricted' | 'unavailable'
    reasonCode: DocumentIntelligenceReasonCode
  }
}

/** 列表查询 filter/sort/page 契约 */
export interface DocumentIntelligenceListQuery {
  attention: DocumentIntelligenceAttentionFacet | null
  sourceKind: DocumentIntelligenceSourceKind | null
  capability: 'ocr_supported' | 'document_body' | null
  status: DocumentIntelligenceDimensionState | null
  sort: DocumentIntelligenceSortKey
  direction: DocumentIntelligenceSortDirection
  page: number
  perPage: number
  /** 有界搜索（长度上限在 Validator 强制；此处为类型契约） */
  search: string | null
}

/** 分页元数据（countMode 显式标注计数口径） */
export interface DocumentIntelligenceListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  countMode: DocumentIntelligenceCountMode
  /**
   * 扫描预算内无法覆盖全部匹配来源时为 true（显式截断标注）。
   * 只有它为 false 时 total 才代表完整匹配集大小。
   */
  scanTruncated: boolean
  /** countMode=page 时，facet 计数仅在当前页范围有效 */
  facetCounts: Partial<Record<DocumentIntelligenceAttentionFacet, number>>
}

export interface DocumentIntelligenceListResponse {
  data: DocumentIntelligenceSourceSummary[]
  meta: DocumentIntelligenceListMeta
}

/** 统一错误 envelope 的低敏错误体 */
export interface DocumentIntelligenceErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, string | number | boolean>
  }
}

// ---------------------------------------------------------------------------
// 纯函数：维度合并（禁止 false-zero / false-ready）
// ---------------------------------------------------------------------------

/**
 * 合并权威维度到来源总状态。
 * 规则（fail-closed）：
 * - 任一维度 hidden/blocked → 整体 blocked；
 * - 任一维度 truncated/unavailable → 整体 degraded 语义用 truncated/unavailable 表达（不降级为 empty）；
 * - 任一维度 stale → stale；
 * - 否则取「最有信息量」的非 not_applicable 维度（empty 优先于 ready 之前？不——ready 表示有可用产物）：
 *   存在 ready → ready；否则 empty；全部 not_applicable → not_applicable。
 */
const DIMENSION_SEVERITY: Record<DocumentIntelligenceDimensionState, number> = {
  blocked: 6,
  hidden: 5,
  truncated: 4,
  unavailable: 3,
  stale: 2,
  empty: 1,
  ready: 0,
  not_applicable: -1,
}

export function mergeDimensionStates(
  states: DocumentIntelligenceDimensionStates,
): DocumentIntelligenceDimensionState {
  const values = Object.values(states)
  // blocked / hidden 直接短路（信息最保守）
  if (values.includes('blocked')) return 'blocked'
  if (values.includes('hidden')) return 'hidden'
  if (values.includes('truncated')) return 'truncated'
  if (values.includes('unavailable')) return 'unavailable'
  if (values.includes('stale')) return 'stale'
  if (values.includes('ready')) return 'ready'
  if (values.includes('empty')) return 'empty'
  return 'not_applicable'
}

/** 按严重度比较两个维度状态（供排序/告警使用）；未知值视为最高严重度（fail-closed） */
export function compareDimensionSeverity(
  a: DocumentIntelligenceDimensionState,
  b: DocumentIntelligenceDimensionState,
): number {
  return (DIMENSION_SEVERITY[a] ?? 99) - (DIMENSION_SEVERITY[b] ?? 99)
}

// ---------------------------------------------------------------------------
// 纯函数：attention facet 派生
// ---------------------------------------------------------------------------

export function deriveAttentionFacets(params: {
  overall: DocumentIntelligenceDimensionState
  jobStatus: string | null
  hasCurrentAcceptedExtraction: boolean
  isStale: boolean
  governanceBlocked: boolean
  hasReadyDownstreamArtifact: boolean
}): DocumentIntelligenceAttentionFacet[] {
  const facets: DocumentIntelligenceAttentionFacet[] = []
  if (params.governanceBlocked) facets.push('governance_blocked')
  if (params.isStale) facets.push('stale')

  const s = params.jobStatus
  if (s === 'queued' || s === 'normalizing' || s === 'processing') facets.push('processing')
  if (s === 'failed' || s === 'canceled') facets.push('failed')
  if (s === 'reviewable' && !params.hasCurrentAcceptedExtraction) facets.push('needs_review')
  if (!s && !params.hasCurrentAcceptedExtraction && params.overall !== 'not_applicable') {
    // 支持附件但尚无作业：不算 needs_review（用户尚未发起），保持安静
  }

  if (params.hasCurrentAcceptedExtraction && params.hasReadyDownstreamArtifact) {
    facets.push('ready_for_downstream')
  }
  return facets
}

// ---------------------------------------------------------------------------
// 纯函数：稳定排序 / 有界分页 / countMode
// ---------------------------------------------------------------------------

function sourceRefCompare(
  a: Pick<DocumentIntelligenceSourceSummary, 'sourceKind' | 'sourceId'>,
  b: Pick<DocumentIntelligenceSourceSummary, 'sourceKind' | 'sourceId'>,
): number {
  if (a.sourceKind !== b.sourceKind) {
    return a.sourceKind.localeCompare(b.sourceKind)
  }
  return a.sourceId - b.sourceId
}

function timeValue(iso: string | null): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}

/** 稳定排序：主键 + sourceRef tie-breaker（同键同值时输出顺序确定） */
export function sortDocumentIntelligenceSources<
  T extends Pick<
    DocumentIntelligenceSourceSummary,
    'sourceKind' | 'sourceId' | 'createdAt' | 'updatedAt'
  >,
>(
  rows: readonly T[],
  key: DocumentIntelligenceSortKey,
  direction: DocumentIntelligenceSortDirection,
): T[] {
  const sign = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'updated_at':
        cmp = timeValue(a.updatedAt) - timeValue(b.updatedAt)
        break
      case 'created_at':
        cmp = timeValue(a.createdAt) - timeValue(b.createdAt)
        break
      case 'source_ref':
        cmp = 0
        break
    }
    if (cmp !== 0) return cmp * sign
    return sourceRefCompare(a, b)
  })
}

export interface DocumentIntelligencePageResult<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 有界分页：perPage 夹紧到 [1, MAX_PER_PAGE]，页号夹紧到 [1, totalPages]；无静默截断（total 来自全量） */
export function paginateDocumentIntelligence<T>(
  rows: readonly T[],
  page: number,
  perPage: number,
): DocumentIntelligencePageResult<T> {
  const safePerPage = Math.min(
    Math.max(Math.floor(perPage) || 1, 1),
    DOCUMENT_INTELLIGENCE_MAX_PER_PAGE,
  )
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / safePerPage))
  const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), totalPages)
  const start = (safePage - 1) * safePerPage
  return {
    data: rows.slice(start, start + safePerPage),
    meta: { total, page: safePage, perPage: safePerPage, totalPages },
  }
}

/**
 * countMode 语义：只有当调用方明确说明统计覆盖全量匹配集时才是 exact；
 * 页内统计必须诚实标注 page，绝不把页内计数冒充全量（spec：counts whose scope and truncation are explicit）。
 */
export function computeCountMode(params: {
  countsCoverFullMatchSet: boolean
}): DocumentIntelligenceCountMode {
  return params.countsCoverFullMatchSet ? 'exact' : 'page'
}

// ---------------------------------------------------------------------------
// 纯函数：URL 状态 parse / serialize / sanitize（design D4 allowlist 契约）
// ---------------------------------------------------------------------------

export const DOCUMENT_INTELLIGENCE_URL_VIEW = 'intelligence'

export const DOCUMENT_INTELLIGENCE_URL_KEYS = [
  'view',
  'attention',
  'source',
  'panel',
  'job',
  'extraction',
] as const

export interface DocumentIntelligenceUrlState {
  attention: DocumentIntelligenceAttentionFacet | null
  source: { kind: DocumentIntelligenceSourceKind; id: number } | null
  panel: DocumentIntelligenceSurface | null
  job: number | null
  extraction: number | null
}

export type DocumentIntelligenceUrlParseResult =
  { ok: true; state: DocumentIntelligenceUrlState } | { ok: false; reason: string }

/** 单值上限（防超长注入载荷） */
const URL_VALUE_MAX_LENGTH = 64
/** 正整数 id 的严格格式 */
const POSITIVE_INT_PATTERN = /^\d+$/

/** 注入模式：脚本/HTML/协议 URL/SQL 注释/控制字符等 */
const URL_INJECTION_PATTERNS: RegExp[] = [
  /<[^>]*>/,
  /javascript:/i,
  /data:/i,
  /vbscript:/i,
  /on\w+\s*=/i,
  /--/,
  /[;'"`\\]/,
  /[\u0000-\u001f\u007f]/,
]

function rejectableUrlValue(value: string): boolean {
  if (value.length > URL_VALUE_MAX_LENGTH) return true
  return URL_INJECTION_PATTERNS.some((p) => p.test(value))
}

/**
 * 解析 workbench URL 参数（严格 allowlist）。
 * - 只接受 DOCUMENT_INTELLIGENCE_URL_KEYS 内的键；出现未知键整体拒绝（fail closed）。
 * - view 若存在必须是 'intelligence'。
 * - source 格式 `<kind>:<positive-int>`；job/extraction 必须是正整数。
 * - 文件名/正文/OCR 文本/hash/prompt/provider payload 无处安放——它们不是合法键或值。
 */
export function parseIntelligenceUrlState(
  params: Record<string, string | string[] | undefined>,
): DocumentIntelligenceUrlParseResult {
  for (const key of Object.keys(params)) {
    if (!(DOCUMENT_INTELLIGENCE_URL_KEYS as readonly string[]).includes(key)) {
      return { ok: false, reason: `unknown_url_key:${key}` }
    }
  }

  const pick = (key: string): string | null => {
    const v = params[key]
    if (v === undefined) return null
    const single = Array.isArray(v) ? v[0] : v
    return single ?? null
  }

  const view = pick('view')
  if (view !== null && view !== DOCUMENT_INTELLIGENCE_URL_VIEW) {
    return { ok: false, reason: `invalid_view:${view.slice(0, URL_VALUE_MAX_LENGTH)}` }
  }

  const state: DocumentIntelligenceUrlState = {
    attention: null,
    source: null,
    panel: null,
    job: null,
    extraction: null,
  }

  const attention = pick('attention')
  if (attention !== null) {
    if (rejectableUrlValue(attention) || !isDocumentIntelligenceAttentionFacet(attention)) {
      return { ok: false, reason: 'invalid_attention' }
    }
    state.attention = attention
  }

  const source = pick('source')
  if (source !== null) {
    if (rejectableUrlValue(source)) return { ok: false, reason: 'invalid_source' }
    const idx = source.indexOf(':')
    if (idx <= 0) return { ok: false, reason: 'invalid_source_format' }
    const kind = source.slice(0, idx)
    const idRaw = source.slice(idx + 1)
    if (!isDocumentIntelligenceSourceKind(kind)) return { ok: false, reason: 'invalid_source_kind' }
    if (!POSITIVE_INT_PATTERN.test(idRaw) || idRaw.length > 15) {
      return { ok: false, reason: 'invalid_source_id' }
    }
    const id = Number(idRaw)
    if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== idRaw.replace(/^0+(?=\d)/, '')) {
      return { ok: false, reason: 'invalid_source_id' }
    }
    state.source = { kind, id }
  }

  const panel = pick('panel')
  if (panel !== null) {
    if (rejectableUrlValue(panel) || !isDocumentIntelligenceSurface(panel)) {
      return { ok: false, reason: 'invalid_panel' }
    }
    state.panel = panel
  }

  const intOf = (raw: string | null): number | { bad: true } => {
    if (raw === null) return 0
    if (rejectableUrlValue(raw)) return { bad: true }
    if (!POSITIVE_INT_PATTERN.test(raw) || raw.length > 15) return { bad: true }
    const n = Number(raw)
    if (!Number.isSafeInteger(n) || n <= 0) return { bad: true }
    return n
  }

  const job = intOf(pick('job'))
  if (job === 0) {
    state.job = null
  } else if (typeof job === 'number') {
    state.job = job
  } else {
    return { ok: false, reason: 'invalid_job_id' }
  }

  const extraction = intOf(pick('extraction'))
  if (extraction === 0) {
    state.extraction = null
  } else if (typeof extraction === 'number') {
    state.extraction = extraction
  } else {
    return { ok: false, reason: 'invalid_extraction_id' }
  }

  return { ok: true, state }
}

/** 序列化：仅输出有值的 allowlist 键；空 state 输出空串 */
export function serializeIntelligenceUrlState(state: DocumentIntelligenceUrlState): string {
  const usp = new URLSearchParams()
  usp.set('view', DOCUMENT_INTELLIGENCE_URL_VIEW)
  if (state.attention) usp.set('attention', state.attention)
  if (state.source) usp.set('source', `${state.source.kind}:${state.source.id}`)
  if (state.panel) usp.set('panel', state.panel)
  if (state.job !== null) usp.set('job', String(state.job))
  if (state.extraction !== null) usp.set('extraction', String(state.extraction))
  return usp.toString()
}

/**
 * sanitize：对来自外部的任意对象做防御性清洗——
 * 非 allowlist 键直接丢弃并返回被拒绝键列表（不抛异常，用于 UI 兜底展示安全态）。
 */
export function sanitizeIntelligenceUrlParams(
  params: Record<string, string | string[] | undefined>,
): { cleaned: Record<string, string>; rejectedKeys: string[] } {
  const cleaned: Record<string, string> = {}
  const rejectedKeys: string[] = []
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value
    if (single === undefined) continue
    if (
      (DOCUMENT_INTELLIGENCE_URL_KEYS as readonly string[]).includes(key) &&
      !rejectableUrlValue(single)
    ) {
      cleaned[key] = single
    } else {
      rejectedKeys.push(key)
    }
  }
  return { cleaned, rejectedKeys }
}

// ---------------------------------------------------------------------------
// 纯函数：低敏扫描（fixture/DTO/error/telemetry 共享守卫）
// ---------------------------------------------------------------------------

/** 禁止出现的键名片段（不区分大小写） */
const PROHIBITED_KEY_FRAGMENTS = [
  'prompt',
  'secret',
  'password',
  'authorization',
  'apikey',
  'api_key',
  'token',
  'extractedtext',
  'acceptedtext',
  'candidatetext',
  'rawresponse',
  'modeloutput',
  'requestbody',
  'responsebody',
]

/** 值形态黑名单：绝对路径 / Bearer / 长文本启发（>400 字符视为疑似全文） */
const ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:\\|\/(?:home|Users|var|etc|tmp|root)\/)/
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/i

export interface LowSensitiveFinding {
  path: string
  kind: 'prohibited_key' | 'absolute_path' | 'bearer_token' | 'suspected_long_text'
}

/**
 * 递归扫描任意 JSON 可序列化载荷，报告潜在敏感泄漏。
 * 用于共享测试断言 DTO/URL/error/telemetry fixture 不含全文、原始 provider
 * payload、prompt/模型输出、secret/token/Authorization 或绝对路径。
 */
export function scanLowSensitive(
  payload: unknown,
  basePath = '$',
  depth = 0,
): LowSensitiveFinding[] {
  const findings: LowSensitiveFinding[] = []
  if (depth > 12) return findings
  if (payload === null || payload === undefined) return findings

  if (Array.isArray(payload)) {
    payload.forEach((item, i) => {
      findings.push(...scanLowSensitive(item, `${basePath}[${i}]`, depth + 1))
    })
    return findings
  }

  if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const path = `${basePath}.${key}`
      if (
        PROHIBITED_KEY_FRAGMENTS.some((f) =>
          key
            .toLowerCase()
            .replace(/[-_\s]/g, '')
            .includes(f),
        )
      ) {
        findings.push({ path, kind: 'prohibited_key' })
        // 不跳过值：值形态（Bearer/绝对路径/长文本）同样要报告
      }
      findings.push(...scanLowSensitive(value, path, depth + 1))
    }
    return findings
  }

  if (typeof payload === 'string') {
    if (ABSOLUTE_PATH_PATTERN.test(payload)) {
      findings.push({ path: basePath, kind: 'absolute_path' })
    }
    if (BEARER_PATTERN.test(payload)) {
      findings.push({ path: basePath, kind: 'bearer_token' })
    }
    if (payload.length > 400) {
      findings.push({ path: basePath, kind: 'suspected_long_text' })
    }
  }

  return findings
}
