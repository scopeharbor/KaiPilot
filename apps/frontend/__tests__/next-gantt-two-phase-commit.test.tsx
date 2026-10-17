/**
 * v3-ui-next-gantt-lens tasks 3.3 —— 两阶段提交与 409 冲突防御测试。
 *
 * 覆盖（spec「显式应用方案与 preview→confirm 两阶段提交」+「并发修改检测与 TOCTOU
 * 409 冲突防御」三场景）：
 * - 成功路径：preview（取 previewToken + 冲突检查）→ commit（携带 previewToken 事务落库）
 *   顺序提交，成功后销毁 session 归 idle；
 * - CYCLE 依赖环：preview 返回 CYCLE 冲突时原位阻断，commit 绝不发出，conflicts 落入
 *   backendPreview 供阻断呈现；
 * - HTTP 409 SCHEDULE_STALE（preview 或 commit 阶段）：session 置 stale、canApply 禁用，
 *   「放弃并刷新」（discardSession）与「重新试算」（enterSession）两条恢复路径可用。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useWhatIfSession } from '@/hooks/use-what-if-session'
import {
  ganttSchedulingApi,
  type GanttScheduleRequest,
  type GanttScheduleResponse,
} from '@/lib/api/gantt-scheduling'
import type { GanttModel } from '@/lib/gantt/types'

const PROJECT_ID = 42
const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z')

const MODEL: GanttModel = {
  tasks: [
    {
      id: 1,
      name: '支付网关联调',
      wbsCode: '2.1',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 0,
      durationDays: 5,
      progress: 0.3,
      status: 'in_progress',
    },
    {
      id: 2,
      name: '联调验收',
      wbsCode: '2.2',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 10,
      durationDays: 3,
      progress: 0,
      status: 'not_started',
    },
  ],
  dependencies: [{ id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 }],
  milestones: [],
  timeRange: { startDay: 0, endDay: 20 },
  epochMs: EPOCH_MS,
}

const BASE_RESPONSE: GanttScheduleResponse = {
  changes: [
    {
      taskId: 1,
      taskName: '支付网关联调',
      before: { startDate: '2026-01-01', endDate: '2026-01-05', durationDays: 5 },
      after: { startDate: '2026-01-15', endDate: '2026-01-19', durationDays: 5 },
      reason: 'direct_move',
      dependencyIds: [],
    },
  ],
  conflicts: [],
  warnings: [],
  affectedTaskIds: [1],
  previewToken: 'tok_xyz',
  committed: false,
  calendar: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
}

/** 测试驾驶台：真实 useWhatIfSession + 真实 store，仅 mock 网络层。 */
function Harness() {
  const whatIf = useWhatIfSession(PROJECT_ID, { model: MODEL, calendarSettings: null })
  return (
    <div>
      <button data-testid="enter" onClick={whatIf.enterSession}>
        进入试算
      </button>
      <button
        data-testid="move"
        onClick={() =>
          whatIf.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: '2026-01-15' })
        }
      >
        移动任务 1
      </button>
      <button
        data-testid="apply"
        onClick={() => void whatIf.applySession()}
        disabled={!whatIf.controls.canApply}
      >
        应用方案
      </button>
      <button data-testid="discard" onClick={whatIf.discardSession}>
        放弃并刷新
      </button>
      <button data-testid="re-enter" onClick={whatIf.enterSession}>
        基于最新数据重新试算
      </button>
      <span data-testid="status">{whatIf.status}</span>
      <span data-testid="canApply">{String(whatIf.controls.canApply)}</span>
      <span data-testid="cursor">{whatIf.history.cursor}</span>
      <span data-testid="conflict-count">{whatIf.backendPreview?.conflicts.length ?? 0}</span>
    </div>
  )
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** 进入试算并派发一条 move 命令（cursor=1）。 */
async function setupUnsavedSession() {
  render(<Harness />, { wrapper: wrapper() })
  fireEvent.click(screen.getByTestId('enter'))
  fireEvent.click(screen.getByTestId('move'))
  await waitFor(() => expect(screen.getByTestId('cursor').textContent).toBe('1'))
  expect(screen.getByTestId('canApply').textContent).toBe('true')
}

