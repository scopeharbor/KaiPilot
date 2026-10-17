import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import AuditService, { AuditEvent } from '#services/audit_service'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const MAX_WBS_DEPTH = 19

interface AuditContext {
  requestId?: string | null
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

/** WBS 节点子树汇总（状态 / 起止 / 加权进度 / 各状态计数）。 */
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

@inject()
export default class WbsTreeService {
  constructor(private audit: AuditService) {}

  async getTree(
    organizationId: number,
    projectId: number,
    includeTask = false,
  ): Promise<WbsNode[]> {
    await db.transaction(async (trx) => {
      const project = await this.projectOrFail(organizationId, projectId, trx)
      await this.ensureRoot(project, trx)
    })

    let query = WbsNode.query()
      .where('project_id', projectId)
      .orderBy('depth', 'asc')
      .orderBy('path', 'asc')
      .orderBy('display_order', 'asc')
    if (includeTask) {
      query = query.preload('task')
    }
    return query
  }

  /**
   * 节点汇总：统计节点整棵子树下挂的全部任务（一个工作包常挂多个任务）。
   * 此前工作包只显示它 task_id 指向的第一个任务，出现「下面还有阻塞任务却显示已完成」。
   */
  async rollups(projectId: number, nodes: WbsNode[]): Promise<Map<number, WbsRollup>> {
    const tasks = (await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNotNull('wbs_node_id')
      .select(
        'wbs_node_id',
        'status',
        'start_date',
        'end_date',
        'progress_percent',
        'duration_days',
      )) as Array<{
      wbs_node_id: number | string
      status: string
      start_date: string | Date | null
      end_date: string | Date | null
      progress_percent: number | string | null
      duration_days: number | string | null
    }>
    const byNode = new Map<number, typeof tasks>()
    for (const task of tasks) {
      const key = Number(task.wbs_node_id)
      const list = byNode.get(key) ?? []
      list.push(task)
      byNode.set(key, list)
    }
    const children = new Map<number, number[]>()
    for (const node of nodes) {
      if (node.parentId === null) continue
      const list = children.get(Number(node.parentId)) ?? []
      list.push(Number(node.id))
      children.set(Number(node.parentId), list)
    }
    const toIso = (value: string | Date | null) => {
      if (!value) return null
      const date =
        value instanceof Date
          ? DateTime.fromJSDate(value)
          : DateTime.fromISO(String(value).replace(' ', 'T'))
      return date.isValid ? date.toISODate() : null
    }
    const result = new Map<number, WbsRollup>()
    const collect = (nodeId: number): typeof tasks => {
      const own = byNode.get(nodeId) ?? []
      return own.concat(...(children.get(nodeId) ?? []).map(collect))
    }
    for (const node of nodes) {
      const list = collect(Number(node.id))
      if (!list.length) continue
      const active = list.filter((t) => t.status !== 'cancelled')
      const count = (status: string) => active.filter((t) => t.status === status).length
      const completed = count('completed')
      const blocked = count('blocked') + count('on_hold')
      const inProgress = count('in_progress')
      let weightSum = 0
      let weighted = 0
      for (const t of active) {
        const weight = Math.max(1, Number(t.duration_days) || 1)
        weightSum += weight
        weighted +=
          weight *
          (t.status === 'completed'
            ? 100
            : Math.min(100, Math.max(0, Number(t.progress_percent) || 0)))
      }
      const starts = list
        .map((t) => toIso(t.start_date))
        .filter((d): d is string => !!d)
        .sort()
      const ends = list
        .map((t) => toIso(t.end_date))
        .filter((d): d is string => !!d)
        .sort()
      const status: WbsRollup['status'] =
        active.length === 0
          ? 'cancelled'
          : completed === active.length
            ? 'completed'
            : blocked > 0
              ? 'blocked'
              : inProgress > 0 || completed > 0
                ? 'in_progress'
                : 'not_started'
      result.set(Number(node.id), {
        status,
        taskCount: active.length,
        completedCount: completed,
        inProgressCount: inProgress,
        blockedCount: blocked,
        progressPercent: weightSum ? Math.round(weighted / weightSum) : 0,
        startDate: starts[0] ?? null,
        endDate: ends.at(-1) ?? null,
      })
    }
    return result
  }

  async createNode(
    organizationId: number,
    projectId: number,
    input: CreateWbsNodeInput,
    actorUserId: number,
    ctx: AuditContext = {},
  ): Promise<WbsNode> {
    return db.transaction(async (trx) => {
      const project = await this.projectOrFail(organizationId, projectId, trx)
      const root = await this.ensureRoot(project, trx)
      const parentId = input.parentId === undefined ? root.id : input.parentId
      const parent = parentId === null ? null : await this.nodeOrFail(projectId, parentId, trx)

      if (parent && parent.depth + 1 > MAX_WBS_DEPTH) {
        throw new ValidationException('WBS 最多支持 20 层')
      }
      await this.assertTaskAvailable(projectId, input.taskId ?? null, trx)

      const siblings = await WbsNode.query({ client: trx })
        .where('project_id', projectId)
        .where((query) =>
          parentId === null ? query.whereNull('parent_id') : query.where('parent_id', parentId),
        )

      const node = await WbsNode.create(
        {
          projectId,
          parentId,
          name: input.name,
          taskId: input.taskId ?? null,
          path: null,
          code: null,
          depth: parent ? parent.depth + 1 : 0,
          isLeaf: true,
          collapsed: false,
          displayOrder: siblings.length,
        },
        { client: trx },
      )

      await this.recalculateTree(projectId, trx)
      await node.refresh()
      await this.audit.log({
        event: AuditEvent.WBS_NODE_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'wbs_node',
        entityId: node.id,
        requestId: ctx.requestId ?? null,
        metadata: { path: node.path, code: node.code, parentId: node.parentId },
        client: trx,
        strict: true,
      })
      return node
    })
  }

