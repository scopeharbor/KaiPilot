/**
 * TRIZ Skill Layer 前端组件测试 (v3-triz-skill-layer-integration §4.11-4.12)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'

// Mock hooks
vi.mock('@/hooks/use-triz-skill-layer', () => ({
  useTrizSkillLayerSummary: vi.fn(),
  useTrizSkillLayerDestinations: vi.fn(),
  useTrizSkillLayerRoutePreview: vi.fn(),
  useTrizSkillLayerHandoffPreview: vi.fn(),
  trizSkillLayerKeys: {
    all: ['triz-skill-layer'],
    summary: (id: string) => ['triz-skill-layer', 'summary', id],
    destinations: (id: string) => ['triz-skill-layer', 'destinations', id],
  },
}))

// vi.mock 会被提升到文件顶部，不能写在单个 it 里做「本用例专用」覆盖——
// 原先「permission-denied」用例内部的 vi.mock 实际把整份文件的权限都清空了，
// 导致其余用例全部命中「无权查看」早退分支。改为可变持有量，逐用例设置。
const permissionState = vi.hoisted(() => ({
  permissions: ['triz_skill_layer:view', 'triz_skill_layer:preview'] as string[],
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ permissions: permissionState.permissions }),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/projects/1/triz-skill-layer',
  useSearchParams: () => new URLSearchParams(),
}))

import TrizSkillLayerPanel from '@/components/triz/triz-skill-layer-panel'
import {
  useTrizSkillLayerSummary,
  useTrizSkillLayerRoutePreview,
} from '@/hooks/use-triz-skill-layer'
import { asMock } from './_mock-types'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockSummary = {
  data: {
    profiles: [
      {
        skillKey: 'org/triz-contradiction-v1',
        destinationKey: 'contradiction_discovery',
        version: '1.0.0',
        lifecycleStatus: 'active',
        availability: 'available',
        name: '矛盾发现',
        description: '识别项目中的技术矛盾和物理矛盾',
        stageBindings: ['requirements_parsing', 'contradiction_detection'],
        requiredPermissions: ['triz_contradiction:view'],
        featureFlags: [],
        knowledgeAvailability: true,
        sourceRefPolicy: 'low_sensitivity_only',
        fromRegistry: true,
        isEval: false,
        warnings: [],
      },
      {
        skillKey: 'unavailable:evolution_trend_analysis',
        destinationKey: 'evolution_trend_analysis',
        version: '0.0.0',
        lifecycleStatus: 'unavailable',
        availability: 'unavailable',
        name: '进化趋势分析',
        description: '八大进化趋势确定性评分',
        stageBindings: ['monitoring_review'],
        requiredPermissions: ['triz_evolution_trend_analysis:view'],
        featureFlags: [],
        knowledgeAvailability: false,
        sourceRefPolicy: 'unavailable',
        fromRegistry: false,
        isEval: false,
        warnings: ['TRIZ_SL_MISSING_MODULE'],
      },
    ],
    unavailableDestinations: ['evolution_trend_analysis'],
    activationSummary: {
      activeSkillKeys: ['org/triz-contradiction-v1'],
      advisorySkillKeys: [],
      activationEvidenceRefs: [],
      hasActiveActivations: true,
    },
    stageBindings: [
      {
        stage: 'requirements_parsing',
        recommendedDestinations: ['contradiction_discovery'],
        confidence: 0.85,
        warnings: [],
      },
    ],
    sourceSummaries: [],
    permissionSummary: {
      grantedPermissions: ['triz_skill_layer:view'],
      missingPermissions: [],
      canViewSummary: true,
      canViewDestinations: true,
      canRoutePreview: true,
      canHandoffPreview: true,
      denialWarnings: [],
    },
    featureFlagEnabled: true,
    auditRefs: [],
  },
}

describe('TrizSkillLayerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionState.permissions = ['triz_skill_layer:view', 'triz_skill_layer:preview']
    // 面板顶层会读 routeMutation.isPending，mock 必须给出可用的 mutation 形态
    vi.mocked(useTrizSkillLayerRoutePreview).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      error: null,
      data: undefined,
      reset: vi.fn(),
    } as never)
    vi.mocked(useTrizSkillLayerSummary).mockReturnValue(
      asMock({
        data: mockSummary,
        isLoading: false,
        error: null,
      }),
    )
  })

  it('renders available skill profiles', async () => {
    render(<TrizSkillLayerPanel />, { wrapper: createWrapper() })
    await waitFor(() => {
      expect(screen.getByText('TRIZ Skill Layer')).toBeTruthy()
      expect(screen.getByText('矛盾发现')).toBeTruthy()
      expect(screen.getByText('进化趋势分析')).toBeTruthy()
    })
  })

  it('renders stage bindings section', async () => {
    render(<TrizSkillLayerPanel />, { wrapper: createWrapper() })
    await waitFor(() => {
      expect(screen.getByText('阶段绑定')).toBeTruthy()
      expect(screen.getByText('需求解析')).toBeTruthy()
    })
  })

  it('renders loading state', () => {
    vi.mocked(useTrizSkillLayerSummary).mockReturnValue(
      asMock({
        data: undefined,
        isLoading: true,
        error: null,
      }),
    )
    const { container } = render(<TrizSkillLayerPanel />, { wrapper: createWrapper() })
    // Loading skeleton should be rendered
    // 本项目 Skeleton 用 animate-shimmer，不是 shadcn 默认的 animate-pulse
    const skeletons = container.querySelectorAll('[class*="animate-shimmer"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders feature-off state', () => {
    vi.mocked(useTrizSkillLayerSummary).mockReturnValue(
      asMock({
        data: { ...mockSummary, data: { ...mockSummary.data, featureFlagEnabled: false } },
        isLoading: false,
        error: null,
      }),
    )
    render(<TrizSkillLayerPanel />, { wrapper: createWrapper() })
    expect(screen.getByText('TRIZ Skill Layer 功能已关闭。请联系管理员开启。')).toBeTruthy()
  })

  it('renders permission-denied state', () => {
    permissionState.permissions = []
    render(<TrizSkillLayerPanel />, { wrapper: createWrapper() })
    expect(
      screen.getByText('无权查看 TRIZ Skill Layer。需要 triz_skill_layer:view 权限。'),
    ).toBeTruthy()
  })
})

describe('Forbidden wording check', () => {
  it('UI does not contain auto-execution terms', () => {
    // This test ensures the component code itself doesn't have forbidden words
    // __dirname 是 apps/frontend/__tests__，组件在 apps/frontend/components 下，
    // 原来的 '../../components' 指到了 apps/components（不存在），readFileSync 直接抛 ENOENT。
    const componentSource = fs.readFileSync(
      path.resolve(__dirname, '../components/triz/triz-skill-layer-panel.tsx'),
      'utf-8',
    )
    const forbiddenTerms = ['自动应用', '一键执行', '自动写入Blueprint', '自动通知']
    for (const term of forbiddenTerms) {
      expect(componentSource).not.toContain(term)
    }
  })
})
