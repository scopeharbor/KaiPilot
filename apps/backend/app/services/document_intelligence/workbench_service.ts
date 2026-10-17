/**
 * DocumentIntelligenceWorkbenchService — 项目级文档智能工作台只读聚合器
 *
 * 职责（design D1/D2/D6）：
 * - 以 read ports 批量投影来源、OCR job、accepted extraction、downstream 与治理维度，
 *   Map-based 线性合并为封闭 DTO；禁止逐行 N+1 依赖调用。
 * - 核心来源查询失败 fail closed；非关键维度失败单独降级（显式 unavailable），
 *   绝不合成 false-zero / false-ready。
 * - entrypoint 由服务端裁决生成；client 声明无法覆盖（spec：Client claims forbidden action）。
 * - 零写入、零 provider、零公网：本服务不注入任何 owning command 方法。
 */

import {
  DOCUMENT_INTELLIGENCE_MAX_PER_PAGE,
  buildEntrypointDescriptor,
  deriveAttentionFacets,
  mergeDimensionStates,
  computeCountMode,
  sortDocumentIntelligenceSources,
  paginateDocumentIntelligence,
  isOcrSupportedMime,
  type DocumentIntelligenceSourceSummary,
  type DocumentIntelligenceSourceDetail,
  type DocumentIntelligenceListQuery,
  type DocumentIntelligenceListResponse,
  type DocumentIntelligenceDimensionState,
  type DocumentIntelligenceDimensionStates,
  type DocumentIntelligenceReasonCode,
} from '@aiproj/types'
import type {
  DocumentIntelligenceReadPorts,
  WorkbenchEntityLinkSummaryRow,
  WorkbenchExtractionRow,
  WorkbenchGovernanceSummary,
  WorkbenchJobRow,
  WorkbenchSearchIndexEntryRow,
  WorkbenchSnapshotSummaryRow,
  WorkbenchSourceRow,
} from './read_ports.js'

/** 页内扫描预算：attention/status 过滤最多在预算内精确计算，超出诚实降级为 page 口径 */
export const WORKBENCH_SCAN_BUDGET = 1000

/** 服务端权限裁决输入（由 Controller/Policy 计算后传入，client 不可伪造） */
export interface WorkbenchAccessDecisions {
  /** 只读用户：仅 document_reader/governance 可用 */
  readOnly: boolean
  /** 可管理文件（file:manage）：owning 写入面板的入口资格 */
  canManageFiles: boolean
  /** 可读 OCR 审计明细（ocr audit 权限），不足时治理视图显示 restricted */
  canReadAudit: boolean
}

/** OCR job 处理中的权威状态集合（复用 owning 状态机词表，不改判） */
const PROCESSING_STATUSES = new Set(['queued', 'normalizing', 'processing'])
/** OCR job 终态失败集合 */
const FAILED_STATUSES = new Set(['failed', 'canceled'])

function mapJobDimension(
  job: WorkbenchJobRow | undefined,
  sourceKind: string,
): DocumentIntelligenceDimensionState {
  if (sourceKind !== 'attachment') return 'not_applicable'
  if (!job) return 'empty'
  if (FAILED_STATUSES.has(job.status)) return 'unavailable'
  if (job.warningCodes.includes('STALE_SOURCE')) return 'stale'
  if (PROCESSING_STATUSES.has(job.status)) return 'empty' // 尚无产物，但非失败
  return 'ready'
}

function mapExtractionDimension(
  lifecycle: 'current' | 'superseded' | undefined,
  sourceKind: string,
): DocumentIntelligenceDimensionState {
  if (sourceKind !== 'attachment') return 'not_applicable'
  if (!lifecycle) return 'empty'
  return lifecycle === 'current' ? 'ready' : 'stale'
}

function mapSearchIndexDimension(
  entry: WorkbenchSearchIndexEntryRow | undefined,
  sourceKind: string,
): DocumentIntelligenceDimensionState {
  if (sourceKind !== 'attachment') return 'not_applicable'
  if (!entry) return 'empty'
  if (entry.tombstonedAt || entry.status === 'tombstoned') return 'blocked'
  return entry.status === 'active' ? 'ready' : 'empty'
}

function mapSnapshotDimension(
  extraction: WorkbenchExtractionRow | undefined,
  snapshot: WorkbenchSnapshotSummaryRow | undefined,
  sourceKind: string,
): DocumentIntelligenceDimensionState {
  if (sourceKind !== 'attachment') return 'not_applicable'
  if (!extraction) return 'empty'
  if ((snapshot?.currentCount ?? 0) > 0) return 'ready'
  if ((snapshot?.supersededCount ?? 0) > 0) return 'stale'
  return 'empty'
}

