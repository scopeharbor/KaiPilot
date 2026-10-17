// v3-document-markdown-import-export —— 共享 fixture builders（前后端测试共用）。
// 覆盖：valid create / valid replace / unsupported warnings / oversized / stale replacement /
// read-only export / selected-tree partial failure / hidden source denial。

import {
  computeMarkdownPreviewHash,
  computeMarkdownSourceDocumentHash,
  normalizeMarkdownText,
  safeMarkdownFilename,
  summarizeMarkdownExportManifest,
  type MarkdownExportBundleManifest,
  type MarkdownExportTreeResult,
  type MarkdownImportMode,
  type MarkdownImportPreview,
  type MarkdownImportPreviewRequest,
  type MarkdownImportPreviewTarget,
  type MarkdownImportConfirmRequest,
  type MarkdownImportConfirmResult,
  type MarkdownWarning,
} from './document-markdown-import-export.js'

export const mdFixtureContent =
  '# 项目启动计划\n\n本文件描述项目启动阶段的任务分解与里程碑。\n\n## 阶段一\n\n- 需求确认\n- 计划评审\n'

export const mdFixtureWithFrontmatter = [
  '---',
  'title: 产品需求说明',
  '---',
  '',
  '# 概述',
  '',
  '一段正文。',
  '',
].join('\n')

export const mdFixtureUnsupportedFeatures = [
  '# 混合内容',
  '',
  '<div class="note">原始 HTML 块</div>',
  '',
  '![远程图片](https://example.com/image.png)',
  '',
  '引用本地文件：`C:\\Users\\x\\notes\\draft.md`',
  '',
  '## 二级',
  '### 三级',
  '#### 四级',
  '##### 五级',
  '###### 六级',
  '####### 七级标题（过深）',
  '',
].join('\n')

// ---------------------------------------------------------------------------
// preview fixtures
// ---------------------------------------------------------------------------

export function buildPreviewTarget(overrides?: Partial<MarkdownImportPreviewTarget>) {
  return {
    mode: 'create' as MarkdownImportMode,
    targetDocumentId: null,
    targetDocumentName: null,
    parentId: null,
    ...overrides,
  }
}

export function buildWarning(overrides?: Partial<MarkdownWarning>) {
  return {
    code: 'RAW_HTML' as const,
    message: '检测到原始 HTML 内容',
    snippet: '<div>…',
    count: 1,
    ...overrides,
  }
}

export function buildMarkdownImportPreview(
  overrides?: Partial<MarkdownImportPreview>,
): MarkdownImportPreview {
  const mode: MarkdownImportMode = overrides?.mode ?? 'create'
  const target = overrides?.target ?? buildPreviewTarget()
  const normalizedContent = overrides?.normalizedContent ?? mdFixtureContent
  const inferredTitle = overrides?.inferredTitle ?? '项目启动计划'
  const previewHash =
    overrides?.previewHash ??
    computeMarkdownPreviewHash({ normalizedContent, mode, title: inferredTitle })
  return {
    mode,
    normalizedContent,
    inferredTitle,
    safeTitle: safeMarkdownFilename(inferredTitle),
    byteCount: normalizedContent.length,
    lineCount: normalizedContent.split('\n').length,
    target,
    warnings: overrides?.warnings ?? [],
    previewHash,
    sourceDocumentHash: overrides?.sourceDocumentHash ?? null,
    allowedActions: overrides?.allowedActions ?? ['import', 'replace', 'export'],
  }
}

