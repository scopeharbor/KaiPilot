/**
 * v3-ui-next-batch4-reports-change-queue W3 · tasks 3.6
 * 变更队列工具栏即时过滤与分页重置测试（PmoChangeQueueFilterToolbar）。
 *
 * 覆盖：
 * - 状态 Tab 切换过滤；
 * - 项目下拉勾选过滤；
 * - 模糊搜索关键词匹配（300ms 防抖）；
 * - 筛选条件变更后分页自动重置为第 1 页（onResetPage）。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_FILTER_STATE,
  PmoChangeQueueFilterToolbar,
  filterChangeQueueItems,
  type ChangeQueueFilterState,
} from '@/components/next/pmo/change-queue/PmoChangeQueueFilterToolbar'
import type { CrossProjectChangeRequestItem } from '@/lib/next/pmo-change-queue-composer'

function makeItem(
  overrides: Partial<CrossProjectChangeRequestItem> = {},
): CrossProjectChangeRequestItem {
  return {
    id: 1,
    crCode: 'CR-2026-001',
    organizationId: 1,
    projectId: 201,
    title: '扩大项目范围',
    description: '描述文本',
    changeType: 'scope',
    status: 'submitted',
    priority: 'high',
    requesterId: 10,
    approverId: null,
    requestedBy: 10,
    reviewedBy: null,
    impactSummary: null,
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: '2026-09-01T08:00:00.000Z',
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    projectName: '天权全域监控系统',
    projectCode: 'CORE-01',
    requesterName: '张三',
    ...overrides,
  }
}

describe('变更队列纯过滤函数 (filterChangeQueueItems)', () => {
  const items = [
    makeItem({
      id: 1,
      status: 'submitted',
      projectId: 201,
      priority: 'high',
      crCode: 'CR-001',
      title: '扩大范围',
    }),
    makeItem({
      id: 2,
      status: 'approved',
      projectId: 202,
      priority: 'low',
      crCode: 'CR-002',
      title: '延后交付',
    }),
    makeItem({
      id: 3,
      status: 'under_review',
      projectId: 201,
      priority: 'urgent',
      crCode: 'CR-003',
      title: '预算调整',
    }),
  ]

  test('1. 状态分面 pending 归并 submitted 与 under_review', () => {
    const result = filterChangeQueueItems(items, {
      ...DEFAULT_FILTER_STATE,
      statusFacet: 'pending',
    })
    expect(result.map((i) => i.id).sort()).toEqual([1, 3])
  })

  test('2. 项目多选过滤', () => {
    const result = filterChangeQueueItems(items, {
      ...DEFAULT_FILTER_STATE,
      statusFacet: 'all',
      projectIds: [202],
    })
    expect(result.map((i) => i.id)).toEqual([2])
  })

  test('3. 模糊搜索匹配标题', () => {
    const result = filterChangeQueueItems(items, {
      ...DEFAULT_FILTER_STATE,
      statusFacet: 'all',
      search: '预算',
    })
    expect(result.map((i) => i.id)).toEqual([3])
  })
})

describe('PMO 变更队列筛选工具栏交互 (PmoChangeQueueFilterToolbar · W3 tasks 3.5/3.6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderToolbar(overrides: Partial<ChangeQueueFilterState> = {}) {
    const onFilterChange = vi.fn()
    const onResetPage = vi.fn()
    let filters: ChangeQueueFilterState = { ...DEFAULT_FILTER_STATE, ...overrides }

    const { rerender } = render(
      <PmoChangeQueueFilterToolbar
        projects={[
          { id: 201, name: '天权全域监控系统', code: 'CORE-01' },
          { id: 202, name: '仓储物流调度中台', code: 'LOGI-02' },
        ]}
        filters={filters}
        onFilterChange={(next) => {
          filters = next
          onFilterChange(next)
        }}
        onResetPage={onResetPage}
      />,
    )

    return { onFilterChange, onResetPage, rerender, getFilters: () => filters }
  }

  test('1. 状态 Tab 切换过滤并触发分页重置', () => {
    const { onFilterChange, onResetPage } = renderToolbar()

    fireEvent.click(screen.getByRole('tab', { name: '已批准' }))
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ statusFacet: 'approved' }),
    )
    expect(onResetPage).toHaveBeenCalledTimes(1)
  })

  test('2. 项目下拉勾选过滤并触发分页重置', () => {
    const { onFilterChange, onResetPage } = renderToolbar()

    fireEvent.click(document.querySelector('[data-change-project-filter]')!)
    fireEvent.click(document.querySelector('[data-change-project-option="202"]')!)

    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [202] }))
    expect(onResetPage).toHaveBeenCalledTimes(1)
  })

  test('3. 模糊搜索关键词 300ms 防抖后触发过滤与分页重置', async () => {
    const { onFilterChange, onResetPage } = renderToolbar()

    const input = document.querySelector('[data-change-search-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '预算调整' } })

    expect(onFilterChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)

    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ search: '预算调整' }))
    expect(onResetPage).toHaveBeenCalledTimes(1)
  })

  test('4. 重置按钮清空全部筛选条件', () => {
    const { onFilterChange } = renderToolbar({ statusFacet: 'approved', projectIds: [201] })

    fireEvent.click(screen.getByText('重置'))
    expect(onFilterChange).toHaveBeenCalledWith(DEFAULT_FILTER_STATE)
  })
})
