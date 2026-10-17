import TrizInnovationWorkbenchPage from '@/app/(dashboard)/projects/[id]/triz-workbench/page'
import { useAuthStore } from '@/stores/auth-store'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accessTokenWith } from './_jwt-helper'
import type {
  InnovationSchemeDTO,
  InnovationSourceRef,
  InnovationWorkbenchSourcesResponse,
} from '@aiproj/types'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
}))

const mutations = {
  create: vi.fn(),
  addOption: vi.fn(),
  compare: vi.fn(),
  narrative: vi.fn(),
  handoff: vi.fn(),
}

let sourceQueryState: {
  data?: InnovationWorkbenchSourcesResponse['data']
  isLoading: boolean
  isError?: boolean
}
let schemesQueryState: {
  data?: {
    data: InnovationSchemeDTO[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }
  isLoading: boolean
  isError?: boolean
}

const contradictionSource: InnovationSourceRef = {
  sourceType: 'contradiction',
  ref: 'pc-iw-1',
  hash: 'sig-iw-1',
  severity: 'high',
  stale: true,
  title: '工期与资源负载对立',
}

const sourceData: InnovationWorkbenchSourcesResponse['data'] = {
  contradictions: [contradictionSource],
  analysisArtifacts: [
    {
      artifactId: 'ta-iw-1',
      compilerRunId: 11,
      contentHash: 'ch-iw-1',
      status: 'completed',
      warningCount: 1,
      blockingWarningCount: 0,
      resolutionPathCount: 2,
      stale: false,
      calculatedAt: '2026-07-16T00:00:00.000Z',
    },
  ],
  includeDraft: false,
}

const scheme: InnovationSchemeDTO = {
  schemeId: 'iw-1',
  organizationId: 1,
  projectId: 1,
  name: '方案 A',
  note: null,
  options: [
    {
      optionId: 'opt-1',
      origin: 'deterministic_mapping',
      sourceRefs: [contradictionSource],
      selectedPathId: null,
      principleIds: ['segmentation'],
      name: '分段交付候选',
      description: '仅作为待审核建议',
      applicability: ['关键路径密度高'],
      nonApplicability: [],
      hashes: {
        contradictionSignatures: ['sig-iw-1'],
        analysisContentHashes: [],
        selectedPathId: null,
      },
      warnings: [{ code: 'STALE_SOURCE_CONTRADICTION', severity: 'warning', message: 'stale' }],
      impact: {
        schedule: 'improves',
        resource_load: 'neutral',
        risk: 'neutral',
        scope_flexibility: 'neutral',
        quality_maintainability: 'neutral',
        change_complexity: 'worsens',
      },
      reviewState: 'pending',
      createdBy: 1,
    },
  ],
  scores: {
    'opt-1': {
      total: 88,
      severity: 20,
      confidence: 10,
      stalePenalty: -10,
      warningPenalty: -2,
      applicability: 2,
      constraintFit: 5,
      hashCompleteness: 5,
      reviewState: 3,
    },
  },
  status: 'open',
  reviewState: 'pending',
  handoff: {
    status: 'candidate_created',
    draftSessionRef: 'draft_iw_1',
    handedOffAt: null,
    blockedReason: null,
  },
  narrative: {
    narrative: '规则摘要：请以确定性评分和来源 refs 为准。',
    isFallback: true,
    hallucinationChecked: true,
    hallucinationPassed: false,
    degradedReason: '模型不可用',
    referencedOptionIds: ['opt-1'],
    referencedPrincipleIds: ['segmentation'],
    referencedParameterKeys: [],
    provider: 'fake',
    model: 'fixture',
    cost: {
      promptTokens: 0,
      completionTokens: 12,
      totalTokens: 12,
      estimatedCost: 0,
      latencyMs: 1,
      finishReason: 'fallback',
      errorCategory: 'model',
      budgetDecisionRef: null,
      contextPacketRef: 'ctx',
      modelOutputRef: 'out',
    },
  },
  schemeHash: 'iw-sch-demo',
  comparisonRef: 'iw-cmp-demo',
  schemaVersion: '1.0.0',
  createdBy: 1,
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: null,
  reviewedAt: null,
  abandonedAt: null,
}

vi.mock('@/hooks/use-triz-innovation-workbench', () => ({
  useTrizInnovationSources: () => sourceQueryState,
  useTrizInnovationSchemes: () => schemesQueryState,
  useCreateTrizInnovationScheme: () => ({ mutate: mutations.create, isPending: false }),
  useAddTrizInnovationOption: () => ({ mutate: mutations.addOption, isPending: false }),
  useCompareTrizInnovationScheme: () => ({ mutate: mutations.compare, isPending: false }),
  useGenerateTrizInnovationNarrative: () => ({ mutate: mutations.narrative, isPending: false }),
  useTrizInnovationDraftHandoff: () => ({ mutate: mutations.handoff, isPending: false }),
}))

function login(permissions: string[]) {
  act(() => {
    useAuthStore.getState().setSession({
      user: {
        id: 1,
        fullName: '当前用户',
        email: 'me@example.com',
        isSuperAdmin: false,
        organizations: [{ id: 1, name: '组织', slug: 'o', role: 'owner' }],
      },
      accessToken: accessTokenWith(permissions, { organizationId: 1 }),
      refreshToken: 'r',
    })
  })
}

describe('TrizInnovationWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => useAuthStore.getState().clear())
    sourceQueryState = { data: sourceData, isLoading: false, isError: false }
    schemesQueryState = {
      data: { data: [scheme], meta: { total: 1, page: 1, perPage: 50, totalPages: 1 } },
      isLoading: false,
      isError: false,
    }
  })

  test('masks workbench when user lacks view permission', () => {
    login(['project:view'])
    render(<TrizInnovationWorkbenchPage />)
    expect(screen.getByText('无权限查看 TRIZ 创新工作台')).toBeInTheDocument()
    expect(screen.queryByText('工期与资源负载对立')).not.toBeInTheDocument()
  })

  test('renders stale source, comparison table, fallback narrative, and handoff action', () => {
    login([
      'project:view',
      'contradiction:view',
      'triz_innovation:view',
      'triz_innovation:manage',
      'triz_innovation:handoff',
      'ai:trigger',
    ])
    render(<TrizInnovationWorkbenchPage />)

    expect(screen.getByText('工期与资源负载对立')).toBeInTheDocument()
    expect(screen.getAllByText('已过期').length).toBeGreaterThan(0)
    expect(screen.getByText('分段交付候选')).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
    expect(screen.getByText('Fallback')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /创建待审核草案/ })).toBeEnabled()
  })

  test('opens detail drawer with source refs and Draft Layer navigation', () => {
    login([
      'project:view',
      'contradiction:view',
      'triz_innovation:view',
      'triz_innovation:manage',
      'triz_innovation:handoff',
      'ai:trigger',
    ])
    render(<TrizInnovationWorkbenchPage />)

    fireEvent.click(screen.getByRole('button', { name: /查看详情/ }))
    expect(screen.getByText('来源 refs')).toBeInTheDocument()
    expect(screen.getByText('评分明细')).toBeInTheDocument()
    expect(screen.getByText('审计摘要')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开草案' })).toHaveAttribute(
      'href',
      '/draft-layer/draft_iw_1',
    )
  })

  test('scheme detail Draft Layer navigation does not trigger generation side effects', () => {
    login([
      'project:view',
      'contradiction:view',
      'triz_innovation:view',
      'triz_innovation:manage',
      'triz_innovation:handoff',
      'ai:trigger',
    ])
    render(<TrizInnovationWorkbenchPage />)

    fireEvent.click(screen.getByRole('button', { name: /查看详情/ }))
    const draftLink = screen.getByRole('link', { name: '打开草案' })
    expect(draftLink).toHaveAttribute('href', '/draft-layer/draft_iw_1')
    expect(mutations.create).not.toHaveBeenCalled()
    expect(mutations.addOption).not.toHaveBeenCalled()
    expect(mutations.compare).not.toHaveBeenCalled()
    expect(mutations.narrative).not.toHaveBeenCalled()
    expect(mutations.handoff).not.toHaveBeenCalled()
  })

  test('renders loading failure state without leaking source counts', () => {
    sourceQueryState = { data: undefined, isLoading: false, isError: true }
    login(['project:view', 'contradiction:view', 'triz_innovation:view', 'triz_innovation:manage'])
    render(<TrizInnovationWorkbenchPage />)
    expect(screen.getByText('工作台加载失败')).toBeInTheDocument()
    expect(screen.queryByText('工期与资源负载对立')).not.toBeInTheDocument()
  })
})
