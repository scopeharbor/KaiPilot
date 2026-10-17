/**
 * OKR Detail Drawer 与 Tree 组件测试
 * （v3-okr-hierarchy-management tasks 6.6 + 6.8）。
 *
 * @aiproj/frontend
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { OkrDetailDrawer } from '@/components/views/okr-detail-drawer'
import type { OkrObjective } from '@aiproj/types'

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderWithClient(ui: React.ReactElement) {
  const qc = makeQueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const mockObjective: OkrObjective = {
  id: 1,
  organizationId: 1,
  cycleId: 1,
  projectId: null,
  teamId: null,
  ownerId: null,
  scope: 'organization',
  title: '提升产品体验',
  description: '改进核心流程',
  status: 'active',
  weight: 1,
  progress: 65,
  confidence: 'medium',
  startDate: null,
  endDate: null,
  metricVersion: '1.0.0',
  calculatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
}

const mockKeyResults = [
  {
    id: 1,
    organizationId: 1,
    objectiveId: 1,
    title: 'KR1: 满意度90%',
    description: null,
    measurementType: 'percent' as const,
    unitLabel: '%',
    baselineValue: 0,
    targetValue: 100,
    currentValue: 50,
    confidence: 'medium' as const,
    status: 'active' as const,
    weight: 100,
    lastUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  },
  {
    id: 2,
    organizationId: 1,
    objectiveId: 1,
    title: 'KR2: NPS 60',
    description: null,
    measurementType: 'number' as const,
    unitLabel: null,
    baselineValue: 0,
    targetValue: 100,
    currentValue: 30,
    confidence: 'low' as const,
    status: 'active' as const,
    weight: 50,
    lastUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  },
]

describe('OkrDetailDrawer', () => {
  test('open=false 时返回 null', () => {
    const { container } = renderWithClient(
      <OkrDetailDrawer objective={mockObjective} open={false} onClose={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  test('open=true 时显示标题和元数据', () => {
    renderWithClient(<OkrDetailDrawer objective={mockObjective} open={true} onClose={vi.fn()} />)
    expect(screen.getByText('提升产品体验')).toBeDefined()
    expect(screen.getByText('组织')).toBeDefined()
    expect(screen.getByText('活跃')).toBeDefined()
    expect(screen.getByText('进度: 65%')).toBeDefined()
  })

  test('显示 description', () => {
    renderWithClient(<OkrDetailDrawer objective={mockObjective} open={true} onClose={vi.fn()} />)
    expect(screen.getByText('改进核心流程')).toBeDefined()
  })

  test('显示关键结果列表', () => {
    const objWithKrs = { ...mockObjective, keyResults: mockKeyResults }
    renderWithClient(<OkrDetailDrawer objective={objWithKrs} open={true} onClose={vi.fn()} />)
    expect(screen.getByText('KR1: 满意度90%')).toBeDefined()
    expect(screen.getByText('KR2: NPS 60')).toBeDefined()
  })

  test('readOnly 时显示权限提示且不可编辑', () => {
    const objWithKrs = { ...mockObjective, keyResults: mockKeyResults }
    renderWithClient(
      <OkrDetailDrawer objective={objWithKrs} open={true} onClose={vi.fn()} readOnly={true} />,
    )
    expect(screen.getByText(/只有查看权限/)).toBeDefined()
    // 编辑按钮不应出现
    const editButtons = screen.queryAllByText('编辑进度')
    expect(editButtons.length).toBe(0)
  })

  test('点击编辑进度显示输入框', () => {
    const objWithKrs = { ...mockObjective, keyResults: mockKeyResults }
    renderWithClient(<OkrDetailDrawer objective={objWithKrs} open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getAllByText('编辑进度')[0]!)
    expect(screen.getByPlaceholderText('新值')).toBeDefined()
  })

  test('点击取消关闭编辑', () => {
    const objWithKrs = { ...mockObjective, keyResults: mockKeyResults }
    renderWithClient(<OkrDetailDrawer objective={objWithKrs} open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getAllByText('编辑进度')[0]!)
    fireEvent.click(screen.getByText('取消'))
    // 编辑按钮再次出现
    expect(screen.getAllByText('编辑进度').length).toBeGreaterThan(0)
  })

  test('显示证据引用', () => {
    const evidence = [
      {
        id: 1,
        organizationId: 1,
        targetType: 'objective' as const,
        targetId: 1,
        sourceKind: 'project' as const,
        sourceId: 1,
        summary: '里程碑完成',
        hash: 'abc12345',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      },
    ]
    const objWithEv = { ...mockObjective, evidence }
    renderWithClient(<OkrDetailDrawer objective={objWithEv} open={true} onClose={vi.fn()} />)
    expect(screen.getByText(/里程碑完成/)).toBeDefined()
  })

  test('显示对齐关系', () => {
    const alignments = [
      {
        id: 1,
        organizationId: 1,
        childObjectiveId: 1,
        parentObjectiveId: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      },
    ]
    const objWithAl = { ...mockObjective, alignments }
    renderWithClient(<OkrDetailDrawer objective={objWithAl} open={true} onClose={vi.fn()} />)
    expect(screen.getByText(/child=1 → parent=2/)).toBeDefined()
  })

  test('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    renderWithClient(<OkrDetailDrawer objective={mockObjective} open={true} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('rollup warnings 正确显示', () => {
    const objWithRollup = {
      ...mockObjective,
      rollup: {
        progress: 50,
        confidence: 'medium' as const,
        metricVersion: '1.0.0',
        calculatedAt: new Date().toISOString(),
        sourceCount: 2,
        restrictedCount: 1,
        warnings: [{ code: 'RESTRICTED_CHILD' as const, message: '1 个子节点因权限受限被隐藏' }],
      },
    }
    renderWithClient(<OkrDetailDrawer objective={objWithRollup} open={true} onClose={vi.fn()} />)
    expect(screen.getByText(/2 个源/)).toBeDefined()
    expect(screen.getByText(/1 个受限/)).toBeDefined()
    expect(screen.getByText(/1 个子节点因权限受限被隐藏/)).toBeDefined()
  })

  test('save 按钮触发 onKrProgressUpdate', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const objWithKrs = { ...mockObjective, keyResults: mockKeyResults }
    renderWithClient(
      <OkrDetailDrawer
        objective={objWithKrs}
        open={true}
        onClose={vi.fn()}
        onKrProgressUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getAllByText('编辑进度')[0]!)
    fireEvent.change(screen.getByPlaceholderText('新值'), { target: { value: '75' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(1, 75)
    })
  })
})
