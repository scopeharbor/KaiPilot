/**
 * Document Intelligence Workbench — 只读聚合端口（v3-document-intelligence-workbench §3）
 *
 * 红线（design D2/D6）：
 * - 本接口只暴露 source-first 分页与 page-scoped bulk query；
 *   不向聚合器暴露任何 owning command 方法（run/retry/confirm/index/extract/
 *   link/export/cleanup/preview/save/supersede 等）——由类型与静态回归共同强制。
 * - 全部批量方法以「当前页的 sourceIds」为输入，禁止逐行 N+1 调用。
 * - 返回行均为低敏投影：无正文、无原始 provider payload、无 prompt/模型输出。
 */

/** 工作台来源行（native document 或 attachment 的低敏投影） */
export interface WorkbenchSourceRow {
  sourceKind: 'native_document' | 'attachment'
  sourceId: number
  displayName: string
  mimeType: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** OCR job 低敏投影 */
export interface WorkbenchJobRow {
  jobId: number
  sourceAttachmentId: number
  status: string
  warningCodes: string[]
  succeededPages: number | null
  pageCount: number | null
  provider: string | null
  costSummaryPresent: boolean
  createdAt: string
  updatedAt: string
}

/** accepted extraction 低敏引用（无正文） */
export interface WorkbenchExtractionRow {
  extractionId: number
  jobId: number | null
  sourceId: number
  lifecycle: 'current' | 'superseded'
  confirmedAt: string | null
}

/** 搜索索引条目低敏投影 */
export interface WorkbenchSearchIndexEntryRow {
  entryId: number
  extractionId: number | null
  sourceId: number
  status: string
  tombstonedAt: string | null
  updatedAt: string | null
}

/** 结构化快照低敏计数投影 */
export interface WorkbenchSnapshotSummaryRow {
  currentCount: number
  supersededCount: number
  latestCurrentSnapshotId: number | null
}

/** 实体关联 per-extraction 低敏摘要（page-scoped，不含标签正文） */
export interface WorkbenchEntityLinkSummaryRow {
  activeLinkCount: number
  supersededLinkCount: number
  /** 目标不可见/被隐藏而无法安全展示的确认链接数量 */
  hiddenTargetCount: number
  /** 所属 run 是否已被判定 stale（复用 owning run.status） */
  staleRun: boolean
}

/** 实体关联维度批量结果：失败时 available=false，绝不冒充零 */
export interface WorkbenchEntityLinkBulkResult {
  /** key = extractionId */
  rows: Map<number, WorkbenchEntityLinkSummaryRow>
  /** 无法安全解析时显式 unavailable，不冒充零 */
  available: boolean
}

/** 治理维度低敏摘要 */
export interface WorkbenchGovernanceSummary {
  /** 维度整体是否可用；false 时其余字段不得被当作事实 */
  available: boolean
  retentionHoldActive: boolean
  /** 已过保留期/待清除记录数（低敏计数，来自 shipped lifecycle classifier） */
  retentionExpiredCount: number
  privacyBlocked: boolean
  /** shipped privacy resolver 的全局输出模式（低敏枚举） */
  privacyOutputMode: string
  auditAccess: 'available' | 'restricted' | 'unavailable'
  profileProvenance: {
    identity: string
    version: string
    provenanceKind: 'builtin' | 'enabled_plugin' | 'organization_owned'
    status: 'active' | 'disabled' | 'invalid' | 'missing'
    receiptRef: string | null
  } | null
}

/**
 * 工作台唯一依赖边界。实现方必须保证：
 * 1) organization/project 双重过滤；2) 稳定排序；3) 批量 in-list 查询。
 */
export interface DocumentIntelligenceReadPorts {
  /**
   * 当前页可见来源（source-first 分页；total 来自 scoped count，不受行获取上限影响）。
   *
   * sourceKind / search 是数据库级 cheap filter；sort/direction 与共享纯函数
   * `sortDocumentIntelligenceSources` 使用同一比较器，保证跨页稳定且无重复/遗漏。
   */
  pageVisibleSources(params: {
    organizationId: number
    projectId: number
    page: number
    perPage: number
    sourceKind?: 'native_document' | 'attachment' | null
    search?: string | null
    sort?: 'updated_at' | 'created_at' | 'source_ref'
    direction?: 'asc' | 'desc'
  }): Promise<{ items: WorkbenchSourceRow[]; total: number }>

  /** 页内批量加载每个附件源的最新 OCR job（复用既有 updatedAt→createdAt→id 降序语义） */
  loadLatestJobsBySourceIds(params: {
    organizationId: number
    projectId: number
    sourceIds: number[]
  }): Promise<Map<number, WorkbenchJobRow>>

  /** 页内批量加载 current/superseded accepted extraction（按 sourceId 分组取最新） */
  loadExtractionsBySourceIds(params: {
    organizationId: number
    projectId: number
    sourceIds: number[]
  }): Promise<Map<number, WorkbenchExtractionRow>>

  /** 页内批量加载搜索索引条目摘要 */
  loadSearchIndexEntriesBySourceIds(params: {
    organizationId: number
    projectId: number
    sourceIds: number[]
  }): Promise<Map<number, WorkbenchSearchIndexEntryRow>>

  /** 按 extractionIds 批量加载结构化快照计数 */
  loadSnapshotSummariesByExtractionIds(params: {
    organizationId: number
    projectId: number
    extractionIds: number[]
  }): Promise<Map<number, WorkbenchSnapshotSummaryRow>>

  /** 按 extractionIds 批量加载实体关联确认摘要（page-scoped） */
  loadEntityLinkSummariesByExtractionIds(params: {
    organizationId: number
    projectId: number
    extractionIds: number[]
  }): Promise<WorkbenchEntityLinkBulkResult>

  /** 项目级治理摘要（retention/privacy/audit/profile provenance） */
  loadGovernanceSummary(params: {
    organizationId: number
    projectId: number
  }): Promise<WorkbenchGovernanceSummary>
}

/** 静态回归词表：禁止出现在 read ports 上的 owning command 方法名片段 */
export const FORBIDDEN_PORT_METHOD_FRAGMENTS = [
  'create',
  'retry',
  'confirm',
  'execute',
  'index_',
  '_index',
  'extract',
  'link_',
  '_link',
  'export',
  'cleanup',
  'preview',
  'save',
  'supersede',
  'reject',
  'uninstall',
  'drain',
  'cancel',
] as const

/** read ports 的封闭键集：任何额外函数属性都视为 owning command 注入 */
export const DOCUMENT_INTELLIGENCE_PORT_KEYS = [
  'pageVisibleSources',
  'loadLatestJobsBySourceIds',
  'loadExtractionsBySourceIds',
  'loadSearchIndexEntriesBySourceIds',
  'loadSnapshotSummariesByExtractionIds',
  'loadEntityLinkSummariesByExtractionIds',
  'loadGovernanceSummary',
] as const

/**
 * 运行时守卫：断言给定对象作为 read ports 实现不携带任何封闭键集之外的
 * 函数属性（即 owning command 注入）。与静态 excess-property 检查互补。
 */
export function assertNoOwningCommands(
  ports: object,
): { ok: true } | { ok: false; violations: string[] } {
  const violations: string[] = []
  for (const [key, value] of Object.entries(ports)) {
    if (
      !(DOCUMENT_INTELLIGENCE_PORT_KEYS as readonly string[]).includes(key) &&
      typeof value === 'function'
    ) {
      violations.push(key)
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
