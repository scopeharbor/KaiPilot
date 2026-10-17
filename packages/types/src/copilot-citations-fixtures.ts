// @aiproj/types — V3 Copilot 引用合约 fixtures
// 覆盖五种引用状态：完整出处、缺 URL、缺抓取时间、多结论、漂移
// 以及内部/外部标签和可观测性记录的正常/异常用例

import type {
  CopilotCitation,
  CopilotCitationRender,
  CopilotExternalRetrievalObservabilityRecord,
} from './copilot-citations.js'
import { generateCitationId } from './copilot-citations.js'

// ---------------------------------------------------------------------------
// 引用 fixtures
// ---------------------------------------------------------------------------

/** 带完整出处的引用（happy path）。 */
export function makeCitationWithProvenance(overrides?: Partial<CopilotCitation>): CopilotCitation {
  return {
    citationId: generateCitationId('https://example.com/article', '2026-08-18T10:00:00Z'),
    url: 'https://example.com/article',
    title: '行业标准工期分析',
    fetchedAt: '2026-08-18T10:00:00Z',
    snapshotHash: 'abc123def456',
    supportedConclusionIds: ['conc-001'],
    ...overrides,
  }
}

/** 缺少 URL 的引用 — 应被抑制。 */
export function makeCitationWithoutUrl(): CopilotCitation {
  return {
    citationId: 'cit_no_url',
    url: '', // 缺失
    title: '无出处条目',
    fetchedAt: '2026-08-18T10:00:00Z',
    snapshotHash: 'hash1',
    supportedConclusionIds: ['conc-no-url'],
  }
}

/** 缺少抓取时间的引用 — 应被抑制。 */
export function makeCitationWithoutFetchTime(): CopilotCitation {
  return {
    citationId: 'cit_no_time',
    url: 'https://example.com/missing-time',
    title: '无抓取时间条目',
    fetchedAt: '', // 缺失
    snapshotHash: 'hash2',
    supportedConclusionIds: ['conc-no-time'],
  }
}

/** 同一 URL 支持多个结论的引用。 */
export function makeCitationMultiConclusion(): CopilotCitation {
  return {
    citationId: generateCitationId('https://example.com/multi', '2026-08-18T11:00:00Z'),
    url: 'https://example.com/multi',
    title: '多结论来源',
    fetchedAt: '2026-08-18T11:00:00Z',
    snapshotHash: 'multi_hash_001',
    supportedConclusionIds: ['conc-002', 'conc-003', 'conc-004'],
  }
}

/** 快照已漂移的引用。 */
export function makeCitationDrifted(): CopilotCitation {
  return {
    citationId: generateCitationId('https://example.com/changed', '2026-08-17T09:00:00Z'),
    url: 'https://example.com/changed',
    title: '已变更来源',
    fetchedAt: '2026-08-17T09:00:00Z',
    snapshotHash: 'old_snapshot_hash',
    supportedConclusionIds: ['conc-drifted'],
  }
}

// ---------------------------------------------------------------------------
// 渲染 fixtures
// ---------------------------------------------------------------------------

/** 带脚注编号的引用渲染。 */
export function makeCitationRender(
  citation?: CopilotCitation,
  overrides?: Partial<CopilotCitationRender>,
): CopilotCitationRender {
  return {
    citation: citation ?? makeCitationWithProvenance(),
    footNoteIndex: 1,
    isDrifted: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 来源类型标签 fixtures
// ---------------------------------------------------------------------------

/** 内部来源标签（无需 URL）。 */
export function makeInternalSourceLabel() {
  return {
    provenance: 'internal' as const,
    label: '项目数据',
    nonDismissible: true as const,
  }
}

/** 外部来源标签。 */
export function makeExternalSourceLabel() {
  return {
    provenance: 'external' as const,
    label: '外部来源',
    nonDismissible: true as const,
  }
}

// ---------------------------------------------------------------------------
// 可观测性记录 fixtures
// ---------------------------------------------------------------------------

/** 安全的可观测性记录（仅含域名 + 计数）。 */
export function makeObservabilityRecord(
  overrides?: Partial<CopilotExternalRetrievalObservabilityRecord>,
): CopilotExternalRetrievalObservabilityRecord {
  return {
    recordId: 'obs_test_001',
    organizationId: 'org-001',
    domain: 'example.com',
    citationsPresented: 3,
    citationsActivated: 1,
    injectionInterceptions: 0,
    recordedAt: '2026-08-18T12:00:00Z',
    ...overrides,
  }
}

/** 不安全的可观测性记录（用于负面测试 — 泄露查询文本）。 */
export function makeUnsafeObservabilityRecord(): Record<string, unknown> {
  return {
    recordId: 'obs_unsafe_001',
    organizationId: 'org-001',
    domain: 'example.com',
    queryText: '行业标准工期', // 泄露 — 敏感字段
    fullUrl: 'https://example.com/search?q=行业标准工期', // 泄露
    citationsPresented: 2,
    citationsActivated: 0,
    injectionInterceptions: 0,
    recordedAt: '2026-08-18T12:00:00Z',
  }
}
