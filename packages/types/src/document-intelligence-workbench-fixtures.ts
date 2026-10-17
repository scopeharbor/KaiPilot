/**
 * V3 Document Intelligence Workbench — 确定性 fixture builders
 *
 * 覆盖：常规/边界来源摘要、四类 owning panel 上下文、治理降级、
 * 插件 profile provenance、跨租诱饵，以及 1000 sources / 200+ jobs 规模夹具。
 * 全部确定性输出（固定种子序列），供契约测试与性能门复用。
 */

import {
  type DocumentIntelligenceSourceSummary,
  type DocumentIntelligenceSourceDetail,
  type DocumentIntelligenceSourceKind,
  type DocumentIntelligenceDimensionState,
  type DocumentIntelligenceDimensionStates,
  type DocumentIntelligenceAttentionFacet,
  type DocumentIntelligenceSurface,
  type DocumentIntelligenceProfileProvenance,
  DOCUMENT_INTELLIGENCE_DIMENSIONS,
  mergeDimensionStates,
} from './document-intelligence-workbench.js'

/** 固定基准时间（确定性） */
const BASE_TIME = '2026-08-01T00:00:00.000Z'

function isoAt(offsetMinutes: number): string {
  const t = new Date(BASE_TIME).getTime() + offsetMinutes * 60_000
  return new Date(t).toISOString()
}

export function buildDimensionStates(
  overrides: Partial<
    Record<(typeof DOCUMENT_INTELLIGENCE_DIMENSIONS)[number], DocumentIntelligenceDimensionState>
  > = {},
): DocumentIntelligenceDimensionStates {
  return {
    ocr_job: 'empty',
    accepted_extraction: 'not_applicable',
    search_index: 'not_applicable',
    structured_snapshot: 'not_applicable',
    entity_link: 'not_applicable',
    governance: 'ready',
    ...overrides,
  }
}

export interface BuildSourceSummaryOptions {
  sourceKind?: DocumentIntelligenceSourceKind
  sourceId?: number
  displayName?: string | null
  mimeType?: string | null
  dimensionOverrides?: Partial<
    Record<(typeof DOCUMENT_INTELLIGENCE_DIMENSIONS)[number], DocumentIntelligenceDimensionState>
  >
  attentionFacets?: DocumentIntelligenceAttentionFacet[]
  jobStatus?: string | null
  jobId?: number | null
  extractionId?: number | null
  hasReadyDownstreamArtifact?: boolean
  isStale?: boolean
  governanceBlocked?: boolean
  profileProvenance?: DocumentIntelligenceProfileProvenance | null
  createdAtOffsetMin?: number
  updatedAtOffsetMin?: number
}

/** 确定性构建单条来源摘要 */
export function buildDocumentIntelligenceSourceSummary(
  opts: BuildSourceSummaryOptions = {},
): DocumentIntelligenceSourceSummary {
  const sourceKind = opts.sourceKind ?? 'attachment'
  const sourceId = opts.sourceId ?? 1
  const dimensions = buildDimensionStates(
    sourceKind === 'native_document'
      ? {
          ocr_job: 'not_applicable',
          accepted_extraction: 'not_applicable',
          search_index: 'not_applicable',
          structured_snapshot: 'not_applicable',
          entity_link: 'not_applicable',
          ...opts.dimensionOverrides,
        }
      : opts.dimensionOverrides,
  )
  const jobStatus = opts.jobStatus ?? (sourceKind === 'attachment' ? 'reviewable' : null)
  return {
    sourceKind,
    sourceId,
    displayName: opts.displayName ?? `fixture-source-${sourceKind}-${sourceId}`,
    capabilities: {
      documentBodyReadable: sourceKind === 'native_document',
      markdownReadable: sourceKind === 'native_document',
      ocrSupportedMime: sourceKind === 'attachment',
      mimeType:
        opts.mimeType ?? (sourceKind === 'attachment' ? 'application/pdf' : 'text/markdown'),
    },
    status: mergeDimensionStates(dimensions),
    attentionFacets: opts.attentionFacets ?? [],
    dimensionStates: dimensions,
    warningReasons: [],
    latestJob:
      jobStatus && opts.jobId !== null
        ? {
            jobId: opts.jobId ?? ((sourceId - 1) % 250) + 1,
            status: jobStatus,
            createdAt: isoAt(opts.createdAtOffsetMin ?? 0),
            succeededPages: 3,
            totalPages: 3,
          }
        : null,
    currentExtraction:
      opts.extractionId != null && opts.extractionId !== 0
        ? { extractionId: opts.extractionId, lifecycle: 'current', confirmedAt: BASE_TIME }
        : null,
    entrypoints: [],
    profileProvenance: opts.profileProvenance === undefined ? null : opts.profileProvenance,
    updatedAt: isoAt(opts.updatedAtOffsetMin ?? 0),
    createdAt: isoAt(opts.createdAtOffsetMin ?? 0),
  }
}

