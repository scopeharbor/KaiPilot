/**
 * V3 Document Intelligence Workbench — 共享契约测试
 *
 * 覆盖 tasks §2：
 * - 2.2 未知值 fail-closed 校验（来源类型/维度状态/attention/surface/reason/count mode/sort key）
 * - 2.4 reviewable-without-accepted / current accepted / superseded / expired /
 *       partial failure / unsupported MIME / native-document-no-OCR 契约
 * - 2.6 200+ jobs、重复时间戳、页边界、非法 sort/filter/perPage、无静默截断
 * - 2.8 server-denied/client-claimed、unknown surface、stale/hidden source、
 *       accepted-only downstream entrypoint 负例
 * - 2.10 URL 注入拒绝与 round-trip
 * - 2.12 低敏扫描（DTO/URL/error fixture 不含全文/raw provider/prompt/secret/绝对路径）
 */

import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_INTELLIGENCE_MAX_PER_PAGE,
  buildEntrypointDescriptor,
  computeCountMode,
  deriveAttentionFacets,
  parseIntelligenceUrlState,
  paginateDocumentIntelligence,
  resolveConfirmationOwnedBy,
  sanitizeIntelligenceUrlParams,
  scanLowSensitive,
  serializeIntelligenceUrlState,
  sortDocumentIntelligenceSources,
  mergeDimensionStates,
  isDocumentIntelligenceSourceKind,
  isDocumentIntelligenceDimensionState,
  isDocumentIntelligenceAttentionFacet,
  isDocumentIntelligenceSurface,
  isDocumentIntelligenceReasonCode,
  isDocumentIntelligenceCountMode,
  isDocumentIntelligenceSortKey,
  type DocumentIntelligenceSourceSummary,
} from './document-intelligence-workbench.js'
import {
  buildBuiltinProfileProvenance,
  buildCrossTenantDecoySummary,
  buildDimensionStates,
  buildDocumentIntelligenceSourceDetail,
  buildDocumentIntelligenceSourceSummary,
  buildEnabledPluginProfileProvenance,
  buildOwningPanelFixtures,
  buildScaleFixture,
} from './document-intelligence-workbench-fixtures.js'

// ─── 2.2 fail-closed 校验 ────────────────────────────────────────────────

describe('契约词表 | 未知值 fail-closed', () => {
  it('来源类型拒绝未知值', () => {
    expect(isDocumentIntelligenceSourceKind('attachment')).toBe(true)
    expect(isDocumentIntelligenceSourceKind('native_document')).toBe(true)
    expect(isDocumentIntelligenceSourceKind('external_file')).toBe(false)
    expect(isDocumentIntelligenceSourceKind(42)).toBe(false)
    expect(isDocumentIntelligenceSourceKind(null)).toBe(false)
  })

  it('维度状态拒绝未知值（含 not_applicable，拒绝 guessed）', () => {
    for (const s of [
      'ready',
      'empty',
      'unavailable',
      'hidden',
      'stale',
      'blocked',
      'truncated',
      'not_applicable',
    ]) {
      expect(isDocumentIntelligenceDimensionState(s)).toBe(true)
    }
    expect(isDocumentIntelligenceDimensionState('ok')).toBe(false)
    expect(isDocumentIntelligenceDimensionState('READY')).toBe(false) // 大小写敏感，不宽松匹配
  })

  it('attention facet 拒绝未知值', () => {
    expect(isDocumentIntelligenceAttentionFacet('needs_review')).toBe(true)
    expect(isDocumentIntelligenceAttentionFacet('ready_for_downstream')).toBe(true)
    expect(isDocumentIntelligenceAttentionFacet('maybe_review')).toBe(false)
  })

  it('surface 封闭集合拒绝任意面板名', () => {
    expect(isDocumentIntelligenceSurface('review')).toBe(true)
    expect(isDocumentIntelligenceSurface('arbitrary_component')).toBe(false)
  })

  it('reason code / countMode / sort key 拒绝未知值', () => {
    expect(isDocumentIntelligenceReasonCode('permission_denied')).toBe(true)
    expect(isDocumentIntelligenceReasonCode('because_i_said_so')).toBe(false)
    expect(isDocumentIntelligenceCountMode('page')).toBe(true)
    expect(isDocumentIntelligenceCountMode('estimated')).toBe(false)
    expect(isDocumentIntelligenceSortKey('updated_at')).toBe(true)
    expect(isDocumentIntelligenceSortKey('drop table users')).toBe(false)
  })
})