export function buildMarkdownPreviewRequest(
  overrides?: Partial<MarkdownImportPreviewRequest>,
): MarkdownImportPreviewRequest {
  return {
    mode: 'create',
    content: mdFixtureContent,
    originalFilename: 'plan.md',
    parentId: null,
    targetDocumentId: null,
    expectedSourceDocumentHash: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// confirm fixtures
// ---------------------------------------------------------------------------

export function buildMarkdownConfirmRequest(
  overrides?: Partial<MarkdownImportConfirmRequest>,
): MarkdownImportConfirmRequest {
  const mode: MarkdownImportMode = overrides?.mode ?? 'create'
  const content = overrides?.content ?? mdFixtureContent
  const normalized = normalizeMarkdownText(content)
  const title = overrides?.mode === 'replace' ? null : '项目启动计划'
  const previewHash =
    overrides?.previewHash ??
    computeMarkdownPreviewHash({ normalizedContent: normalized, mode, title })
  return {
    mode,
    content,
    originalFilename: 'plan.md',
    parentId: null,
    targetDocumentId: null,
    confirmed: true,
    previewHash,
    expectedSourceDocumentHash: null,
    ...overrides,
  }
}

export function buildMarkdownConfirmResult(
  overrides?: Partial<MarkdownImportConfirmResult>,
): MarkdownImportConfirmResult {
  return {
    documentId: 42,
    mode: 'create',
    name: '项目启动计划.md',
    previewHash: 'abc123',
    sourceDocumentHash: null,
    byteCount: mdFixtureContent.length,
    warningCodes: [],
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// replace / stale fixtures
// ---------------------------------------------------------------------------

export function buildReplacePreview(
  overrides?: Partial<MarkdownImportPreview>,
): MarkdownImportPreview {
  const targetDocumentId = 7
  const content = overrides?.normalizedContent ?? '# 新版本正文\n\n更新内容。\n'
  const mode: MarkdownImportMode = 'replace'
  const sourceDocumentHash =
    overrides?.sourceDocumentHash ??
    computeMarkdownSourceDocumentHash({ documentId: targetDocumentId, content: '旧版本正文\n' })
  const preview = buildMarkdownImportPreview({
    mode,
    normalizedContent: content,
    target: buildPreviewTarget({ mode, targetDocumentId, targetDocumentName: '旧文档.md' }),
    inferredTitle: null,
    safeTitle: null,
    sourceDocumentHash,
    ...overrides,
  })
  preview.previewHash = computeMarkdownPreviewHash({
    normalizedContent: content,
    mode,
    title: preview.inferredTitle,
    targetDocumentId,
  })
  return preview
}

export function buildStaleReplacePreview(
  overrides?: Partial<MarkdownImportPreview>,
): MarkdownImportPreview {
  return buildReplacePreview({
    warnings: [
      {
        code: 'STALE_SOURCE',
        message: '源文档自预览后已变更',
        count: 1,
      },
    ],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// export fixtures
// ---------------------------------------------------------------------------

export function buildSingleExportResult(overrides?: {
  filename?: string
  content?: string
  contentHash?: string
  byteCount?: number
  source?: { documentId: number; name: string }
}) {
  const content = overrides?.content ?? mdFixtureContent
  return {
    filename: overrides?.filename ?? '项目启动计划.md',
    content,
    contentHash: overrides?.contentHash ?? 'deadbeef',
    byteCount: overrides?.byteCount ?? content.length,
    source: overrides?.source ?? { documentId: 7, name: '项目启动计划.md' },
  }
}

export function buildMarkdownBundleManifest(
  overrides?: Partial<MarkdownExportBundleManifest>,
): MarkdownExportBundleManifest {
  return summarizeMarkdownExportManifest(
    overrides?.items ?? [
      { documentId: 1, path: 'docs/A.md', status: 'exported', byteCount: 10, contentHash: 'a1' },
      { documentId: 2, path: 'docs/B.md', status: 'exported', byteCount: 20, contentHash: 'b2' },
    ],
  )
}

export function buildSelectedTreePartialFailure(): MarkdownExportBundleManifest {
  return summarizeMarkdownExportManifest([
    { documentId: 1, path: 'docs/A.md', status: 'exported', byteCount: 10, contentHash: 'a1' },
    { documentId: 3, path: 'docs/C.md', status: 'denied', reasonCode: 'HIDDEN_SOURCE_DENIAL' },
    { documentId: 4, path: 'docs/D.md', status: 'failed', reasonCode: 'MISSING_CONTENT' },
  ])
}

export function buildMarkdownExportTreeResult(
  overrides?: Partial<MarkdownExportTreeResult>,
): MarkdownExportTreeResult {
  const manifest = overrides?.manifest ?? buildMarkdownBundleManifest()
  const content =
    overrides?.content ?? '# 导出文档集\n\n## docs/A.md\n\n内容 A\n\n## docs/B.md\n\n内容 B\n'
  return {
    filename: 'documents.md',
    content,
    bundleHash: overrides?.bundleHash ?? 'bundle-hash',
    byteCount: content.length,
    manifest,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 大尺寸有界 fixture（P1：性能测试用）
// ---------------------------------------------------------------------------

export function buildLargeMarkdownFixture(lines = 490): string {
  const parts: string[] = ['# 大文档', '']
  for (let i = 1; i <= lines; i++) {
    parts.push(
      `## 章节 ${i}`,
      '',
      `第 ${i} 章正文，包含一些**加粗**与 [链接](https://example.com/link) 文本。`,
      '',
    )
  }
  return parts.join('\n')
}