export interface BuildSourceDetailOptions extends BuildSourceSummaryOptions {
  auditAccess?: 'available' | 'restricted' | 'unavailable'
  retentionHoldActive?: boolean | null
  privacyStatus?: DocumentIntelligenceDimensionState
  permissionDecision?: DocumentIntelligenceDimensionState
  sourceHashPrefix?: string | null
  providerSummary?: string | null
}

/** 确定性构建详情（证据与治理视图） */
export function buildDocumentIntelligenceSourceDetail(
  opts: BuildSourceDetailOptions = {},
): DocumentIntelligenceSourceDetail {
  const summary = buildDocumentIntelligenceSourceSummary(opts)
  return {
    ...summary,
    evidence: {
      sourceHashPrefix: opts.sourceHashPrefix === undefined ? 'a1b2c3' : opts.sourceHashPrefix,
      jobCount: summary.latestJob ? 1 : 0,
      extractionCount: summary.currentExtraction ? 1 : 0,
      providerSummary: opts.providerSummary ?? 'fake-adapter',
      costSummaryPresent: false,
      freshness: { lastActivityAt: summary.updatedAt },
      downstream: {
        searchIndexStatus: summary.dimensionStates.search_index === 'ready' ? 'active' : null,
        structuredSnapshotCurrentCount:
          summary.dimensionStates.structured_snapshot === 'ready' ? 1 : 0,
        structuredSnapshotSupersededCount: 0,
        entityLinkActiveCount: summary.dimensionStates.entity_link === 'ready' ? 1 : 0,
        entityLinkSupersededCount: 0,
        entityLinkHiddenTargetCount: 0,
      },
    },
    governance: {
      permissionDecision: opts.permissionDecision ?? 'ready',
      privacyStatus: opts.privacyStatus ?? 'ready',
      retentionHoldActive: opts.retentionHoldActive ?? false,
      retentionExpiredCount: 0,
      auditAccess: opts.auditAccess ?? 'available',
      reasonCode: 'none',
    },
  }
}

/** 内置 profile provenance */
export function buildBuiltinProfileProvenance(): DocumentIntelligenceProfileProvenance {
  return {
    identity: 'com.aiproj.builtin.ocr-profile',
    version: '1.0.0',
    provenanceKind: 'builtin',
    status: 'active',
    receiptRef: null,
  }
}

/** 已启用插件 profile provenance */
export function buildEnabledPluginProfileProvenance(): DocumentIntelligenceProfileProvenance {
  return {
    identity: 'com.example.fixture.ocr-profile-pack',
    version: '2.1.0',
    provenanceKind: 'enabled_plugin',
    status: 'active',
    receiptRef: 'receipt-fixture-0001',
  }
}

/** 停用/损坏 profile provenance（历史可读但新选择停止） */
export function buildDisabledPluginProfileProvenance(): DocumentIntelligenceProfileProvenance {
  return {
    identity: 'com.example.fixture.ocr-profile-pack',
    version: '2.1.0',
    provenanceKind: 'enabled_plugin',
    status: 'disabled',
    receiptRef: 'receipt-fixture-0001',
  }
}

