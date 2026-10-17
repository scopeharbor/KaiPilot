import { createRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GanttBaselineControls } from '@/components/views/gantt/baseline/GanttBaselineControls'
import type { GanttBaseline } from '@/lib/api/gantt-baseline'
import { applyBaselineToModel, summarizeBaselineDeviation } from '@/lib/gantt/baseline'
import type { GanttModel } from '@/lib/gantt/types'

const { mutate, toast, toPng } = vi.hoisted(() => ({
  mutate: vi.fn(),
  toast: vi.fn(),
  toPng: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
}))

vi.mock('@/hooks/use-gantt-baseline', () => ({
  useSaveGanttBaseline: () => ({ mutate, isPending: false }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))
vi.mock('html-to-image', () => ({ toPng }))

const model: GanttModel = {
  epochMs: Date.parse('2026-07-01T00:00:00Z'),
  timeRange: { startDay: 0, endDay: 30 },
  dependencies: [],
  milestones: [],
  tasks: [
    {
      id: 1,
      name: '提前任务',
      wbsCode: '',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 1,
      durationDays: 2,
      progress: 0,
      status: 'not_started',
    },
    {
      id: 2,
      name: '滞后任务',
      wbsCode: '',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 5,
      durationDays: 5,
      progress: 0,
      status: 'not_started',
    },
    {
      id: 3,
      name: '新增任务',
      wbsCode: '',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 10,
      durationDays: 1,
      progress: 0,
      status: 'not_started',
    },
  ],
}

const baseline: GanttBaseline = {
  id: 1,
  projectId: 7,
  createdBy: 1,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
  snapshot: {
    savedAt: '2026-07-01T00:00:00.000Z',
    milestones: [],
    tasks: [
      { id: 1, startDate: '2026-07-01', endDate: '2026-07-05' },
      { id: 2, startDate: '2026-07-05', endDate: '2026-07-07' },
      { id: 99, startDate: '2026-07-01', endDate: '2026-07-02' },
    ],
  },
}

describe('甘特基线只读对比', () => {
  beforeEach(() => {
    mutate.mockReset()
    toast.mockReset()
    toPng.mockClear()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('叠加基线日期并汇总提前/滞后/新增/删除', () => {
    const compared = applyBaselineToModel(model, baseline)
    expect(compared.tasks[0]).toMatchObject({ baselineStartDay: 0, baselineEndDay: 4 })
    expect(compared.tasks[1]).toMatchObject({ baselineStartDay: 4, baselineEndDay: 6 })
    expect(summarizeBaselineDeviation(model, baseline)).toEqual({
      early: 1,
      late: 1,
      unchanged: 0,
      added: 1,
      deleted: 1,
    })
    expect(model.tasks[0]?.baselineStartDay).toBeUndefined()
  })

  it('无基线开启对比时显示明确空态', () => {
    render(
      <GanttBaselineControls
        projectId={7}
        baseline={null}
        baselineLoading={false}
        compareEnabled
        onCompareChange={vi.fn()}
        summary={{ early: 0, late: 0, unchanged: 0, added: 0, deleted: 0 }}
        exportTarget={createRef<HTMLDivElement>()}
        canSave={false}
      />,
    )
    expect(screen.getByText(/尚未保存基线/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存基线' })).not.toBeInTheDocument()
  })

  it('保存与导出当前视图均由显式按钮触发', async () => {
    const target = createRef<HTMLDivElement>()
    render(
      <>
        <div ref={target}>甘特内容</div>
        <GanttBaselineControls
          projectId={7}
          baseline={baseline}
          baselineLoading={false}
          compareEnabled={false}
          onCompareChange={vi.fn()}
          summary={{ early: 1, late: 1, unchanged: 0, added: 1, deleted: 1 }}
          exportTarget={target}
          canSave
        />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '保存基线' }))
    expect(mutate).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '导出当前视图 PNG' }))
    await waitFor(() => expect(toPng).toHaveBeenCalledWith(target.current, expect.any(Object)))
  })
})
