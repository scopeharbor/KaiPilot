'use client'

import * as React from 'react'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
} from '@xyflow/react'
import { AlertTriangle, GitBranch, RefreshCw, Route, X, Network as NetworkIcon } from 'lucide-react'
import { dependenciesApi, dependencyKeys } from '@/lib/api/dependencies'
import type { TaskDependency } from '@/lib/api/dependencies'
import { tasksApi, taskKeys } from '@/lib/api/tasks'
import type { Task } from '@/lib/api/tasks'
import {
  memoizedComputeCriticalPath,
  type CpmDependencyInput,
  type CpmTaskInput,
  type CpmTaskType,
} from '@/lib/gantt/critical-path'
import {
  createWorkingCalendar,
  endFromStart,
  shiftWorkingDays,
  snapToWorkingDay,
  startFromEnd,
  workingDayDuration,
  type WorkingCalendar,
} from '@/lib/gantt/working-calendar'
import { CHART_EPOCH_MS } from '@/lib/gantt/geometry'
import {
  AON_NODE_HEIGHT,
  AON_NODE_WIDTH,
  computeAonPositions,
  layoutAonGraph,
  aonNodePoint,
  type AonPoint,
  type AonRankedGraph,
} from '@/lib/next/charts/aon-layout'
import { AonSixBoxNode, type AonSixBoxFlowNode } from './AonSixBoxNode'
import { AonDependencyEdge, type AonDependencyFlowEdge } from './AonDependencyEdge'
import { cn } from '@/lib/utils'

/**
 * AON 紧前节点网络图镜头（v3-ui-next-chart-gallery tasks 3.3）。
 *
 * - 数据：项目级依赖 `GET /projects/:id/dependencies` + 全量任务（分页拉满，与甘特同源缓存键）；
 * - CPM 核心：`lib/gantt/critical-path.ts` 纯函数核（isCritical / 边关键判定权威来源，
 *   `backfillCriticalPath` 同构语义）；六格 ES/EF/LS/LF 显示值由下方镜像双传派生
 *   （引擎只回传关键标记与总时差，不暴露逐日细节；镜像与引擎同用 working-calendar 原语，
 *   一致性由 `next-chart-aon-network.test.tsx` 的引擎对齐断言守门）；
 * - 排版：自研 Kahn 分层纯函数 `aon-layout.ts`（环保护：回边忽略并警示）；
 * - 交互：平移/缩放/适应全景/小地图；点击节点聚焦直接前驱/后继，其余弱化，
 *   右侧抽屉展示六格与依赖清单；
 * - 只读铁律：节点禁拖拽、画布禁连线（nodesDraggable/nodesConnectable=false），
 *   交互仅 GET 查询，零 POST/PATCH/DELETE（RL-01 / RL-06 / spec「零写保护」）。
 */

const DAY_MS = 86_400_000
/** 超过该节点数不做首屏全景适配，改从左上角可读缩放起步。 */
const AON_FIT_VIEW_MAX_NODES = 40
const AON_READABLE_VIEWPORT = { x: 24, y: 24, zoom: 0.7 }
const TASK_PAGE_SIZE = 100
const TASK_MAX_PAGES = 10

/**
 * 声明式连接点：六格节点不渲染 <Handle> DOM（避免可见连接点干扰只读视觉），
 * 但 xyflow 需要 node.handles 才视节点为 initialized 并渲染依赖边
 * （jsdom 无 ResizeObserver 实测也依赖该声明，见 tasks 3.4 测试方案）。
 * 左缘中线 = target（前驱来向），右缘中线 = source（后继去向）。
 */
const AON_NODE_HANDLES = [
  { id: 'in', type: 'target' as const, position: Position.Left, x: 0, y: AON_NODE_HEIGHT / 2 },
  {
    id: 'out',
    type: 'source' as const,
    position: Position.Right,
    x: AON_NODE_WIDTH,
    y: AON_NODE_HEIGHT / 2,
  },
]

// ---------------------------------------------------------------------------
// 纯函数模型装配（buildAonNetworkView）：tasks + deps → 六格/关键标记/坐标
// ---------------------------------------------------------------------------

