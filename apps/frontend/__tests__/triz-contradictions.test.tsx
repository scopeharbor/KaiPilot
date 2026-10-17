import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ContradictionSummaryCard } from '@/components/layout/ProjectHeader'
import ProjectContradictionsPage from '@/app/(dashboard)/projects/[id]/contradictions/page'
import {
  trizContradictionKeys,
  trizContradictionsApi,
  type ListContradictionsResponse,
} from '@/lib/api/triz-contradictions'
import type { ContradictionDTO } from '@aiproj/types'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  } as Response
}

const mockHooks = vi.hoisted(() => ({
  listData: undefined as ListContradictionsResponse | undefined,
  listLoading: false,
  refreshMutate: vi.fn(),
  confirmMutate: vi.fn(),
  dismissMutate: vi.fn(),
  explainMutate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '42' }),
}))

vi.mock('@/hooks/use-triz-contradictions', () => ({
  useTrizContradictions: () => ({
    data: mockHooks.listData,
    isLoading: mockHooks.listLoading,
  }),
  useRefreshTrizContradictions: () => ({
    mutate: mockHooks.refreshMutate,
    isPending: false,
  }),
  useConfirmTrizContradiction: () => ({
    mutate: mockHooks.confirmMutate,
    isPending: false,
  }),
  useDismissTrizContradiction: () => ({
    mutate: mockHooks.dismissMutate,
    isPending: false,
  }),
  useExplainTrizContradiction: () => ({
    mutate: mockHooks.explainMutate,
    isPending: false,
  }),
}))

function contradiction(overrides: Partial<ContradictionDTO> = {}): ContradictionDTO {
  return {
    id: 1,
    organizationId: 1,
    projectId: 42,
    key: 'pc:42:d-test',
    dedupeKey: 'd-test',
    type: 'technical',
    status: 'draft',
    ruleId: 'CD-001',
    ruleVersion: '1.0.0',
    severity: 'high',
    confidence: 0.8,
    improvingParameterKey: 'duration',
    worseningParameterKey: 'cost',
    improvingDirection: '为追赶工期压缩进度',
    worseningDirection: '赶工成本上升',
    parameterKey: null,
    requirementA: null,
    requirementB: null,
    title: '压缩工期会抬高成本',
    evidence: [
      {
        entityType: 'task',
        entityId: 0,
        title: 'task 聚合',
        detail: '逾期任务驱动工期压力',
        isVisible: true,
      },
    ],
    suggestedPrinciples: [
      {
        principleId: 'segmentation',
        name: '分割/分解',
        relevance: 0.9,
        advice: '将大任务拆分为更小阶段或子任务',
      },
    ],
    inputSignature: 'tcd-1',
    outputHash: 'out-1',
    stale: false,
    staleReason: null,
    relatedChangeRequestId: null,
    confirmedBy: null,
    confirmedAt: null,
    dismissedBy: null,
    dismissedAt: null,
    dismissReason: null,
    aiExplanation: null,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('TRIZ contradictions frontend', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockHooks.listData = undefined
    mockHooks.listLoading = false
  })

  test('API list 使用项目 contradictions 路径', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 1 } }),
        ),
    )

    await trizContradictionsApi.list(42, { status: 'draft' })

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/projects/42/contradictions?status=draft'),
      expect.anything(),
    )
  })

  test('API refresh 使用 POST', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: {
            created: 1,
            unchanged: 0,
            superseded: 0,
            total: 1,
            ruleVersion: '1.0.0',
            inputSignature: 'tcd-1',
            outputHash: 'out-1',
          },
        }),
      ),
    )

    await trizContradictionsApi.refresh(42)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/projects/42/contradictions/refresh'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('query keys encode project and filters', () => {
    expect(trizContradictionKeys.list(42, { status: 'confirmed' })).toEqual([
      'triz-contradictions',
      'list',
      42,
      { status: 'confirmed' },
    ])
  })

  test('页面渲染空态', () => {
    mockHooks.listData = {
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 1 },
    }

    render(<ProjectContradictionsPage />)

    expect(screen.getByText('项目矛盾')).toBeInTheDocument()
    expect(screen.getByText('暂无派生矛盾')).toBeInTheDocument()
  })

  test('页面渲染列表、详情和 AI fallback', () => {
    mockHooks.listData = {
      data: [
        contradiction({
          aiExplanation: {
            narrative: '规则摘要 fallback',
            isFallback: true,
            hallucinationChecked: true,
            degradedReason: 'AI 草稿未通过校验',
            referencedPrincipleIds: ['segmentation'],
            referencedParameterKeys: ['duration', 'cost'],
            confidence: 0.6,
            provider: 'fake',
            model: 'fixture',
            needsConfirmation: true,
          },
        }),
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }

    render(<ProjectContradictionsPage />)

    expect(screen.getAllByText('压缩工期会抬高成本')[0]).toBeInTheDocument()
    expect(screen.getByText('分割/分解')).toBeInTheDocument()
    expect(screen.getByText('规则摘要 fallback')).toBeInTheDocument()
    expect(screen.getByText('AI 草稿未通过校验')).toBeInTheDocument()
  })

  test('Dashboard 摘要卡展示低敏 Top 项并支持权限脱敏', () => {
    const { rerender } = render(
      <ContradictionSummaryCard
        projectId={42}
        loading={false}
        summary={{
          unresolvedCount: 1,
          staleCount: 0,
          warnings: [],
          topContradictions: [
            {
              id: 1,
              type: 'technical',
              title: '压缩工期会抬高成本',
              severity: 'high',
              improvingParameterKey: 'duration',
              worseningParameterKey: 'cost',
              parameterKey: null,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('未解决矛盾')).toBeInTheDocument()
    expect(screen.getByText('压缩工期会抬高成本')).toBeInTheDocument()
    expect(screen.getByText('工期/进度 ↔ 成本')).toBeInTheDocument()

    rerender(
      <ContradictionSummaryCard
        projectId={42}
        loading={false}
        summary={{
          unresolvedCount: 0,
          staleCount: 0,
          warnings: ['CONTRADICTION_PERMISSION_REDACTED'],
          topContradictions: [],
        }}
      />,
    )

    expect(screen.getByText('当前角色无权查看矛盾摘要。')).toBeInTheDocument()
    expect(screen.queryByText('查看全部')).not.toBeInTheDocument()
  })
})
