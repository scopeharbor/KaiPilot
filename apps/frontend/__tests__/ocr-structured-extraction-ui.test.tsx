/**
 * OCR Structured Extraction — Frontend UI Component Tests (v3-ocr-structured-extraction §6.12)
 *
 * 测试结构化提取审查面组件：字段审查、表格审查、stale 阻断、只读状态、红线提示。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('@/hooks/use-ocr-structured-extraction', () => ({
  useOcrExtractionProfiles: vi.fn(),
  useOcrExtractionRuns: vi.fn(),
  useOcrExtractionRun: vi.fn(),
  useOcrExtractionCandidates: vi.fn(),
  useCreateOcrExtractionRun: vi.fn(),
  useOcrStructuredExtractionPreview: vi.fn(),
  useOcrStructuredExtractionSave: vi.fn(),
}))

import {
  useOcrExtractionProfiles,
  useOcrExtractionRuns,
  useOcrExtractionRun,
  useOcrExtractionCandidates,
  useCreateOcrExtractionRun,
  useOcrStructuredExtractionPreview,
  useOcrStructuredExtractionSave,
} from '@/hooks/use-ocr-structured-extraction'
import OcrStructuredExtractionReview from '@/components/views/ocr/ocr-structured-extraction-review'

// ─── Mock hooks ───────────────────────────────────────────────────────────

const mockProfilesData = {
  data: [
    {
      profileId: 1,
      name: '会议纪要',
      scope: 'builtin',
      status: 'active',
      schemaKey: 'meeting-minutes',
      currentVersion: 1,
      totalRuns: 3,
      description: '提取会议纪要',
      organizationId: 1,
      projectId: null,
      createdAt: '2025-06-01T00:00:00Z',
      updatedAt: '2025-06-01T00:00:00Z',
    },
    {
      profileId: 2,
      name: '行动事项表',
      scope: 'builtin',
      status: 'active',
      schemaKey: 'action-items',
      currentVersion: 1,
      totalRuns: 1,
      description: '提取行动事项',
      organizationId: 1,
      projectId: null,
      createdAt: '2025-06-01T00:00:00Z',
      updatedAt: '2025-06-01T00:00:00Z',
    },
  ],
  meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
}

const mockRunsData = {
  data: [
    {
      runId: 1,
      extractionId: 1,
      profileId: 1,
      profileName: '会议纪要',
      profileVersion: 1,
      status: 'completed',
      totalFieldCandidates: 3,
      totalTableCandidates: 0,
      warningCount: 1,
      errorCount: 0,
      provenance: 'deterministic',
      createdBy: 1,
      createdAt: '2025-06-15T10:00:00Z',
      completedAt: '2025-06-15T10:01:00Z',
      allowedActions: ['view', 'review', 'preview_confirm', 'confirm'],
    },
  ],
  meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
}

const mockRunDetail = {
  data: {
    runId: 1,
    extractionId: 1,
    profileId: 1,
    profileName: '会议纪要',
    profileVersion: 1,
    status: 'completed',
    totalFieldCandidates: 3,
    totalTableCandidates: 0,
    warningCount: 1,
    errorCount: 0,
    provenance: 'deterministic' as const,
    createdBy: 1,
    createdAt: '2025-06-15T10:00:00Z',
    completedAt: '2025-06-15T10:01:00Z',
    allowedActions: ['view', 'review', 'preview_confirm', 'confirm'],
    extractionSummary: {
      extractionId: 1,
      sourceHash: 'abcd1234',
      candidateHash: 'efgh5678',
      selectedTextHash: 'ijkl9012',
      pageRefs: [0],
      sourceKind: 'attachment',
      sourceName: 'meeting.pdf',
      confirmedAt: '2025-06-15T09:00:00Z',
      status: 'current',
    },
    inputSignature: 'sig001',
    idempotencyKey: 'key001',
    sourceHash: 'abcd1234',
    fieldCandidates: [
      {
        candidateId: 1,
        runId: 1,
        sectionKey: 'meeting_info',
        fieldKey: 'subject',
        fieldType: 'text',
        raw: 'Q3项目启动会议',
        value: { kind: 'text', raw: 'Q3项目启动会议', normalized: 'Q3项目启动会议' },
        confidence: 'high',
        confidenceScore: 0.95,
        spanRef: { pageIndex: 0, charStart: 0, charEnd: 20 },
        sourceSpanHash: 'span001',
        candidateHash: 'cand001',
        warnings: [],
        provenance: 'deterministic',
        status: 'generated',
        createdAt: '2025-06-15T10:00:00Z',
      },
      {
        candidateId: 2,
        runId: 1,
        sectionKey: 'meeting_info',
        fieldKey: 'date',
        fieldType: 'date',
        raw: '2025年6月15日',
        value: {
          kind: 'date',
          raw: '2025年6月15日',
          normalized: '2025-06-15',
          parsed: { year: 2025, month: 6, day: 15 },
        },
        confidence: 'high',
        confidenceScore: 0.9,
        spanRef: { pageIndex: 0, charStart: 20, charEnd: 40 },
        sourceSpanHash: 'span002',
        candidateHash: 'cand002',
        warnings: [],
        provenance: 'deterministic',
        status: 'generated',
        createdAt: '2025-06-15T10:00:00Z',
      },
      {
        candidateId: 3,
        runId: 1,
        sectionKey: 'meeting_info',
        fieldKey: 'location',
        fieldType: 'text',
        raw: '',
        value: null,
        confidence: 'low',
        confidenceScore: 0.05,
        spanRef: null,
        sourceSpanHash: 'span003',
        candidateHash: 'cand003',
        warnings: [
          {
            code: 'MISSING_REQUIRED_FIELD',
            message: '缺少必填字段',
            fieldKey: 'location',
            severity: 'error' as const,
          },
        ],
        provenance: 'deterministic',
        status: 'generated',
        createdAt: '2025-06-15T10:00:00Z',
      },
    ],
    tableCandidates: [],
    warningSummary: {
      totalWarnings: 1,
      totalErrors: 1,
      topCodes: ['MISSING_REQUIRED_FIELD'],
      topFields: ['location'],
      hasBlockingErrors: true,
    },
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * 注：本文件原先不渲染任何组件——`renderWithPermission` 只是把入参原样返回，
 * 其余用例断言的也是用例内部自己写死的字面量（如 `const actions = [...]` 后再断言
 * 它不含 confirm），所以组件怎么改都不会失败。现改为真正挂载
 * `OcrStructuredExtractionReview` 并 mock 其数据 hooks。
 */
