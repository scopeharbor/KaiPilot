/**
 * v3-chart-gallery-data-foundation —— DepartmentService（W3.5）。
 *
 * OBS 组织分解结构部门树：
 * - 租户级树 CRUD（GET /departments 全树 / POST / PATCH / DELETE / GET :id）
 * - path / depth 物化路径自动维护（复用 Department.childPathOf / childDepthOf：
 *   根部门 path = `/<id>/`、depth = 0；子部门 = 父路径 + `<id>/`、depth = 父 + 1）
 * - 修改 parentId 时整棵子树路径重写（同一事务内 BFS 重算，杜绝悬挂路径）
 * - 循环挂载防御与跨组织父部门注入防御：均抛 ValidationException（422）。
 *   父部门不在当前组织即视为非法引用（spec OBS scenario）
 * - 删除保护：存在活跃子部门 / 关联项目 / 关联组织成员时禁止（422）；
 *   SQLite 侧 departments.parent_id 的物理 FK RESTRICT 由服务层先行校验兜底
 * - getProjectObsTree：项目级 OBS 映射，把项目成员（经组织成员部门归属）与
 *   指派任务（负责人经组织成员部门归属）的工时负荷聚合到部门树节点，
 *   自底向上汇总（父节点含全子树）
 */
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import db from '@adonisjs/lucid/services/db'
import Department from '#models/department'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import Task from '#models/task'
import User from '#models/user'
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export interface CreateDepartmentInput {
  name: string
  code: string
  description?: string | null
  /** 父部门：省略 / null 为根部门。父部门必须属于当前组织。 */
  parentId?: number | null
  leaderId?: number | null
  sortOrder?: number
}

export interface UpdateDepartmentInput extends Partial<CreateDepartmentInput> {}

/** GET /departments 租户部门树节点。 */
export interface DepartmentTreeNode {
  id: number
  name: string
  code: string
  description: string | null
  depth: number
  path: string
  sortOrder: number
  leaderId: number | null
  leaderName: string | null
  children: DepartmentTreeNode[]
}

/** 项目级 OBS 树节点挂载度量（design D3.4）。 */
export interface ObsNodeMetrics {
  memberCount: number
  taskCount: number
  completedTaskCount: number
  totalEstimatedHours: number
}

/** 项目级 OBS 树节点（GET /projects/:projectId/obs-tree）。 */
export interface ObsTreeNode {
  id: number
  name: string
  code: string
  depth: number
  path: string
  leaderName: string | null
  metrics: ObsNodeMetrics
  children: ObsTreeNode[]
}

const EMPTY_METRICS: ObsNodeMetrics = {
  memberCount: 0,
  taskCount: 0,
  completedTaskCount: 0,
  totalEstimatedHours: 0,
}

function addMetrics(a: ObsNodeMetrics, b: ObsNodeMetrics): ObsNodeMetrics {
  return {
    memberCount: a.memberCount + b.memberCount,
    taskCount: a.taskCount + b.taskCount,
    completedTaskCount: a.completedTaskCount + b.completedTaskCount,
    totalEstimatedHours: a.totalEstimatedHours + b.totalEstimatedHours,
  }
}

export default class DepartmentService {
  async create(
    organizationId: number,
    input: CreateDepartmentInput,
    actorUserId: number,
  ): Promise<Department> {
    const name = this.normalizeRequiredName(input.name)
    const code = this.normalizeRequiredCode(input.code)
    const sortOrder = Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0

    return db.transaction(async (trx) => {
      await this.assertCodeAvailable(organizationId, code, null, trx)

      const parentId =
        input.parentId === null || input.parentId === undefined ? null : Number(input.parentId)
      let parent: Department | null = null
      if (parentId !== null) {
        parent = await Department.query({ client: trx })
          .where('id', parentId)
          .where('organization_id', organizationId)
          .first()
        if (!parent) {
          throw new ValidationException('父部门不存在或不属于当前组织')
        }
      }

      // 先插入（需要自增 id），再回填物化路径与深度
      const department = await Department.create(
        {
          organizationId,
          parentId,
          name,
          code,
          description: input.description ?? null,
          leaderId: input.leaderId ?? null,
          sortOrder,
          path: '/',
          depth: 0,
          createdBy: actorUserId,
        },
        { client: trx },
      )
      department.path = Department.childPathOf(parent?.path ?? null, department.id)
      department.depth = Department.childDepthOf(parent?.depth ?? null)
      department.useTransaction(trx)
      await department.save()
      return department
    })
  }

