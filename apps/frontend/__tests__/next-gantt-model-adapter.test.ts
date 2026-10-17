/**
 * v3-ui-next-gantt-lens tasks 1.2 —— 甘特数据模型适配单元测试。
 *
 * 覆盖（tasks 1.1/1.2 契约）：
 * - 数据适配链：`useNextGanttModel`（复用 `useProjectGanttModel` 并行拉取）+
 *   `buildGanttModelFromApi` 确定性组装，1000 任务极限分页（10 页 × 100）组合、
 *   优先级等新轨图元确定性属性回填；
 * - UTC epoch 动态对齐（最早起始日为天偏移 0）与工期天数换算；
 * - depth 层级防环（父链自环/互环终止而不死循环）；
 * - FS/SS/FF/SF 四类依赖过滤（双端存在性剔除脏依赖）与 CPM 关键路径字段回填；
 * - 纯函数几何：scaleTime 线性天→像素映射、日/周/月三档刻度、四类依赖正交折线、
 *   视口裁剪窗口（ROW_BUFFER=4 / DAY_BUFFER=4）。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { dependenciesApi, type DependencyType } from '@/lib/api/dependencies'
import { milestonesApi } from '@/lib/api/milestones'
import { projectsApi, type Project } from '@/lib/api/projects'
import { tasksApi, type Task, type TaskPriority } from '@/lib/api/tasks'
import { buildGanttModelFromApi } from '@/lib/gantt/model-from-api'
import {
  DAY_BUFFER,
  NX_PX_PER_DAY,
  ROW_BUFFER,
  buildNextGanttModel,
  buildNextTimeScale,
  buildNextTicks,
  orthogonalDependencyPath,
  useNextGanttModel,
  visibleDayRange,
  visibleRowRange,
  type NextGanttViewport,
} from '@/lib/gantt/next-gantt-adapter'

vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/tasks')>()
  return { ...actual, tasksApi: { ...actual.tasksApi, list: vi.fn() } }
})
vi.mock('@/lib/api/dependencies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/dependencies')>()
  return { ...actual, dependenciesApi: { ...actual.dependenciesApi, listByProject: vi.fn() } }
})
vi.mock('@/lib/api/milestones', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/milestones')>()
  return { ...actual, milestonesApi: { ...actual.milestonesApi, list: vi.fn() } }
})
vi.mock('@/lib/api/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/projects')>()
  return { ...actual, projectsApi: { ...actual.projectsApi, get: vi.fn() } }
})

const PROJECT_ID = 7
const EPOCH_ISO = '2026-09-07'
const EPOCH_MS = Date.parse(`${EPOCH_ISO}T00:00:00Z`)

const iso = (dayOffset: number): string =>
  new Date(EPOCH_MS + dayOffset * 86_400_000).toISOString().slice(0, 10)

let taskSeq = 0
function taskOf(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? ++taskSeq
  return {
    id,
    projectId: PROJECT_ID,
    name: `任务${id}`,
    description: null,
    status: overrides.status ?? 'not_started',
    priority: overrides.priority ?? 'medium',
    taskType: overrides.taskType ?? 'task',
    startDate: overrides.startDate ?? iso(0),
    endDate: overrides.endDate ?? iso(4),
    actualStartDate: null,
    actualEndDate: null,
    durationDays: overrides.durationDays === undefined ? 5 : overrides.durationDays,
    estimatedHours: null,
    actualHours: null,
    progressPercent: overrides.progressPercent ?? 0,
    assigneeId: overrides.assigneeId ?? null,
    assignee: overrides.assignee,
    reviewerId: null,
    parentTaskId: overrides.parentTaskId ?? null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
  }
}

function depOf(
  overrides: Partial<{
    id: number
    predecessorId: number
    successorId: number
    type: DependencyType
    lagDays: number
  }> & { predecessorId: number; successorId: number },
): import('@/lib/api/dependencies').TaskDependency {
  const id = overrides.id ?? depSeq++
  return {
    id,
    predecessorId: overrides.predecessorId,
    successorId: overrides.successorId,
    type: overrides.type ?? 'fs',
    lagDays: overrides.lagDays ?? 0,
    predecessor: {
      id: overrides.predecessorId,
      name: `任务${overrides.predecessorId}`,
      status: 'not_started',
      startDate: null,
      endDate: null,
    },
    successor: {
      id: overrides.successorId,
      name: `任务${overrides.successorId}`,
      status: 'not_started',
      startDate: null,
      endDate: null,
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
  }
}
let depSeq = 1

describe('buildGanttModelFromApi（纯函数组装，tasks 1.1/1.2）', () => {
  beforeEach(() => {
    depSeq = 1
  })

  test('UTC epoch 动态对齐最早起始日，天偏移与工期确定性换算', () => {
    const tasks = [
      taskOf({ id: 1, startDate: '2026-10-01', endDate: '2026-10-05', durationDays: null }),
      taskOf({ id: 2, startDate: '2026-10-08', endDate: '2026-10-09', durationDays: null }),
    ]
    const model = buildGanttModelFromApi(tasks, [], null, [])
    expect(model.epochMs).toBe(Date.parse('2026-10-01T00:00:00Z'))
    expect(model.tasks[0]!.startDay).toBe(0)
    expect(model.tasks[0]!.durationDays).toBe(5)
    expect(model.tasks[1]!.startDay).toBe(7)
    expect(model.tasks[1]!.durationDays).toBe(2)
  })

  test('depth 层级防环：父链互环/自环终止且深度正确', () => {
    // 1 → 2 → 3，且 3 ↔ 4 互环、5 自环。
    const tasks = [
      taskOf({ id: 1, parentTaskId: null }),
      taskOf({ id: 2, parentTaskId: 1 }),
      taskOf({ id: 3, parentTaskId: 2 }),
      taskOf({ id: 4, parentTaskId: 3 }),
      taskOf({ id: 5, parentTaskId: 5 }),
    ]
    tasks[2]!.parentTaskId = 4 // 3 ↔ 4 互环
    const model = buildGanttModelFromApi(tasks, [], null, [])
    const byId = new Map(model.tasks.map((t) => [t.id, t]))
    expect(byId.get(1)!.depth).toBe(0)
    expect(byId.get(2)!.depth).toBe(1)
    // 互环成员：3 → 4 → 3 在 seen 集合处终止（depth 1，不死循环）。
    expect(byId.get(3)!.depth).toBe(1)
    expect(byId.get(4)!.depth).toBe(1)
    expect(byId.get(5)!.depth).toBe(0)
    // 有子节点者标记为 summary。
    expect(byId.get(1)!.kind).toBe('summary')
    expect(byId.get(3)!.kind).toBe('summary')
  })

  test('依赖过滤：双端存在性剔除脏依赖，四类类型与 lag 原样保留', () => {
    const tasks = [taskOf({ id: 1 }), taskOf({ id: 2 }), taskOf({ id: 3 }), taskOf({ id: 4 })]
    const deps = [
      depOf({ id: 1, predecessorId: 1, successorId: 2, type: 'fs' as DependencyType, lagDays: 1 }),
      depOf({ id: 2, predecessorId: 2, successorId: 3, type: 'ss' as DependencyType }),
      depOf({ id: 3, predecessorId: 3, successorId: 4, type: 'ff' as DependencyType }),
      depOf({ id: 4, predecessorId: 4, successorId: 1, type: 'sf' as DependencyType }),
      // 脏数据：端点不在任务集内。
      depOf({ id: 5, predecessorId: 999, successorId: 2 }),
      depOf({ id: 6, predecessorId: 1, successorId: 888 }),
    ]
    const model = buildGanttModelFromApi(tasks, deps, null, [])
    expect(model.dependencies.map((d) => d.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(model.dependencies.map((d) => d.type)).toEqual(['fs', 'ss', 'ff', 'sf'])
    expect(model.dependencies[0]!.lagDays).toBe(1)
  })

  test('CPM 关键路径字段回填：链上任务与依赖 isCritical，带浮动的离链任务非关键', () => {
    // 紧密工作日链（零间隙）：A 09-07..09-11(5d) → FS → B 09-14..09-18(5d) → FS → D 09-21..09-23(3d)。
    const tasks = [
      taskOf({ id: 1, name: 'A', startDate: iso(0), endDate: iso(4), durationDays: 5 }),
      taskOf({ id: 2, name: 'B', startDate: iso(5), endDate: iso(9), durationDays: 5 }),
      taskOf({ id: 3, name: 'D', startDate: iso(10), endDate: iso(12), durationDays: 3 }),
      taskOf({ id: 4, name: 'C', startDate: iso(0), endDate: iso(1), durationDays: 2 }),
    ]
    const deps = [
      depOf({ id: 1, predecessorId: 1, successorId: 2, type: 'fs' as DependencyType }),
      depOf({ id: 2, predecessorId: 2, successorId: 3, type: 'fs' as DependencyType }),
    ]
    const model = buildGanttModelFromApi(tasks, deps, null, [])
    const byId = new Map(model.tasks.map((t) => [t.id, t]))
    expect(byId.get(1)!.isCritical).toBe(true)
    expect(byId.get(2)!.isCritical).toBe(true)
    expect(byId.get(3)!.isCritical).toBe(true)
    expect(byId.get(4)!.isCritical).toBe(false)
    expect(typeof byId.get(4)!.totalFloat).toBe('number')
    expect(model.dependencies.every((d) => d.isCritical === true)).toBe(true)
  })

  test('优先级等新轨确定性属性：buildNextGanttModel 兜底 medium', () => {
    const tasks = [taskOf({ id: 1, priority: 'high' as TaskPriority }), taskOf({ id: 2 })]
    const base = buildGanttModelFromApi(tasks, [], null, [])
    const next = buildNextGanttModel(base)
    expect(next.tasks[0]!.priority).toBe('high')
    expect(next.tasks[1]!.priority).toBe('medium')
  })
})

describe('useNextGanttModel（复用 useProjectGanttModel，tasks 1.1 契约核验）', () => {
  let listMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    listMock = vi.mocked(tasksApi.list)
    vi.mocked(dependenciesApi.listByProject).mockResolvedValue([])
    vi.mocked(milestonesApi.list).mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 100, totalPages: 0 },
    })
    vi.mocked(projectsApi.get).mockResolvedValue({
      id: PROJECT_ID,
      name: '测试项目',
      settings: null,
    } as unknown as Project)
  })

  test('1000 任务极限分页（10 页 × 100）并行组合为完整模型', async () => {
    listMock.mockImplementation(
      async (_projectId: number, filters?: { page?: number; perPage?: number }) => {
        const page = filters?.page ?? 1
        const per = filters?.perPage ?? 100
        const start = (page - 1) * per
        const data = Array.from({ length: per }, (_, i) => {
          const id = start + i + 1
          return taskOf({
            id,
            startDate: iso((id % 40) * 3),
            endDate: iso((id % 40) * 3 + 2),
            durationDays: 3,
          })
        }).slice(0, Math.max(0, 1000 - start))
        return { data, meta: { total: 1000, page, perPage: per, totalPages: 10 } }
      },
    )
    const deps = Array.from({ length: 1500 }, (_, i) =>
      depOf({
        id: i + 1,
        predecessorId: (i % 1000) + 1,
        successorId: ((i + 180) % 1000) + 1,
        type: (['fs', 'ss', 'ff', 'sf'] as const)[i % 4],
      }),
    )
    vi.mocked(dependenciesApi.listByProject).mockResolvedValue(deps)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useNextGanttModel(PROJECT_ID), {
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    })

    await waitFor(() => expect(result.current.model).not.toBeNull())
    const model = result.current.model!
    expect(model.tasks).toHaveLength(1000)
    expect(model.dependencies).toHaveLength(1500)
    // 分页拉满 10 页（并行逐页）。
    expect(listMock).toHaveBeenCalledTimes(10)
    // 任务行均带确定性优先级与 CPM 字段（环数据下 CPM 降级不抛）。
    for (const t of model.tasks) {
      expect(t.priority).toBeTruthy()
      expect(typeof t.isCritical).toBe('boolean')
    }
    // UTC epoch 对齐最早起始日（iso(0)）。
    expect(model.epochMs).toBe(EPOCH_MS)
    expect(model.timeRange.endDay).toBeGreaterThan(0)
  })

  test('真实里程碑实体组装为负 id 里程碑行与标记', async () => {
    listMock.mockResolvedValue({
      data: [taskOf({ id: 1 })],
      meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
    })
    vi.mocked(milestonesApi.list).mockResolvedValue({
      data: [
        {
          id: 10,
          projectId: PROJECT_ID,
          name: '里程碑 M1',
          description: null,
          status: 'planned',
          storedStatus: 'planned',
          plannedDate: iso(4),
          autoCalculated: false,
          displayOrder: 1,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: null,
        },
      ],
      meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useNextGanttModel(PROJECT_ID), {
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    })
    await waitFor(() => expect(result.current.model).not.toBeNull())
    const model = result.current.model!
    expect(model.milestones).toHaveLength(1)
    expect(model.milestones[0]!.taskId).toBe(-11)
    expect(model.tasks.find((t) => t.id === -11)?.kind).toBe('milestone')
    expect(model.tasks.find((t) => t.id === -11)?.startDay).toBe(4)
  })
})

describe('新轨几何与视口裁剪（tasks 1.3/1.7 纯函数）', () => {
  const scaleOf = (granularity: 'day' | 'week' | 'month') => {
    const model = buildGanttModelFromApi(
      [taskOf({ id: 1, startDate: iso(0), endDate: iso(40) })],
      [],
      null,
      [],
    )
    return buildNextTimeScale(model, granularity, { todayMs: EPOCH_MS + 60 * 86_400_000 })
  }

  /** 以指定 epoch（月首等便于刻度断言）构建比例尺。 */
  const scaleFromEpoch = (epochIso: string, granularity: 'day' | 'week' | 'month') => {
    const epochMs = Date.parse(`${epochIso}T00:00:00Z`)
    const endIso = new Date(epochMs + 40 * 86_400_000).toISOString().slice(0, 10)
    const model = buildGanttModelFromApi(
      [taskOf({ id: 1, startDate: epochIso, endDate: endIso })],
      [],
      null,
      [],
    )
    return buildNextTimeScale(model, granularity, { todayMs: epochMs + 60 * 86_400_000 })
  }

  test('scaleTime 线性映射：日 40px/周 80px/月 ≈120px 单元格', () => {
    const day = scaleOf('day')
    expect(day.pxPerDay).toBe(40)
    expect(day.timeScale(EPOCH_MS)).toBe(0)
    expect(day.timeScale(EPOCH_MS + 5 * 86_400_000)).toBeCloseTo(200, 8)
    expect(day.timeScale(EPOCH_MS + 7 * 86_400_000)).toBeCloseTo(280, 8)

    const week = scaleOf('week')
    expect(week.pxPerDay).toBeCloseTo(80 / 7)
    expect(week.timeScale(EPOCH_MS + 7 * 86_400_000)).toBeCloseTo(80, 8)

    const month = scaleOf('month')
    expect(month.pxPerDay).toBe(4)
    expect(month.timeScale(EPOCH_MS + 30 * 86_400_000)).toBeCloseTo(120, 8)
  })

  test('visibleRowRange / visibleDayRange 应用 ROW_BUFFER=4 / DAY_BUFFER=4', () => {
    expect(ROW_BUFFER).toBe(4)
    expect(DAY_BUFFER).toBe(4)
    const day = scaleOf('day')
    const viewport: NextGanttViewport = {
      width: 1200,
      height: 800,
      scrollLeft: 600,
      scrollTop: 1000,
    }
    expect(visibleRowRange(viewport, day, 100)).toEqual({ startRow: 23, endRow: 54 })
    expect(visibleDayRange(viewport, day)).toEqual({ startDay: 11, endDay: 49 })
  })

  test('日刻度两级标尺：月界主刻度 + 01/02 次刻度与周末标定', () => {
    const day = scaleFromEpoch('2026-09-01', 'day')
    const { major, minor } = buildNextTicks(day, { startDay: 0, endDay: 31 })
    expect(major[0]!.label).toBe('2026年9月')
    expect(minor[0]!.label).toBe('01')
    expect(minor[0]!.weekend).toBe(false) // 2026-09-01 周二
    expect(minor[4]!.weekend).toBe(true) // 2026-09-05 周六
    expect(minor[5]!.weekend).toBe(true) // 2026-09-06 周日
    expect(NX_PX_PER_DAY.day).toBe(40)
  })

  test('周刻度：主标尺月界、次标尺 W 序号（MM/DD）且步进 7 天', () => {
    const week = scaleFromEpoch('2026-09-01', 'week')
    const { major, minor } = buildNextTicks(week, { startDay: 0, endDay: 20 })
    expect(minor.length).toBeGreaterThan(0)
    // 2026-09-01 是周二 → 首个自然周刻度落在周一 09-07（day 6）；步进 7 天。
    const first = minor[0]!
    expect(first.label).toMatch(/^W\d+ \(\d{2}\/\d{2}\)$/)
    expect(first.day).toBe(6)
    expect(minor[1]!.day - minor[0]!.day).toBe(7)
    expect(major.some((t) => t.label === '2026年9月')).toBe(true)
  })

  test('月刻度：次标尺按月、主标尺仅年界', () => {
    const month = scaleFromEpoch('2026-09-01', 'month')
    const { major, minor } = buildNextTicks(month, { startDay: 0, endDay: 120 })
    expect(minor[0]!.label).toBe('2026年9月')
    expect(minor.some((t) => t.label === '2026年10月')).toBe(true)
    expect(major).toHaveLength(0) // 9–12 月无年界
    // 跨年窗口出现主刻度（2027-01-01 = day 122）。
    const crossYear = buildNextTicks(month, { startDay: 90, endDay: 165 })
    expect(crossYear.major.map((t) => t.label)).toContain('2027年')
  })

  test('四类依赖正交折线：伸出/折回路径确定性', () => {
    const ep = (x1: number, y1: number, x2: number, y2: number) => ({
      id: 1,
      x1,
      y1,
      x2,
      y2,
      predRow: 0,
      succRow: 1,
    })
    // FS：前置终点右侧伸出 24px，后继在伸出点右侧 → 直接下落。
    expect(orthogonalDependencyPath(ep(79, 18, 280, 54), 'fs')).toBe('M79,18 H103 V54 H280')
    // FF：后继在左侧 → 折回中点位。
    expect(orthogonalDependencyPath(ep(399, 738, 199, 774), 'ff')).toBe('M399,738 H299 V774 H199')
    // SS：起点侧向左伸出，后继更右 → 左伸后下落折回。
    expect(orthogonalDependencyPath(ep(400, 378, 200, 414), 'ss')).toBe('M400,378 H376 V414 H200')
    // SF：后继锚点在终点侧。
    expect(orthogonalDependencyPath(ep(240, 1098, 119, 1134), 'sf')).toBe(
      'M240,1098 H216 V1134 H119',
    )
  })
})
