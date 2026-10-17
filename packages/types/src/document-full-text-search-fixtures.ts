/**
 * v3-document-full-text-search — 测试 fixtures 与 builders
 */

import type {
  DocumentSearchEntry,
  DocumentSearchStatus,
  DocumentSearchRebuildResult,
  DocumentSearchLifecycle,
} from './document-full-text-search.js'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

let _nextId = 10_000

function nextId(): number {
  return _nextId++
}

export function buildDocumentSearchEntry(
  overrides: Partial<DocumentSearchEntry> = {},
): DocumentSearchEntry {
  const id = overrides.id ?? nextId()
  return {
    id,
    organizationId: overrides.organizationId ?? 1,
    projectId: overrides.projectId ?? 1,
    documentId: overrides.documentId ?? id,
    title: overrides.title ?? '测试文档',
    contentHash: overrides.contentHash ?? 'abc12345' + '000a',
    contentText: overrides.contentText ?? '这是测试文档的正文内容。包含一些中文文本用于搜索测试。',
    contentLength: overrides.contentLength ?? 30,
    truncated: overrides.truncated ?? false,
    version: overrides.version ?? 1,
    lifecycle: overrides.lifecycle ?? ('active' as DocumentSearchLifecycle),
    deletedAt: overrides.deletedAt ?? null,
    indexedAt: overrides.indexedAt ?? '2026-08-03T10:00:00.000Z',
    createdAt: overrides.createdAt ?? '2026-08-03T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-08-03T10:00:00.000Z',
  }
}

export function buildDocumentSearchStatus(
  overrides: Partial<DocumentSearchStatus> = {},
): DocumentSearchStatus {
  return {
    totalIndexable: overrides.totalIndexable ?? 10,
    indexed: overrides.indexed ?? 9,
    staleOrMissing: overrides.staleOrMissing ?? 1,
    truncated: overrides.truncated ?? 0,
    lastIndexedAt: overrides.lastIndexedAt ?? '2026-08-03T10:00:00.000Z',
  }
}

export function buildDocumentSearchRebuildResult(
  overrides: Partial<DocumentSearchRebuildResult> = {},
): DocumentSearchRebuildResult {
  return {
    runId: overrides.runId ?? 'run-001',
    indexed: overrides.indexed ?? 10,
    skipped: overrides.skipped ?? 2,
    removed: overrides.removed ?? 1,
    truncated: overrides.truncated ?? 0,
    warnings: overrides.warnings ?? [],
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const fixtureShortDocument = {
  name: '项目章程',
  content:
    '# 项目章程\n\n本项目旨在构建一个AI优先的项目管理平台。\n\n## 目标\n\n- 用一句话启动项目\n- AI自动生成完整计划\n- 专业PM可控',
} as const

export const fixtureLongTruncatedDocument = {
  name: '长篇技术规范',
  content:
    '# 长篇技术规范\n\n' +
    '这是一段很长的文档正文内容。'.repeat(3000) +
    '\n\n## 结尾\n\n以上为全部规范内容。',
} as const

export const fixtureMarkdownRichDocument = {
  name: 'Markdown 丰富文档',
  content: [
    '# 产品需求文档',
    '',
    '## 概述',
    '',
    '这是一个 **重要的** 产品需求文档。包含 *斜体* 和 `code` 示例。',
    '',
    '### 技术方案',
    '',
    '```typescript',
    'const greeting = "hello world"',
    'console.log(greeting)',
    '```',
    '',
    '参考链接：[Google](https://google.com) 和 [GitHub](https://github.com)',
    '',
    '### 数据表格',
    '',
    '| 字段 | 类型 | 说明 |',
    '|------|------|------|',
    '| id | number | 主键 |',
    '| name | string | 名称 |',
    '',
    '<!-- 以下是旧版本内容，已废弃 -->',
    '',
    '> 这是一个引用块。',
    '',
    '1. 第一步',
    '2. 第二步',
    '3. 第三步',
    '',
    '---',
    '',
    '![架构图](https://example.com/arch.png)',
    '',
    '最终确认：**通过**。',
  ].join('\n'),
} as const

/** fixture 长文档正文（超过 50k 用于截断测试） */
export function makeLongDocumentFixture(length: number = 50_001): {
  name: string
  content: string
} {
  return {
    name: '超长文档',
    content: 'A'.repeat(length),
  }
}