/** 跨租诱饵源：任何断言都应证明它不出现在同租响应中 */
export function buildCrossTenantDecoySummary(): DocumentIntelligenceSourceSummary {
  return buildDocumentIntelligenceSourceSummary({
    sourceKind: 'attachment',
    sourceId: 999999,
    displayName: 'cross-tenant-decoy.pdf',
    dimensionOverrides: { governance: 'blocked' },
  })
}

/** 四个 owning surface 的深链上下文 */
export interface OwningPanelFixtureContext {
  surface: DocumentIntelligenceSurface
  projectId: number
  sourceKind: DocumentIntelligenceSourceKind
  sourceId: number
  jobId: number | null
  extractionId: number | null
}

export function buildOwningPanelFixtures(projectId = 1): OwningPanelFixtureContext[] {
  return [
    {
      surface: 'review',
      projectId,
      sourceKind: 'attachment',
      sourceId: 11,
      jobId: 501,
      extractionId: null,
    },
    {
      surface: 'search_index',
      projectId,
      sourceKind: 'attachment',
      sourceId: 12,
      jobId: 502,
      extractionId: 601,
    },
    {
      surface: 'structured_extraction',
      projectId,
      sourceKind: 'attachment',
      sourceId: 13,
      jobId: 503,
      extractionId: 602,
    },
    {
      surface: 'entity_linking',
      projectId,
      sourceKind: 'attachment',
      sourceId: 14,
      jobId: 504,
      extractionId: 603,
    },
  ]
}

export interface ScaleFixtureResult {
  sources: DocumentIntelligenceSourceSummary[]
  /** 每条 attachment 来源一条对应 job 记录（共 jobs 条），用于证明 200+ 不被截断 */
  jobCount: number
}

/**
 * 规模夹具：1000 visible sources（前 700 attachment + 后 300 native document）、
 * 220 个 OCR job（>200 固定截断阈值）、混合治理与 downstream 状态。
 * 确定性：id 连续、时间按 id 线性偏移。
 */
export function buildScaleFixture(
  params: {
    totalSources?: number
    jobCount?: number
  } = {},
): ScaleFixtureResult {
  const totalSources = params.totalSources ?? 1000
  const jobCount = params.jobCount ?? 220
  const sources: DocumentIntelligenceSourceSummary[] = []

  for (let i = 1; i <= totalSources; i++) {
    const isAttachment = i <= Math.floor(totalSources * 0.7)
    // 混合维度状态：每 7 条一个 blocked，每 11 条一个 stale，其余正常
    const governanceBlocked = i % 7 === 0
    const isStale = !governanceBlocked && i % 11 === 0
    const hasJob = isAttachment && (i - 1) % 5 !== 4 // 少量附件无作业
    const jobId = hasJob ? ((i * 3) % jobCount) + 1 : null
    const hasAccepted = hasJob && i % 3 === 0
    const hasDownstream = hasAccepted && i % 9 === 0

    sources.push(
      buildDocumentIntelligenceSourceSummary({
        sourceKind: isAttachment ? 'attachment' : 'native_document',
        sourceId: i,
        jobStatus: hasJob
          ? hasAccepted
            ? 'completed'
            : i % 17 === 0
              ? 'failed'
              : 'reviewable'
          : null,
        jobId,
        extractionId: hasAccepted ? 10_000 + i : null,
        dimensionOverrides: {
          ocr_job: hasJob
            ? i % 17 === 0
              ? 'stale'
              : 'ready'
            : isAttachment
              ? 'empty'
              : 'not_applicable',
          accepted_extraction: isAttachment ? (hasAccepted ? 'ready' : 'empty') : 'not_applicable',
          search_index: isAttachment ? (hasDownstream ? 'ready' : 'empty') : 'not_applicable',
          governance: governanceBlocked ? 'blocked' : 'ready',
        },
        isStale,
        governanceBlocked,
        hasReadyDownstreamArtifact: hasDownstream,
        createdAtOffsetMin: i,
        updatedAtOffsetMin: totalSources - i, // 反向偏移制造排序平局场景
      }),
    )
  }

  return { sources, jobCount }
}
