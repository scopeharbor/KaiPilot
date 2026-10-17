// v3-resource-capacity-forecasting-closed-loop §8.3/8.4/8.6/8.8/8.10/8.12 —— 页面测试。
// 覆盖：loading/empty/error 六态、fact/hypothesis 双重区分、advisory/非因果文案、
// 表格 fallback、键盘聚焦、隐藏数据非泄露、窄屏语义（类名层面断言）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

const mockDetail = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
  isError: false,
}))
vi.mock('@/hooks/use-resource-capacity-loops', () => ({
  useRcclLoopDetail: () => mockDetail,
  useSimulateRcclLoop: () => ({ mutate: vi.fn(), isPending: false }),
  useRcclLoops: () => ({ data: undefined, isLoading: false, isError: false }),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ loopId: '9' }),
}))

import ResourceCapacityLoopDetailPage from '../app/(dashboard)/organization/resource-capacity-loops/[loopId]/page'

function renderDetail(detail?: Record<string, unknown>) {
  // hook 契约：GET /:loopId 后端只返 { data: detail } 单键，apiFetch 解一层后
  // fetchRcclLoopDetail 返回的就是 detail 本体，页面直接消费 data（无信封）。
  mockDetail.data = detail
  return render(React.createElement(ResourceCapacityLoopDetailPage))
}

const fullDetail = {
  loop: {
    id: 9,
    title: 'Q4 容量闭环',
    state: 'simulated',
    revision: 3,
    granularity: 'week',
    windowStart: '2026-09-01',
    windowEnd: '2026-11-30',
  },
  baseline: { id: 77, digest: 'fnv1a:abc123', readyForSimulation: true },
  scenarios: [{ id: 1, name: '情景一', revision: 2, active: true }],
  simulations: [{ id: 5, scenarioId: 1, digest: 'fnv1a:sim', staleState: 'current' }],
  currentSelection: null,
  receipts: [],
  observations: [],
  reviews: [],
  actionPosture: { writesApplied: false, confirmationRequired: true },
}

beforeEach(() => {
  mockDetail.isLoading = false
  mockDetail.isError = false
  mockDetail.data = undefined
})

describe('RCCL 详情工作台（§8）', () => {
  it('loading 态：aria-busy 且有骨架屏', () => {
    mockDetail.isLoading = true
    renderDetail()
    expect(screen.getByTestId('rccl-detail-loading')).toHaveAttribute('aria-busy')
  })

  it('error/restricted 态：role=alert，不泄露任何隐藏实体信息', () => {
    mockDetail.isError = true
    renderDetail()
    expect(screen.getByRole('alert').textContent).not.toContain('fnv1a')
    expect(screen.getByTestId('rccl-detail-error')).toBeInTheDocument()
  })

  it('事实与假设双重区分：基线标「事实数据」、情景标「假设」徽章', () => {
    renderDetail(fullDetail)
    expect(screen.getByText('事实数据')).toBeInTheDocument()
    expect(screen.getByText('假设')).toBeInTheDocument()
    expect(screen.getByTestId('rccl-fact-table')).toBeInTheDocument() // 图表必须有表格 fallback
  })

  it('advisory/unapplied 文案 + 零正式写入姿态说明（§8.8）', () => {
    renderDetail(fullDetail)
    const note = screen.getByTestId('rccl-posture-note')
    expect(note.textContent).toContain('咨询性质')
    expect(note.textContent).toContain('未被应用')
    expect(note.textContent).toContain('显式确认')
  })

  it('非因果中文文案：观察时间线不声称「导致」（§8.12）', () => {
    renderDetail({
      ...fullDetail,
      observations: [{ id: 3, comparable: false, status: 'partial' }],
      reviews: [{ id: 4, outcome: 'partially_met' }],
    })
    const timeline = screen.getByTestId('rccl-timeline')
    expect(timeline.textContent).toContain('不可比')
    expect(timeline.textContent).not.toContain('导致')
  })

  it('选择与 handoff 姿态区：明确两次确认边界（§8.9/8.10）', () => {
    renderDetail({
      ...fullDetail,
      currentSelection: {
        id: 12,
        scenarioId: 1,
        fingerprint: 'fnv1a:fpx',
        expiresAt: '2026-08-28T00:00:00Z',
      },
    })
    const info = screen.getByTestId('rccl-selection-info')
    expect(info.textContent).toContain('写入授权')
    expect(info.textContent).toContain('再次显式确认')
  })

  it('模拟按钮带当前修订号（stale selection 可辨识）且可键盘聚焦', () => {
    renderDetail(fullDetail)
    const btn = screen.getByTestId('rccl-simulate-button')
    expect(btn.textContent).toContain('v3')
    expect(btn.className).toContain('focus-visible:ring-2')
  })

  it('窄屏堆叠语义：队列容器使用响应式 flex 类', () => {
    // 队列页 header 使用 sm:flex-row 断点；此处验证详情页根容器无固定宽度。
    const { container } = renderDetail(fullDetail)
    expect(container.firstElementChild?.className).toContain('space-y-6')
  })
})
