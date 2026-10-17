/**
 * v3-ui-next-chart-gallery W3 · tasks 3.1/3.4 —— AON 拓扑排版纯函数 + 网络图镜头测试。
 *
 * 覆盖：
 * - aon-layout 纯函数：Kahn 分层、坐标单调、环保护（回边忽略且可警示）、空图容错；
 * - AON 六格节点数值回显（ES/EF/LS/LF/工期/总时差）与 CPM 关键路径红色高亮判定
 *   （引擎核 + 镜像双传一致性由数值断言守门）；
 * - FS/SS/FF/SF + lag 边标签格式与关键边判定；
 * - 点击节点：直接前驱/后继连线聚焦（active）、其余弱化（dim）、侧边抽屉详情；
 * - 空态（无依赖引导去甘特）、错误重试；
 * - 只读零写：交互全程无任何写 API 调用。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TaskDependency } from '@/lib/api/dependencies'
import type { Task } from '@/lib/api/tasks'
import { layoutAonGraph, computeAonPositions } from '@/lib/next/charts/aon-layout'
import { formatAonDependencyLabel } from '@/components/next/charts/lenses/AonDependencyEdge'
import { AonNetworkChartLens } from '@/components/next/charts/lenses/AonNetworkChartLens'
import { __resetCriticalPathMemo } from '@/lib/gantt/critical-path'

// ---------------------------------------------------------------------------
// Module mocks（网络层全部走 mock，真实模块不触网）
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({
  listDeps: vi.fn(),
  listTasks: vi.fn(),
  createDep: vi.fn(),
  deleteDep: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}))

vi.mock('@/lib/api/dependencies', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/dependencies')>()
  return {
    ...original,
    dependenciesApi: {
      ...original.dependenciesApi,
      listByProject: apiMock.listDeps,
      create: apiMock.createDep,
      delete: apiMock.deleteDep,
    },
  }
})

vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/tasks')>()
  return {
    ...original,
    tasksApi: {
      ...original.tasksApi,
      list: apiMock.listTasks,
      update: apiMock.updateTask,
      delete: apiMock.deleteTask,
    },
  }
})

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts/aon-network',
  useParams: () => ({ id: '42', chartId: 'aon-network' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// Fixtures —— 排期：2026-03-02（周一）起
//  T1 需求分析(3d) ──FS──▶ T2 原型设计(2d) ──FS──▶ T3 用户走查(4d)  （关键链）
//  T1 ──SS+2d──▶ T4 竞品调研(5d)                                  （TF=2 非关键）
// ---------------------------------------------------------------------------

const BASE_TASK: Task = {
  id: 0,
  projectId: 42,
  name: '',
  description: null,
  status: 'not_started',
  priority: 'medium',
  taskType: 'task',
  startDate: null,
  endDate: null,
  actualStartDate: null,
  actualEndDate: null,
  durationDays: 1,
  estimatedHours: 8,
  actualHours: null,
  progressPercent: 0,
  assigneeId: null,
  reviewerId: null,
  parentTaskId: null,
  wbsNodeId: null,
  milestoneId: null,
  costEstimateCents: null,
  costActualCents: null,
  customFields: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}

function mkTask(overrides: Partial<Task>): Task {
  return { ...BASE_TASK, ...overrides }
}

function mkDep(
  id: number,
  predecessorId: number,
  successorId: number,
  type: 'fs' | 'ss' | 'ff' | 'sf',
  lagDays: number,
  names: Record<number, string>,
): TaskDependency {
  return {
    id,
    predecessorId,
    successorId,
    type,
    lagDays,
    predecessor: {
      id: predecessorId,
      name: names[predecessorId]!,
      status: 'not_started',
      startDate: null,
      endDate: null,
    },
    successor: {
      id: successorId,
      name: names[successorId]!,
      status: 'not_started',
      startDate: null,
      endDate: null,
    },
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  }
}

const NAMES: Record<number, string> = {
  1: '需求分析',
  2: '原型设计',
  3: '用户走查',
  4: '竞品调研',
}

const AON_TASKS: Task[] = [
  mkTask({
    id: 1,
    name: NAMES[1],
    startDate: '2026-03-02',
    endDate: '2026-03-04',
    durationDays: 3,
  }),
  mkTask({
    id: 2,
    name: NAMES[2],
    startDate: '2026-03-05',
    endDate: '2026-03-06',
    durationDays: 2,
  }),
  mkTask({
    id: 3,
    name: NAMES[3],
    startDate: '2026-03-09',
    endDate: '2026-03-12',
    durationDays: 4,
  }),
  mkTask({
    id: 4,
    name: NAMES[4],
    startDate: '2026-03-04',
    endDate: '2026-03-10',
    durationDays: 5,
  }),
]

const AON_DEPS: TaskDependency[] = [
  mkDep(11, 1, 2, 'fs', 0, NAMES),
  mkDep(12, 2, 3, 'fs', 0, NAMES),
  mkDep(13, 1, 4, 'ss', 2, NAMES),
]

function tasksEnvelope(tasks: Task[]) {
  return { data: tasks, meta: { total: tasks.length, page: 1, perPage: 100, totalPages: 1 } }
}

// ---------------------------------------------------------------------------
// 渲染上下文
// ---------------------------------------------------------------------------

function renderLens() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <div style={{ height: 720 }}>
        <AonNetworkChartLens projectId={42} />
      </div>
    </QueryClientProvider>,
  )
  return { client, ...utils }
}

function slotValue(nodeId: number, slot: string): string {
  const node = document.querySelector(`[data-aon-node][data-task-id="${nodeId}"]`)
  expect(node, `节点 ${nodeId} 应渲染`).not.toBeNull()
  const value = node!.querySelector(`[data-aon-slot="${slot}"] [data-aon-slot-value]`)
  expect(value, `节点 ${nodeId} 的 ${slot} 格应存在`).not.toBeNull()
  return value!.textContent ?? ''
}

beforeEach(() => {
  apiMock.listDeps.mockReset()
  apiMock.listTasks.mockReset()
  apiMock.createDep.mockReset()
  apiMock.deleteDep.mockReset()
  apiMock.updateTask.mockReset()
  apiMock.deleteTask.mockReset()
  __resetCriticalPathMemo()
})

// ---------------------------------------------------------------------------
// 1) aon-layout 纯函数
// ---------------------------------------------------------------------------

describe('aon-layout 分层排版纯函数', () => {
  test('链式/菱形 DAG：分层正确、x 沿 rank 单调、同层 y 不重叠', () => {
    const graph = layoutAonGraph(
      [1, 2, 3, 4, 5],
      [
        { predecessorId: 1, successorId: 2 },
        { predecessorId: 1, successorId: 3 },
        { predecessorId: 2, successorId: 4 },
        { predecessorId: 3, successorId: 4 },
        { predecessorId: 4, successorId: 5 },
      ],
    )
    expect(graph.hasCycle).toBe(false)
    expect(graph.cycleEdges).toHaveLength(0)
    expect(graph.ranks.get(1)).toBe(0)
    expect(graph.ranks.get(2)).toBe(1)
    expect(graph.ranks.get(3)).toBe(1)
    expect(graph.ranks.get(4)).toBe(2)
    expect(graph.ranks.get(5)).toBe(3)
    expect(graph.layers.map((layer) => [...layer].sort((a, b) => a - b))).toEqual([
      [1],
      [2, 3],
      [4],
      [5],
    ])

    const positions = computeAonPositions(graph)
    for (const taskId of graph.nodeIds) {
      const rank = graph.ranks.get(taskId)!
      const pos = positions.get(taskId)!
      expect(pos.x).toBeGreaterThanOrEqual(0)
      expect(pos.y).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(pos.x)).toBe(true)
      for (const other of graph.nodeIds) {
        const otherRank = graph.ranks.get(other)!
        if (otherRank > rank) {
          expect(positions.get(other)!.x).toBeGreaterThan(pos.x)
        }
      }
    }
    // 同层不同行 y 严格递增且互异
    const rank1Ids = graph.layers[1]!
    const ys = rank1Ids.map((id) => positions.get(id)!.y)
    expect(new Set(ys).size).toBe(rank1Ids.length)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })

  test('环路保护：检出回边、仍产出合法分层、可继续计算坐标', () => {
    const graph = layoutAonGraph(
      [1, 2, 3],
      [
        { predecessorId: 1, successorId: 2 },
        { predecessorId: 2, successorId: 3 },
        { predecessorId: 3, successorId: 1 },
      ],
    )
    expect(graph.hasCycle).toBe(true)
    expect(graph.cycleEdges).toHaveLength(1)
    expect(graph.cycleEdges[0]).toEqual({ predecessorId: 3, successorId: 1 })
    // 去环后的保留边分层严格递增
    expect(graph.ranks.get(1)).toBe(0)
    expect(graph.ranks.get(2)).toBe(1)
    expect(graph.ranks.get(3)).toBe(2)
    const positions = computeAonPositions(graph)
    expect(positions.size).toBe(3)
  })

  test('自环入回边、端点缺失边忽略、重复边去重', () => {
    const graph = layoutAonGraph(
      [1, 2],
      [
        { predecessorId: 1, successorId: 1 },
        { predecessorId: 1, successorId: 99 },
        { predecessorId: 1, successorId: 2 },
        { predecessorId: 1, successorId: 2 },
      ],
    )
    expect(graph.hasCycle).toBe(true)
    expect(graph.cycleEdges).toEqual([{ predecessorId: 1, successorId: 1 }])
    expect(graph.ranks.get(2)).toBe(1)
    expect(graph.layers).toHaveLength(2)
  })

  test('空图与无依赖节点容错（不抛错、全 rank 0）', () => {
    const empty = layoutAonGraph([], [])
    expect(empty.nodeIds).toHaveLength(0)
    expect(empty.layers).toHaveLength(0)
    expect(empty.hasCycle).toBe(false)
    expect(computeAonPositions(empty).size).toBe(0)

    const isolated = layoutAonGraph([7, 8, 9], [])
    expect(isolated.hasCycle).toBe(false)
    expect(isolated.ranks.get(7)).toBe(0)
    expect(isolated.ranks.get(8)).toBe(0)
    expect(isolated.ranks.get(9)).toBe(0)
    const positions = computeAonPositions(isolated)
    const ys = [7, 8, 9].map((id) => positions.get(id)!.y)
    expect(new Set(ys).size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 2) 边标签格式
// ---------------------------------------------------------------------------

describe('AonDependencyEdge 标签格式', () => {
  test('FS/SS/FF/SF 四种关系 + 正负滞后量', () => {
    expect(formatAonDependencyLabel('fs', 0)).toBe('FS')
    expect(formatAonDependencyLabel('ss', 0)).toBe('SS')
    expect(formatAonDependencyLabel('ff', 0)).toBe('FF')
    expect(formatAonDependencyLabel('sf', 0)).toBe('SF')
    expect(formatAonDependencyLabel('fs', 2)).toBe('FS+2d')
    expect(formatAonDependencyLabel('ff', -1)).toBe('FF-1d')
    expect(formatAonDependencyLabel('ss', 5)).toBe('SS+5d')
  })
})

// ---------------------------------------------------------------------------
// 3) 镜头渲染：六格数值 / 关键路径 / 聚焦 / 抽屉 / 零写
// ---------------------------------------------------------------------------

describe('AonNetworkChartLens 镜头', () => {
  beforeEach(() => {
    apiMock.listDeps.mockResolvedValue(AON_DEPS)
    apiMock.listTasks.mockResolvedValue(tasksEnvelope(AON_TASKS))
  })

  test('渲染六格数值：关键链 ES/EF/LS/LF/TF 与引擎判定一致，关键节点高亮', async () => {
    renderLens()
    expect(await screen.findByText('需求分析')).toBeInTheDocument()

    // T1（关键）：ES0 EF2 LS0 LF2 TF0 工期3d
    expect(slotValue(1, 'es')).toBe('0')
    expect(slotValue(1, 'ef')).toBe('2')
    expect(slotValue(1, 'ls')).toBe('0')
    expect(slotValue(1, 'lf')).toBe('2')
    expect(slotValue(1, 'tf')).toBe('0')
    expect(slotValue(1, 'dur')).toBe('3d')
    expect(document.querySelector('[data-aon-node][data-task-id="1"]')).toHaveAttribute(
      'data-critical',
      'true',
    )
    // T2：ES3 EF4
    expect(slotValue(2, 'es')).toBe('3')
    expect(slotValue(2, 'ef')).toBe('4')
    expect(slotValue(2, 'tf')).toBe('0')
    // T3：ES5 EF8，工期 4d
    expect(slotValue(3, 'es')).toBe('5')
    expect(slotValue(3, 'ef')).toBe('8')
    expect(slotValue(3, 'ls')).toBe('5')
    expect(slotValue(3, 'lf')).toBe('8')
    expect(slotValue(3, 'dur')).toBe('4d')
    expect(document.querySelector('[data-aon-node][data-task-id="3"]')).toHaveAttribute(
      'data-critical',
      'true',
    )
    // T4 非关键：ES2 EF6 LS4 LF8 总时差 2
    expect(slotValue(4, 'es')).toBe('2')
    expect(slotValue(4, 'ef')).toBe('6')
    expect(slotValue(4, 'ls')).toBe('4')
    expect(slotValue(4, 'lf')).toBe('8')
    expect(slotValue(4, 'tf')).toBe('2')
    expect(document.querySelector('[data-aon-node][data-task-id="4"]')).toHaveAttribute(
      'data-critical',
      'false',
    )
  })

  test('依赖边：FS 普通边与 SS+2d 标签、关键边判定贯穿', async () => {
    renderLens()
    expect(await screen.findByText('需求分析')).toBeInTheDocument()

    // 标签：两条 FS + 一条 SS+2d
    expect(screen.getAllByText('FS')).toHaveLength(2)
    expect(screen.getAllByText('SS+2d')).toHaveLength(1)
    const edgeEls = document.querySelectorAll('[data-aon-edge]')
    expect(edgeEls.length).toBe(3)
    const edge11 = document.querySelector('[data-aon-edge][data-edge-id="11"]')
    const edge13 = document.querySelector('[data-aon-edge][data-edge-id="13"]')
    expect(edge11).toHaveAttribute('data-type', 'fs')
    expect(edge13).toHaveAttribute('data-type', 'ss')
    expect(edge13).toHaveAttribute('data-lag', '2')
    expect(edge11).toHaveAttribute('data-critical', 'true')
    expect(edge13).toHaveAttribute('data-critical', 'false')
  })

  test('点击节点聚焦直接前驱/后继连线、其余弱化；侧边抽屉展示时差与依赖清单', async () => {
    renderLens()
    await screen.findByText('原型设计')

    fireEvent.click(screen.getByTestId('rf__node-2'))
    await waitFor(() => expect(document.querySelector('[data-aon-drawer]')).not.toBeNull())

    // 抽屉内容
    const drawerEl = document.querySelector('[data-aon-drawer]') as HTMLElement
    expect(within(drawerEl).getByText('原型设计')).toBeInTheDocument()
    expect(document.querySelector('[data-aon-drawer-close]')).not.toBeNull()
    expect(document.querySelector('[data-aon-drawer-critical]')).not.toBeNull()
    expect(document.querySelector('[data-aon-drawer-slot="最早开始 ES"]')).toHaveTextContent('3')

    // 直接邻接边 active：11（1→2）、12（2→3）；非邻接边 13 dim
    const activeEdges = document.querySelectorAll('[data-aon-edge][data-focus="active"]')
    expect(activeEdges).toHaveLength(2)
    const dimEdges = document.querySelectorAll('[data-aon-edge][data-focus="dim"]')
    expect(dimEdges).toHaveLength(1)
    expect(dimEdges[0]).toHaveAttribute('data-edge-id', '13')

    // 前驱/后继清单
    expect(within(drawerEl).getAllByText('需求分析').length).toBeGreaterThan(0)
    expect(within(drawerEl).getAllByText('用户走查').length).toBeGreaterThan(0)

    // 关闭抽屉
    fireEvent.click(document.querySelector('[data-aon-drawer-close]')!)
    await waitFor(() => expect(document.querySelector('[data-aon-drawer]')).toBeNull())
  })

  test('无依赖空态：语义引导 + 前往甘特图；有任务但无参与网络节点同样空态', async () => {
    apiMock.listDeps.mockResolvedValue([])
    renderLens()
    await waitFor(() => expect(document.querySelector('[data-aon-empty]')).not.toBeNull())
    const empty = document.querySelector('[data-aon-empty]') as HTMLElement
    expect(within(empty).getByText('当前项目暂无任务依赖关系')).toBeInTheDocument()
    const goto = document.querySelector('[data-aon-empty-goto-gantt]')
    expect(goto).toHaveAttribute('href', '/next/projects/42?lens=gantt')
  })

  test('接口失败错误卡 + 重试恢复', async () => {
    apiMock.listTasks.mockRejectedValueOnce(new Error('network down'))
    renderLens()
    await waitFor(() => expect(document.querySelector('[data-aon-error]')).not.toBeNull())

    apiMock.listTasks.mockResolvedValue(tasksEnvelope(AON_TASKS))
    fireEvent.click(document.querySelector('[data-aon-retry]')!)
    expect(await screen.findByText('需求分析')).toBeInTheDocument()
  })

  test('只读零写：节点点击/缩放组件交互全程零写 API 调用', async () => {
    renderLens()
    await screen.findByText('竞品调研')

    // 模拟高频交互：点击多个节点、关闭抽屉
    fireEvent.click(screen.getByTestId('rf__node-1'))
    await waitFor(() => expect(document.querySelector('[data-aon-drawer]')).not.toBeNull())
    fireEvent.click(screen.getByTestId('rf__node-4'))
    await waitFor(() => expect(document.querySelector('[data-aon-drawer]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-aon-drawer-close]')!)
    await waitFor(() => expect(document.querySelector('[data-aon-drawer]')).toBeNull())

    expect(apiMock.listTasks).toHaveBeenCalled()
    expect(apiMock.listDeps).toHaveBeenCalled()
    // 镜头只消费两个列表 GET；写能力全部零调用
    expect(apiMock.createDep).not.toHaveBeenCalled()
    expect(apiMock.deleteDep).not.toHaveBeenCalled()
    expect(apiMock.updateTask).not.toHaveBeenCalled()
    expect(apiMock.deleteTask).not.toHaveBeenCalled()
  })
})
