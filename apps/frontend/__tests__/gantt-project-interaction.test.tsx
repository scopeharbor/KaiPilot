import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectGanttPage from '@/app/(dashboard)/projects/[id]/(views)/gantt/page'
import type { GanttScheduleResponse } from '@/lib/api/gantt-scheduling'
import type { GanttModel } from '@/lib/gantt/types'

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  createDependency: vi.fn(),
  adjustMilestone: vi.fn(),
  adjustProgress: vi.fn(),
  toast: vi.fn(),
  can: vi.fn((permission: string) => permission === 'task:update'),
  canAny: vi.fn(() => true),
}))

const model: GanttModel = {
  epochMs: Date.parse('2026-07-06T00:00:00Z'),
  timeRange: { startDay: 0, endDay: 20 },
  tasks: [
    {
      id: 1,
      name: '任务A',
      wbsCode: '1',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 0,
      durationDays: 2,
      progress: 0,
      status: 'not_started',
    },
    {
      id: 2,
      name: '任务B',
      wbsCode: '2',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 3,
      durationDays: 2,
      progress: 0,
      status: 'not_started',
    },
  ],
  dependencies: [],
  milestones: [],
}

const preview: GanttScheduleResponse = {
  changes: [
    {
      taskId: 1,
      taskName: '任务A',
      before: { startDate: '2026-07-06', endDate: '2026-07-07', durationDays: 2 },
      after: { startDate: '2026-07-07', endDate: '2026-07-08', durationDays: 2 },
      reason: 'direct_move',
      dependencyIds: [],
    },
  ],
  conflicts: [],
  warnings: [],
  affectedTaskIds: [1],
  previewToken: 'a'.repeat(64),
  committed: false,
  calendar: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
}

vi.mock('next/navigation', () => ({ useParams: () => ({ id: '7' }) }))
vi.mock('@/hooks/use-project-gantt', () => ({
  useProjectGanttModel: () => ({
    model,
    project: {
      id: 7,
      settings: {
        workingCalendar: {
          version: 1,
          workdays: [1, 2, 3, 4, 5],
          holidays: [],
          extraWorkdays: [],
        },
      },
    },
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/hooks/use-gantt-scheduling', () => ({
  useGanttSchedule: () => ({ mutateAsync: mocks.schedule, isPending: false }),
}))
vi.mock('@/hooks/use-gantt-baseline', () => ({
  useGanttBaseline: () => ({ data: null, isLoading: false, isError: false }),
  useSaveGanttBaseline: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-task-dependencies', () => ({
  useCreateProjectDependency: () => ({
    mutateAsync: mocks.createDependency,
    isPending: false,
  }),
}))
vi.mock('@/hooks/use-gantt-adjustments', () => ({
  useAdjustMilestoneDate: () => ({ mutateAsync: mocks.adjustMilestone, isPending: false }),
  useAdjustTaskProgress: () => ({ mutateAsync: mocks.adjustProgress, isPending: false }),
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: mocks.can, canAny: mocks.canAny }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast, dismiss: vi.fn() }),
}))
vi.mock('@/components/views/gantt/GanttView', () => ({
  GanttView: (props: {
    editable: boolean
    dependencyEditable: boolean
    onScheduleDraft: (draft: {
      taskId: number
      operation: 'move'
      startDay: number
      endDay: number
    }) => void
    onDependencyDraft: (draft: { predecessorId: number; successorId: number; type: 'fs' }) => void
    onMilestoneDraft?: (draft: { milestoneId: number; taskId: number; day: number }) => void
    onProgressDraft?: (draft: { taskId: number; progress: number }) => void
  }) => (
    <div>
      <span>{props.editable ? '可排程' : '只读'}</span>
      <span>{props.dependencyEditable ? '可连线' : '不可连线'}</span>
      <button
        type="button"
        onClick={() =>
          props.onScheduleDraft({
            taskId: 1,
            operation: 'move',
            startDay: 1,
            endDay: 2,
          })
        }
      >
        模拟拖拽
      </button>
      <button
        type="button"
        onClick={() => props.onDependencyDraft({ predecessorId: 1, successorId: 2, type: 'fs' })}
      >
        模拟连线
      </button>
      <button
        type="button"
        onClick={() => props.onDependencyDraft({ predecessorId: 1, successorId: 1, type: 'fs' })}
      >
        模拟自依赖
      </button>
      <button
        type="button"
        onClick={() => props.onMilestoneDraft?.({ milestoneId: 11, taskId: 1, day: 5 })}
      >
        模拟里程碑改期
      </button>
      <button type="button" onClick={() => props.onProgressDraft?.({ taskId: 1, progress: 0.6 })}>
        模拟进度调整
      </button>
    </div>
  ),
}))

