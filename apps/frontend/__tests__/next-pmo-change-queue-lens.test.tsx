/**
 * v3-ui-next-batch4-reports-change-queue W3 · tasks 3.4
 * PMO 变更队列高密度表格与多维过滤测试（PmoChangeQueueLens）。
 *
 * 覆盖：
 * - 首屏加载紧凑行渲染（36px / 精确档 32px）；
 * - 状态指示灯颜色对应；
 * - 点击单行呼出审批抽屉回调；
 * - 无变更时的语义空态。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { PmoChangeQueueLens } from '@/components/next/pmo/change-queue/PmoChangeQueueLens'
import type { CrossProjectChangeRequestItem } from '@/lib/next/pmo-change-queue-composer'

function makeItem(
  overrides: Partial<CrossProjectChangeRequestItem> = {},
): CrossProjectChangeRequestItem {
  return {
    id: 1,
    crCode: 'CR-2026-001',
    organizationId: 1,
    projectId: 201,
    title: '扩大项目范围以覆盖新市场',
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

describe('PMO 变更队列高密度表格镜头 (PmoChangeQueueLens · W3 tasks 3.3/3.4)', () => {
  test('1. 无变更时渲染语义空态', () => {
    render(<PmoChangeQueueLens items={[]} />)
    expect(screen.getByText('当前筛选条件下暂无变更请求')).toBeInTheDocument()
  })

  test('2. 首屏紧凑行渲染与状态/优先级指示灯颜色对应', () => {
    const items = [
      makeItem({ id: 1, crCode: 'CR-2026-001', priority: 'urgent', status: 'submitted' }),
      makeItem({ id: 2, crCode: 'CR-2026-002', priority: 'low', status: 'approved' }),
    ]
    render(<PmoChangeQueueLens items={items} tier="immersive" />)

    expect(screen.getByText('CR-2026-001')).toBeInTheDocument()
    expect(screen.getByText('CR-2026-002')).toBeInTheDocument()

    const rows = document.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveClass('h-9')

    expect(document.querySelector('[data-priority-dot="urgent"]')).not.toBeNull()
    expect(document.querySelector('[data-priority-dot="low"]')).not.toBeNull()
    expect(document.querySelector('[data-change-status-badge="submitted"]')).not.toBeNull()
    expect(document.querySelector('[data-change-status-badge="approved"]')).not.toBeNull()
  })

  test('3. 精确档下行高收敛为 32px（h-8）', () => {
    render(<PmoChangeQueueLens items={[makeItem()]} tier="precise" />)
    const row = document.querySelector('[data-change-queue-row]')
    expect(row).toHaveClass('h-8')
    expect(document.querySelector('[data-pmo-change-queue-lens]')).toHaveAttribute(
      'data-immersion',
      'precise',
    )
  })

  test('4. 点击行呼出审批抽屉回调（onRowClick）', () => {
    const onRowClick = vi.fn()
    const item = makeItem({ id: 42, crCode: 'CR-2026-042' })
    render(<PmoChangeQueueLens items={[item]} onRowClick={onRowClick} />)

    fireEvent.click(document.querySelector('[data-change-queue-row="42"]')!)
    expect(onRowClick).toHaveBeenCalledWith(item)

    onRowClick.mockClear()
    fireEvent.click(document.querySelector('[data-action="view-change-detail"]')!)
    expect(onRowClick).toHaveBeenCalledWith(item)
  })
})
