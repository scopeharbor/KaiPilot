import { describe, expect, it } from 'vitest'
import {
  computeMarkdownBundleHash,
  computeMarkdownExportHash,
  computeMarkdownPreviewHash,
  computeMarkdownSourceDocumentHash,
  extractFrontmatterTitle,
  extractMarkdownSnippet,
  inferMarkdownTitle,
  isMarkdownAllowedAction,
  isMarkdownImportMode,
  isMarkdownWarningCode,
  MARKDOWN_ALLOWED_ACTIONS,
  MARKDOWN_BUNDLE_MAX_ITEMS,
  MARKDOWN_IMPORT_MODES,
  MARKDOWN_WARNING_CODES,
  normalizeMarkdownText,
  safeMarkdownFilename,
  sortMarkdownExportItems,
  sortMarkdownWarnings,
  summarizeMarkdownExportManifest,
  collectMarkdownWarningCodes,
  redactMarkdownAuditMetadata,
  buildMarkdownAuditMetadata,
  markdownFnv1aHash,
} from '../src/document-markdown-import-export.js'
import {
  buildLargeMarkdownFixture,
  buildMarkdownBundleManifest,
  buildMarkdownConfirmRequest,
  buildMarkdownConfirmResult,
  buildMarkdownExportTreeResult,
  buildMarkdownImportPreview,
  buildMarkdownPreviewRequest,
  buildReplacePreview,
  buildSelectedTreePartialFailure,
  buildSingleExportResult,
  buildStaleReplacePreview,
  buildWarning,
  mdFixtureContent,
  mdFixtureUnsupportedFeatures,
  mdFixtureWithFrontmatter,
} from '../src/document-markdown-import-export-fixtures.js'

describe('normalization', () => {
  it('removes BOM and normalizes CRLF/CR to LF deterministically', () => {
    expect(normalizeMarkdownText('\uFEFF# a\r\nb\r\nc')).toBe('# a\nb\nc')
    expect(normalizeMarkdownText('x\ry\nz')).toBe('x\ny\nz')
    expect(normalizeMarkdownText('# a\r\nb')).toBe(normalizeMarkdownText('# a\nb'))
    expect(normalizeMarkdownText('')).toBe('')
  })
})

describe('title inference', () => {
  it('prefers frontmatter title over H1 and filename', () => {
    expect(inferMarkdownTitle(mdFixtureWithFrontmatter)).toBe('产品需求说明')
    expect(inferMarkdownTitle(mdFixtureContent)).toBe('项目启动计划')
    expect(inferMarkdownTitle('# 无 frontmatter', 'fallback.md')).toBe('无 frontmatter')
  })

  it('falls back to filename (without .md) when no heading exists', () => {
    expect(inferMarkdownTitle('纯文本没有标题', 'notes.md')).toBe('notes')
    expect(inferMarkdownTitle('', 'untitled.txt')).toBe('untitled.txt')
    expect(inferMarkdownTitle('', '')).toBeNull()
  })

  it('strips quotes from frontmatter title', () => {
    expect(extractFrontmatterTitle("---\ntitle: '带引号标题'\n---\n# 正文")).toBe('带引号标题')
  })

  it('extractFrontmatterTitle returns null for non-frontmatter input', () => {
    expect(extractFrontmatterTitle('# 没有 frontmatter')).toBeNull()
    expect(extractFrontmatterTitle('')).toBeNull()
  })
})

