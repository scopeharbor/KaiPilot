/**
 * V3 OCR Document Search Indexing — 测试夹具构建器
 *
 * 提供 OCR 搜索索引预览条目、索引条目、索引运行、预览请求/响应、
 * 执行请求/响应的 fixture 构建器。所有函数为纯函数，零副作用，零 I/O。
 */

import type {
  OcrSearchIndexEntrySummary,
  OcrSearchIndexRunSummary,
  OcrSearchIndexPreviewEntry,
  OcrSearchIndexPreviewResponse,
  OcrSearchIndexExecuteResponse,
  OcrSearchIndexBlockedReason,
  OcrSearchIndexRunType,
} from './ocr-document-search-indexing.js'

// ─── 简单 fixture 构建器 ──────────────────────────────────────────────────

export function buildIndexPreviewEntry(
  overrides: Partial<OcrSearchIndexPreviewEntry> = {},
): OcrSearchIndexPreviewEntry {
  return {
    extractionId: 1,
    sourceKind: 'attachment',
    sourceId: 10,
    sourceHash: 'abc123def456',
    selectedTextHash: 'txt789hash012',
    pageRefs: [1, 2],
    eligible: true,
    blockedReason: null,
    warnings: [],
    plannedIndexHash: 'a1b2c3d4e5f6g7h8',
    currentEntryId: null,
    currentStatus: null,
    ...overrides,
  }
}

export function buildBlockedPreviewEntry(
  reason: OcrSearchIndexBlockedReason,
  overrides: Partial<OcrSearchIndexPreviewEntry> = {},
): OcrSearchIndexPreviewEntry {
  return buildIndexPreviewEntry({
    eligible: false,
    blockedReason: reason,
    plannedIndexHash: null,
    warnings: [],
    ...overrides,
  })
}