function mockQuery(data: unknown, isLoading = false) {
  return { data, isLoading, isError: false, error: null } as never
}

function mockMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  } as never
}

const CANDIDATES = {
  data: {
    runId: 1,
    fields: mockRunDetail.data.fieldCandidates,
    tables: [],
  },
}

/** 运行行是 role="button" 的 div，标题被拆成多个文本节点，按角色定位 */
function selectFirstRun() {
  const row = screen.getAllByRole('button').find((el) => el.textContent?.includes('会议纪要'))
  expect(row).toBeTruthy()
  fireEvent.click(row!)
}

/** 默认全部放行；各用例按需覆盖 */
function primeHooks(
  overrides: {
    runs?: unknown
    runDetail?: unknown
    candidates?: unknown
    candidatesLoading?: boolean
  } = {},
) {
  vi.mocked(useOcrExtractionProfiles).mockReturnValue(mockQuery(mockProfilesData))
  vi.mocked(useOcrExtractionRuns).mockReturnValue(mockQuery(overrides.runs ?? mockRunsData))
  vi.mocked(useOcrExtractionRun).mockReturnValue(mockQuery(overrides.runDetail ?? mockRunDetail))
  vi.mocked(useOcrExtractionCandidates).mockReturnValue(
    mockQuery(overrides.candidates ?? CANDIDATES, overrides.candidatesLoading ?? false),
  )
  vi.mocked(useCreateOcrExtractionRun).mockReturnValue(mockMutation())
  vi.mocked(useOcrStructuredExtractionPreview).mockReturnValue(mockMutation())
  vi.mocked(useOcrStructuredExtractionSave).mockReturnValue(mockMutation())
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('OcrStructuredExtractionReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primeHooks()
  })

  describe('运行列表与空态', () => {
    it('渲染 profile 与运行列表', () => {
      render(<OcrStructuredExtractionReview projectId={7} />)

      expect(screen.getByText('提取运行')).toBeTruthy()
      // 运行行标题被拆成多个文本节点（名称 + v + 版本号），用正则匹配整行
      expect(screen.getAllByText(/会议纪要 v1/).length).toBeGreaterThan(0)
    })

    it('无运行时给出中文空态而不是空白', () => {
      primeHooks({ runs: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 1 } } })
      render(<OcrStructuredExtractionReview projectId={7} />)

      expect(screen.getByText('暂无提取运行')).toBeTruthy()
    })

    it('未选择运行时提示先选运行', () => {
      render(<OcrStructuredExtractionReview projectId={7} />)

      expect(screen.getByText('请从上方运行列表中选择一个运行来审查提取结果')).toBeTruthy()
    })
  })

  describe('字段候选审查', () => {
    it('选中运行后渲染字段候选与置信度', () => {
      render(<OcrStructuredExtractionReview projectId={7} />)
      selectFirstRun()

      expect(screen.getByText('Q3项目启动会议')).toBeTruthy()
      // 三条字段候选都应渲染出 fieldKey（告警文案在 Tooltip 内，默认不入 DOM）
      expect(screen.getByText('location')).toBeTruthy()
      expect(screen.getByText('subject')).toBeTruthy()
    })

    it('候选为空时给出中文提示', () => {
      primeHooks({ candidates: { data: { runId: 1, fields: [], tables: [] } } })
      render(<OcrStructuredExtractionReview projectId={7} />)
      selectFirstRun()

      expect(screen.getByText('该运行暂无可审查的候选数据')).toBeTruthy()
    })
  })

  describe('权限降级', () => {
    it('readOnly 时给出只读提示且不出现创建运行按钮', () => {
      render(<OcrStructuredExtractionReview projectId={7} readOnly />)

      expect(
        screen.getByText('您当前为只读访问。如需创建运行或确认提取结果，请联系项目管理员。'),
      ).toBeTruthy()
      expect(screen.queryByText('创建运行')).toBeNull()
    })

    it('allowedActions 不含 confirm 时不出现预览确认按钮', () => {
      primeHooks({
        runDetail: {
          data: { ...mockRunDetail.data, allowedActions: ['view', 'review'] },
        },
      })
      render(<OcrStructuredExtractionReview projectId={7} />)
      selectFirstRun()

      expect(screen.queryByText('预览确认')).toBeNull()
    })

    it('allowedActions 含 confirm 时出现预览确认按钮', () => {
      render(<OcrStructuredExtractionReview projectId={7} />)
      selectFirstRun()

      expect(screen.getByText('预览确认')).toBeTruthy()
    })
  })

  describe('stale 阻断', () => {
    it('来源被截断时给出过期告警且预览按钮禁用', () => {
      primeHooks({
        runDetail: {
          data: {
            ...mockRunDetail.data,
            warningSummary: {
              ...mockRunDetail.data.warningSummary,
              topCodes: ['SOURCE_TRUNCATED'],
            },
          },
        },
      })
      render(<OcrStructuredExtractionReview projectId={7} />)
      selectFirstRun()

      expect(
        screen.getByText(
          '来源文件可能已变更，当前候选数据可能已过时。建议重新运行提取以获得最新结果。',
        ),
      ).toBeTruthy()
      const previewBtn = screen.getByText('预览确认').closest('button')
      expect(previewBtn?.disabled).toBe(true)
    })

    it('来源正常时不出现过期告警', () => {
      render(<OcrStructuredExtractionReview projectId={7} />)
      selectFirstRun()

      expect(screen.queryByText(/当前候选数据可能已过时/)).toBeNull()
    })
  })
})

// ─── 纯数据契约（不依赖渲染） ─────────────────────────────────────────────

describe('提取运行数据契约', () => {
  it('字段候选携带来源溯源信息', () => {
    const fc = mockRunDetail.data.fieldCandidates[0]!
    expect(fc.spanRef).not.toBeNull()
    expect(fc.sourceSpanHash).toBeTruthy()
    expect(fc.confidenceScore).toBeGreaterThanOrEqual(0.8)
  })

  it('日期字段带结构化 parsed 值', () => {
    const fc = mockRunDetail.data.fieldCandidates[1]!
    expect(fc.fieldType).toBe('date')
    expect((fc.value as { parsed: unknown }).parsed).toEqual({ year: 2025, month: 6, day: 15 })
  })

  it('缺失必填字段带 error 级告警', () => {
    const fc = mockRunDetail.data.fieldCandidates[2]!
    expect(fc.confidence).toBe('low')
    expect(fc.warnings[0]!.code).toBe('MISSING_REQUIRED_FIELD')
    expect(fc.warnings[0]!.severity).toBe('error')
  })
})
