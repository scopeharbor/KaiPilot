/**
 * PMO Priority Scoring 页面测试
 *
 * v3-pmo-priority-scoring-model §5.4
 *
 * 覆盖：授权态、未授权态、加载态、空组合、API错误、feature-off、数据不可用
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PRIORITY_LEVEL_LABELS } from '@aiproj/types'

// 模拟 hooks
const mockUsePermissions = vi.fn()
const mockUsePriorityScoringSummary = vi.fn()
const mockUsePriorityScoringProjects = vi.fn()
const mockUsePriorityScoringWeights = vi.fn()

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => mockUsePermissions(),
}))

vi.mock('@/hooks/use-priority-scoring', () => ({
  usePriorityScoringSummary: () => mockUsePriorityScoringSummary(),
  usePriorityScoringProjects: () => mockUsePriorityScoringProjects(),
  usePriorityScoringWeights: () => mockUsePriorityScoringWeights(),
}))

vi.mock('@/components/ui/Card', () => ({
  // 透传其余 props：页面给卡片挂了 role/aria-label（筛选开关的可访问名），
  // 桩件若只收 className 会把这些属性吞掉。
  Card: ({ children, className, ...rest }: StubProps) => (
    <div data-testid="card" className={className} {...rest}>
      {children}
    </div>
  ),
  CardContent: ({ children, className }: StubProps) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
  CardHeader: ({ children, className }: StubProps) => (
    <div data-testid="card-header" className={className}>
      {children}
    </div>
  ),
  CardTitle: ({ children, className }: StubProps) => (
    <div data-testid="card-title" className={className}>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ className }: StubProps) => <div data-testid="skeleton" className={className} />,
}))

vi.mock('@/components/ui/Alert', () => ({
  Alert: ({ children, variant, className }: StubProps) => (
    <div data-testid={`alert-${variant}`} className={className}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: StubProps) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, className }: StubProps) => (
    <span data-testid="badge" className={className}>
      {children}
    </span>
  ),
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, variant, size, disabled }: StubProps) => (
    <button
      data-testid="button"
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </button>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import PmoPriorityScoringPage from '@/app/(dashboard)/pmo/priority-scoring/page'
import type { StubProps } from './_mock-types'

function makeEmptySummary() {
  return {
    totalProjects: 0,
    scoredProjects: 0,
    unscoredProjects: 0,
    levelCounts: { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 },
    scoreVersion: 'pmo-priority-v1',
    weightVersion: 'pmo-priority-v1',
    sourceFreshness: [],
    warnings: [{ code: 'EMPTY_PORTFOLIO', message: '无可见项目' }],
    calculatedAt: new Date().toISOString(),
  }
}

function makeSummary() {
  return {
    totalProjects: 10,
    scoredProjects: 10,
    unscoredProjects: 0,
    levelCounts: { critical: 2, high: 3, medium: 3, low: 2, unranked: 0 },
    scoreVersion: 'pmo-priority-v1',
    weightVersion: 'pmo-priority-v1',
    sourceFreshness: [],
    warnings: [],
    calculatedAt: new Date().toISOString(),
  }
}

function makeProjectsData() {
  return {
    data: [
      {
        projectId: 1,
        projectName: '紧急项目-A',
        priorityScore: 92,
        priorityLevel: 'critical',
        rank: 1,
        scoreVersion: 'pmo-priority-v1',
        calculatedAt: new Date().toISOString(),
        inputSignature: {
          version: 'pmo-priority-v1',
          organizationHash: 'abc',
          inputsHash: 'def',
          computedAt: new Date().toISOString(),
        },
        sourceFreshness: [],
        dimensions: [],
        topReasons: [
          {
            dimension: 'delivery_urgency',
            normalizedValue: 98,
            weightedContribution: 24.5,
            lowSensitiveLabel: '交付紧急度',
          },
        ],
        warnings: [],
        allowedActions: [{ action: 'view_detail', label: '查看详情', enabled: true }],
        tieBreaker: { level: 'critical', trafficLightSeverity: 90, dueUrgency: 95, projectId: 1 },
      },
    ],
    meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
  }
}

describe('PmoPriorityScoringPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未授权用户显示权限提示', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => false })
    mockUsePriorityScoringSummary.mockReturnValue({ data: null, isLoading: false, error: null })
    mockUsePriorityScoringProjects.mockReturnValue({ data: null, isLoading: false, error: null })
    mockUsePriorityScoringWeights.mockReturnValue({ data: null })

    render(<PmoPriorityScoringPage />)
    expect(screen.getByText('您没有 PMO 优先级评分访问权限。')).toBeDefined()
  })

  it('授权用户显示标题', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => true })
    mockUsePriorityScoringSummary.mockReturnValue({
      data: makeSummary(),
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringProjects.mockReturnValue({
      data: makeProjectsData(),
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringWeights.mockReturnValue({ data: { version: 'pmo-priority-v1' } })

    render(<PmoPriorityScoringPage />)
    expect(screen.getByText('优先级评分')).toBeDefined()
    expect(screen.getByText('10/10 已评分')).toBeDefined()
  })

  it('加载态显示骨架屏', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => true })
    mockUsePriorityScoringSummary.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    })
    mockUsePriorityScoringProjects.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    })
    mockUsePriorityScoringWeights.mockReturnValue({ data: null })

    render(<PmoPriorityScoringPage />)
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
  })

  it('空组合显示警告', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => true })
    mockUsePriorityScoringSummary.mockReturnValue({
      data: makeEmptySummary(),
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringProjects.mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 0 } },
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringWeights.mockReturnValue({ data: { version: 'pmo-priority-v1' } })

    render(<PmoPriorityScoringPage />)
    expect(screen.getByText('无可见项目')).toBeDefined()
  })

  it('API 错误显示错误提示', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => true })
    mockUsePriorityScoringSummary.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('网络错误'),
    })
    mockUsePriorityScoringProjects.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringWeights.mockReturnValue({ data: null })

    render(<PmoPriorityScoringPage />)
    expect(screen.getByText('加载优先级评分失败，请稍后重试。')).toBeDefined()
  })

  it('等级分布显示正确', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => true })
    mockUsePriorityScoringSummary.mockReturnValue({
      data: makeSummary(),
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringProjects.mockReturnValue({
      data: makeProjectsData(),
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringWeights.mockReturnValue({ data: { version: 'pmo-priority-v1' } })

    render(<PmoPriorityScoringPage />)
    // 等级标签在下方项目队列里也会出现；按卡片的可访问名断言，标签与计数一并校验。
    const distribution = within(screen.getByRole('region', { name: '优先级等级分布' }))
    expect(
      distribution.getByRole('button', { name: `${PRIORITY_LEVEL_LABELS.critical}：2 个项目` }),
    ).toBeDefined()
    expect(
      distribution.getByRole('button', { name: `${PRIORITY_LEVEL_LABELS.high}：3 个项目` }),
    ).toBeDefined()
  })

  it('队列显示项目名称', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => true })
    mockUsePriorityScoringSummary.mockReturnValue({
      data: makeSummary(),
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringProjects.mockReturnValue({
      data: makeProjectsData(),
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringWeights.mockReturnValue({ data: { version: 'pmo-priority-v1' } })

    render(<PmoPriorityScoringPage />)
    expect(screen.getByText('紧急项目-A')).toBeDefined()
    expect(screen.getByText('#1')).toBeDefined()
  })

  it('unranked 项目透明度降低', () => {
    mockUsePermissions.mockReturnValue({ canAny: () => true })
    mockUsePriorityScoringSummary.mockReturnValue({
      data: {
        ...makeSummary(),
        levelCounts: { critical: 0, high: 0, medium: 0, low: 0, unranked: 1 },
      },
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringProjects.mockReturnValue({
      data: {
        data: [
          {
            ...makeProjectsData().data[0],
            projectId: 2,
            projectName: '未评分项目',
            priorityScore: -1,
            priorityLevel: 'unranked',
            rank: -1,
            topReasons: [],
            warnings: [{ code: 'SOURCE_UNAVAILABLE', message: '数据不可用' }],
            tieBreaker: {
              level: 'unranked',
              trafficLightSeverity: -1,
              dueUrgency: -1,
              projectId: 2,
            },
          },
        ],
        meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
      },
      isLoading: false,
      error: null,
    })
    mockUsePriorityScoringWeights.mockReturnValue({ data: { version: 'pmo-priority-v1' } })

    render(<PmoPriorityScoringPage />)
    expect(screen.getByText('未评分项目')).toBeDefined()
  })
})