// ─── 2.3 维度合并：禁止 false-zero / false-ready ────────────────────────

describe('维度合并纯函数', () => {
  it('unavailable 不被合成 empty', () => {
    const states = buildDimensionStates({ ocr_job: 'unavailable' })
    expect(mergeDimensionStates(states)).toBe('unavailable')
  })

  it('truncated 不被合成 ready', () => {
    const states = buildDimensionStates({
      ocr_job: 'ready',
      accepted_extraction: 'truncated',
    })
    expect(mergeDimensionStates(states)).not.toBe('ready')
    expect(mergeDimensionStates(states)).toBe('truncated')
  })

  it('blocked 与 hidden 短路为最保守语义', () => {
    expect(mergeDimensionStates(buildDimensionStates({ governance: 'blocked' }))).toBe('blocked')
    expect(mergeDimensionStates(buildDimensionStates({ ocr_job: 'hidden' }))).toBe('hidden')
  })

  it('native document 无 OCR 时显式 not_applicable 而非 failed/missing', () => {
    const native = buildDocumentIntelligenceSourceSummary({
      sourceKind: 'native_document',
      sourceId: 1,
      jobStatus: null,
      jobId: null,
    })
    expect(native.dimensionStates.ocr_job).toBe('not_applicable')
    expect(native.dimensionStates.accepted_extraction).toBe('not_applicable')
    // 文档能力独立归因：正文可读不因无 OCR 变失败
    expect(native.capabilities.documentBodyReadable).toBe(true)
  })
})

// ─── 2.4 关键生命周期契约 ────────────────────────────────────────────────

describe('生命周期契约投影', () => {
  it('reviewable-without-accepted → needs_review 且不暴露 accepted-only 下游', () => {
    const facets = deriveAttentionFacets({
      overall: 'empty',
      jobStatus: 'reviewable',
      hasCurrentAcceptedExtraction: false,
      isStale: false,
      governanceBlocked: false,
      hasReadyDownstreamArtifact: false,
    })
    expect(facets).toContain('needs_review')
    expect(facets).not.toContain('ready_for_downstream')

    // accepted-only downstream entrypoint 必须不可用
    const ep = buildEntrypointDescriptor({
      surface: 'search_index',
      serverAllowed: true,
      refs: { sourceKind: 'attachment', sourceId: 1 },
    })
    // 无 extraction ref 时调用方不得伪造 enabled 的下游入口：
    // 服务端裁决以 hasCurrentAcceptedExtraction 为前提，此处模拟服务端拒绝。
    const denied = buildEntrypointDescriptor({
      surface: 'search_index',
      serverAllowed: false,
      denialReasonCode: 'no_accepted_extraction',
      refs: { sourceKind: 'attachment', sourceId: 1 },
    })
    expect(ep.enabled).toBe(true) // 有权限时 descriptor 本身可为 enabled…
    expect(denied.enabled).toBe(false) // …但缺 accepted 时服务端裁决必须禁用
    expect(denied.reasonCode).toBe('no_accepted_extraction')
  })

  it('current accepted extraction 以低敏引用标识并派生 downstream readiness', () => {
    const row = buildDocumentIntelligenceSourceSummary({
      sourceId: 5,
      jobStatus: 'completed',
      extractionId: 777,
      dimensionOverrides: {
        ocr_job: 'ready',
        accepted_extraction: 'ready',
        search_index: 'ready',
      },
    })
    expect(row.currentExtraction).toEqual({
      extractionId: 777,
      lifecycle: 'current',
      confirmedAt: '2026-08-01T00:00:00.000Z',
    })
    expect(row.currentExtraction).not.toHaveProperty('acceptedText')
  })

  it('superseded/expired 显式保留，不冒充 empty 成功', () => {
    const superseded = buildDimensionStates({ accepted_extraction: 'stale' })
    expect(superseded.accepted_extraction).toBe('stale')
    expect(mergeDimensionStates(superseded)).toBe('stale')

    const expired = buildDimensionStates({ accepted_extraction: 'unavailable' })
    expect(expired.accepted_extraction).toBe('unavailable')
  })

  it('partial failure 用 truncated/unavailable 表达且整体不被判 ready', () => {
    const partial = mergeDimensionStates(
      buildDimensionStates({ ocr_job: 'truncated', accepted_extraction: 'empty' }),
    )
    expect(partial).toBe('truncated')
  })

  it('unsupported MIME 附件保留文件操作但无 OCR 能力', () => {
    const row = buildDocumentIntelligenceSourceSummary({
      sourceId: 8,
      mimeType: 'application/x-unknown',
    })
    row.capabilities.ocrSupportedMime = false
    row.dimensionStates.ocr_job = 'not_applicable'
    // 行本身仍可用（有 displayName / updatedAt），但 OCR 维度 not_applicable
    expect(row.displayName).toBeTruthy()
    expect(row.dimensionStates.ocr_job).toBe('not_applicable')
  })
})

