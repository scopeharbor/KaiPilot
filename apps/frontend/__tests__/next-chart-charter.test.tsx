/**
 * 项目章程镜头定向测试（v3-chart-gallery-tier2-org-contract-plans W2 · task 2.4）。
 *
 * 覆盖：
 * 1. Adapter 纯函数：章程信封解析、分节模型装配、审批状态徽标映射、日期区间格式化、缺口字段中性降级；
 * 2. 镜头组件渲染：头部元数据、愿景、范围、商业论证、目标列表、验收准则列表；
 * 3. 审批状态机与版本展示（草案/待审批/已通过/已驳回）；
 * 4. Charter 空态专项：新项目尚未创建章程（data: null）标准空态承接防白屏；
 * 5. RL-01 零写网络断言：交互全程写请求（POST/PATCH/PUT/DELETE）恒为 0；
 * 6. DOM 中性措辞断言：正则扫描全局 DOM 树零「告警/预警/危险」词汇。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProjectCharterData } from '@/lib/api/charter'
import {
  buildCharterViewModel,
  CHARTER_NOT_SET_LABEL,
  formatDateSpan,
} from '@/lib/next/charts/charter-adapter'
import { CharterChartLens } from '@/components/next/charts/lenses/CharterChartLens'
import {
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventMock extends MouseEvent {}
  window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
}

if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function makeSampleCharterData(overrides: Partial<ProjectCharterData> = {}): ProjectCharterData {
  return {
    id: 1,
    organizationId: 1,
    projectId: 42,
    title: '智能研发平台立项章程',
    vision: '构建新一代面向敏捷与创新工程的智能研发管理基础设施。',
    scope: '覆盖项目计划、组织分解、风险治理与图表馆全景镜头等核心模块。',
    objectives: [
      '完成图表馆 24 项全量镜头交付',
      '实现工程度量指标实时卷算',
      '达成系统端到端测试覆盖率 90%',
    ],
    successCriteria: [
      '所有 24 个图表全部就绪且零白屏错误',
      '核心接口响应时间 < 200ms',
      '通过安全与权限审计',
    ],
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    businessCase: '提升团队工程交付效率 35%，降低立项沟通与对齐成本。',
    approvalStatus: 'approved',
    approvedBy: 1,
    approvedAt: '2026-09-02T10:00:00.000Z',
    version: 2,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    ...overrides,
  }
}

describe('项目章程适配器纯函数测试 (charter-adapter.ts)', () => {
  test('buildCharterViewModel 解析完整章程实体与状态机', () => {
    const raw = makeSampleCharterData()
    const model = buildCharterViewModel(raw)

    expect(model.hasCharter).toBe(true)
    expect(model.isEmpty).toBe(false)
    expect(model.title).toBe('智能研发平台立项章程')
    expect(model.versionText).toBe('v2')
    expect(model.statusBadge.label).toBe('已通过')
    expect(model.statusBadge.tone).toBe('success')
    expect(model.approvedAtText).toBe('2026-09-02')
    expect(model.dateSpan).toBe('2026-09-01 ~ 2026-12-31')
    expect(model.hasObjectives).toBe(true)
    expect(model.objectives).toHaveLength(3)
    expect(model.hasSuccessCriteria).toBe(true)
    expect(model.successCriteria).toHaveLength(3)
    expect(model.hasBusinessCase).toBe(true)
  })

  test('审批状态机中性映射覆盖 draft / pending_approval / rejected', () => {
    const draft = buildCharterViewModel(makeSampleCharterData({ approvalStatus: 'draft' }))
    expect(draft.statusBadge.label).toBe('草案')
    expect(draft.statusBadge.tone).toBe('neutral')

    const pending = buildCharterViewModel(
      makeSampleCharterData({ approvalStatus: 'pending_approval' }),
    )
    expect(pending.statusBadge.label).toBe('待审批')
    expect(pending.statusBadge.tone).toBe('accent')

    const rejected = buildCharterViewModel(makeSampleCharterData({ approvalStatus: 'rejected' }))
    expect(rejected.statusBadge.label).toBe('已驳回')
    expect(rejected.statusBadge.tone).toBe('subtle')
  })

  test('缺口字段中性占位「未填写」，不抛错不崩溃', () => {
    const partial = buildCharterViewModel(
      makeSampleCharterData({
        vision: '',
        scope: '',
        businessCase: null,
        objectives: [],
        successCriteria: [],
      }),
    )

    expect(partial.vision).toBe(CHARTER_NOT_SET_LABEL)
    expect(partial.scope).toBe(CHARTER_NOT_SET_LABEL)
    expect(partial.businessCase).toBe(CHARTER_NOT_SET_LABEL)
    expect(partial.hasBusinessCase).toBe(false)
    expect(partial.hasObjectives).toBe(false)
    expect(partial.hasSuccessCriteria).toBe(false)
  })

  test('日期区间格式化函数健全性', () => {
    expect(formatDateSpan(null, null)).toBe('未设定工期')
    expect(formatDateSpan('2026-09-01', null)).toBe('2026-09-01 ~ 未设定')
    expect(formatDateSpan('2026-09-01', '2026-09-30')).toBe('2026-09-01 ~ 2026-09-30')
  })

  test('未创建章程（null / undefined）安全回退', () => {
    const nullModel = buildCharterViewModel(null)
    expect(nullModel.hasCharter).toBe(false)
    expect(nullModel.isEmpty).toBe(true)
  })
})

describe('CharterChartLens 镜头组件渲染与门禁测试', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(() => {
    resetFetchRouter()
    queryClient.clear()
  })

  test('完整数据流：渲染愿景、范围、商业论证、目标列表、验收准则与版本状态', async () => {
    const sample = makeSampleCharterData()
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42/charter' && method === 'GET') {
        return jsonResponse(200, { data: sample })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CharterChartLens projectId={42} />
      </QueryClientProvider>,
    )

    // 等待骨架屏消失并渲染主视口
    await waitFor(() => {
      expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
    })

    // 断言标题与状态徽标
    await screen.findByText('智能研发平台立项章程')
    expect(screen.getByText('已通过')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('批准于 2026-09-02')).toBeInTheDocument()

    // 断言分节卡片内容
    expect(screen.getByText('项目愿景 (Project Vision)')).toBeInTheDocument()
    expect(
      screen.getByText('构建新一代面向敏捷与创新工程的智能研发管理基础设施。'),
    ).toBeInTheDocument()

    expect(screen.getByText('业务范围 (Scope)')).toBeInTheDocument()
    expect(
      screen.getByText('覆盖项目计划、组织分解、风险治理与图表馆全景镜头等核心模块。'),
    ).toBeInTheDocument()

    expect(screen.getByText('商业论证 (Business Case)')).toBeInTheDocument()
    expect(
      screen.getByText('提升团队工程交付效率 35%，降低立项沟通与对齐成本。'),
    ).toBeInTheDocument()

    // 断言目标列表与验收准则列表
    expect(screen.getByText('完成图表馆 24 项全量镜头交付')).toBeInTheDocument()
    expect(screen.getByText('所有 24 个图表全部就绪且零白屏错误')).toBeInTheDocument()

    // RL-01 零写断言：写方法恒为 0
    expect(writeMethods(records)).toHaveLength(0)

    // DOM 中性措辞断言：绝对排除告警/预警/危险
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })

  test('Charter 空态专项：新项目尚未创建章程（data: null）标准空态承接防白屏', async () => {
    installFetchRouter((path, method) => {
      if (path === '/projects/99/charter' && method === 'GET') {
        return jsonResponse(200, { data: null })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CharterChartLens projectId={99} />
      </QueryClientProvider>,
    )

    await screen.findByRole('status', { name: '项目章程为空' })
    expect(screen.getByText('暂无项目章程数据')).toBeInTheDocument()
    expect(screen.getByText('当前项目尚未创建项目章程。')).toBeInTheDocument()

    // 零白屏、DOM 中性措辞
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })
})
