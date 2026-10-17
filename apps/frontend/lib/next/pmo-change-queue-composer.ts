/**
 * PMO 全局跨项目变更审批队列多查询前端合成器
 * (v3-ui-next-batch4-reports-change-queue W3 · tasks 3.1 / spec「跨项目变更请求多查询前端合成与缓存失效契约」).
 *
 * 核心设计：
 * 1. 纯前端多查询并发合成（Multi-Query Synthesis）：在后端缺少跨项目全局变更端点的前提下，
 *    先调用 projectsApi.list 获取活跃项目，再受控并发调用各项目 changeRequestsApi.list 端点；
 * 2. 并发通道限制：严格限制最大并发通道数为 5，避免突发高并发造成浏览器连接池枯竭；
 * 3. 容错与安全降级：单项目变更端点报错（如 500）时不阻断整体，捕获异常并记录 failedProjectIds，
 *    返回其余正常项目的合流数据，同时标记 hasDegraded=true 与弱提示文案；
 * 4. 多维排序与元数据回填：将所有项目变更合流，统一回填 projectName 与 projectCode，
 *    支持按提交时间（submittedAt）、优先级（priority）及所属项目等维度排序；
 * 5. 纯只读零写（RL-01）：合成器全生命周期仅发起只读 GET 请求，不产生任何副作用。
 */

import type { Project } from '@/lib/api/projects'
import { projectsApi } from '@/lib/api/projects'
import type { ChangeRequest, ChangeRequestPriority } from '@/lib/api/change-requests'
import { listChangeRequests } from '@/lib/api/change-requests'

/** 变更请求 API 对象封装（供合成器与消费端统一引用）。 */
export const changeRequestsApi = {
  list: listChangeRequests,
}

/** 跨项目变更请求合成项视图模型（在单项目 ChangeRequest 基础上注入所属项目元数据）。 */
export interface CrossProjectChangeRequestItem extends ChangeRequest {
  projectName: string
  projectCode: string | null
  requesterName?: string
}

/** 排序字段支持。 */
export type ChangeQueueSortField =
  'submittedAt' | 'priority' | 'projectName' | 'crCode' | 'title' | 'status'

export type SortDirection = 'asc' | 'desc'

export interface ChangeQueueSortState {
  field: ChangeQueueSortField
  direction: SortDirection
}

/** 全局变更队列合成结果。 */
export interface PmoChangeQueueComposerResult {
  items: CrossProjectChangeRequestItem[]
  totalCount: number
  failedProjectIds: number[]
  hasDegraded: boolean
  warningMessage: string | null
}

/** 全局变更队列 TanStack Query 缓存键。 */
export const PMO_CHANGE_QUEUE_QUERY_KEY = ['pmo', 'change-queue'] as const

export const pmoChangeQueueKeys = {
  all: ['pmo', 'change-queue'] as const,
  list: (organizationId: number | null | undefined, filters?: Record<string, unknown>) =>
    [...pmoChangeQueueKeys.all, organizationId, filters] as const,
}

/** 默认最大并发通道数（spec 约束 ≤ 5）。 */
export const MAX_CONCURRENT_CHANNELS = 5

/** 优先级排序权重。 */
export const PRIORITY_WEIGHTS: Record<ChangeRequestPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

/** 状态分面定义（供工具栏与过滤复用）。 */
export type ChangeQueueStatusFacet =
  'all' | 'pending' | 'approved' | 'returned' | 'rejected' | 'implemented'

/**
 * 受控并发执行器：保证在任意时间点，并发运行的 Promise 数量不超过 limit。
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const concurrency = Math.max(1, Math.min(limit, items.length))
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  const workers = Array.from({ length: concurrency }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++
      results[index] = await fn(items[index]!, index)
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * 比较两项提交时间戳（支持 ISO 字符串与 null）。
 */
function compareTimestamps(
  aStr: string | null | undefined,
  bStr: string | null | undefined,
): number {
  const aTime = aStr ? new Date(aStr).getTime() : 0
  const bTime = bStr ? new Date(bStr).getTime() : 0
  if (Number.isNaN(aTime)) return bStr ? -1 : 0
  if (Number.isNaN(bTime)) return aStr ? 1 : 0
  return aTime - bTime
}

/**
 * 跨项目变更数据集排序纯函数。
 */