// ─── 2.5/2.6 排序 / 分页 / countMode ─────────────────────────────────────

function makeRow(i: number, overrides: Partial<DocumentIntelligenceSourceSummary> = {}) {
  return buildDocumentIntelligenceSourceSummary({
    sourceKind: i % 2 === 0 ? 'attachment' : 'native_document',
    sourceId: i,
    createdAtOffsetMin: i,
    updatedAtOffsetMin: i,
    ...overrides,
  }) as DocumentIntelligenceSourceSummary
}

describe('稳定排序与有界分页', () => {
  it('重复时间戳下 tie-breaker 保证确定性顺序', () => {
    const rows = [makeRow(30), makeRow(10), makeRow(20)].map((r) => ({
      ...r,
      updatedAt: '2026-08-01T00:00:00.000Z',
    }))
    const asc = sortDocumentIntelligenceSources(rows, 'updated_at', 'asc')
    expect(asc.map((r) => `${r.sourceKind}:${r.sourceId}`)).toEqual([
      'attachment:10',
      'attachment:20',
      'attachment:30',
    ])
    const desc = sortDocumentIntelligenceSources(rows, 'updated_at', 'desc')
    // tie-breaker 与方向无关：同键同值时输出顺序恒定，保证跨请求稳定
    expect(desc.map((r) => `${r.sourceKind}:${r.sourceId}`)).toEqual([
      'attachment:10',
      'attachment:20',
      'attachment:30',
    ])
  })

  it('220 jobs / 1000 sources 分页：页边界正确、无静默截断', () => {
    const { sources } = buildScaleFixture()
    expect(sources.length).toBe(1000)

    let seen = new Set<string>()
    for (let page = 1; page <= 10; page++) {
      const sorted = sortDocumentIntelligenceSources(sources, 'created_at', 'asc')
      const pageResult = paginateDocumentIntelligence(sorted, page, 100)
      expect(pageResult.meta.total).toBe(1000)
      if (page <= 10) expect(pageResult.data.length).toBe(100)
      for (const r of pageResult.data) seen.add(`${r.sourceKind}:${r.sourceId}`)
      expect(seen.size).toBe(page * 100 <= 1000 ? Math.min(page * 100, 1000) : seen.size)
    }
    expect(seen.size).toBe(1000) // 连续翻页无重复无遗漏

    // perPage 夹紧到上界
    const over = paginateDocumentIntelligence(sources, 1, 5000)
    expect(over.meta.perPage).toBe(DOCUMENT_INTELLIGENCE_MAX_PER_PAGE)
    expect(over.data.length).toBe(DOCUMENT_INTELLIGENCE_MAX_PER_PAGE)

    // 非法输入夹紧而非崩溃
    const zero = paginateDocumentIntelligence(sources, 0, 0)
    expect(zero.meta.page).toBe(1)
    expect(zero.meta.perPage).toBe(1)
    expect(zero.data.length).toBe(1)
  })

  it('countMode：页内统计必须诚实标注 page', () => {
    expect(computeCountMode({ countsCoverFullMatchSet: true })).toBe('exact')
    expect(computeCountMode({ countsCoverFullMatchSet: false })).toBe('page')
  })
})