describe('safe filename generation', () => {
  it('sanitizes illegal path characters and forces .md', () => {
    expect(safeMarkdownFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j.md')
    expect(safeMarkdownFilename('标题')).toBe('标题.md')
    expect(safeMarkdownFilename('already.md')).toBe('already.md')
  })

  it('bounds length (including .md suffix space) and uses fallback for empty titles', () => {
    const long = 'x'.repeat(300)
    const longName = safeMarkdownFilename(long)
    expect(longName.length).toBeLessThanOrEqual(200)
    expect(longName.endsWith('.md')).toBe(true)
    expect(safeMarkdownFilename('   ')).toBe('document.md')
    expect(safeMarkdownFilename(null)).toBe('document.md')
    expect(safeMarkdownFilename('...')).toBe('document.md')
  })
})

describe('bounded snippet extraction', () => {
  it('collapses newlines and truncates to maxLength', () => {
    expect(extractMarkdownSnippet('a\nb\nc')).toBe('a b c')
    expect(extractMarkdownSnippet('x'.repeat(500), 100).length).toBe(100)
  })
})

describe('hash helpers are deterministic and stable', () => {
  it('preview hash is stable for equivalent normalized input', () => {
    const h1 = computeMarkdownPreviewHash({
      normalizedContent: '# a\n\nb',
      mode: 'create',
      title: 'a',
    })
    const h2 = computeMarkdownPreviewHash({
      normalizedContent: normalizeMarkdownText('# a\r\n\r\nb'),
      mode: 'create',
      title: 'a',
    })
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
  })

  it('source document hash distinguishes content and identity', () => {
    const base = { documentId: 5, content: '正文' } as const
    const same = computeMarkdownSourceDocumentHash(base)
    expect(computeMarkdownSourceDocumentHash(base)).toBe(same)
    expect(computeMarkdownSourceDocumentHash({ ...base, content: '正文2' })).not.toBe(same)
    expect(computeMarkdownSourceDocumentHash({ documentId: 6, content: '正文' })).not.toBe(same)
  })

  it('export hash and bundle hash are stable; bundle refs order-insensitive', () => {
    const exportHash = computeMarkdownExportHash({ documentId: 1, contentHash: 'c1', name: 'a.md' })
    expect(computeMarkdownExportHash({ documentId: 1, contentHash: 'c1', name: 'a.md' })).toBe(
      exportHash,
    )
    expect(
      computeMarkdownBundleHash({ orderedRefs: ['a', 'b'], contentHashes: ['h1', 'h2'] }),
    ).toBe(computeMarkdownBundleHash({ orderedRefs: ['b', 'a'], contentHashes: ['h2', 'h1'] }))
    expect(markdownFnv1aHash('x')).toBe(markdownFnv1aHash('x'))
  })
})

describe('warning ordering and aggregation', () => {
  it('sorts warnings deterministically by code and deduplicates codes', () => {
    const warnings = [
      buildWarning({ code: 'REMOTE_IMAGE', count: 2 }),
      buildWarning({ code: 'RAW_HTML' }),
      buildWarning({ code: 'REMOTE_IMAGE', count: 3 }),
    ]
    const sorted = sortMarkdownWarnings(warnings)
    expect(sorted.map((w) => w.code)).toEqual(['RAW_HTML', 'REMOTE_IMAGE', 'REMOTE_IMAGE'])
    expect(collectMarkdownWarningCodes(warnings)).toEqual(['RAW_HTML', 'REMOTE_IMAGE'])
  })

  it('covers all nine warning codes in the deterministic constant', () => {
    expect(MARKDOWN_WARNING_CODES).toHaveLength(9)
    expect(MARKDOWN_WARNING_CODES).toContain('RAW_HTML')
    expect(MARKDOWN_WARNING_CODES).toContain('REMOTE_IMAGE')
    expect(MARKDOWN_WARNING_CODES).toContain('LOCAL_PATH_REFERENCE')
    expect(MARKDOWN_WARNING_CODES).toContain('UNSUPPORTED_FRONTMATTER')
    expect(MARKDOWN_WARNING_CODES).toContain('EXCESSIVE_HEADING_DEPTH')
    expect(MARKDOWN_WARNING_CODES).toContain('OVERSIZED_CONTENT')
    expect(MARKDOWN_WARNING_CODES).toContain('MISSING_CONTENT')
    expect(MARKDOWN_WARNING_CODES).toContain('STALE_SOURCE')
    expect(MARKDOWN_WARNING_CODES).toContain('HIDDEN_SOURCE_DENIAL')
  })
})

describe('export manifest helpers', () => {
  it('sorts selected documents deterministically by path', () => {
    const items = [
      { path: 'z.md', documentId: 1, status: 'exported' as const },
      { path: 'a/b.md', documentId: 2, status: 'exported' as const },
    ]
    expect(sortMarkdownExportItems(items).map((i) => i.path)).toEqual(['a/b.md', 'z.md'])
  })

  it('summarizes per-item success/failure without hidden metadata', () => {
    const manifest = summarizeMarkdownExportManifest([
      { documentId: 1, path: 'a.md', status: 'exported', byteCount: 5, contentHash: 'h1' },
      { documentId: 2, path: 'b.md', status: 'denied', reasonCode: 'HIDDEN_SOURCE_DENIAL' },
      { documentId: 3, path: 'c.md', status: 'failed', reasonCode: 'MISSING_CONTENT' },
      { documentId: 4, path: 'd.md', status: 'skipped' },
    ])
    expect(manifest.exportedCount).toBe(1)
    expect(manifest.skippedCount).toBe(1)
    expect(manifest.failedCount).toBe(1)
    expect(manifest.deniedCount).toBe(1)
    expect(manifest.items.map((i) => i.path)).toEqual(['a.md', 'b.md', 'c.md', 'd.md'])
  })
})

describe('audit metadata is low-sensitive', () => {
  it('redacts content, filenames, paths and titles', () => {
    const redacted = redactMarkdownAuditMetadata({
      documentId: 1,
      content: 'SECRET',
      originalFilename: 'secret.md',
      filePath: '/tmp/secret.md',
      title: '秘密标题',
      mode: 'create',
    })
    expect(redacted.content).toBe('[REDACTED]')
    expect(redacted.originalFilename).toBe('[REDACTED]')
    expect(redacted.filePath).toBe('[REDACTED]')
    expect(redacted.title).toBe('[REDACTED]')
    expect(redacted.documentId).toBe(1)
    expect(redacted.mode).toBe('create')
  })

  it('buildMarkdownAuditMetadata keeps hashes and counts only', () => {
    const meta = buildMarkdownAuditMetadata({
      mode: 'create',
      documentId: 7,
      previewHash: 'abc',
      byteCount: 100,
      warningCodes: ['RAW_HTML'],
      status: 'confirmed',
    })
    expect(meta.previewHash).toBe('abc')
    expect(meta.byteCount).toBe(100)
    expect(meta.warningCodes).toEqual(['RAW_HTML'])
    expect(meta.status).toBe('confirmed')
    expect(JSON.stringify(meta)).not.toContain('content')
  })
})

describe('type guards', () => {
  it('validates modes, warning codes and allowed actions', () => {
    expect(isMarkdownImportMode('create')).toBe(true)
    expect(isMarkdownImportMode('replace')).toBe(true)
    expect(isMarkdownImportMode('delete')).toBe(false)
    expect(isMarkdownWarningCode('RAW_HTML')).toBe(true)
    expect(isMarkdownWarningCode('NOPE')).toBe(false)
    expect(isMarkdownAllowedAction('export')).toBe(true)
    expect(isMarkdownAllowedAction('auto')).toBe(false)
    expect(MARKDOWN_IMPORT_MODES).toEqual(['create', 'replace'])
    expect(MARKDOWN_ALLOWED_ACTIONS).toEqual(['import', 'replace', 'export'])
  })
})

describe('fixture shape', () => {
  it('builds a valid create preview with stable hash', () => {
    const preview = buildMarkdownImportPreview()
    expect(preview.mode).toBe('create')
    expect(preview.normalizedContent).toBe(mdFixtureContent)
    expect(preview.inferredTitle).toBe('项目启动计划')
    expect(preview.safeTitle).toBe('项目启动计划.md')
    expect(preview.warnings).toEqual([])
    expect(preview.previewHash).toMatch(/^[0-9a-f]{16}$/)
    const again = buildMarkdownImportPreview()
    expect(again.previewHash).toBe(preview.previewHash)
  })

  it('preview request/confirm request are round-trippable', () => {
    const req = buildMarkdownPreviewRequest()
    const confirm = buildMarkdownConfirmRequest()
    expect(req.mode).toBe('create')
    expect(req.content).toBe(mdFixtureContent)
    expect(confirm.confirmed).toBe(true)
    expect(confirm.previewHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('unsupported-feature fixture triggers warning coverage', () => {
    const content = mdFixtureUnsupportedFeatures
    expect(content).toContain('<div')
    expect(content).toContain('https://example.com')
    expect(content).toContain('C:\\Users')
    expect(content).toContain('#######')
  })

  it('replace preview reports target and source hash', () => {
    const preview = buildReplacePreview()
    expect(preview.mode).toBe('replace')
    expect(preview.target.targetDocumentId).toBe(7)
    expect(preview.sourceDocumentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(preview.previewHash).not.toBeNull()
  })

  it('stale replace preview carries STALE_SOURCE warning', () => {
    const stale = buildStaleReplacePreview()
    expect(stale.warnings.map((w) => w.code)).toContain('STALE_SOURCE')
  })

  it('read-only export fixture and single export result shape', () => {
    const single = buildSingleExportResult()
    expect(single.filename).toBe('项目启动计划.md')
    expect(single.byteCount).toBe(single.content.length)
    const tree = buildMarkdownExportTreeResult()
    expect(tree.manifest.items).toHaveLength(2)
    expect(tree.byteCount).toBe(tree.content.length)
  })

  it('selected-tree partial failure preserves denied/failed without titles', () => {
    const manifest = buildSelectedTreePartialFailure()
    expect(manifest.exportedCount).toBe(1)
    expect(manifest.failedCount).toBe(1)
    expect(manifest.deniedCount).toBe(1)
    const denied = manifest.items.find((i) => i.status === 'denied')
    expect(denied?.reasonCode).toBe('HIDDEN_SOURCE_DENIAL')
    expect(denied?.byteCount).toBeUndefined()
    expect(denied?.contentHash).toBeUndefined()
  })

  it('confirm result fixture shape', () => {
    const result = buildMarkdownConfirmResult()
    expect(result.documentId).toBe(42)
    expect(result.mode).toBe('create')
    expect(result.warningCodes).toEqual([])
  })

  it('manifest fixture is deterministic', () => {
    const m1 = buildMarkdownBundleManifest()
    const m2 = buildMarkdownBundleManifest()
    expect(JSON.stringify(m1)).toBe(JSON.stringify(m2))
  })
})

describe('large bounded fixture (P1)', () => {
  it('large fixture stays within import byte/line limits', () => {
    const large = buildLargeMarkdownFixture(490)
    expect(large.length).toBeLessThanOrEqual(100_000)
    expect(large.split('\n').length).toBeLessThanOrEqual(2000)
    expect(normalizeMarkdownText(large)).toBe(large)
  })

  it('large fixture normalization, snippet and hashing finish within budget', () => {
    const large = buildLargeMarkdownFixture(490)
    const start = Date.now()
    const normalized = normalizeMarkdownText(large)
    extractMarkdownSnippet(large)
    computeMarkdownPreviewHash({ normalizedContent: normalized, mode: 'create', title: '大文档' })
    markdownFnv1aHash(large)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)
    expect(MARKDOWN_BUNDLE_MAX_ITEMS).toBe(500)
  })
})