export function sortChangeQueueItems(
  items: CrossProjectChangeRequestItem[],
  sort: ChangeQueueSortState = { field: 'submittedAt', direction: 'desc' },
): CrossProjectChangeRequestItem[] {
  const cloned = [...items]
  const modifier = sort.direction === 'asc' ? 1 : -1

  return cloned.sort((a, b) => {
    switch (sort.field) {
      case 'submittedAt': {
        const timeDiff = compareTimestamps(
          a.submittedAt ?? a.createdAt,
          b.submittedAt ?? b.createdAt,
        )
        if (timeDiff !== 0) return timeDiff * modifier
        return (a.id - b.id) * modifier
      }
      case 'priority': {
        const pDiff = (PRIORITY_WEIGHTS[a.priority] ?? 0) - (PRIORITY_WEIGHTS[b.priority] ?? 0)
        if (pDiff !== 0) return pDiff * modifier
        return (a.id - b.id) * modifier
      }
      case 'projectName': {
        const nameDiff = a.projectName.localeCompare(b.projectName, 'zh-CN')
        if (nameDiff !== 0) return nameDiff * modifier
        return (a.id - b.id) * modifier
      }
      case 'crCode': {
        const codeDiff = a.crCode.localeCompare(b.crCode)
        if (codeDiff !== 0) return codeDiff * modifier
        return (a.id - b.id) * modifier
      }
      case 'title': {
        const titleDiff = a.title.localeCompare(b.title, 'zh-CN')
        if (titleDiff !== 0) return titleDiff * modifier
        return (a.id - b.id) * modifier
      }
      case 'status': {
        const statusDiff = a.status.localeCompare(b.status)
        if (statusDiff !== 0) return statusDiff * modifier
        return (a.id - b.id) * modifier
      }
      default:
        return 0
    }
  })
}

export interface ComposeChangeQueueOptions {
  projects: Array<{ id: number; name: string; code?: string | null }>
  changeRequestsByProject: Record<number, ChangeRequest[]>
  sort?: ChangeQueueSortState
}

/**
 * 纯函数：将各项目的变更数组进行展平合流，注入项目名称与代号元数据，并执行指定排序。
 */
export function composeCrossProjectChangeRequests(
  options: ComposeChangeQueueOptions,
): CrossProjectChangeRequestItem[] {
  const { projects, changeRequestsByProject, sort } = options
  const projectMap = new Map<number, { name: string; code: string | null }>()

  for (const project of projects) {
    projectMap.set(project.id, {
      name: project.name,
      code: project.code ?? null,
    })
  }

  const merged: CrossProjectChangeRequestItem[] = []

  for (const [projectIdStr, crList] of Object.entries(changeRequestsByProject)) {
    const pId = Number(projectIdStr)
    const meta = projectMap.get(pId) ?? { name: `项目 #${pId}`, code: null }

    for (const cr of crList) {
      merged.push({
        ...cr,
        projectName: meta.name,
        projectCode: meta.code,
      })
    }
  }

  return sortChangeQueueItems(merged, sort ?? { field: 'submittedAt', direction: 'desc' })
}

export interface FetchCrossProjectChangeQueueOptions {
  maxProjects?: number
  perPagePerProject?: number
  concurrencyLimit?: number
  sort?: ChangeQueueSortState
}

/**
 * 纯前端并发抓取当前组织活跃项目变更并执行合成。
 *
 * - 最大并发通道控制在 ≤ 5；
 * - 单项目接口异常时不崩溃，执行容错降级并输出弱提示；
 * - 纯客户端零写请求（RL-01）。
 */
export async function fetchCrossProjectChangeQueue(
  options: FetchCrossProjectChangeQueueOptions = {},
): Promise<PmoChangeQueueComposerResult> {
  const maxProjects = options.maxProjects ?? 50
  const perPagePerProject = options.perPagePerProject ?? 100
  const concurrencyLimit = options.concurrencyLimit ?? MAX_CONCURRENT_CHANNELS

  // 1. 获取当前组织活跃项目列表
  const projectsRes = await projectsApi.list({ perPage: maxProjects })
  const projects: Project[] = projectsRes.data ?? []

  const changeRequestsByProject: Record<number, ChangeRequest[]> = {}
  const failedProjectIds: number[] = []

  // 2. 受控并发抓取各项目的变更请求列表
  await mapConcurrent(projects, concurrencyLimit, async (project) => {
    try {
      const crRes = await changeRequestsApi.list(project.id, { perPage: perPagePerProject })
      changeRequestsByProject[project.id] = crRes.data ?? []
    } catch {
      failedProjectIds.push(project.id)
      changeRequestsByProject[project.id] = []
    }
  })

  // 3. 合流与排序
  const items = composeCrossProjectChangeRequests({
    projects,
    changeRequestsByProject,
    sort: options.sort,
  })

  const hasDegraded = failedProjectIds.length > 0
  const warningMessage = hasDegraded ? '部分项目变更同步受阻' : null

  return {
    items,
    totalCount: items.length,
    failedProjectIds,
    hasDegraded,
    warningMessage,
  }
}