function mapEntityLinkDimension(
  available: boolean,
  extraction: WorkbenchExtractionRow | undefined,
  row: WorkbenchEntityLinkSummaryRow | undefined,
  sourceKind: string,
): DocumentIntelligenceDimensionState {
  if (sourceKind !== 'attachment') return 'not_applicable'
  // 维度整体读取失败 → 显式 unavailable（不冒充零）
  if (!available) return 'unavailable'
  if (!extraction) return 'empty'
  if (!row) return 'empty'
  if (row.hiddenTargetCount > 0) return 'blocked'
  if (row.staleRun) return 'stale'
  return row.activeLinkCount > 0 ? 'ready' : 'empty'
}

function mapGovernanceDimension(
  governance: WorkbenchGovernanceSummary,
): DocumentIntelligenceDimensionState {
  if (!governance.available) return 'unavailable'
  if (governance.privacyBlocked || governance.retentionHoldActive) return 'blocked'
  return 'ready'
}

/** 合并后的单源维度输入 */
interface SourceDimensionInput {
  row: WorkbenchSourceRow
  job?: WorkbenchJobRow
  extraction?: WorkbenchExtractionRow
  indexEntry?: WorkbenchSearchIndexEntryRow
  snapshot?: WorkbenchSnapshotSummaryRow
  entityLink?: WorkbenchEntityLinkSummaryRow
  entityLinkAvailable: boolean
  governance: WorkbenchGovernanceSummary
  access: WorkbenchAccessDecisions
}

export default class DocumentIntelligenceWorkbenchService {
  constructor(private readonly ports: DocumentIntelligenceReadPorts) {}