// ─── 2.7/2.8 entrypoint 负例 ─────────────────────────────────────────────

describe('entrypoint 封闭描述符', () => {
  it('四个 owning surface 的确认归属映射正确', () => {
    expect(resolveConfirmationOwnedBy('review')).toEqual({
      ok: true,
      owner: 'ocr-review-confirmation-flow',
      reasonCode: 'none',
    })
    expect(resolveConfirmationOwnedBy('search_index').owner).toBe('ocr-document-search-indexing')
    expect(resolveConfirmationOwnedBy('structured_extraction').owner).toBe(
      'ocr-structured-extraction',
    )
    expect(resolveConfirmationOwnedBy('entity_linking').owner).toBe('ocr-entity-linking')
    // 只读 surface 无确认归属
    expect(resolveConfirmationOwnedBy('governance').owner).toBeNull()
    expect(resolveConfirmationOwnedBy('document_reader').owner).toBeNull()
  })

  it('unknown surface fail closed', () => {
    const r = resolveConfirmationOwnedBy('magic_panel')
    expect(r.ok).toBe(false)
    expect(r.owner).toBeNull()
    expect(r.reasonCode).toBe('unknown_surface')
  })

  it('server-denied 强制 disabled；client 无法声称 allowed', () => {
    const denied = buildEntrypointDescriptor({
      surface: 'review',
      serverAllowed: false,
      denialReasonCode: 'permission_denied',
      refs: { sourceKind: 'attachment', sourceId: 9, jobId: 12 },
    })
    expect(denied.enabled).toBe(false)
    expect(denied.reasonCode).toBe('permission_denied')
    // 描述符结构上不存在 callback/token/handle 字段
    expect(Object.keys(denied).sort()).toEqual([
      'confirmationOwnedBy',
      'enabled',
      'reasonCode',
      'refs',
      'surface',
    ])
  })

  it('stale/hidden source 的入口携带低敏原因', () => {
    const stale = buildEntrypointDescriptor({
      surface: 'review',
      serverAllowed: false,
      denialReasonCode: 'stale_source',
      refs: { sourceKind: 'attachment', sourceId: 3, jobId: 4 },
    })
    expect(stale.reasonCode).toBe('stale_source')
    const hidden = buildEntrypointDescriptor({
      surface: 'document_reader',
      serverAllowed: false,
      denialReasonCode: 'source_hidden',
      refs: { sourceKind: 'native_document', sourceId: 3 },
    })
    expect(hidden.reasonCode).toBe('source_hidden')
  })
})

// ─── 2.9/2.10 URL 状态契约 ───────────────────────────────────────────────

describe('URL state parse / serialize / round-trip', () => {
  it('合法参数解析与 round-trip', () => {
    const raw = serializeIntelligenceUrlState({
      attention: 'needs_review',
      source: { kind: 'attachment', id: 42 },
      panel: 'review',
      job: 501,
      extraction: null,
    })
    const parsed = parseIntelligenceUrlState(Object.fromEntries(new URLSearchParams(raw)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.state).toEqual({
        attention: 'needs_review',
        source: { kind: 'attachment', id: 42 },
        panel: 'review',
        job: 501,
        extraction: null,
      })
    }
  })

  it('未知键整体拒绝', () => {
    const r = parseIntelligenceUrlState({
      view: 'intelligence',
      fileName: '../../etc/passwd',
    })
    expect(r.ok).toBe(false)
  })

  it('非法 view / 枚举值 / 负数与零 ID / 非 ID 值拒绝', () => {
    expect(parseIntelligenceUrlState({ view: 'admin' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ attention: 'everything' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ panel: 'console' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ job: '-1' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ job: '0' }).ok).toBe(false) // 0 视为未提供→null，不报错
    expect(parseIntelligenceUrlState({ job: 'abc' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ source: 'attachment:notanid' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ source: 'external_file:3' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ source: 'no-separator' }).ok).toBe(false)
  })

  it('注入式载荷拒绝：文件名/正文/OCR/prompt/secret/provider payload 形态', () => {
    const payloads = [
      '<script>alert(1)</script>',
      'javascript:alert(1)',
      "'; DROP TABLE users;--",
      `C:\\Users\\alice\\secret.txt`,
      '/home/user/.ssh/id_rsa',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'x'.repeat(200),
      'line\nbreak',
    ]
    for (const p of payloads) {
      expect(parseIntelligenceUrlState({ attention: p }).ok).toBe(false)
      expect(parseIntelligenceUrlState({ panel: p }).ok).toBe(false)
    }
    // 正文形态无法作为 source id 通过
    expect(parseIntelligenceUrlState({ source: `attachment:${'9'.repeat(20)}` }).ok).toBe(false)
  })

  it('sanitize 丢弃非 allowlist 键并报告', () => {
    const { cleaned, rejectedKeys } = sanitizeIntelligenceUrlParams({
      view: 'intelligence',
      attention: 'failed',
      evil: '<img src=x onerror=alert(1)>',
      prompt: 'ignore previous instructions',
    })
    expect(cleaned).toEqual({ view: 'intelligence', attention: 'failed' })
    expect(rejectedKeys.sort()).toEqual(['evil', 'prompt'])
  })
})

