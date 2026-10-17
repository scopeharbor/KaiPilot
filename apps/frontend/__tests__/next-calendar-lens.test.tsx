/**
 * v3-ui-next-remaining-lenses tasks 3.4 —— 日历时间切面镜头（WorkspaceCalendarLens）渲染与交互测试
 * （spec「日历时间切面镜头月历网格与任务落位」三场景 + 状态反馈需求）。
 *
 * 覆盖：
 * - 7 列月历网格布局与非当月单元格弱对比渲染（data-current-month）；
 * - 今天单元格电光天青发丝边框与高亮日期数字（data-today + --nx-space-cyan 类）；
 * - 跨日任务条带在多个相邻单元格连续呈现（start/middle/end 三段）；
 * - 点击「下个月 / 今天」anchorDate 推进/复位并重拉数据（查询参数捕获断言）；
 * - 单日 5 任务溢出 → 前 3 项微卡 + 「+2 项」胶囊，点击弹出当日完整排程浮层；
 * - 骨架屏（aria-busy）、空态、错误重试（refetch）与精确档静态化。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarItem, CalendarFullResponse } from '@/lib/calendar-types'
import { WorkspaceCalendarLens } from '@/components/next/lenses/WorkspaceCalendarLens'
import { useNextTrackStore } from '@/stores/next-track-store'

function setImmersion(tier: 'immersive' | 'light' | 'precise' | null) {
  act(() => {
    useNextTrackStore.getState().setImmersionTier(tier)
  })
}

// ---------------------------------------------------------------------------
// 数据与 hook 装配
// ---------------------------------------------------------------------------

const PROJECT_ID = 7

type QueryState = {
  data: CalendarFullResponse | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: ReturnType<typeof vi.fn>
  isPlaceholderData: boolean
}

function freshState(): QueryState {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isPlaceholderData: false,
  }
}

/** 各月份（YYYY-MM）的数据集；未收录月份回落空集。 */
const monthDatasets = new Map<string, CalendarItem[]>()

const capturedRequests: Array<{ projectId: number; anchorDate: string }> = []

let queryState = freshState()

vi.mock('@/hooks/use-calendar', () => ({
  useProjectCalendarSchedule: (
    projectId: number,
    filters: { view: string; anchorDate: string },
  ) => {
    capturedRequests.push({ projectId, anchorDate: filters.anchorDate })
    const month = filters.anchorDate.slice(0, 7)
    // 保留测试显式注入的 meta（如 unscheduledCount），并绑定当前 anchor 月的数据集
    const prevMeta = queryState.data?.meta
    const prevWorkingCalendar = queryState.data?.workingCalendar
    queryState.data = {
      ...(prevWorkingCalendar ? { workingCalendar: prevWorkingCalendar } : {}),
      data: monthDatasets.get(month) ?? [],
      meta: {
        total: 0,
        page: 1,
        perPage: 200,
        totalPages: 1,
        ...(prevMeta?.unscheduledCount ? { unscheduledCount: prevMeta.unscheduledCount } : {}),
      },
    }
    return queryState
  },
}))

function itemOf(
  name: string,
  start: string,
  end = start,
  kind: 'task' | 'milestone' = 'task',
): CalendarItem {
  return {
    id: `${kind}-${name}`,
    kind,
    sourceId: 1,
    projectId: PROJECT_ID,
    name,
    status: kind === 'milestone' ? 'planned' : 'in_progress',
    priority: kind === 'task' ? 'high' : undefined,
    assignee: null,
    dateRange: { start, end, isSpan: start !== end, missingStart: false, missingEnd: false },
    isMultiDay: start !== end,
    isOverdue: false,
    detailUrl: `/projects/${PROJECT_ID}/tasks/1`,
  }
}

function fullResponse(
  items: CalendarItem[],
  extra: Partial<CalendarFullResponse['meta']> = {},
): CalendarFullResponse {
  return {
    data: items,
    meta: { total: items.length, page: 1, perPage: 200, totalPages: 1, ...extra },
  }
}

function renderLens() {
  return render(
    <WorkspaceCalendarLens
      projectId={PROJECT_ID}
      today="2026-09-17"
      initialAnchorDate="2026-09-15"
    />,
  )
}

function cellOf(container: HTMLElement, date: string): HTMLElement {
  const cell = container.querySelector<HTMLElement>(`[data-calendar-day][data-date="${date}"]`)
  expect(cell, `应渲染日期格 ${date}`).toBeDefined()
  return cell!
}

function resetState() {
  capturedRequests.length = 0
  monthDatasets.clear()
  queryState = freshState()
}

beforeEach(() => {
  resetState()
  setImmersion(null)
})