describe('next-gantt-two-phase-commit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('成功路径：preview 取 previewToken → commit 单事务落库 → session 销毁归 idle', async () => {
    const execute = vi
      .spyOn(ganttSchedulingApi, 'execute')
      .mockImplementation(async (_projectId: number, input: GanttScheduleRequest) => ({
        ...BASE_RESPONSE,
        committed: input.mode === 'commit',
      }))
    await setupUnsavedSession()

    fireEvent.click(screen.getByTestId('apply'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('idle'))

    // 顺序：preview（带 move 参数）→ commit（携带 previewToken）
    const previewCall = execute.mock.calls[0]!
    expect(previewCall[1]).toMatchObject({
      mode: 'preview',
      taskId: 1,
      operation: 'move',
      startDate: '2026-01-15',
      autoSchedule: true,
    })
    const commitCall = execute.mock.calls[1]!
    expect(commitCall[1]).toMatchObject({
      mode: 'commit',
      taskId: 1,
      operation: 'move',
      startDate: '2026-01-15',
      autoSchedule: true,
      previewToken: 'tok_xyz',
    })
    expect(execute).toHaveBeenCalledTimes(2)
    // 提交成功后销毁 session
    expect(screen.getByTestId('cursor').textContent).toBe('0')
    expect(screen.getByTestId('canApply').textContent).toBe('false')
  })

  test('CYCLE 冲突阻断：preview 返回依赖环 → 原位中断，commit 绝不发出', async () => {
    const execute = vi
      .spyOn(ganttSchedulingApi, 'execute')
      .mockImplementation(async (_projectId: number, input: GanttScheduleRequest) => {
        if (input.mode === 'commit') throw new Error('阶段 2 不应被触发')
        return {
          ...BASE_RESPONSE,
          conflicts: [
            {
              taskId: 1,
              taskName: '支付网关联调',
              code: 'CYCLE' as const,
              message: '检测到隐式循环依赖',
              dependencyIds: [1],
            },
          ],
        }
      })
    await setupUnsavedSession()

    fireEvent.click(screen.getByTestId('apply'))
    await waitFor(() => expect(screen.getByTestId('conflict-count').textContent).toBe('1'))

    // 只发生 1 次 preview，阶段 2 未触发；session 保持 active 以便用户修正
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]![1]).toMatchObject({ mode: 'preview' })
    expect(screen.getByTestId('status').textContent).toBe('active')
    expect(screen.getByTestId('cursor').textContent).toBe('1')
  })

  test('commit 阶段 409 SCHEDULE_STALE：session 置 stale，canApply 禁用', async () => {
    const execute = vi
      .spyOn(ganttSchedulingApi, 'execute')
      .mockImplementation(async (_projectId: number, input: GanttScheduleRequest) => {
        if (input.mode === 'commit') {
          throw { status: 409, code: 'SCHEDULE_STALE', message: '排程预览已过期，请重新预览' }
        }
        return BASE_RESPONSE
      })
    await setupUnsavedSession()

    fireEvent.click(screen.getByTestId('apply'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('stale'))

    expect(execute).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('canApply').textContent).toBe('false')
    // 未保存变更保留（供「放弃」或「重新试算」决策）
    expect(screen.getByTestId('cursor').textContent).toBe('1')
  })

  test('409 恢复路径一：放弃并刷新（discardSession 销毁 session）', async () => {
    vi.spyOn(ganttSchedulingApi, 'execute').mockImplementation(
      async (_projectId: number, input: GanttScheduleRequest) => {
        if (input.mode === 'commit') {
          throw { status: 409, code: 'SCHEDULE_STALE', message: '排程预览已过期，请重新预览' }
        }
        return BASE_RESPONSE
      },
    )
    await setupUnsavedSession()
    fireEvent.click(screen.getByTestId('apply'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('stale'))

    fireEvent.click(screen.getByTestId('discard'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('idle'))
    expect(screen.getByTestId('cursor').textContent).toBe('0')
    expect(screen.getByTestId('canApply').textContent).toBe('false')
  })

  test('409 恢复路径二：基于最新数据重新试算（enterSession 重开沙盒）', async () => {
    vi.spyOn(ganttSchedulingApi, 'execute').mockImplementation(
      async (_projectId: number, input: GanttScheduleRequest) => {
        if (input.mode === 'commit') {
          throw { status: 409, code: 'SCHEDULE_STALE', message: '排程预览已过期，请重新预览' }
        }
        return BASE_RESPONSE
      },
    )
    await setupUnsavedSession()
    fireEvent.click(screen.getByTestId('apply'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('stale'))

    fireEvent.click(screen.getByTestId('re-enter'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('active'))
    // 新基线命令栈归零，可继续拖拽推演
    expect(screen.getByTestId('cursor').textContent).toBe('0')
    fireEvent.click(screen.getByTestId('move'))
    await waitFor(() => expect(screen.getByTestId('cursor').textContent).toBe('1'))
    expect(screen.getByTestId('canApply').textContent).toBe('true')
  })

  test('preview 阶段即返回 409 同样置 stale 阻断提交', async () => {
    const execute = vi
      .spyOn(ganttSchedulingApi, 'execute')
      .mockImplementation(async (_projectId: number, input: GanttScheduleRequest) => {
        if (input.mode === 'preview') {
          throw { status: 409, code: 'SCHEDULE_STALE', message: '排程预览已过期，请重新预览' }
        }
        return BASE_RESPONSE
      })
    await setupUnsavedSession()

    fireEvent.click(screen.getByTestId('apply'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('stale'))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('canApply').textContent).toBe('false')
  })

  test('未进入试算/无命令时 apply 不发起任何请求', async () => {
    const execute = vi.spyOn(ganttSchedulingApi, 'execute').mockResolvedValue(BASE_RESPONSE)
    render(<Harness />, { wrapper: wrapper() })

    fireEvent.click(screen.getByTestId('apply'))
    // 无命令 → applySession 直接短路
    await waitFor(() => expect(execute).not.toHaveBeenCalled())
  })
})