  async updateNode(
    organizationId: number,
    projectId: number,
    nodeId: number,
    input: UpdateWbsNodeInput,
    actorUserId: number,
    ctx: AuditContext = {},
  ): Promise<WbsNode> {
    return db.transaction(async (trx) => {
      await this.projectOrFail(organizationId, projectId, trx)
      const node = await this.nodeOrFail(projectId, nodeId, trx)
      if (input.name !== undefined) node.name = input.name
      if (input.collapsed !== undefined) {
        // TODO-DEBT: sec13-T017-per-user-collapse — V1 折叠状态为节点级共享。
        node.collapsed = input.collapsed
      }
      node.useTransaction(trx)
      await node.save()
      await this.audit.log({
        event: AuditEvent.WBS_NODE_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'wbs_node',
        entityId: node.id,
        requestId: ctx.requestId ?? null,
        metadata: { changed: Object.keys(input) },
        client: trx,
        strict: true,
      })
      return node
    })
  }

  async moveNode(
    organizationId: number,
    projectId: number,
    nodeId: number,
    input: MoveWbsNodeInput,
    actorUserId: number,
    ctx: AuditContext = {},
  ): Promise<WbsNode> {
    return db.transaction(async (trx) => {
      const project = await this.projectOrFail(organizationId, projectId, trx)
      const node = await this.nodeOrFail(projectId, nodeId, trx)
      if (Number(project.wbsRootId) === node.id) {
        throw new ValidationException('项目根节点不能移动')
      }

      const parentId = input.parentId === undefined ? node.parentId : input.parentId
      const newParent =
        parentId === null ? null : await this.nodeOrFail(projectId, Number(parentId), trx)
      if (newParent && (newParent.id === node.id || newParent.path?.startsWith(node.path ?? ''))) {
        throw new ValidationException('不能将节点移动到自身或其后代下')
      }

      const descendants = await WbsNode.query({ client: trx })
        .where('project_id', projectId)
        .where('path', 'like', `${node.path}%`)
      const relativeDepth = descendants.reduce(
        (max, descendant) => Math.max(max, descendant.depth - node.depth),
        0,
      )
      const nextDepth = newParent ? newParent.depth + 1 : 0
      if (nextDepth + relativeDepth > MAX_WBS_DEPTH) {
        throw new ValidationException('移动后 WBS 将超过 20 层')
      }

      const before = { path: node.path, code: node.code, parentId: node.parentId }
      const oldParentId = node.parentId === null ? null : Number(node.parentId)
      const siblings = await WbsNode.query({ client: trx })
        .where('project_id', projectId)
        .where((query) =>
          parentId === null
            ? query.whereNull('parent_id')
            : query.where('parent_id', Number(parentId)),
        )
        .whereNot('id', node.id)
        .orderBy('display_order', 'asc')
        .orderBy('id', 'asc')
      const target = Math.min(Math.max(input.displayOrder ?? siblings.length, 0), siblings.length)
      siblings.splice(target, 0, node)
      for (const [index, sibling] of siblings.entries()) {
        sibling.parentId = parentId
        sibling.displayOrder = index
        sibling.useTransaction(trx)
        await sibling.save()
      }

      if (oldParentId !== (parentId === null ? null : Number(parentId))) {
        await this.normalizeSiblingOrder(projectId, oldParentId, trx)
      }
      await this.recalculateTree(projectId, trx)
      await node.refresh()

      await this.audit.log({
        event: AuditEvent.WBS_NODE_MOVED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'wbs_node',
        entityId: node.id,
        requestId: ctx.requestId ?? null,
        metadata: {
          before,
          after: { path: node.path, code: node.code, parentId: node.parentId },
        },
        client: trx,
        strict: true,
      })
      return node
    })
  }