afterEach(() => {
  setImmersion(null)
})

// ---------------------------------------------------------------------------

describe('WorkspaceCalendarLens 月历网格渲染', () => {
  test('渲染 7 列周首（周一~周日）与 35 格自然月矩阵，补齐周弱化标记', () => {
    monthDatasets.set('2026-09', [
      itemOf('接口联调', '2026-09-10'),
      itemOf('需求冻结', '2026-09-11', '2026-09-11', 'milestone'),
    ])
    const { container } = renderLens()

    // 表头 7 列 + 无障碍名称
    expect(screen.getAllByLabelText(/^周[一二三四五六日]$/)).toHaveLength(7)
    expect(screen.getByText('2026 年 9 月')).toBeTruthy()

    const days = container.querySelectorAll('[data-calendar-day]')
    expect(days).toHaveLength(35)
    // 首尾补齐周单元格：8 月 31 日（周一）与 10 月 1~4 日
    expect(cellOf(container, '2026-08-31').dataset.currentMonth).toBe('false')
    expect(cellOf(container, '2026-09-01').dataset.currentMonth).toBe('true')
    expect(cellOf(container, '2026-10-04').dataset.currentMonth).toBe('false')
    // 补齐周弱化：日期数字消费 muted 文本令牌
    expect(within(cellOf(container, '2026-08-31')).getByText('31').className).toContain(
      'text-[var(--nx-text-muted)]',
    )
    expect(within(cellOf(container, '2026-10-01')).getByText('1')).toBeTruthy()
    // 单日任务 / 里程碑微卡
    expect(screen.getByText('接口联调')).toBeTruthy()
    expect(screen.getByText('需求冻结')).toBeTruthy()
    expect(
      cellOf(container, '2026-09-11').querySelector('[data-calendar-milestone]'),
    ).not.toBeNull()
  })

  test('今天单元格呈现天青发丝边框与高亮数字（其余格无 today 标记）', () => {
    monthDatasets.set('2026-09', [itemOf('排期任务', '2026-09-10')])
    const { container } = renderLens()

    const todayCell = cellOf(container, '2026-09-17')
    expect(todayCell.dataset.today).toBe('true')
    expect(todayCell.className).toContain('ring-[var(--nx-space-cyan)]')
    const todayNumber = within(todayCell).getByText('17')
    expect(todayNumber.className).toContain('text-[var(--nx-space-cyan)]')
    expect(todayNumber.className).toContain('font-semibold')

    const ordinaryCell = cellOf(container, '2026-09-16')
    expect(ordinaryCell.dataset.today).toBeUndefined()
    expect(ordinaryCell.className).not.toContain('ring-[var(--nx-space-cyan)]')
  })

  test('跨日任务条带在多个相邻单元格连续呈现（起点/中段/终点）', () => {
    monthDatasets.set('2026-09', [
      itemOf('全链路联调窗口', '2026-09-14', '2026-09-16'),
      itemOf('单日微卡', '2026-09-15'),
    ])
    const { container } = renderLens()

    const startCell = cellOf(container, '2026-09-14')
    expect(startCell.querySelector('[data-span-edge="start"]')).not.toBeNull()
    expect(within(startCell).getByText('全链路联调窗口')).toBeTruthy()

    const middleCell = cellOf(container, '2026-09-15')
    expect(middleCell.querySelector('[data-span-edge="middle"]')).not.toBeNull()
    expect(middleCell.querySelectorAll('[data-calendar-item]')).toHaveLength(2)

    const endCell = cellOf(container, '2026-09-16')
    expect(endCell.querySelector('[data-span-edge="end"]')).not.toBeNull()
    // 三个单元格的条带归属同一任务（连续横贯）
    const names = ['2026-09-14', '2026-09-15', '2026-09-16'].map(
      (date) => cellOf(container, date).querySelector('[data-calendar-item]')?.textContent,
    )
    expect(names.join('|')).toContain('全链路联调窗口')
    // 区间外单元格零条带
    expect(cellOf(container, '2026-09-13').querySelector('[data-calendar-item]')).toBeNull()
    expect(cellOf(container, '2026-09-17').querySelector('[data-calendar-item]')).toBeNull()
  })

  test('周末单元格标记 data-weekend', () => {
    monthDatasets.set('2026-09', [itemOf('排期任务', '2026-09-10')])
    const { container } = renderLens()
    expect(cellOf(container, '2026-09-05').dataset.weekend).toBe('true')
    expect(cellOf(container, '2026-09-06').dataset.weekend).toBe('true')
    expect(cellOf(container, '2026-09-07').dataset.weekend).toBeUndefined()
  })
})