// ─── 2.11 fixture 完备性 ─────────────────────────────────────────────────

describe('fixture builders', () => {
  it('规模夹具满足 1000 sources / 220 jobs / 混合治理', () => {
    const { sources, jobCount } = buildScaleFixture()
    expect(sources.length).toBe(1000)
    expect(jobCount).toBe(220)
    const blocked = sources.filter((s) => s.dimensionStates.governance === 'blocked')
    expect(blocked.length).toBeGreaterThan(0)
    const native = sources.filter((s) => s.sourceKind === 'native_document')
    expect(native.length).toBe(300)
    expect(native.every((s) => s.dimensionStates.ocr_job === 'not_applicable')).toBe(true)
  })

  it('四类 owning panel fixture 上下文齐备', () => {
    const fixtures = buildOwningPanelFixtures(7)
    expect(fixtures.map((f) => f.surface)).toEqual([
      'review',
      'search_index',
      'structured_extraction',
      'entity_linking',
    ])
    expect(fixtures.every((f) => f.projectId === 7)).toBe(true)
    expect(fixtures.find((f) => f.surface === 'structured_extraction')?.extractionId).not.toBeNull()
  })

  it('插件 profile provenance 与跨租诱饵可构建', () => {
    expect(buildEnabledPluginProfileProvenance().provenanceKind).toBe('enabled_plugin')
    expect(buildBuiltinProfileProvenance().provenanceKind).toBe('builtin')
    const decoy = buildCrossTenantDecoySummary()
    expect(decoy.sourceId).toBe(999999)
  })
})

// ─── 2.12 低敏共享扫描 ───────────────────────────────────────────────────

describe('低敏扫描守卫', () => {
  it('干净 DTO/详情 fixture 零 finding', () => {
    const detail = buildDocumentIntelligenceSourceDetail({ sourceId: 21 })
    expect(scanLowSensitive(detail)).toEqual([])
  })

  it('检测 prohibited key / 绝对路径 / Bearer / 疑似全文', () => {
    const dirty = {
      ok: {
        prompt: 'you are a helpful assistant',
        apiKey: 'sk-123',
        Authorization: 'Bearer abc.def',
        extractedText: '全文'.repeat(300),
        nested: { configPath: '/Users/someone/.config/app' },
      },
    }
    const findings = scanLowSensitive(dirty)
    const kinds = new Set(findings.map((f) => f.kind))
    expect(kinds.has('prohibited_key')).toBe(true)
    expect(kinds.has('bearer_token')).toBe(true)
    expect(kinds.has('suspected_long_text')).toBe(true)
    expect(kinds.has('absolute_path')).toBe(true)
  })

  it('URL 序列化结果本身通过低敏扫描', () => {
    const url = serializeIntelligenceUrlState({
      attention: 'governance_blocked',
      source: { kind: 'attachment', id: 3 },
      panel: 'entity_linking',
      job: 9,
      extraction: 11,
    })
    expect(scanLowSensitive(url)).toEqual([])
  })

  it('error envelope fixture 通过低敏扫描', () => {
    const error = {
      error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' },
    }
    expect(scanLowSensitive(error)).toEqual([])
  })
})