describe('真实项目甘特交互编排', () => {
  beforeEach(() => {
    mocks.schedule.mockReset()
    mocks.createDependency.mockReset()
    mocks.adjustMilestone.mockReset()
    mocks.adjustProgress.mockReset()
    mocks.schedule.mockResolvedValue(preview)
    mocks.createDependency.mockResolvedValue({})
    mocks.adjustMilestone.mockResolvedValue({})
    mocks.adjustProgress.mockResolvedValue({})
  })

  it('拖拽只先预览，取消不 commit', async () => {
    const view = render(<ProjectGanttPage />)
    fireEvent.click(view.getByRole('button', { name: '模拟拖拽' }))
    await view.findByText('确认排程调整')
    expect(mocks.schedule).toHaveBeenCalledTimes(1)
    expect(mocks.schedule.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ mode: 'preview', taskId: 1 }),
    )
    fireEvent.click(view.getByRole('button', { name: '取消排程预览并返回甘特图' }))
    await waitFor(() => expect(view.queryByText('确认排程调整')).toBeNull())
    expect(mocks.schedule).toHaveBeenCalledTimes(1)
  })

  it('确认时携 token commit，依赖建立后提供排程入口', async () => {
    mocks.schedule
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({ ...preview, committed: true })
    const view = render(<ProjectGanttPage />)
    fireEvent.click(view.getByRole('button', { name: '模拟拖拽' }))
    await view.findByText('确认排程调整')
    fireEvent.click(view.getByRole('button', { name: '确认排程调整并返回甘特图' }))
    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(2))
    expect(mocks.schedule.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        mode: 'commit',
        previewToken: preview.previewToken,
      }),
    )

    fireEvent.click(view.getByRole('button', { name: '模拟连线' }))
    await view.findByText('建立任务依赖')
    fireEvent.click(view.getByRole('button', { name: '确认建立依赖并返回甘特图' }))
    await waitFor(() => expect(mocks.createDependency).toHaveBeenCalledTimes(1))
    expect(mocks.createDependency).toHaveBeenCalledWith({
      successorId: 2,
      input: { predecessorId: 1, type: 'fs', lagDays: 0 },
    })
    expect(view.getByRole('button', { name: '预览排程调整' })).toBeTruthy()
  })

  it('自依赖被前端阻止：不打开对话框、不发创建请求、给中文错误', async () => {
    const view = render(<ProjectGanttPage />)
    fireEvent.click(view.getByRole('button', { name: '模拟自依赖' }))
    expect(view.queryByText('建立任务依赖')).toBeNull()
    expect(mocks.createDependency).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', title: '任务不能依赖自身' }),
    )
  })

  it('preview 返回冲突时禁用确认提交，保留取消入口', async () => {
    mocks.schedule.mockReset()
    mocks.schedule.mockResolvedValue({
      ...preview,
      conflicts: [
        { taskId: 2, taskName: '任务B', code: 'DEPENDENCY_CONFLICT', message: '违反依赖约束' },
      ],
    })
    const view = render(<ProjectGanttPage />)
    fireEvent.click(view.getByRole('button', { name: '模拟拖拽' }))
    await view.findByText('确认排程调整')
    expect(view.getByText('任务B：违反依赖约束')).toBeTruthy()
    expect(view.getByRole('button', { name: '确认排程调整并返回甘特图' })).toHaveProperty(
      'disabled',
      true,
    )
    // 冲突下点击确认不 commit（仍只有一次 preview 调用）。
    fireEvent.click(view.getByRole('button', { name: '确认排程调整并返回甘特图' }))
    expect(mocks.schedule).toHaveBeenCalledTimes(1)
    expect(view.getByRole('button', { name: '取消排程预览并返回甘特图' })).toBeTruthy()
  })

  it('里程碑改期：确认前不写入，取消不触发 mutation', async () => {
    const view = render(<ProjectGanttPage />)
    fireEvent.click(view.getByRole('button', { name: '模拟里程碑改期' }))
    await view.findByText('确认里程碑日期调整')
    expect(mocks.adjustMilestone).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '取消里程碑日期调整并返回甘特图' }))
    await waitFor(() => expect(view.queryByText('确认里程碑日期调整')).toBeNull())
    expect(mocks.adjustMilestone).not.toHaveBeenCalled()
  })

  it('里程碑改期：确认后按 plannedDate 写入', async () => {
    const view = render(<ProjectGanttPage />)
    fireEvent.click(view.getByRole('button', { name: '模拟里程碑改期' }))
    await view.findByText('确认里程碑日期调整')
    fireEvent.click(view.getByRole('button', { name: '确认里程碑日期调整并返回甘特图' }))
    await waitFor(() => expect(mocks.adjustMilestone).toHaveBeenCalledTimes(1))
    expect(mocks.adjustMilestone).toHaveBeenCalledWith({
      milestoneId: 11,
      plannedDate: '2026-07-11',
    })
  })

  it('进度调整：确认前展示摘要不写入，确认后只改进度', async () => {
    const view = render(<ProjectGanttPage />)
    fireEvent.click(view.getByRole('button', { name: '模拟进度调整' }))
    await view.findByText('确认进度调整')
    expect(mocks.adjustProgress).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '确认进度调整并返回甘特图' }))
    await waitFor(() => expect(mocks.adjustProgress).toHaveBeenCalledTimes(1))
    expect(mocks.adjustProgress).toHaveBeenCalledWith({ taskId: 1, progress: 0.6 })
    // 进度确认不应触发排程或依赖写入。
    expect(mocks.schedule).not.toHaveBeenCalled()
    expect(mocks.createDependency).not.toHaveBeenCalled()
  })
})