describe('WorkspaceCalendarLens 月份导航与重拉', () => {
  test('点击「下个月」推进 anchorDate 并重拉新月份数据', async () => {
    monthDatasets.set('2026-09', [itemOf('九月任务', '2026-09-10')])
    monthDatasets.set('2026-10', [itemOf('十月任务', '2026-10-05')])
    const { container } = renderLens()
    expect(screen.getByText('九月任务')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('下个月'))

    await waitFor(() => {
      expect(screen.getByText('2026 年 10 月')).toBeTruthy()
    })
    expect(await screen.findByText('十月任务')).toBeTruthy()
    // 十月网格（2026-10-01 周四 → 35 格）
    expect(container.querySelectorAll('[data-calendar-day]')).toHaveLength(35)
    expect(container.querySelector('[data-calendar-day][data-date="2026-09-10"]')).toBeNull()
    // 查询参数已携带新 anchorDate（YYYY-MM-DD）
    expect(capturedRequests.map((r) => r.anchorDate)).toContain('2026-09-15')
    expect(capturedRequests.map((r) => r.anchorDate)).toContain('2026-10-01')
  })

  test('点击「上个月」回退月份，点击「今天」复位到今天所在月', async () => {
    monthDatasets.set('2026-09', [itemOf('九月任务', '2026-09-10')])
    monthDatasets.set('2026-08', [itemOf('八月任务', '2026-08-12')])
    const { container } = renderLens()

    fireEvent.click(screen.getByLabelText('上个月'))
    expect(await screen.findByText('2026 年 8 月')).toBeTruthy()
    expect(await screen.findByText('八月任务')).toBeTruthy()
    expect(capturedRequests.map((r) => r.anchorDate)).toContain('2026-08-01')

    // 再「下个月」回 9 月（anchor 归一为 2026-09-01）
    fireEvent.click(screen.getByLabelText('下个月'))
    expect(await screen.findByText('2026 年 9 月')).toBeTruthy()
    expect(await screen.findByText('九月任务')).toBeTruthy()
    expect(capturedRequests.map((r) => r.anchorDate)).toContain('2026-09-01')

    // 点「今天」从月初归位到系统今天（2026-09-17，注入固定值）
    fireEvent.click(screen.getByLabelText('返回今天'))
    await waitFor(() => {
      expect(capturedRequests.map((r) => r.anchorDate)).toContain('2026-09-17')
    })
    expect(await screen.findByText('2026 年 9 月')).toBeTruthy()
    expect(cellOf(container, '2026-09-17').dataset.today).toBe('true')
  })
})

describe('WorkspaceCalendarLens 溢出折叠与当日侧栏', () => {
  test('单日 5 项收敛为前 3 微卡 +「+2 项」胶囊，点击在右侧当日面板列出全部', async () => {
    monthDatasets.set('2026-09', [
      itemOf('任务一', '2026-09-18'),
      itemOf('任务二', '2026-09-18'),
      itemOf('任务三', '2026-09-18'),
      itemOf('任务四', '2026-09-18'),
      itemOf('任务五', '2026-09-18'),
    ])
    const { container } = renderLens()

    const cell = cellOf(container, '2026-09-18')
    const pill = cell.querySelector<HTMLButtonElement>('[data-calendar-overflow]')
    expect(pill).not.toBeNull()
    expect(pill!.textContent).toBe('+2 项')

    // 单元格内仅渲染前 3 项
    expect(within(cell).getByText('任务一')).toBeTruthy()
    expect(within(cell).getByText('任务三')).toBeTruthy()
    expect(screen.queryByText('任务四')).toBeNull()
    expect(screen.queryByText('任务五')).toBeNull()

    // 点击胶囊 → 右侧当日面板（全部 5 项，不遮住日历）
    fireEvent.click(pill!)
    const panel = await screen.findByRole('complementary', { name: '2026-09-18 当日任务' })
    const rows = within(panel).queryAllByText(/^任务[一二三四五]$/)
    expect(rows).toHaveLength(5)
    expect(cellOf(container, '2026-09-18').dataset.selected).toBe('true')

    // 关闭面板
    fireEvent.click(within(panel).getByLabelText('关闭当日面板'))
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull()
    })
  })
})