function parseIsoDateMs(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

interface NormalizedAonTask {
  taskId: number
  name: string
  isMilestone: boolean
  startMs: number
  endMs: number
}

interface NormalizedAonDep {
  depId: number
  predecessorId: number
  successorId: number
  type: 'fs' | 'ss' | 'ff' | 'sf'
  lagDays: number
}

export interface AonNodeSchedule {
  taskId: number
  name: string
  isMilestone: boolean
  /** 工作日工期（引擎口径，里程碑 0） */
  durationDays: number
  /** 相对网络锚点的天序（0 = 锚点日，工作日计数） */
  es: number
  ef: number
  ls: number
  lf: number
  /** 总时差（工作日）；0 = 关键路径 */
  totalFloat: number
  isCritical: boolean
  esIso: string
  efIso: string
  lsIso: string
  lfIso: string
}

export interface AonEdgeSchedule {
  depId: number
  predecessorId: number
  successorId: number
  predecessorName: string
  successorName: string
  type: 'fs' | 'ss' | 'ff' | 'sf'
  lagDays: number
  isCritical: boolean
}

export interface AonNetworkView {
  ok: true
  /** 0 天对应的 ISO 日期；null = 无任何计划日期（纯相对排布） */
  anchorIso: string | null
  nodes: AonNodeSchedule[]
  edges: AonEdgeSchedule[]
  positions: Map<number, AonPoint>
  layout: AonRankedGraph
  /** 任务总数（含孤立但参与网络的节点数） */
  nodeCount: number
  edgeCount: number
  /** 参与网络的任务是否带计划日期（决定图例展示） */
  hasPlannedDates: boolean
}

export type AonNetworkBuildResult =
  { ok: false; reason: 'no-dependencies' | 'no-tasks' } | AonNetworkView

/** 镜像 CPM 双传（语义与 critical-path.ts 同构，供六格显示值使用）。 */
function schedulePass(
  calendar: WorkingCalendar,
  tasks: NormalizedAonTask[],
  deps: NormalizedAonDep[],
  topoOrder: number[],
): ScheduleEntry[] {
  const taskById = new Map(tasks.map((t) => [t.taskId, t]))
  const incoming = new Map<number, NormalizedAonDep[]>()
  const outgoing = new Map<number, NormalizedAonDep[]>()
  for (const dep of deps) {
    incoming.set(dep.successorId, [...(incoming.get(dep.successorId) ?? []), dep])
    outgoing.set(dep.predecessorId, [...(outgoing.get(dep.predecessorId) ?? []), dep])
  }

  const state = new Map<number, ScheduleEntry>()
  for (const task of tasks) {
    const durationDays = task.isMilestone
      ? 0
      : workingDayDuration(calendar, task.startMs, task.endMs)
    state.set(task.taskId, { es: 0, ef: 0, ls: 0, lf: 0, durationDays })
  }

  // 前向：ES/EF（与引擎 earliestStartOfSuccessor 同构）。
  for (const id of topoOrder) {
    const task = taskById.get(id)
    if (!task) continue
    const s = state.get(id)!
    const ownStart = snapToWorkingDay(calendar, task.startMs, 1)
    let es = ownStart
    for (const dep of incoming.get(id) ?? []) {
      const pred = taskById.get(dep.predecessorId)
      const predState = pred ? state.get(pred.taskId) : undefined
      if (!pred || !predState) continue
      let required = es
      switch (dep.type) {
        case 'fs':
          required = shiftWorkingDays(calendar, predState.ef, dep.lagDays + 1)
          break
        case 'ss':
          required = shiftWorkingDays(calendar, predState.es, dep.lagDays)
          break
        case 'ff':
          required = startFromEndSafe(
            calendar,
            shiftWorkingDays(calendar, predState.ef, dep.lagDays),
            s.durationDays,
          )
          break
        case 'sf':
          required = startFromEndSafe(
            calendar,
            shiftWorkingDays(calendar, predState.es, dep.lagDays),
            s.durationDays,
          )
          break
      }
      if (required > es) es = required
    }
    s.es = es
    s.ef =
      task.isMilestone || s.durationDays <= 0 ? es : endFromStartSafe(calendar, es, s.durationDays)
  }

  let deadline = 0
  for (const s of state.values()) {
    if (s.ef > deadline) deadline = s.ef
  }
  for (const s of state.values()) {
    s.lf = deadline
    s.ls = s.durationDays <= 0 ? deadline : startFromEndSafe(calendar, deadline, s.durationDays)
  }
  for (const id of [...topoOrder].reverse()) {
    const task = taskById.get(id)
    const s = state.get(id)
    if (!task || !s) continue
    for (const dep of outgoing.get(id) ?? []) {
      const succ = taskById.get(dep.successorId)
      const succState = succ ? state.get(succ.taskId) : undefined
      if (!succ || !succState) continue
      let latest = s.ls
      switch (dep.type) {
        case 'fs':
          latest = startFromEndSafe(
            calendar,
            shiftWorkingDays(calendar, succState.ls, -dep.lagDays - 1),
            s.durationDays,
          )
          break
        case 'ss':
          latest = shiftWorkingDays(calendar, succState.ls, -dep.lagDays)
          break
        case 'ff':
          latest = startFromEndSafe(
            calendar,
            shiftWorkingDays(calendar, succState.lf, -dep.lagDays),
            s.durationDays,
          )
          break
        case 'sf':
          latest = shiftWorkingDays(calendar, succState.lf, -dep.lagDays)
          break
      }
      if (latest < s.ls) {
        s.ls = latest
        s.lf = s.durationDays <= 0 ? latest : endFromStartSafe(calendar, latest, s.durationDays)
      }
    }
  }
  return topoOrder
    .map((id) => state.get(id)!)
    .filter((entry): entry is ScheduleEntry => entry !== undefined)
}

interface ScheduleEntry {
  es: number
  ef: number
  ls: number
  lf: number
  durationDays: number
}

function startFromEndSafe(calendar: WorkingCalendar, end: number, d: number): number {
  return d <= 0 ? end : startFromEnd(calendar, end, d)
}
function endFromStartSafe(calendar: WorkingCalendar, start: number, d: number): number {
  return d <= 0 ? start : endFromStart(calendar, start, d)
}

/**
 * 装配 AON 网络视图（纯函数，无 DOM/无网络）。
 *
 * 1. 规整：参与节点 = 依赖两端任务（排除汇总任务，与 CPM 归一化一致）；
 * 2. CPM 引擎核：isCritical 与边关键（权威）；六格数值由镜像双传派生；
 * 3. Kahn 分层排版 + 坐标映射；
 * 4. 锚点 = 全部节点 ES 的最早日期（有日期任务的最早排期日）。
 */
export function buildAonNetworkView(
  tasks: readonly Task[],
  dependencies: readonly TaskDependency[],
): AonNetworkBuildResult {
  const calendar = createWorkingCalendar()

  // 1) 参与节点与边规整
  const rawDeps = dependencies.filter((d) => d.predecessorId !== d.successorId)
  if (rawDeps.length === 0) return { ok: false, reason: 'no-dependencies' }

  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const summaryIds = new Set(tasks.filter((t) => t.taskType === 'summary').map((t) => t.id))
  const kept: TaskDependency[] = []
  for (const dep of rawDeps) {
    if (summaryIds.has(dep.predecessorId) || summaryIds.has(dep.successorId)) continue
    kept.push(dep)
  }
  if (kept.length === 0) return { ok: false, reason: 'no-tasks' }

  const participating = new Set<number>()
  for (const dep of kept) {
    participating.add(dep.predecessorId)
    participating.add(dep.successorId)
  }

  // 2) 任务排期输入（缺省日期回退：有任一计划日则取其最早日，否则固定 epoch）
  let datedFloor: number | null = null
  for (const id of participating) {
    const full = taskById.get(id)
    const startIso = full?.startDate ?? null
    const ms = parseIsoDateMs(startIso)
    if (ms !== null && (datedFloor === null || ms < datedFloor)) datedFloor = ms
  }
  const floorMs = datedFloor ?? CHART_EPOCH_MS

  const normTasks = new Map<number, NormalizedAonTask>()
  for (const id of participating) {
    const full = taskById.get(id)
    let name = ''
    let startIso: string | null = null
    let endIso: string | null = null
    let isMilestone = false
    if (full) {
      name = full.name
      startIso = full.startDate
      endIso = full.endDate
      isMilestone = full.taskType === 'milestone'
    } else {
      const summary =
        kept.find((d) => d.predecessorId === id)?.predecessor ??
        kept.find((d) => d.successorId === id)?.successor
      if (summary) {
        name = summary.name
        startIso = summary.startDate
        endIso = summary.endDate
      }
    }
    const startMs = parseIsoDateMs(startIso) ?? floorMs
    let endMs = startMs
    if (!isMilestone) {
      if (startIso !== null) {
        const parsedEnd = parseIsoDateMs(endIso)
        endMs = parsedEnd !== null && parsedEnd >= startMs ? parsedEnd : startMs
      } else {
        // 无计划日期：以 durationDays（或 1 工作日）推一个假想工期窗，
        // 保证 CPM 引擎与镜像双传以相同 start/end 输入计算（语义一致）。
        const durDays =
          full && full.durationDays !== null && full.durationDays > 0 ? full.durationDays : 1
        endMs = startMs + Math.max(durDays - 1, 0) * DAY_MS
      }
    }
    normTasks.set(id, { taskId: id, name, isMilestone, startMs, endMs })
  }

  // 汇总任务参与边已在上方剔除；此处兜底剔除任何仍指向汇总的边
  const normDeps: NormalizedAonDep[] = []
  const seenPairs = new Set<string>()
  for (const dep of kept) {
    if (!normTasks.has(dep.predecessorId) || !normTasks.has(dep.successorId)) continue
    const key = `${dep.predecessorId}->${dep.successorId}`
    if (seenPairs.has(key)) continue
    seenPairs.add(key)
    normDeps.push({
      depId: dep.id,
      predecessorId: dep.predecessorId,
      successorId: dep.successorId,
      type: dep.type,
      lagDays: dep.lagDays,
    })
  }
  if (normDeps.length === 0) return { ok: false, reason: 'no-tasks' }

  // 3) CPM 引擎核（权威关键标记）
  const cpmTasks: CpmTaskInput[] = [...normTasks.values()].map((t) => {
    const taskType: CpmTaskType = t.isMilestone ? 'milestone' : 'task'
    return {
      taskId: t.taskId,
      startMs: t.startMs,
      endMs: t.endMs,
      taskType,
    }
  })
  const cpmDeps: CpmDependencyInput[] = normDeps.map((d) => ({
    depId: d.depId,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: d.type,
    lagDays: d.lagDays,
  }))
  const engine = memoizedComputeCriticalPath(cpmTasks, cpmDeps, calendar)

  // 4) 拓扑 + 镜像双传派生六格数值
  const layout = layoutAonGraph(
    [...normTasks.keys()],
    normDeps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId })),
  )
  const scheduleEntries = schedulePass(
    calendar,
    [...normTasks.values()],
    normDeps,
    layout.topoOrder,
  )
  const scheduleById = new Map<number, ScheduleEntry>()
  layout.topoOrder.forEach((taskId, index) => {
    scheduleById.set(taskId, scheduleEntries[index]!)
  })

  let anchorMs = Infinity
  for (const entry of scheduleEntries) {
    if (entry.es < anchorMs) anchorMs = entry.es
  }
  if (!Number.isFinite(anchorMs)) return { ok: false, reason: 'no-tasks' }

  const anchorIso = datedFloor !== null ? isoOf(anchorMs) : null

  const nodes: AonNodeSchedule[] = [...normTasks.values()].map((t) => {
    const s = scheduleById.get(t.taskId)!
    const engineTask = engine.tasks.get(t.taskId)
    const totalFloat = engineTask?.totalFloat ?? 0
    const isCritical = engineTask?.isCritical ?? false
    return {
      taskId: t.taskId,
      name: t.name,
      isMilestone: t.isMilestone,
      durationDays: s.durationDays,
      es: dayIndexOf(calendar, anchorMs, s.es),
      ef: dayIndexOf(calendar, anchorMs, s.ef),
      ls: dayIndexOf(calendar, anchorMs, s.ls),
      lf: dayIndexOf(calendar, anchorMs, s.lf),
      totalFloat,
      isCritical,
      esIso: isoOf(s.es),
      efIso: isoOf(s.ef),
      lsIso: isoOf(s.ls),
      lfIso: isoOf(s.lf),
    }
  })

  const edges: AonEdgeSchedule[] = normDeps.map((d) => {
    const pred = normTasks.get(d.predecessorId)!
    const succ = normTasks.get(d.successorId)!
    return {
      depId: d.depId,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      predecessorName: pred.name,
      successorName: succ.name,
      type: d.type,
      lagDays: d.lagDays,
      isCritical: engine.deps.get(d.depId) ?? false,
    }
  })

  const positions = computeAonPositions(layout)

  return {
    ok: true,
    anchorIso,
    nodes,
    edges,
    positions,
    layout,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    hasPlannedDates: datedFloor !== null,
  }
}

