/**
 * 日历：月 / 周 / 日视图、当日侧栏、快速新建（双击 / 悬停加号 / 拖选）。
 * 快速新建是一张小表单：AI 建议以灰字预填，Tab 采纳，Enter 只用确认过的值建立，5 秒撤销。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarItem } from '@/lib/calendar-types'
import type { QuickCreateResult } from '@/lib/api/calendar-quick-create'
import { WorkspaceCalendarLens } from '@/components/next/lenses/WorkspaceCalendarLens'

const PROJECT_ID = 7
let items: CalendarItem[] = []
const windows: Array<{ dateFrom?: string; dateTo?: string }> = []

vi.mock('@/hooks/use-calendar', () => ({
  useProjectCalendarSchedule: (
    _projectId: number,
    filters: { anchorDate: string; dateFrom?: string; dateTo?: string },
  ) => {
    windows.push({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })
    return {
      data: { data: items, meta: { total: items.length, page: 1, perPage: 200, totalPages: 1 } },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isPlaceholderData: false,
    }
  },
}))

const mocks = vi.hoisted(() => ({
  suggest: vi.fn(),
  check: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/calendar-quick-create', () => ({
  calendarQuickCreateApi: { suggest: mocks.suggest, check: mocks.check },
}))

vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/tasks')>()
  return {
    ...actual,
    tasksApi: { ...actual.tasksApi, create: mocks.create, delete: mocks.remove },
  }
})

const options = {
  members: [
    { id: 1, name: '王经理', activeTasks: 4 },
    { id: 2, name: '李开发', activeTasks: 1 },
  ],
  workPackages: [{ id: 11, label: '1.2 数据迁移' }],
}

function suggestion(name: string, input: { startDate: string; endDate?: string }, extra = {}) {
  return {
    name,
    startDate: input.startDate,
    endDate: input.endDate ?? '2026-09-11',
    durationDays: 2,
    assigneeId: 2,
    assigneeName: '李开发',
    assigneeReason: '后端，手上任务少',
    wbsNodeId: 11,
    wbsNodeName: '1.2 数据迁移',
    priority: 'high' as const,
    aiFields: ['name', 'dates', 'assignee', 'wbs', 'priority'] as Array<
      'name' | 'dates' | 'assignee' | 'wbs' | 'priority'
    >,
    conflicts: [],
    ...extra,
  }
}

function result(input: { startDate: string; endDate?: string; text?: string }): QuickCreateResult {
  const text = input.text ?? ''
  const tasks = !text
    ? [
        suggestion('启动数据迁移：盘点旧表', input),
        suggestion('内测上线前的验收检查', input, { assigneeId: 1, priority: 'medium' }),
      ]
    : text.includes('；')
      ? text.split('；').map((part) => suggestion(`${part}并自测`, input))
      : [suggestion(`${text}并自测`, input)]
  return { source: 'ai', note: null, options, tasks }
}

function lunarFree(): React.ComponentProps<typeof WorkspaceCalendarLens>['calendarSystems'] {
  return ['solar']
}

function renderLens(props: Partial<React.ComponentProps<typeof WorkspaceCalendarLens>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceCalendarLens
        projectId={PROJECT_ID}
        today="2026-09-17"
        initialAnchorDate="2026-09-15"
        calendarSystems={lunarFree()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

const cell = (container: HTMLElement, date: string) =>
  container.querySelector<HTMLElement>(`[data-calendar-day][data-date="${date}"]`)!

function click(target: HTMLElement) {
  fireEvent.mouseDown(target, { button: 0 })
  fireEvent.mouseUp(window)
}

beforeEach(() => {
  items = []
  windows.length = 0
  mocks.suggest.mockReset().mockImplementation(async (_projectId: number, input) => result(input))
  mocks.check.mockReset().mockResolvedValue({
    conflicts: [[{ code: 'overload', message: '王经理 这段时间已有 4 件进行中的任务' }]],
  })
  mocks.create
    .mockReset()
    .mockImplementation(async (_projectId: number, input: { name: string }) => ({
      id: 900 + mocks.create.mock.calls.length,
      name: input.name,
    }))
  mocks.remove.mockReset().mockResolvedValue(undefined)
})

describe('月 / 周 / 日视图', () => {
  test('切到周：7 列、按这周查询、翻页一次 7 天；切到日：1 列', () => {
    const { container } = renderLens()
    fireEvent.click(screen.getByRole('radio', { name: '周' }))
    expect(container.querySelector('[data-calendar-columns="week"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-calendar-column]')).toHaveLength(7)
    expect(windows.at(-1)).toEqual({ dateFrom: '2026-09-14', dateTo: '2026-09-20' })
    expect(screen.getByRole('heading').textContent).toBe('2026年9月14日 – 20日')

    fireEvent.click(screen.getByLabelText('下一周'))
    expect(windows.at(-1)).toEqual({ dateFrom: '2026-09-21', dateTo: '2026-09-27' })

    fireEvent.click(screen.getByRole('radio', { name: '日' }))
    expect(container.querySelectorAll('[data-calendar-column]')).toHaveLength(1)
    // 日视图落在锚点那天（9/15 翻一周 → 9/22）
    expect(windows.at(-1)).toEqual({ dateFrom: '2026-09-22', dateTo: '2026-09-22' })
    expect(screen.getByRole('heading').textContent).toBe('2026年9月22日 · 周二')
  })

  test('周视图每天列出全部任务（不折叠），跨日任务每天都有', () => {
    items = [1, 2, 3, 4, 5].map((n) => ({
      id: `task-${n}`,
      kind: 'task' as const,
      sourceId: n,
      projectId: PROJECT_ID,
      name: `任务${n}`,
      status: 'in_progress',
      assignee: { id: 2, fullName: '李开发', email: 'li@x' },
      dateRange: {
        start: '2026-09-15',
        end: n === 1 ? '2026-09-17' : '2026-09-15',
        isSpan: n === 1,
        missingStart: false,
        missingEnd: false,
      },
      isMultiDay: n === 1,
      isOverdue: false,
      detailUrl: '',
    }))
    const { container } = renderLens({ initialView: 'week' })
    const tuesday = cell(container, '2026-09-15')
    expect(within(tuesday).getAllByText(/任务\d/)).toHaveLength(5)
    expect(within(tuesday).getAllByText(/李开发/).length).toBeGreaterThan(0)
    expect(within(cell(container, '2026-09-17')).getByText(/任务1/)).toBeTruthy()
  })
})

describe('当日侧栏', () => {
  test('单击空白选中某天 → 右侧当日面板；面板里可在这天新建', async () => {
    const { container } = renderLens()
    click(cell(container, '2026-09-10'))
    const panel = await screen.findByRole('complementary', { name: '2026-09-10 当日任务' })
    expect(within(panel).getByText('这天没有任务')).toBeTruthy()
    expect(cell(container, '2026-09-10').dataset.selected).toBe('true')

    fireEvent.click(within(panel).getByText('在这天新建任务'))
    const card = await screen.findByRole('dialog', { name: '快速新建任务' })
    expect(card.dataset.startDate).toBe('2026-09-10')
  })
})

describe('快速新建：灰字建议 + Tab 采纳', () => {
  async function openOn(container: HTMLElement, date: string) {
    fireEvent.doubleClick(cell(container, date))
    const card = await screen.findByRole('dialog', { name: '快速新建任务' })
    await waitFor(() =>
      expect(within(card).getByLabelText('任务名')).toHaveAttribute(
        'placeholder',
        '启动数据迁移：盘点旧表',
      ),
    )
    return card
  }

  test('打开就请模型（不先出规则）；每栏的 AI 建议是灰字；可以换一个建议', async () => {
    const { container } = renderLens()
    const card = await openOn(container, '2026-09-10')
    expect(mocks.suggest).toHaveBeenCalledTimes(1)
    expect(mocks.suggest.mock.calls[0]![1]).toEqual({ startDate: '2026-09-10', text: '' })
    expect(within(card).getByLabelText('任务名')).toHaveFocus()
    expect(within(card).getByLabelText('任务名')).toHaveValue('')
    for (const label of ['截止日期', '负责人', '工作包', '优先级']) {
      expect(within(card).getByLabelText(label)).toHaveAttribute('data-ghost', 'true')
    }
    expect((within(card).getByLabelText('截止日期') as HTMLInputElement).value).toBe('2026-09-11')
    expect(within(card).getByText('后端，手上任务少')).toBeTruthy()
    // 卡片里不再有表情符号
    expect(card.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)

    fireEvent.click(within(card).getByText('换一个建议（1/2）'))
    expect(within(card).getByLabelText('任务名')).toHaveAttribute(
      'placeholder',
      '内测上线前的验收检查',
    )
  })

  test('Tab 逐栏采纳灰字；Enter 只用确认过的值建立，审计记采纳的栏位；5 秒撤销', async () => {
    const { container } = renderLens()
    const card = await openOn(container, '2026-09-10')
    const nameInput = within(card).getByLabelText('任务名')
    fireEvent.keyDown(nameInput, { key: 'Tab' })
    expect(nameInput).toHaveValue('启动数据迁移：盘点旧表')
    expect(within(card).getByLabelText('截止日期')).toHaveFocus()
    fireEvent.keyDown(within(card).getByLabelText('截止日期'), { key: 'Tab' })
    expect(within(card).getByLabelText('截止日期')).not.toHaveAttribute('data-ghost')
    fireEvent.keyDown(within(card).getByLabelText('负责人'), { key: 'Tab' })
    // 工作包、优先级没采纳：仍是灰字，不会被建立
    expect(within(card).getByLabelText('工作包')).toHaveAttribute('data-ghost', 'true')
    // 采纳名称不会再请一次模型
    expect(mocks.suggest).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(nameInput, { key: 'Enter' })
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create).toHaveBeenCalledWith(PROJECT_ID, {
      name: '启动数据迁移：盘点旧表',
      startDate: '2026-09-10',
      endDate: '2026-09-11',
      priority: 'medium',
      assigneeId: 2,
      customFields: { source: 'calendar-quick-create', aiFields: ['name', 'dates', 'assignee'] },
    })
    const undo = await screen.findByText(/撤销（5）/)
    fireEvent.click(undo)
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(PROJECT_ID, 901))
  })

  test('打了开头：停顿后按打的内容请模型，灰字接在后面补全；自己选的负责人算自己定的，并提示冲突', async () => {
    const { container } = renderLens()
    const card = await openOn(container, '2026-09-10')
    const nameInput = within(card).getByLabelText('任务名')
    fireEvent.change(nameInput, { target: { value: '写导出接口' } })
    await waitFor(
      () => expect(card.querySelector('[data-ghost="name"]')?.textContent).toBe('并自测'),
      { timeout: 3000 },
    )
    expect(mocks.suggest.mock.calls.at(-1)![1]).toEqual({
      startDate: '2026-09-10',
      text: '写导出接口',
    })

    fireEvent.change(within(card).getByLabelText('负责人'), { target: { value: '1' } })
    // 按将要建立的值（自己选的负责人）重算冲突
    await waitFor(() =>
      expect(mocks.check.mock.calls.at(-1)?.[2]).toEqual([
        { name: '写导出接口', startDate: '2026-09-10', endDate: '2026-09-10', assigneeId: 1 },
      ]),
    )
    expect(await within(card).findByText('王经理 这段时间已有 4 件进行中的任务')).toBeTruthy()
    // 没采纳补全：按自己打的建立；负责人是自己选的，不算 AI 补的
    fireEvent.click(within(card).getByText('建立'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({
      name: '写导出接口',
      assigneeId: 1,
      customFields: { aiFields: [] },
    })
  })

  test('名称空着按 Enter 不建立，提示写任务名或采纳建议', async () => {
    const { container } = renderLens()
    const card = await openOn(container, '2026-09-10')
    fireEvent.keyDown(within(card).getByLabelText('任务名'), { key: 'Enter' })
    expect(within(card).getByRole('alert').textContent).toBe('请写任务名，或采纳灰字建议')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  test('一句话里几件事：提示可以分成几条，点了才一起建', async () => {
    const { container } = renderLens()
    const card = await openOn(container, '2026-09-10')
    fireEvent.change(within(card).getByLabelText('任务名'), {
      target: { value: '整理导出需求；开发导出接口' },
    })
    const split = await within(card).findByText('分成 2 条建立', undefined, { timeout: 3000 })
    expect(mocks.create).not.toHaveBeenCalled()
    fireEvent.click(split)
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/等 2 项/)).toBeTruthy()
  })

  test('按住拖过几天 → 日期就是拖选的范围（不是灰字）', async () => {
    const { container } = renderLens()
    fireEvent.mouseDown(cell(container, '2026-09-08'), { button: 0 })
    fireEvent.mouseEnter(cell(container, '2026-09-09'))
    fireEvent.mouseEnter(cell(container, '2026-09-10'))
    expect(cell(container, '2026-09-09').dataset.inDrag).toBe('true')
    fireEvent.mouseUp(window)

    const card = await screen.findByRole('dialog', { name: '快速新建任务' })
    expect(card.dataset.startDate).toBe('2026-09-08')
    expect(card.dataset.endDate).toBe('2026-09-10')
    await waitFor(() =>
      expect(mocks.suggest).toHaveBeenCalledWith(
        PROJECT_ID,
        { startDate: '2026-09-08', endDate: '2026-09-10', text: '' },
        expect.anything(),
      ),
    )
    const end = within(card).getByLabelText('截止日期') as HTMLInputElement
    expect(end.value).toBe('2026-09-10')
    expect(end).not.toHaveAttribute('data-ghost')
  })

  test('悬停加号点一下也能新建；点在任务条上不触发新建；Esc 关闭', async () => {
    items = [
      {
        id: 'task-1',
        kind: 'task',
        sourceId: 1,
        projectId: PROJECT_ID,
        name: '登录页开发',
        status: 'in_progress',
        assignee: null,
        dateRange: {
          start: '2026-09-11',
          end: '2026-09-11',
          isSpan: false,
          missingStart: false,
          missingEnd: false,
        },
        isMultiDay: false,
        isOverdue: false,
        detailUrl: '',
      },
    ]
    const onOpenTask = vi.fn()
    const { container } = renderLens({ onOpenTask })
    fireEvent.doubleClick(screen.getByText('登录页开发'))
    expect(screen.queryByRole('dialog', { name: '快速新建任务' })).toBeNull()

    fireEvent.click(container.querySelector('[data-calendar-add="2026-09-12"]')!)
    const card = await screen.findByRole('dialog', { name: '快速新建任务' })
    expect(card.dataset.startDate).toBe('2026-09-12')
    fireEvent.keyDown(card, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '快速新建任务' })).toBeNull()
  })
})