  /**
   * 来源清单：source-first 分页 + page-scoped 批量加载 + Map 线性合并。
   * attention/status 过滤在扫描预算内精确计算，超预算时 facet counts 诚实标注 page 口径。
   */
  async listSources(params: {
    organizationId: number
    projectId: number
    query: DocumentIntelligenceListQuery
    access: WorkbenchAccessDecisions
  }): Promise<DocumentIntelligenceListResponse> {
    const { organizationId, projectId, query } = params

    // 依赖维度数据的过滤条件必须先扫描才能判定；纯来源属性过滤可下推到 DB。
    const needsDimensionScan = Boolean(query.attention || query.status || query.capability)
    const cheapFilters = {
      sourceKind: query.sourceKind,
      search: query.search,
      sort: query.sort,
      direction: query.direction,
    }

    // 1) source-first 分页：先按扫描预算探一次，拿到权威 total
    //    （核心来源查询失败即 fail closed，由 Controller 转统一错误 envelope）
    const probe = await this.ports.pageVisibleSources({
      organizationId,
      projectId,
      page: 1,
      perPage: WORKBENCH_SCAN_BUDGET,
      ...cheapFilters,
    })

    const withinBudget = probe.total <= WORKBENCH_SCAN_BUDGET

    // 2) 选择行集合：
    //    - 预算内：整套匹配来源都可扫描 → 精确 total 与精确 facet 计数
    //    - 超预算且无维度过滤：直接取请求页（DB 级 source-first 分页，零截断）
    //    - 超预算且有维度过滤：只能扫描预算窗口 → 显式标注 scanTruncated
    let rows = probe.items
    let dbPagedTotal: number | null = null
    // Validator 已在 HTTP 层拒绝无界 perPage；这里再夹一次，保证 Service 被直接
    // 调用（测试/内部复用）时同样不会发出无界页请求（fail closed 的第二道）。
    const safePerPage = Math.min(
      Math.max(Math.floor(query.perPage) || 1, 1),
      DOCUMENT_INTELLIGENCE_MAX_PER_PAGE,
    )
    const safePage = Math.max(Math.floor(query.page) || 1, 1)
    if (!withinBudget && !needsDimensionScan) {
      const pageResult = await this.ports.pageVisibleSources({
        organizationId,
        projectId,
        page: safePage,
        perPage: safePerPage,
        ...cheapFilters,
      })
      rows = pageResult.items
      dbPagedTotal = pageResult.total
    }

    // 3) 维度批量加载（常数族数，与页内行数同阶）
    const merged = await this.#loadDimensions({
      organizationId,
      projectId,
      rows,
      access: params.access,
    })
    const summaries = merged.inputs.map((input) => this.#buildSummary(input))

    // 4) 维度依赖过滤（capability 需要 MIME 能力判定，与 attention/status 同属扫描过滤）
    let filtered = summaries
    if (query.capability === 'ocr_supported') {
      filtered = filtered.filter((s) => s.capabilities.ocrSupportedMime)
    } else if (query.capability === 'document_body') {
      filtered = filtered.filter((s) => s.capabilities.documentBodyReadable)
    }
    if (query.attention) {
      filtered = filtered.filter((s) => s.attentionFacets.includes(query.attention!))
    }
    if (query.status) {
      filtered = filtered.filter((s) => s.status === query.status)
    }

    // 5) DB 已分页的分支不再二次切片；其余分支稳定排序后有界分页
    const sorted = sortDocumentIntelligenceSources(filtered, query.sort, query.direction)
    const page =
      dbPagedTotal !== null
        ? {
            data: sorted,
            meta: {
              total: dbPagedTotal,
              page: safePage,
              perPage: safePerPage,
              totalPages: Math.max(1, Math.ceil(dbPagedTotal / safePerPage)),
            },
          }
        : paginateDocumentIntelligence(sorted, query.page, query.perPage)

    // 6) 计数口径诚实标注：只有整套匹配集都被扫描过才是 exact
    const countsCoverFullMatchSet = withinBudget
    const facetSource = countsCoverFullMatchSet ? filtered : page.data
    const facetCounts: Partial<Record<string, number>> = {}
    for (const summary of facetSource) {
      for (const facet of summary.attentionFacets) {
        facetCounts[facet] = (facetCounts[facet] ?? 0) + 1
      }
    }

    return {
      data: page.data,
      meta: {
        total: page.meta.total,
        page: page.meta.page,
        perPage: page.meta.perPage,
        totalPages: page.meta.totalPages,
        countMode: computeCountMode({ countsCoverFullMatchSet }),
        scanTruncated: !withinBudget && needsDimensionScan,
        facetCounts,
      },
    }
  }

  /** 详情：按源重新验证 visibility/current refs/permission，深链恢复的服务端权威。 */
  async getSourceDetail(params: {
    organizationId: number
    projectId: number
    sourceKind: 'native_document' | 'attachment'
    sourceId: number
    access: WorkbenchAccessDecisions
  }): Promise<{ found: true; data: DocumentIntelligenceSourceDetail } | { found: false }> {
    const { organizationId, projectId } = params

    const paged = await this.ports.pageVisibleSources({
      organizationId,
      projectId,
      page: 1,
      perPage: WORKBENCH_SCAN_BUDGET,
    })
    const row = paged.items.find(
      (r) => r.sourceKind === params.sourceKind && r.sourceId === params.sourceId,
    )
    // deleted / hidden / cross-project / 不存在 → 统一 not found（不泄露存在性差异）
    if (!row) return { found: false }

    const merged = await this.#loadDimensions({
      organizationId,
      projectId,
      rows: [row],
      access: params.access,
    })
    const input = merged.inputs[0]!
    const summary = this.#buildSummary(input)

    const governanceState = mapGovernanceDimension(input.governance)
    const governanceReadable = input.governance.available

    return {
      found: true,
      data: {
        ...summary,
        evidence: {
          sourceHashPrefix: null, // 低敏：hash 前缀仅在授权审计路径提供
          jobCount: input.job ? 1 : 0,
          extractionCount: input.extraction ? 1 : 0,
          providerSummary: input.job?.provider ?? null,
          costSummaryPresent: input.job?.costSummaryPresent ?? false,
          freshness: { lastActivityAt: row.updatedAt ?? row.createdAt },
          downstream: {
            searchIndexStatus: input.indexEntry?.status ?? null,
            structuredSnapshotCurrentCount: input.snapshot?.currentCount ?? null,
            structuredSnapshotSupersededCount: input.snapshot?.supersededCount ?? null,
            // 维度不可用时保持 null —— 绝不用 0 表示「读不到」
            entityLinkActiveCount: input.entityLinkAvailable
              ? (input.entityLink?.activeLinkCount ?? 0)
              : null,
            entityLinkSupersededCount: input.entityLinkAvailable
              ? (input.entityLink?.supersededLinkCount ?? 0)
              : null,
            entityLinkHiddenTargetCount: input.entityLinkAvailable
              ? (input.entityLink?.hiddenTargetCount ?? 0)
              : null,
          },
        },
        governance: {
          permissionDecision: params.access.canManageFiles ? 'ready' : 'blocked',
          privacyStatus: !governanceReadable
            ? 'unavailable'
            : input.governance.privacyBlocked
              ? 'blocked'
              : 'ready',
          retentionHoldActive: governanceReadable ? input.governance.retentionHoldActive : null,
          retentionExpiredCount: governanceReadable ? input.governance.retentionExpiredCount : null,
          auditAccess: !governanceReadable
            ? 'unavailable'
            : params.access.canReadAudit
              ? 'available'
              : 'restricted',
          reasonCode: this.#governanceReasonCode(input.governance, governanceState, params.access),
        },
      },
    }
  }

  /**
   * 页内批量加载全部维度并组装为逐行输入。
   *
   * 常数级依赖调用族数：source ×1、job ×1、extraction ×1、index ×1、snapshot ×1、
   * entity-link ×1、governance ×1 —— 与行数无关（禁止 N+1）。
   */
  async #loadDimensions(params: {
    organizationId: number
    projectId: number
    rows: WorkbenchSourceRow[]
    access: WorkbenchAccessDecisions
  }): Promise<{ inputs: SourceDimensionInput[] }> {
    const { organizationId, projectId, rows } = params
    const attachmentIds = rows.filter((r) => r.sourceKind === 'attachment').map((r) => r.sourceId)

    const [jobMap, extractionMap, indexMap] = await Promise.all([
      this.ports.loadLatestJobsBySourceIds({ organizationId, projectId, sourceIds: attachmentIds }),
      this.ports.loadExtractionsBySourceIds({
        organizationId,
        projectId,
        sourceIds: attachmentIds,
      }),
      this.ports.loadSearchIndexEntriesBySourceIds({
        organizationId,
        projectId,
        sourceIds: attachmentIds,
      }),
    ])

    const extractionIds = [...extractionMap.values()].map((e) => e.extractionId)
    const [snapshotMap, entityLinkResult, governance] = await Promise.all([
      this.ports.loadSnapshotSummariesByExtractionIds({
        organizationId,
        projectId,
        extractionIds,
      }),
      this.ports.loadEntityLinkSummariesByExtractionIds({
        organizationId,
        projectId,
        extractionIds,
      }),
      this.ports.loadGovernanceSummary({ organizationId, projectId }),
    ])

    const inputs = rows.map((row) => {
      const extraction = extractionMap.get(row.sourceId)
      return {
        row,
        job: jobMap.get(row.sourceId),
        extraction,
        indexEntry: indexMap.get(row.sourceId),
        snapshot: extraction ? snapshotMap.get(extraction.extractionId) : undefined,
        entityLink: extraction ? entityLinkResult.rows.get(extraction.extractionId) : undefined,
        entityLinkAvailable: entityLinkResult.available,
        governance,
        access: params.access,
      }
    })
    return { inputs }
  }

  /** 治理维度的低敏 reason code（保持单一、非泄露） */
  #governanceReasonCode(
    governance: WorkbenchGovernanceSummary,
    state: DocumentIntelligenceDimensionState,
    access: WorkbenchAccessDecisions,
  ): DocumentIntelligenceReasonCode {
    if (state === 'unavailable') return 'dimension_failed'
    if (governance.privacyBlocked) return 'privacy_blocked'
    if (governance.retentionHoldActive) return 'retention_hold'
    if (governance.profileProvenance?.status === 'invalid') return 'profile_invalid'
    if (governance.profileProvenance?.status === 'disabled') return 'profile_disabled'
    if (!access.canReadAudit) return 'audit_restricted'
    return 'none'
  }

  #buildSummary(args: SourceDimensionInput): DocumentIntelligenceSourceSummary {
    const { row, job, extraction, indexEntry, snapshot, entityLink, governance, access } = args

    const dimensionStates: DocumentIntelligenceDimensionStates = {
      ocr_job: mapJobDimension(job, row.sourceKind),
      accepted_extraction: mapExtractionDimension(extraction?.lifecycle, row.sourceKind),
      search_index: mapSearchIndexDimension(indexEntry, row.sourceKind),
      structured_snapshot: mapSnapshotDimension(extraction, snapshot, row.sourceKind),
      entity_link: mapEntityLinkDimension(
        args.entityLinkAvailable,
        extraction,
        entityLink,
        row.sourceKind,
      ),
      governance: mapGovernanceDimension(governance),
    }

    const overall = mergeDimensionStates(dimensionStates)
    const isStale =
      dimensionStates.ocr_job === 'stale' || dimensionStates.accepted_extraction === 'stale'
    const governanceBlocked = dimensionStates.governance === 'blocked'
    const hasCurrentAccepted = extraction?.lifecycle === 'current'
    const hasReadyDownstream =
      dimensionStates.search_index === 'ready' ||
      dimensionStates.structured_snapshot === 'ready' ||
      dimensionStates.entity_link === 'ready'

    const attentionFacets = deriveAttentionFacets({
      overall,
      jobStatus: job?.status ?? null,
      hasCurrentAcceptedExtraction: hasCurrentAccepted,
      isStale,
      governanceBlocked,
      hasReadyDownstreamArtifact: hasReadyDownstream,
    })

    const warningReasons: DocumentIntelligenceReasonCode[] = []
    if (isStale) warningReasons.push('stale_source')
    if (governance.privacyBlocked) warningReasons.push('privacy_blocked')
    if (governance.retentionHoldActive) warningReasons.push('retention_hold')
    if (dimensionStates.ocr_job === 'unavailable') warningReasons.push('dimension_failed')
    if (dimensionStates.entity_link === 'unavailable') warningReasons.push('dimension_failed')
    if (dimensionStates.governance === 'unavailable') warningReasons.push('dimension_failed')
    if (dimensionStates.search_index === 'blocked') warningReasons.push('lifecycle_purged')
    if (dimensionStates.entity_link === 'blocked') warningReasons.push('source_hidden')
    if (row.sourceKind === 'attachment' && !isOcrSupportedMime(row.mimeType)) {
      warningReasons.push('unsupported_mime')
    }
    if (governance.profileProvenance?.status === 'invalid') warningReasons.push('profile_invalid')
    if (governance.profileProvenance?.status === 'disabled') warningReasons.push('profile_disabled')

    const refs = {
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      ...(job && row.sourceKind === 'attachment' ? { jobId: job.jobId } : {}),
      ...(hasCurrentAccepted && extraction ? { extractionId: extraction.extractionId } : {}),
    }

    // 不支持 MIME 的附件：不暴露任何 OCR create/retry/review/downstream 入口
    const ocrCapable = row.sourceKind === 'attachment' && isOcrSupportedMime(row.mimeType)
    const canOpenOwningPanels =
      access.canManageFiles && !access.readOnly && !governanceBlocked && ocrCapable

    const entrypoints = [
      buildEntrypointDescriptor({
        surface: 'review',
        serverAllowed: canOpenOwningPanels && !!job && (job.status === 'reviewable' || isStale),
        denialReasonCode: !ocrCapable
          ? 'unsupported_mime'
          : governanceBlocked
            ? 'privacy_blocked'
            : !job
              ? 'no_accepted_extraction'
              : 'permission_denied',
        refs,
      }),
      buildEntrypointDescriptor({
        surface: 'search_index',
        serverAllowed: canOpenOwningPanels && hasCurrentAccepted,
        denialReasonCode: !ocrCapable
          ? 'unsupported_mime'
          : governanceBlocked
            ? 'privacy_blocked'
            : hasCurrentAccepted
              ? 'permission_denied'
              : 'no_accepted_extraction',
        refs,
      }),
      buildEntrypointDescriptor({
        surface: 'structured_extraction',
        serverAllowed: canOpenOwningPanels && hasCurrentAccepted,
        denialReasonCode: !ocrCapable
          ? 'unsupported_mime'
          : governanceBlocked
            ? 'privacy_blocked'
            : hasCurrentAccepted
              ? 'permission_denied'
              : 'no_accepted_extraction',
        refs,
      }),
      buildEntrypointDescriptor({
        surface: 'entity_linking',
        serverAllowed: canOpenOwningPanels && hasCurrentAccepted,
        denialReasonCode: !ocrCapable
          ? 'unsupported_mime'
          : governanceBlocked
            ? 'privacy_blocked'
            : hasCurrentAccepted
              ? 'permission_denied'
              : 'no_accepted_extraction',
        refs,
      }),
      buildEntrypointDescriptor({
        surface: 'document_reader',
        serverAllowed: true,
        refs,
      }),
      buildEntrypointDescriptor({
        surface: 'governance',
        serverAllowed: true,
        refs,
      }),
    ]

    return {
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      displayName: row.displayName,
      capabilities: {
        documentBodyReadable: row.sourceKind === 'native_document',
        markdownReadable: row.sourceKind === 'native_document',
        ocrSupportedMime: ocrCapable,
        mimeType: row.mimeType,
      },
      status: overall,
      attentionFacets,
      dimensionStates,
      warningReasons,
      latestJob: job
        ? {
            jobId: job.jobId,
            status: job.status,
            createdAt: job.createdAt,
            succeededPages: job.succeededPages,
            totalPages: job.pageCount,
          }
        : null,
      currentExtraction:
        extraction && extraction.lifecycle === 'current'
          ? {
              extractionId: extraction.extractionId,
              lifecycle: 'current',
              confirmedAt: extraction.confirmedAt,
            }
          : null,
      entrypoints,
      profileProvenance: governance.profileProvenance,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    }
  }
}
