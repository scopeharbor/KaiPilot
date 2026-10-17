import { apiFetch } from '@/lib/api-client'

export interface WbsTaskSummary {
  id: number
  name: string
  status: string
  startDate: string | null
  endDate: string | null
}

export interface WbsNode {
  id: number
  projectId: number
  parentId: number | null
  path: string
  code: string
  name: string
  depth: number
  isLeaf: boolean
  collapsed: boolean
  displayOrder: number
  taskId: number | null
  task?: WbsTaskSummary
  /** 子树汇总：节点下全部任务（含子节点）的状态 / 起止 / 加权进度 / 计数。 */
  rollup?: WbsRollup
  createdAt: string
  updatedAt: string | null
}

export interface WbsRollup {
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'cancelled'
  taskCount: number
  completedCount: number
  inProgressCount: number
  blockedCount: number
  progressPercent: number
  startDate: string | null
  endDate: string | null
}

export interface CreateWbsNodeInput {
  name: string
  parentId?: number | null
  taskId?: number | null
}

export interface UpdateWbsNodeInput {
  name?: string
  collapsed?: boolean
}

export interface MoveWbsNodeInput {
  parentId?: number | null
  displayOrder?: number
}

const base = (projectId: number) => `/projects/${projectId}`

/** 数字 id 归一：PostgreSQL 的 bigint 主键以字符串返回（"7"），外键列却是数字（7）。 */
function toId(value: unknown): number {
  return typeof value === 'string' ? Number(value) : (value as number)
}

function toNullableId(value: unknown): number | null {
  return value === null || value === undefined ? null : toId(value)
}

/**
 * WBS 节点 id 类字段统一成数字。PG 下 `id` 是字符串、`parentId` 是数字，
 * 按全等组树时子节点一个也挂不上（实测导入 125 个节点只显示根节点）；SQLite 两边都是数字所以测试没暴露。
 */
export function normalizeWbsNode(node: WbsNode): WbsNode {
  return {
    ...node,
    id: toId(node.id),
    projectId: toId(node.projectId),
    parentId: toNullableId(node.parentId),
    taskId: toNullableId(node.taskId),
    ...(node.task ? { task: { ...node.task, id: toId(node.task.id) } } : {}),
  }
}

export const wbsApi = {
  tree: async (projectId: number, includeTask = true) => {
    const nodes = await apiFetch<WbsNode[]>(
      `${base(projectId)}/wbs-tree${includeTask ? '?include=task' : ''}`,
    )
    return Array.isArray(nodes) ? nodes.map(normalizeWbsNode) : nodes
  },
  create: async (projectId: number, input: CreateWbsNodeInput) =>
    normalizeWbsNode(
      await apiFetch<WbsNode>(`${base(projectId)}/wbs/nodes`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  update: async (projectId: number, nodeId: number, input: UpdateWbsNodeInput) =>
    normalizeWbsNode(
      await apiFetch<WbsNode>(`${base(projectId)}/wbs/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    ),
  move: async (projectId: number, nodeId: number, input: MoveWbsNodeInput) =>
    normalizeWbsNode(
      await apiFetch<WbsNode>(`${base(projectId)}/wbs/nodes/${nodeId}/move`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  delete: (projectId: number, nodeId: number) =>
    apiFetch<void>(`${base(projectId)}/wbs/nodes/${nodeId}`, { method: 'DELETE' }),
}

export const wbsKeys = {
  all: ['wbs'] as const,
  trees: () => [...wbsKeys.all, 'tree'] as const,
  tree: (projectId: number) => [...wbsKeys.trees(), projectId] as const,
}