  /** 租户完整部门树（根节点列表；层级内按 sort_order asc / id asc）。 */
  async listTree(organizationId: number): Promise<DepartmentTreeNode[]> {
    const departments = await Department.query()
      .where('organization_id', organizationId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
    if (departments.length === 0) return []

    const childrenByParent = this.buildChildrenMap(departments)
    const leaderNames = await this.loadLeaderNames(departments)
    const roots = this.rootDepartments(departments)

    return roots
      .map((dept) => this.toTreeNode(dept, childrenByParent, leaderNames))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  }

  async get(organizationId: number, departmentId: number): Promise<Department> {
    return this.departmentOrFail(organizationId, departmentId)
  }

  async update(
    organizationId: number,
    departmentId: number,
    input: UpdateDepartmentInput,
    _actorUserId: number,
  ): Promise<Department> {
    return db.transaction(async (trx) => {
      const department = await this.departmentOrFail(organizationId, departmentId, trx)
      const all = await Department.query({ client: trx }).where('organization_id', organizationId)
      const allById = new Map(all.map((dept) => [dept.id, dept]))

      if (input.name !== undefined) {
        department.name = this.normalizeRequiredName(input.name)
      }
      if (input.code !== undefined) {
        const code = this.normalizeRequiredCode(input.code)
        if (code !== department.code) {
          await this.assertCodeAvailable(organizationId, code, department.id, trx)
          department.code = code
        }
      }
      if (input.description !== undefined) {
        department.description = input.description === null ? null : input.description
      }
      if (input.leaderId !== undefined) {
        department.leaderId = input.leaderId === null ? null : Number(input.leaderId)
      }
      if (input.sortOrder !== undefined) {
        department.sortOrder = Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0
      }

      // 父节点调整：整棵子树物化路径重写
      if (input.parentId !== undefined) {
        const nextParentId = input.parentId === null ? null : Number(input.parentId)
        const currentParentId = department.parentId === null ? null : Number(department.parentId)
        if (nextParentId !== currentParentId) {
          const parent = nextParentId === null ? null : allById.get(nextParentId)
          if (nextParentId !== null && !parent) {
            throw new ValidationException('父部门不存在或不属于当前组织')
          }
          if (parent) {
            this.assertNoCycle(department, parent, allById)
          }
          department.parentId = nextParentId
          await this.rewriteSubtree(allById, department, trx)
          return department
        }
      }

      department.useTransaction(trx)
      await department.save()
      return department
    })
  }

  async softDelete(
    organizationId: number,
    departmentId: number,
    _actorUserId: number,
  ): Promise<void> {
    const department = await this.departmentOrFail(organizationId, departmentId)

    const activeChildCount = await Department.query()
      .where('parent_id', departmentId)
      .count('*', 'total')
    if (Number(activeChildCount[0]?.$extras?.total ?? 0) > 0) {
      throw new ValidationException('该部门下存在子部门，请先删除或移走子部门')
    }

    const linkedProject = await Project.query()
      .where('department_id', departmentId)
      .select('id')
      .first()
    if (linkedProject) {
      throw new ValidationException('仍有项目挂载在该部门下，请先调整项目归属')
    }

    const linkedMember = await OrganizationMember.query()
      .where('department_id', departmentId)
      .select('id')
      .first()
    if (linkedMember) {
      throw new ValidationException('仍有组织成员挂载在该部门下，请先调整成员归属')
    }

    department.deletedAt = DateTime.now()
    await department.save()
  }

  /**
   * 项目级 OBS 组织分工树（design D3.4，只读聚合）：
   * 项目成员（project_members 活跃行）与项目任务（负责人）通过组织成员表的
   * department_id 归属到部门节点；各节点先统计直属，再自底向上汇总到根。
   */
  async getProjectObsTree(organizationId: number, projectId: number): Promise<ObsTreeNode[]> {
    await this.projectOrFail(organizationId, projectId)

    const departments = await Department.query()
      .where('organization_id', organizationId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
    if (departments.length === 0) return []

    const departmentIds = new Set(departments.map((dept) => dept.id))
    const direct = new Map<number, ObsNodeMetrics>()

    // 组织成员 → 部门归属（仅统计仍挂载在活跃部门上的成员行）
    const orgMemberRows = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .whereNotNull('department_id')
      .select('user_id', 'department_id')
    const userDepartment = new Map<number, number>()
    for (const row of orgMemberRows) {
      const departmentId = Number(row.departmentId)
      if (departmentIds.has(departmentId)) userDepartment.set(Number(row.userId), departmentId)
    }

    // 项目成员计数
    const projectMembers = await ProjectMember.query()
      .where('project_id', projectId)
      .where('is_active', true)
      .select('user_id')
    for (const member of projectMembers) {
      const departmentId = userDepartment.get(Number(member.userId))
      if (departmentId === undefined) continue
      const metrics = direct.get(departmentId) ?? { ...EMPTY_METRICS }
      metrics.memberCount += 1
      direct.set(departmentId, metrics)
    }

    // 任务聚合：负责人所属部门的任务总数 / 完成数 / 预估总工时
    const tasks = await Task.query()
      .where('project_id', projectId)
      .select('id', 'assignee_id', 'status', 'estimated_hours')
    for (const task of tasks) {
      if (task.assigneeId === null || task.assigneeId === undefined) continue
      const departmentId = userDepartment.get(Number(task.assigneeId))
      if (departmentId === undefined) continue
      const metrics = direct.get(departmentId) ?? { ...EMPTY_METRICS }
      metrics.taskCount += 1
      if (task.status === 'completed') metrics.completedTaskCount += 1
      if (typeof task.estimatedHours === 'number') {
        metrics.totalEstimatedHours += task.estimatedHours
      }
      direct.set(departmentId, metrics)
    }

    const childrenByParent = this.buildChildrenMap(departments)
    const leaderNames = await this.loadLeaderNames(departments)
    const roots = this.rootDepartments(departments)

    const build = (dept: Department): ObsTreeNode => {
      const childNodes = this.sortedChildren(childrenByParent, dept.id).map(build)
      const childTotal = childNodes.reduce<ObsNodeMetrics>(
        (acc, child) => addMetrics(acc, child.metrics),
        { ...EMPTY_METRICS },
      )
      const ownMetrics = direct.get(dept.id) ?? { ...EMPTY_METRICS }
      return {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        depth: dept.depth,
        path: dept.path,
        leaderName: leaderNames.get(dept.id) ?? null,
        metrics: addMetrics(ownMetrics, childTotal),
        children: childNodes,
      }
    }

    return roots.map(build)
  }

  // ---------------- 树组装辅助 ----------------

  /** 子部门表：parentId → [Department]（按 sort_order / id 排序）。 */
  private buildChildrenMap(departments: Department[]): Map<number, Department[]> {
    const map = new Map<number, Department[]>()
    for (const dept of departments) {
      if (dept.parentId === null || dept.parentId === undefined) continue
      const siblings = map.get(Number(dept.parentId)) ?? []
      siblings.push(dept)
      map.set(Number(dept.parentId), siblings)
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    }
    return map
  }

  private sortedChildren(
    childrenByParent: Map<number, Department[]>,
    parentId: number,
  ): Department[] {
    return childrenByParent.get(parentId) ?? []
  }

  /** 根节点集合：parentId 为空，或父部门已不在活跃集合（软删/脏数据 → 孤儿挂根）。 */
  private rootDepartments(departments: Department[]): Department[] {
    const liveIds = new Set(departments.map((dept) => dept.id))
    return departments.filter((dept) => {
      return dept.parentId === null || !liveIds.has(Number(dept.parentId))
    })
  }

  private toTreeNode(
    dept: Department,
    childrenByParent: Map<number, Department[]>,
    leaderNames: Map<number, string | null>,
  ): DepartmentTreeNode {
    return {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      description: dept.description,
      depth: dept.depth,
      path: dept.path,
      sortOrder: dept.sortOrder,
      leaderId: dept.leaderId,
      leaderName: leaderNames.get(dept.id) ?? null,
      children: this.sortedChildren(childrenByParent, dept.id).map((child) =>
        this.toTreeNode(child, childrenByParent, leaderNames),
      ),
    }
  }

  private async loadLeaderNames(departments: Department[]): Promise<Map<number, string | null>> {
    const leaderIds = Array.from(
      new Set(
        departments
          .map((dept) => dept.leaderId)
          .filter((id): id is number => id !== null && id !== undefined),
      ),
    )
    const names = new Map<number, string | null>()
    if (leaderIds.length === 0) return names
    const users = await User.query().whereIn('id', leaderIds).select('id', 'full_name')
    for (const user of users) names.set(user.id, user.fullName ?? null)
    return names
  }

  // ---------------- 物化路径维护 ----------------

  /**
   * 循环挂载防御：从新父节点沿 allById 内存快照向上回溯，
   * 若链中出现本节点自身则构成环。guard 防脏数据死循环。
   */
  private assertNoCycle(
    department: Department,
    parent: Department,
    allById: Map<number, Department>,
  ): void {
    const guard = new Set<number>()
    let current: Department | undefined = parent
    while (current !== undefined) {
      if (current.id === department.id) {
        throw new ValidationException('不能将部门挂载到自身或其子部门下（会构成环）')
      }
      if (current.parentId === null || current.parentId === undefined) break
      const parentId = Number(current.parentId)
      if (guard.has(parentId)) break // 上游脏数据环保护
      guard.add(parentId)
      current = allById.get(parentId)
    }
  }

  /**
   * 子树物化路径重写：调用前 department.parentId 已指向新父，且 department 自身
   * 的 path/depth 已按新父重算。以 department 为根按 DFS 逐层重算整棵子树的
   * path / depth（父先于子，路径沿栈传递——descendant 的父节点必须使用刚重算的
   * path，而非数据库旧值），全部在同一事务内落库。
   */
  private async rewriteSubtree(
    allById: Map<number, Department>,
    department: Department,
    trx: TransactionClientContract,
  ): Promise<void> {
    const childrenByParent = new Map<number, Department[]>()
    for (const dept of allById.values()) {
      if (dept.parentId === null || dept.parentId === undefined) continue
      const siblings = childrenByParent.get(Number(dept.parentId)) ?? []
      siblings.push(dept)
      childrenByParent.set(Number(dept.parentId), siblings)
    }

    const selfParent =
      department.parentId === null ? null : allById.get(Number(department.parentId))
    department.path = Department.childPathOf(selfParent?.path ?? null, department.id)
    department.depth = Department.childDepthOf(selfParent?.depth ?? null)

    const changed: Department[] = [department]
    const stack: Array<{ dept: Department; parentPath: string; parentDepth: number }> =
      this.sortedChildren(childrenByParent, department.id).map((child) => ({
        dept: child,
        parentPath: department.path,
        parentDepth: department.depth,
      }))
    while (stack.length > 0) {
      const entry = stack.pop()!
      entry.dept.path = Department.childPathOf(entry.parentPath, entry.dept.id)
      entry.dept.depth = Department.childDepthOf(entry.parentDepth)
      changed.push(entry.dept)
      for (const grandchild of this.sortedChildren(childrenByParent, entry.dept.id)) {
        stack.push({
          dept: grandchild,
          parentPath: entry.dept.path,
          parentDepth: entry.dept.depth,
        })
      }
    }

    for (const dept of changed) {
      dept.useTransaction(trx)
      await dept.save()
    }
  }

  // ---------------- 基础辅助 ----------------

  private async departmentOrFail(
    organizationId: number,
    departmentId: number,
    client?: TransactionClientContract,
  ): Promise<Department> {
    let query = Department.query()
      .where('id', departmentId)
      .where('organization_id', organizationId)
    if (client) query = query.useTransaction(client)
    const department = await query.first()
    if (!department) throw new ResourceNotFoundException('部门不存在')
    return department
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async assertCodeAvailable(
    organizationId: number,
    code: string,
    excludeId: number | null,
    client?: TransactionClientContract,
  ): Promise<void> {
    // 物理行查询（含软删除行）：UNIQUE(organization_id, code) 之下软删行也占位
    let query = db.from('departments').where('organization_id', organizationId).where('code', code)
    if (client) query = query.useTransaction(client)
    if (excludeId !== null) query = query.whereNot('id', excludeId)
    const duplicate = await query.first()
    if (duplicate) throw new ValidationException('部门编码已存在')
  }

  private normalizeRequiredName(value: string): string {
    if (!value || !value.trim()) throw new ValidationException('部门名称不能为空')
    const trimmed = value.trim()
    if (trimmed.length > 128) throw new ValidationException('部门名称长度不能超过 128')
    return trimmed
  }

  private normalizeRequiredCode(value: string): string {
    if (!value || !value.trim()) throw new ValidationException('部门编码不能为空')
    const trimmed = value.trim()
    if (trimmed.length > 64) throw new ValidationException('部门编码长度不能超过 64')
    return trimmed
  }
}