export function buildIndexEntrySummary(
  overrides: Partial<OcrSearchIndexEntrySummary> = {},
): OcrSearchIndexEntrySummary {
  const now = new Date().toISOString()
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    extractionId: 1,
    sourceKind: 'attachment',
    sourceId: 10,
    sourceHash: 'abc123def456',
    selectedTextHash: 'txt789hash012',
    indexContentHash: 'idxhash00112233',
    pageRefs: [1, 2],
    status: 'active',
    indexedBy: 1,
    indexedAt: now,
    tombstonedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function buildTombstonedEntrySummary(
  overrides: Partial<OcrSearchIndexEntrySummary> = {},
): OcrSearchIndexEntrySummary {
  const now = new Date().toISOString()
  return buildIndexEntrySummary({
    status: 'tombstoned',
    tombstonedAt: now,
    indexedBy: null,
    ...overrides,
  })
}

export function buildIndexRunSummary(
  type: OcrSearchIndexRunType,
  overrides: Partial<OcrSearchIndexRunSummary> = {},
): OcrSearchIndexRunSummary {
  const now = new Date().toISOString()
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    runType: type,
    status: 'succeeded',
    previewHash: 'prevhash00000001',
    idempotencyKeyHash: 'idemhash0000001',
    entryCount: 3,
    blockedCount: 0,
    warningCount: 0,
    warnings: [],
    blockedReasons: [],
    note: null,
    runBy: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function buildPreviewResponse(
  entries: OcrSearchIndexPreviewEntry[],
  overrides: Partial<OcrSearchIndexPreviewResponse['data']> = {},
): OcrSearchIndexPreviewResponse {
  const eligibleCount = entries.filter((e) => e.eligible).length
  const blockedCount = entries.filter((e) => !e.eligible).length
  const blockedReasons = [
    ...new Set(entries.filter((e) => e.blockedReason).map((e) => e.blockedReason!)),
  ]
  const warnings = [...new Set(entries.flatMap((e) => e.warnings))]
  const previewHash = 'fixture-preview-hash-0001'

  return {
    data: {
      entries,
      eligibleCount,
      blockedCount,
      blockedReasons,
      warnings,
      previewHash,
      requiresConfirmation: eligibleCount > 0,
      ...overrides,
    },
  }
}

export function buildExecuteResponse(
  entries: OcrSearchIndexEntrySummary[],
  run: OcrSearchIndexRunSummary,
  overrides: Partial<OcrSearchIndexExecuteResponse['data']> = {},
): OcrSearchIndexExecuteResponse {
  return {
    data: {
      run,
      entries,
      createdCount: entries.length,
      updatedCount: 0,
      blockedCount: 0,
      ...overrides,
    },
  }
}

// ─── 多条目 fixture ──────────────────────────────────────────────────────

export function buildMultipleEligiblePreviews(count: number): OcrSearchIndexPreviewEntry[] {
  const entries: OcrSearchIndexPreviewEntry[] = []
  for (let i = 0; i < count; i++) {
    entries.push(
      buildIndexPreviewEntry({
        extractionId: i + 1,
        sourceId: 10 + i,
        sourceHash: `srcHash${String(i).padStart(4, '0')}`,
        selectedTextHash: `txtHash${String(i).padStart(4, '0')}`,
        plannedIndexHash: `idxHash${String(i).padStart(4, '0')}000000`,
        pageRefs: [i + 1],
      }),
    )
  }
  return entries
}

export function buildMixedPreviewEntries(): OcrSearchIndexPreviewEntry[] {
  return [
    buildIndexPreviewEntry({ extractionId: 1, eligible: true }),
    buildBlockedPreviewEntry('stale_source', { extractionId: 2 }),
    buildBlockedPreviewEntry('hold_active', { extractionId: 3 }),
    buildIndexPreviewEntry({
      extractionId: 4,
      eligible: true,
      warnings: ['retention_deadline_approaching'],
    }),
    buildBlockedPreviewEntry('purged_extraction', { extractionId: 5 }),
  ]
}

// ─── 常量 fixture ────────────────────────────────────────────────────────

export const FIXTURE_SEARCHABLE_TEXT_SHORT = '这是一段简短的测试OCR文本'

export const FIXTURE_SEARCHABLE_TEXT_LONG =
  '项目管理系统需要支持多项目并行管理，包括甘特图、WBS分解、资源分配、风险管理、变更控制、报表生成、文档管理、OCR识别、搜索索引等核心功能模块。' +
  '每个模块都经过严格的质量控制和性能优化，确保系统在高并发场景下的稳定性和响应速度。' +
  '同时系统还需要支持AI辅助的项目规划、智能推荐、风险预测、进度诊断等高级功能，为用户提供全面的项目管理解决方案。' +
  '在多项目环境下，系统需要协调跨项目资源分配、依赖关系管理、里程碑对齐、交付物跟踪等复杂场景，并通过OCR文档索引实现非结构化数据的全文搜索能力。' +
  '为了满足企业级需求，系统还集成了组织级Dashboard、OKR进度回流、BI趋势分析、PMO组合Dashboard等高级分析功能。'

export const FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD =
  'OCR文本识别结果包含项目计划书中的关键信息：项目启动时间为2024年3月，预计工期12个月，总预算500万元，项目团队包括项目经理、技术负责人、测试工程师、UI设计师等角色。主要交付物包括Web应用、移动端App、API接口文档、用户手册。'

// ─── 审计元数据 fixture ──────────────────────────────────────────────────

export function buildAuditMetadataFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    organizationId: 1,
    projectId: 1,
    runId: 1,
    runType: 'index',
    entryIds: [1, 2, 3],
    extractionIds: [1, 2, 3],
    sourceKinds: ['attachment'],
    sourceIds: [10, 11, 12],
    sourceHashes: ['abc123', 'def456', 'ghi789'],
    selectedTextHashes: ['txt111', 'txt222', 'txt333'],
    indexContentHashes: ['idx111', 'idx222', 'idx333'],
    previewHash: 'prevhash00000001',
    idempotencyKeyHash: 'idemhash0000001',
    createdCount: 3,
    updatedCount: 0,
    blockedCount: 0,
    warningCodes: [],
    blockedReasons: [],
    ...overrides,
  }
}