/** 某毫秒日期相对锚点的「工作日天序」（锚点 = 0）。 */
function dayIndexOf(calendar: WorkingCalendar, anchorMs: number, ms: number): number {
  if (ms <= anchorMs) return 0
  return Math.max(0, workingDayDuration(calendar, anchorMs, ms) - 1)
}

// ---------------------------------------------------------------------------
// 数据拉取
// ---------------------------------------------------------------------------

async function fetchProjectTasksAll(projectId: number): Promise<Task[]> {
  const firstPage = await tasksApi.list(projectId, { page: 1, perPage: TASK_PAGE_SIZE })
  const pageCount = Math.min(firstPage.meta.totalPages, TASK_MAX_PAGES)
  if (pageCount <= 1) return firstPage.data
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      tasksApi.list(projectId, { page: index + 2, perPage: TASK_PAGE_SIZE }),
    ),
  )
  return [...firstPage.data, ...rest.flatMap((page) => page.data)]
}

// ---------------------------------------------------------------------------
// 镜头组件
// ---------------------------------------------------------------------------

const TASK_STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '受阻',
  on_hold: '挂起',
  cancelled: '已取消',
}

export interface AonNetworkChartLensProps {
  projectId: number
}

export function AonNetworkChartLens({ projectId }: AonNetworkChartLensProps) {
  const mobile = useMobileWorkspace()
  const [mobileGraph, setMobileGraph] = useState(false)
  const [mobileSearch, setMobileSearch] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const depsQuery = useQuery({
    queryKey: dependencyKeys.project(projectId),
    queryFn: () => dependenciesApi.listByProject(projectId),
    enabled: projectId > 0,
    staleTime: 60_000,
  })
  const tasksQuery = useQuery({
    queryKey: taskKeys.list(projectId, { page: 1, perPage: TASK_PAGE_SIZE }),
    queryFn: () => fetchProjectTasksAll(projectId),
    enabled: projectId > 0,
    staleTime: 60_000,
  })

  const view = useMemo<AonNetworkBuildResult | null>(() => {
    if (!depsQuery.data || !tasksQuery.data) return null
    return buildAonNetworkView(tasksQuery.data, depsQuery.data)
  }, [depsQuery.data, tasksQuery.data])

  const isPending = depsQuery.isPending || tasksQuery.isPending
  const isError = depsQuery.isError || tasksQuery.isError
  const emptyView = view && !view.ok ? view : null

  const flowNodes = useMemo<AonSixBoxFlowNode[]>(() => {
    if (!view || !view.ok) return []
    const adjacent = new Set<number>()
    if (selectedTaskId !== null) {
      for (const edge of view.edges) {
        if (edge.predecessorId === selectedTaskId) adjacent.add(edge.successorId)
        if (edge.successorId === selectedTaskId) adjacent.add(edge.predecessorId)
      }
    }
    return view.nodes.map((node) => {
      const pos = aonNodePoint(view.positions, node.taskId)
      const isSelected = node.taskId === selectedTaskId
      const dimmed = selectedTaskId !== null && !isSelected && !adjacent.has(node.taskId)
      return {
        id: String(node.taskId),
        type: 'aon' as const,
        position: { x: pos.x, y: pos.y },
        // 声明式初始尺寸：jsdom 无布局测量，xyflow 需 width/height 才渲染节点与边
        // （生产浏览器中 ResizeObserver 实测后自动接管）。
        width: AON_NODE_WIDTH,
        height: AON_NODE_HEIGHT,
        handles: AON_NODE_HANDLES,
        data: {
          taskId: node.taskId,
          name: node.name,
          isMilestone: node.isMilestone,
          durationDays: node.durationDays,
          es: node.es,
          ef: node.ef,
          ls: node.ls,
          lf: node.lf,
          totalFloat: node.totalFloat,
          isCritical: node.isCritical,
          dimmed,
        },
      }
    })
  }, [view, selectedTaskId])

  const flowEdges = useMemo<AonDependencyFlowEdge[]>(() => {
    if (!view || !view.ok) return []
    return view.edges.map((edge) => {
      const touched =
        selectedTaskId !== null &&
        (edge.predecessorId === selectedTaskId || edge.successorId === selectedTaskId)
      return {
        id: String(edge.depId),
        source: String(edge.predecessorId),
        target: String(edge.successorId),
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'aon' as const,
        data: {
          predecessorId: edge.predecessorId,
          successorId: edge.successorId,
          type: edge.type,
          lagDays: edge.lagDays,
          isCritical: edge.isCritical,
          focus: selectedTaskId === null ? 'idle' : touched ? 'active' : 'dim',
        },
      }
    })
  }, [view, selectedTaskId])

  const selectedNode = useMemo(() => {
    if (!view || !view.ok || selectedTaskId === null) return null
    return view.nodes.find((n) => n.taskId === selectedTaskId) ?? null
  }, [view, selectedTaskId])

  const selectedDetail = useMemo(() => {
    if (!view || !view.ok || selectedNode === null) return null
    const preds = view.edges
      .filter((e) => e.successorId === selectedNode.taskId)
      .map((e) => ({ ...e, name: e.predecessorName }))
    const succs = view.edges
      .filter((e) => e.predecessorId === selectedNode.taskId)
      .map((e) => ({ ...e, name: e.successorName }))
    const fullTask = tasksQuery.data?.find((t) => t.id === selectedNode.taskId) ?? null
    return { preds, succs, fullTask }
  }, [view, selectedNode, tasksQuery.data])

  const onNodeClick = useCallback((_event: React.MouseEvent, node: { id: string }) => {
    setSelectedTaskId((current) => {
      const id = Number(node.id)
      return current === id ? null : id
    })
  }, [])

  const onPaneClick = useCallback(() => setSelectedTaskId(null), [])

  const handleRetry = useCallback(() => {
    void depsQuery.refetch()
    void tasksQuery.refetch()
  }, [depsQuery, tasksQuery])

  // 加载态：暗黑骨架
  if (isPending) {
    return (
      <div
        data-aon-loading
        role="status"
        aria-busy="true"
        aria-label="正在加载 AON 网络图"
        className="flex h-full min-h-80 flex-1 animate-pulse flex-col gap-3"
      >
        <div className="h-8 w-1/3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
        <div className="grid flex-1 grid-cols-[auto_1fr_auto] items-center gap-4 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6">
          {[0, 1, 2].map((col) => (
            <div key={col} className="flex flex-col gap-4">
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-24 w-[200px] rounded-[4px] bg-[var(--nx-workspace-surface)]"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 错误态：重试
  if (isError) {
    return (
      <div
        data-aon-error
        role="alert"
        aria-label="AON 网络图加载失败"
        className="mx-auto flex h-full min-h-72 max-w-md flex-col items-center justify-center gap-3 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-sm font-medium text-[var(--nx-text-primary)]">AON 网络图数据加载失败</p>
        <p className="text-xs text-[var(--nx-text-muted)]">
          任务或依赖接口暂时不可用，请稍后重试。
        </p>
        <button
          type="button"
          data-aon-retry
          onClick={handleRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新加载
        </button>
      </div>
    )
  }

  // 空态：无任务依赖（或参与节点为空）
  if (emptyView) {
    const noDeps = emptyView.reason === 'no-dependencies'
    return (
      <div
        data-aon-empty
        className="flex h-full min-h-80 flex-1 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-8 text-center"
      >
        <NetworkIcon className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
        <div>
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">
            {noDeps ? '当前项目暂无任务依赖关系' : '未找到参与依赖网络的任务'}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--nx-text-muted)]">
            {noDeps
              ? 'AON 网络图以任务依赖为骨架，请先在甘特图中为任务建立前置/后继关系。'
              : '参与依赖的任务可能已被删除，或依赖指向了汇总阶段任务。'}
          </p>
        </div>
        {noDeps ? (
          <Link
            href={`/next/projects/${projectId}?lens=gantt`}
            data-aon-empty-goto-gantt
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            前往甘特图建立依赖
          </Link>
        ) : null}
      </div>
    )
  }

  // 就绪：React Flow 画布
  const network = view as AonNetworkView
  // 节点多时全景适配会缩到 0.1 倍左右、六格字看不清：改为从左上角以可读缩放起步，
  // 需要全景时点左下角「适应视图」。节点少时仍一屏适配全景。
  const readableStart = mobile || network.nodeCount > AON_FIT_VIEW_MAX_NODES
  if (mobile && !mobileGraph)
    return (
      <div data-aon-lens data-mobile-aon className="relative min-h-[420px] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium">任务依赖网络</h3>
          <button
            type="button"
            onClick={() => setMobileGraph(true)}
            className="min-h-11 rounded-lg border border-[var(--nx-border-hairline)] px-3 text-sm"
          >
            查看网络图
          </button>
        </div>
        <label className="block text-sm">
          查找网络任务
          <input
            type="search"
            value={mobileSearch}
            onChange={(e) => setMobileSearch(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3"
          />
        </label>
        <p className="text-sm text-[var(--nx-text-muted)]">
          {network.nodeCount} 个任务 · {network.edgeCount} 条依赖。点击任务查看时差和前后置关系。
        </p>
        {network.nodes
          .filter((node) => node.name.toLowerCase().includes(mobileSearch.trim().toLowerCase()))
          .map((node) => (
            <button
              key={node.taskId}
              type="button"
              onClick={() => setSelectedTaskId(node.taskId)}
              className="block min-h-20 w-full rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-left"
            >
              <span className="block break-words text-base font-medium">{node.name}</span>
              <span className="mt-2 block text-sm text-[var(--nx-text-secondary)]">
                {node.durationDays} 天 ·{' '}
                {node.isCritical ? '关键路径' : `总时差 ${node.totalFloat} 天`}
              </span>
              <span className="mt-1 block text-sm text-[var(--nx-text-muted)]">
                前置 {network.edges.filter((e) => e.successorId === node.taskId).length} · 后置{' '}
                {network.edges.filter((e) => e.predecessorId === node.taskId).length}
              </span>
            </button>
          ))}
        {selectedNode && selectedDetail ? (
          <AonNodeDetailDrawer
            projectId={projectId}
            node={selectedNode}
            detail={selectedDetail}
            anchorIso={network.anchorIso}
            onClose={() => setSelectedTaskId(null)}
          />
        ) : null}
      </div>
    )
  return (
    <div
      data-aon-lens
      // 画布默认撑满视口剩余高度（扣除顶栏、镜头工具栏与图例），不再只占半屏
      className="flex h-full min-h-[max(420px,calc(100dvh-13rem))] min-w-0 flex-1 flex-col gap-2"
    >
      {mobile ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMobileGraph(false)}
            className="min-h-11 rounded-lg border border-[var(--nx-border-hairline)] px-3 text-sm"
          >
            返回任务网络
          </button>
          <p className="text-sm text-[var(--nx-text-muted)]">
            单指平移，双指缩放；点节点查看详情。
          </p>
        </div>
      ) : null}
      {network.layout.hasCycle ? (
        <div
          data-aon-cycle-warning
          role="status"
          className="flex items-center gap-2 rounded-md border bg-[var(--nx-bg-1)] px-3 py-1.5 text-xs text-[var(--nx-text-secondary)]"
          style={{ borderColor: 'var(--nx-status-warning)' }}
        >
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          检测到 {network.layout.cycleEdges.length}{' '}
          条依赖环路连线，已忽略以完成拓扑呈现（不影响数据）。
        </div>
      ) : null}

      <div
        data-aon-canvas
        className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
      >
        {/* 绝对定位铺满画布：ReactFlow 的 100% 高度在 flex 伸展出来的父级上解析不出（曾 0 高、整张图空白），
            且其内部样式会覆盖传入的 position，所以包一层而不是直接改 ReactFlow 的 style。 */}
        <div className="absolute inset-0">
          <ReactFlow<AonSixBoxFlowNode, AonDependencyFlowEdge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={{ aon: AonSixBoxNode }}
            edgeTypes={{ aon: AonDependencyEdge }}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            elementsSelectable
            fitView={!readableStart}
            defaultViewport={readableStart ? AON_READABLE_VIEWPORT : undefined}
            fitViewOptions={{ padding: 0.18, minZoom: 0.12, maxZoom: 1.2 }}
            minZoom={0.08}
            maxZoom={2}
            proOptions={{ hideAttribution: false }}
            style={{ width: '100%', height: '100%' }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="var(--nx-text-muted)"
            />
            <Controls showInteractive={false} />
            {!mobile ? (
              <MiniMap
                pannable
                zoomable
                nodeColor={() => 'var(--nx-accent)'}
                maskColor="var(--nx-space-bg)"
                style={{ backgroundColor: 'var(--nx-workspace-surface)' }}
              />
            ) : null}
          </ReactFlow>
        </div>

        {selectedNode && selectedDetail ? (
          <AonNodeDetailDrawer
            projectId={projectId}
            node={selectedNode}
            detail={selectedDetail}
            anchorIso={network.anchorIso}
            onClose={() => setSelectedTaskId(null)}
          />
        ) : null}
      </div>

      <div
        data-aon-legend
        className="flex min-h-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--nx-border-hairline)] pt-2 text-[10px] text-[var(--nx-text-muted)]"
      >
        <span className="inline-flex items-center gap-1.5 font-mono">
          <Route className="h-3 w-3 text-[var(--nx-text-muted)]" aria-hidden />
          {network.anchorIso !== null ? (
            <>第 0 天 = {network.anchorIso}（工作日）</>
          ) : (
            <>无计划日期：按最早可用工作日相对排布</>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-[var(--nx-status-danger)]" aria-hidden />
          关键路径（总时差 0）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-5 bg-[var(--nx-text-muted)] opacity-45"
            aria-hidden
          />
          普通依赖（FS/SS/FF/SF）
        </span>
        <span className="ml-auto">
          {network.nodeCount} 节点 · {network.edgeCount} 连线 · 只读视图
        </span>
      </div>
    </div>
  )
}

interface AonNodeDetailDrawerProps {
  projectId: number
  node: AonNodeSchedule
  detail: {
    preds: (AonEdgeSchedule & { name: string })[]
    succs: (AonEdgeSchedule & { name: string })[]
    fullTask: Task | null
  }
  anchorIso: string | null
  onClose: () => void
}

function AonNodeDetailDrawer({ node, detail, anchorIso, onClose }: AonNodeDetailDrawerProps) {
  const slot = (label: string, index: number, iso: string) => (
    <div className="flex items-center justify-between gap-2" data-aon-drawer-slot={label}>
      <span className="text-[var(--nx-text-muted)]">{label}</span>
      <span className="font-mono text-[var(--nx-text-primary)]">
        {index}
        <span className="ml-1.5 text-[10px] text-[var(--nx-text-muted)]">{iso}</span>
      </span>
    </div>
  )

  return (
    <aside
      data-aon-drawer
      aria-label="任务时差与依赖详情"
      className="absolute right-0 top-0 z-20 flex h-full w-72 max-w-full flex-col gap-3 overflow-y-auto border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            data-aon-drawer-title
            className="truncate text-sm font-semibold text-[var(--nx-text-primary)]"
          >
            {node.isMilestone ? '◆ ' : ''}
            {node.name}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
            #{node.taskId} ·{' '}
            {detail.fullTask
              ? (TASK_STATUS_LABELS[detail.fullTask.status] ?? detail.fullTask.status)
              : '任务'}
          </p>
        </div>
        <button
          type="button"
          data-aon-drawer-close
          aria-label="关闭详情"
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {node.isCritical ? (
          <span
            data-aon-drawer-critical
            className="rounded border border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-danger)]"
          >
            关键路径
          </span>
        ) : (
          <span className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
            总时差 {node.totalFloat} 工作日
          </span>
        )}
        {node.isMilestone ? (
          <span className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
            里程碑 · 0 工期
          </span>
        ) : (
          <span className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
            工期 {node.durationDays} 工作日
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5">
        {slot('最早开始 ES', node.es, node.esIso)}
        {slot('最早完成 EF', node.ef, node.efIso)}
        {slot('最晚开始 LS', node.ls, node.lsIso)}
        {slot('最晚完成 LF', node.lf, node.lfIso)}
        <div className="my-0.5 border-t border-[var(--nx-border-hairline)]" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--nx-text-muted)]">总时差 TF</span>
          <span
            data-aon-drawer-float
            className={cn(
              'font-mono',
              node.totalFloat === 0
                ? 'text-[var(--nx-status-danger)]'
                : 'text-[var(--nx-status-warning)]',
            )}
          >
            {node.totalFloat} 工作日
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--nx-text-muted)]">锚点</span>
          <span className="font-mono text-[10px] text-[var(--nx-text-secondary)]">
            {anchorIso ?? '最早可用（无计划日期）'}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
          紧前任务（{detail.preds.length}）
        </p>
        {detail.preds.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--nx-border-hairline)] px-2 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
            无前驱 —— 起始节点
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.preds.map((edge) => (
              <li
                key={edge.depId}
                data-aon-drawer-pred
                className="flex items-center justify-between gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px]"
              >
                <span className="truncate text-[var(--nx-text-secondary)]">{edge.name}</span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--nx-text-muted)]">
                  {edge.type.toUpperCase()}
                  {edge.lagDays ? `${edge.lagDays > 0 ? '+' : ''}${edge.lagDays}d` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
          紧后任务（{detail.succs.length}）
        </p>
        {detail.succs.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--nx-border-hairline)] px-2 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
            无后继 —— 收尾节点
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.succs.map((edge) => (
              <li
                key={edge.depId}
                data-aon-drawer-succ
                className="flex items-center justify-between gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px]"
              >
                <span className="truncate text-[var(--nx-text-secondary)]">{edge.name}</span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--nx-text-muted)]">
                  {edge.type.toUpperCase()}
                  {edge.lagDays ? `${edge.lagDays > 0 ? '+' : ''}${edge.lagDays}d` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

export default AonNetworkChartLens