  async deleteNode(
    organizationId: number,
    projectId: number,
    nodeId: number,
    actorUserId: number,
    ctx: AuditContext = {},
  ): Promise<void> {
    await db.transaction(async (trx) => {
      const project = await this.projectOrFail(organizationId, projectId, trx)
      const node = await this.nodeOrFail(projectId, nodeId, trx)
      if (Number(project.wbsRootId) === node.id) {
        throw new ValidationException('项目根节点不能删除')
      }

      const children = await WbsNode.query({ client: trx })
        .where('project_id', projectId)
        .where('parent_id', node.id)
        .orderBy('display_order', 'asc')
      const rootSiblings = await WbsNode.query({ client: trx })
        .where('project_id', projectId)
        .whereNull('parent_id')
      let nextRootOrder = rootSiblings.length
      for (const child of children) {
        child.parentId = null
        child.displayOrder = nextRootOrder++
        child.useTransaction(trx)
        await child.save()
      }

      const oldParentId = node.parentId === null ? null : Number(node.parentId)
      node.deletedAt = DateTime.now()
      node.useTransaction(trx)
      await node.save()
      await this.normalizeSiblingOrder(projectId, oldParentId, trx)
      await this.recalculateTree(projectId, trx)
      await this.audit.log({
        event: AuditEvent.WBS_NODE_DELETED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'wbs_node',
        entityId: node.id,
        requestId: ctx.requestId ?? null,
        metadata: { path: node.path, code: node.code, promotedChildren: children.map((c) => c.id) },
        client: trx,
        strict: true,
      })
    })
  }

  private async ensureRoot(project: Project, trx: TransactionClientContract): Promise<WbsNode> {
    if (project.wbsRootId !== null) {
      const existing = await WbsNode.query({ client: trx })
        .where('id', Number(project.wbsRootId))
        .where('project_id', project.id)
        .first()
      if (existing) return existing
    }

    const root = await WbsNode.create(
      {
        projectId: project.id,
        parentId: null,
        path: null,
        code: null,
        name: project.name,
        depth: 0,
        isLeaf: true,
        collapsed: false,
        displayOrder: 0,
        taskId: null,
      },
      { client: trx },
    )
    root.path = `/${root.id}/`
    root.code = '1'
    await root.save()
    project.wbsRootId = root.id
    project.useTransaction(trx)
    await project.save()
    await this.recalculateTree(project.id, trx)
    await root.refresh()
    return root
  }

  private async recalculateTree(projectId: number, trx: TransactionClientContract): Promise<void> {
    const nodes = await WbsNode.query({ client: trx })
      .where('project_id', projectId)
      .orderBy('display_order', 'asc')
      .orderBy('id', 'asc')
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const children = new Map<number | null, WbsNode[]>()

    for (const node of nodes) {
      const requestedParent = node.parentId === null ? null : Number(node.parentId)
      const parentId =
        requestedParent !== null && byId.has(requestedParent) ? requestedParent : null
      if (parentId !== requestedParent) node.parentId = parentId
      const group = children.get(parentId) ?? []
      group.push(node)
      children.set(parentId, group)
    }

    for (const group of children.values()) {
      group.sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id)
    }

    const visit = async (
      parentId: number | null,
      parentPath: string,
      parentCode: string | null,
      depth: number,
    ) => {
      const group = children.get(parentId) ?? []
      for (const [index, node] of group.entries()) {
        node.displayOrder = index
        node.depth = depth
        node.path = `${parentPath}${node.id}/`
        node.code = parentCode ? `${parentCode}.${index + 1}` : String(index + 1)
        node.isLeaf = (children.get(node.id) ?? []).length === 0
        node.useTransaction(trx)
        await node.save()
        await visit(node.id, node.path, node.code, depth + 1)
      }
    }

    await visit(null, '/', null, 0)
  }

  private async normalizeSiblingOrder(
    projectId: number,
    parentId: number | null,
    trx: TransactionClientContract,
  ): Promise<void> {
    const siblings = await WbsNode.query({ client: trx })
      .where('project_id', projectId)
      .where((query) =>
        parentId === null ? query.whereNull('parent_id') : query.where('parent_id', parentId),
      )
      .orderBy('display_order', 'asc')
      .orderBy('id', 'asc')
    for (const [index, sibling] of siblings.entries()) {
      sibling.displayOrder = index
      sibling.useTransaction(trx)
      await sibling.save()
    }
  }

  private async assertTaskAvailable(
    projectId: number,
    taskId: number | null,
    trx: TransactionClientContract,
  ): Promise<void> {
    if (taskId === null) return
    const task = await Task.query({ client: trx })
      .where('id', taskId)
      .where('project_id', projectId)
      .first()
    if (!task) throw new ValidationException('关联任务不属于当前项目')
    // 软删节点已从活动树移除（模型层查询均排除 deleted_at），不占用 task_id 关联，
    // 允许删除后为同一任务重建 WBS 节点；唯一约束侧由 1994000000000 迁移改为条件唯一
    const occupied = await trx
      .from('wbs_nodes')
      .where('task_id', taskId)
      .whereNull('deleted_at')
      .first()
    if (occupied) throw new ValidationException('该任务已关联 WBS 节点')
  }

  private async nodeOrFail(
    projectId: number,
    nodeId: number,
    trx: TransactionClientContract,
  ): Promise<WbsNode> {
    const node = await WbsNode.query({ client: trx })
      .where('id', nodeId)
      .where('project_id', projectId)
      .first()
    if (!node) throw new ResourceNotFoundException('WBS 节点不存在')
    return node
  }

  private async projectOrFail(
    organizationId: number,
    projectId: number,
    trx: TransactionClientContract,
  ): Promise<Project> {
    const project = await Project.query({ client: trx })
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }
}