describe('WorkspaceCalendarLens 状态反馈与精确档', () => {
  test('加载中渲染 7 列网格骨架屏（role=status + aria-busy）', () => {
    queryState.isPending = true
    queryState.data = undefined
    monthDatasets.set('2026-09', [itemOf('任务', '2026-09-10')])
    renderLens()

    const skeleton = screen.getByRole('status')
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByLabelText('正在加载日历排程')).toBeTruthy()
    // 工具栏标题仍可用
    expect(screen.getByText('2026 年 9 月')).toBeTruthy()
  })

  test('查询失败渲染错误卡，点击「重新载入」触发 refetch 后恢复', async () => {
    queryState.isError = true
    queryState.error = new Error('网络中断')
    queryState.data = undefined
    monthDatasets.set('2026-09', [itemOf('恢复任务', '2026-09-10')])

    const { rerender } = renderLens()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('日历排程加载失败')).toBeTruthy()
    expect(screen.getByText('网络中断')).toBeTruthy()

    fireEvent.click(screen.getByText('重新载入'))
    expect(queryState.refetch).toHaveBeenCalledTimes(1)

    // 网络恢复：错误清除后重新渲染出网格
    queryState.isError = false
    queryState.error = null
    rerender(
      <WorkspaceCalendarLens
        projectId={PROJECT_ID}
        today="2026-09-17"
        initialAnchorDate="2026-09-15"
      />,
    )
    expect(await screen.findByText('恢复任务')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('当月无排程：照常显示月格，顶部一行提示（含未排期任务计数）', () => {
    queryState.data = fullResponse([], { unscheduledCount: 3 })
    monthDatasets.set('2026-09', [])
    const { container } = renderLens()
    expect(screen.getByText('本月没有任务排期')).toBeTruthy()
    expect(screen.getByText(/另有 3 项任务未排定起止日期/)).toBeTruthy()
    // 月格不再被空态整块替换
    expect(container.querySelector('[data-calendar-month-grid]')).not.toBeNull()
    expect(container.querySelectorAll('[data-calendar-day]').length).toBeGreaterThanOrEqual(28)
  })

  test('日期格显示农历 / 法定「休 / 班」/ 封网角标（与旧轨同源）', () => {
    monthDatasets.set('2026-10', [itemOf('任务', '2026-10-12')])
    queryState.data = {
      data: [],
      meta: { total: 0, page: 1, perPage: 200, totalPages: 1 },
      workingCalendar: {
        workdays: [1, 2, 3, 4, 5],
        holidays: [],
        extraWorkdays: [],
        changeFreezeWindows: [{ start: '2026-10-20', end: '2026-10-22', label: '封网：演练' }],
      },
    } as unknown as CalendarFullResponse
    render(
      <WorkspaceCalendarLens
        projectId={PROJECT_ID}
        today="2026-09-17"
        initialAnchorDate="2026-10-15"
      />,
    )
    const cell = (date: string) =>
      document.querySelector(`[data-calendar-day][data-date="${date}"]`)!
    expect(cell('2026-10-01').querySelector('[data-calendar-statutory="off"]')).toBeTruthy()
    expect(cell('2026-10-10').querySelector('[data-calendar-statutory="work"]')).toBeTruthy()
    expect(cell('2026-10-21').querySelector('[data-calendar-freeze]')).toBeTruthy()
    expect(cell('2026-10-23').querySelector('[data-calendar-freeze]')).toBeNull()
    expect(cell('2026-10-15').querySelector('[data-calendar-lunar]')?.textContent).toBeTruthy()
  })

  test('切月加载中沿用上个月的空占位数据时，不误报本月「暂无任务排期」', () => {
    // 项目 10 月才开始：从 9 月（空）切到 10 月，新月份返回前 placeholderData 仍是 9 月的空集
    queryState.isPlaceholderData = true
    monthDatasets.set('2026-09', [])
    renderLens()
    expect(screen.queryByText('当前月份暂无任务排期')).toBeNull()
    expect(document.querySelector('[data-calendar-month-grid]')).toBeTruthy()
  })

  test('精确档：停用今天数字光晕与骨架脉冲', () => {
    setImmersion('precise')
    queryState.isPending = true
    queryState.data = undefined
    monthDatasets.set('2026-09', [itemOf('任务', '2026-09-17')])

    const { container, rerender } = renderLens()
    expect(container.querySelector('[data-calendar-lens]')?.getAttribute('data-immersion')).toBe(
      'precise',
    )
    const skeleton = container.querySelector('[data-calendar-skeleton]')
    expect(skeleton?.querySelector('.animate-pulse')).toBeNull()

    // 数据就绪：今天格保留天青 1px 发丝边框，但数字无光晕
    queryState.isPending = false
    rerender(
      <WorkspaceCalendarLens
        projectId={PROJECT_ID}
        today="2026-09-17"
        initialAnchorDate="2026-09-15"
      />,
    )
    const todayCell = cellOf(container, '2026-09-17')
    expect(todayCell.className).toContain('ring-[var(--nx-space-cyan)]')
    expect(within(todayCell).getByText('17').className).not.toContain('text-shadow')
  })
})
