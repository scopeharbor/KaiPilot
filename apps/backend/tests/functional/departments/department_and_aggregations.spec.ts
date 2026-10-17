import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Department from '#models/department'
import OrganizationMember from '#models/organization_member'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type Organization from '#models/organization'
import type User from '#models/user'
import Task from '#models/task'
import app from '@adonisjs/core/services/app'
import DepartmentService from '#services/department_service'
import ProjectMetricsService from '#services/project_metrics_service'
import TaskService from '#services/task_service'
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/** 装配项目 + owner(PM) + 可选额外成员（自动加 org member + project member）。 */
async function setupProject(
  org: Organization,
  creator: User,
  extraMembers: Array<{ user: User; role: string }> = [],
) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const roleCache = new Map<string, ProjectRole>()
  for (const { user, role } of extraMembers) {
    await addOrgMember(org, user, 'member')
    let roleRow = roleCache.get(role)
    if (!roleRow) {
      roleRow = await ProjectRole.create({
        projectId: project.id,
        name: role,
        description: role,
        permissions: [],
        isSystem: true,
      })
      roleCache.set(role, roleRow)
    }
    await ProjectMember.create({
      projectId: project.id,
      userId: user.id,
      projectRoleId: roleRow.id,
      isActive: true,
    })
  }
  return { project }
}

interface TaskSeedOptions {
  name?: string
  status?: string
  assigneeId?: number | null
  reviewerId?: number | null
  estimatedHours?: number | null
  startDate?: DateTime | null
  endDate?: DateTime | null
  locationUnit?: string | null
  cycleStage?: string | null
  consultedUserIds?: number[]
  informedUserIds?: number[]
}

async function seedTask(projectId: number, options: TaskSeedOptions = {}): Promise<Task> {
  return Task.create({
    projectId,
    name: options.name ?? '测试任务',
    status: (options.status ?? 'not_started') as never,
    priority: 'medium',
    taskType: 'task',
    assigneeId: options.assigneeId ?? null,
    reviewerId: options.reviewerId ?? null,
    estimatedHours: options.estimatedHours ?? null,
    startDate: options.startDate ?? null,
    endDate: options.endDate ?? null,
    locationUnit: options.locationUnit ?? null,
    cycleStage: options.cycleStage ?? null,
    consultedUserIds: options.consultedUserIds ?? [],
    informedUserIds: options.informedUserIds ?? [],
  })
}

/** 挂组织成员到部门（organization_members.department_id）。 */
async function assignMemberDepartment(
  org: Organization,
  user: User,
  departmentId: number,
): Promise<void> {
  const row = await OrganizationMember.query()
    .where('organization_id', org.id)
    .where('user_id', user.id)
    .firstOrFail()
  row.departmentId = departmentId
  await row.save()
}

function findTreeNode<T extends { children: T[]; code: string }>(
  nodes: T[],
  code: string,
): T | null {
  for (const node of nodes) {
    if (node.code === code) return node
    const found = findTreeNode(node.children, code)
    if (found) return found
  }
  return null
}

test.group('DepartmentService 部门树 + OBS/RACI/LOB 聚合', (group) => {
  useAuthDatabase(group)
  const deptService = new DepartmentService()
  const metricsService = new ProjectMetricsService()

  // ---------------- 部门树 CRUD ----------------

  test('多级部门 path / depth 自动维护：根 0、子 1、孙 2', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('dept-hier') })
    const org = await createOrganization(owner)

    const root = await deptService.create(org.id, { name: '研发中心', code: 'RD' }, owner.id)
    assert.equal(root.path, `/${root.id}/`)
    assert.equal(root.depth, 0)

    const child = await deptService.create(
      org.id,
      { name: '前端工程组', code: 'FE', parentId: root.id },
      owner.id,
    )
    assert.equal(child.path, `/${root.id}/${child.id}/`)
    assert.equal(child.depth, 1)

    const grandchild = await deptService.create(
      org.id,
      { name: '图表组', code: 'CHART', parentId: child.id },
      owner.id,
    )
    assert.equal(grandchild.path, `/${root.id}/${child.id}/${grandchild.id}/`)
    assert.equal(grandchild.depth, 2)
  })

  test('listTree 返回嵌套树（根含 children、孤儿挂根层）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('dept-tree') })
    const org = await createOrganization(owner)

    const rootA = await deptService.create(org.id, { name: '研发中心', code: 'RD' }, owner.id)
    const rootB = await deptService.create(org.id, { name: '交付中心', code: 'DL' }, owner.id)
    await deptService.create(org.id, { name: '前端组', code: 'FE', parentId: rootA.id }, owner.id)
    const childB = await deptService.create(
      org.id,
      { name: '实施组', code: 'IMPL', parentId: rootB.id },
      owner.id,
    )
    await deptService.create(
      org.id,
      { name: '实施一组', code: 'IMPL-1', parentId: childB.id },
      owner.id,
    )

    const tree = await deptService.listTree(org.id)
    assert.lengthOf(tree, 2)
    const rd = findTreeNode(tree, 'RD')
    assert.isNotNull(rd)
    assert.equal(rd!.children[0].code, 'FE')
    const impl = findTreeNode(tree, 'IMPL')
    assert.equal(impl!.children[0].code, 'IMPL-1')
    assert.equal(impl!.depth, 1)
  })

  test('改 parent 整棵子树 path/depth 重写（含移为根）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('dept-move') })
    const org = await createOrganization(owner)

    const rootA = await deptService.create(org.id, { name: 'A 中心', code: 'A' }, owner.id)
    const rootB = await deptService.create(org.id, { name: 'B 中心', code: 'B' }, owner.id)
    const childA = await deptService.create(
      org.id,
      { name: 'A-1', code: 'A1', parentId: rootA.id },
      owner.id,
    )
    const grandA = await deptService.create(
      org.id,
      { name: 'A-1-1', code: 'A11', parentId: childA.id },
      owner.id,
    )

    // A-1 整棵移入 B 中心下
    const moved = await deptService.update(org.id, childA.id, { parentId: rootB.id }, owner.id)
    assert.equal(moved.path, `/${rootB.id}/${childA.id}/`)
    assert.equal(moved.depth, 1)

    const reloaded = await Department.query().where('id', grandA.id).firstOrFail()
    assert.equal(reloaded.path, `/${rootB.id}/${childA.id}/${grandA.id}/`)
    assert.equal(reloaded.depth, 2)

    // 再移为根
    const movedRoot = await deptService.update(org.id, childA.id, { parentId: null }, owner.id)
    assert.equal(movedRoot.path, `/${childA.id}/`)
    assert.equal(movedRoot.depth, 0)
    const reloadedGrand = await Department.query().where('id', grandA.id).firstOrFail()
    assert.equal(reloadedGrand.path, `/${childA.id}/${grandA.id}/`)
    assert.equal(reloadedGrand.depth, 1)

    const tree = await deptService.listTree(org.id)
    assert.lengthOf(tree, 3) // A、B、A-1 全部为根
  })

  test('循环挂载防御：挂自身 / 挂自身子孙 → ValidationException', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('dept-cycle') })
    const org = await createOrganization(owner)

    const root = await deptService.create(org.id, { name: '根部门', code: 'ROOT' }, owner.id)
    const child = await deptService.create(
      org.id,
      { name: '子部门', code: 'SUB', parentId: root.id },
      owner.id,
    )
    const grand = await deptService.create(
      org.id,
      { name: '孙部门', code: 'LEAF', parentId: child.id },
      owner.id,
    )

    await assert.rejects(
      () => deptService.update(org.id, root.id, { parentId: grand.id }, owner.id),
      ValidationException,
    )
    await assert.rejects(
      () => deptService.update(org.id, grand.id, { parentId: grand.id }, owner.id),
      ValidationException,
    )
    // 不变式保持：孙部门仍挂在子部门下
    const still = await deptService.get(org.id, grand.id)
    assert.equal(still.parentId, child.id)
  })

  test('跨组织父部门注入：create / update 一律 ValidationException', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('dept-xorg-a') })
    const ownerB = await createUser({ email: uniqueEmail('dept-xorg-b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)

    const foreignParent = await deptService.create(
      orgB.id,
      { name: 'B 部门', code: 'B1' },
      ownerB.id,
    )

    await assert.rejects(
      () =>
        deptService.create(
          orgA.id,
          { name: 'A 子部门', code: 'A1', parentId: foreignParent.id },
          ownerA.id,
        ),
      ValidationException,
    )
    const own = await deptService.create(orgA.id, { name: 'A 部门', code: 'A1' }, ownerA.id)
    await assert.rejects(
      () => deptService.update(orgA.id, own.id, { parentId: foreignParent.id }, ownerA.id),
      ValidationException,
    )
    // 未污染：own 仍为根
    const reloaded = await deptService.get(orgA.id, own.id)
    assert.equal(reloaded.parentId, null)
  })

  test('部门编码同组织唯一：create / update 冲突 → ValidationException', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('dept-code') })
    const org = await createOrganization(owner)

    await deptService.create(org.id, { name: '研发', code: 'RD' }, owner.id)
    await assert.rejects(
      () => deptService.create(org.id, { name: '重复研发', code: 'RD' }, owner.id),
      ValidationException,
    )
    const other = await deptService.create(org.id, { name: '交付', code: 'DL' }, owner.id)
    await assert.rejects(
      () => deptService.update(org.id, other.id, { code: 'RD' }, owner.id),
      ValidationException,
    )
  })

  test('删除保护：有子部门 / 挂组织成员 / 挂项目 → ValidationException；解除后删除成功', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('dept-del') })
    const member = await createUser({ email: uniqueEmail('dept-del-m') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [{ user: member, role: 'member' }])

    const root = await deptService.create(org.id, { name: '研发中心', code: 'RD' }, owner.id)
    const child = await deptService.create(
      org.id,
      { name: '前端组', code: 'FE', parentId: root.id },
      owner.id,
    )

    // 有活跃子部门 → 禁止删父
    await assert.rejects(
      () => deptService.softDelete(org.id, root.id, owner.id),
      ValidationException,
    )

    // 组织成员挂载 → 禁止删
    await assignMemberDepartment(org, member, child.id)
    await assert.rejects(
      () => deptService.softDelete(org.id, child.id, owner.id),
      ValidationException,
    )

    // 项目挂载 → 禁止删
    project.departmentId = child.id
    await project.save()
    await assert.rejects(
      () => deptService.softDelete(org.id, child.id, owner.id),
      ValidationException,
    )

    // 解除项目与成员挂载后删除成功
    project.departmentId = null
    await project.save()
    const memberRow = await OrganizationMember.query()
      .where('organization_id', org.id)
      .where('user_id', member.id)
      .firstOrFail()
    memberRow.departmentId = null
    await memberRow.save()

    await deptService.softDelete(org.id, child.id, owner.id)
    await assert.rejects(() => deptService.get(org.id, child.id), ResourceNotFoundException)

    // 父部门现可删除（子部门已软删，不阻挡）
    await deptService.softDelete(org.id, root.id, owner.id)
    const list = await deptService.listTree(org.id)
    assert.lengthOf(list, 0)
  })

  test('跨组织部门访问：get / update / softDelete → 404', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('dept-iso-a') })
    const ownerB = await createUser({ email: uniqueEmail('dept-iso-b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)

    const deptA = await deptService.create(orgA.id, { name: 'A 部门', code: 'A1' }, ownerA.id)

    await assert.rejects(() => deptService.get(orgB.id, deptA.id), ResourceNotFoundException)
    await assert.rejects(
      () => deptService.update(orgB.id, deptA.id, { name: '越权改名' }, ownerB.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => deptService.softDelete(orgB.id, deptA.id, ownerB.id),
      ResourceNotFoundException,
    )
  })

  // ---------------- OBS 项目工时映射 ----------------

  test('OBS 树：项目成员与指派任务挂载到部门并自底向上汇总', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('obs-owner') })
    const uEng = await createUser({ email: uniqueEmail('obs-eng'), fullName: '张工程' })
    const uQa = await createUser({ email: uniqueEmail('obs-qa'), fullName: '李质量' })
    const uOther = await createUser({ email: uniqueEmail('obs-other'), fullName: '王协作' })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: uEng, role: 'member' },
      { user: uQa, role: 'member' },
    ])
    // uOther 只挂组织不挂项目：作为任务负责人仍应计入任务聚合，但不计 memberCount
    await addOrgMember(org, uOther, 'member')

    const rd = await deptService.create(
      org.id,
      { name: '研发中心', code: 'RD', leaderId: uEng.id },
      owner.id,
    )
    const eng = await deptService.create(
      org.id,
      { name: '工程部', code: 'ENG', parentId: rd.id, leaderId: uEng.id },
      owner.id,
    )
    const qa = await deptService.create(
      org.id,
      { name: '质量部', code: 'QA', parentId: rd.id },
      owner.id,
    )

    await assignMemberDepartment(org, uEng, eng.id)
    await assignMemberDepartment(org, uQa, qa.id)
    await assignMemberDepartment(org, uOther, eng.id)

    await seedTask(project.id, { name: 't1', assigneeId: uEng.id, estimatedHours: 8 })
    await seedTask(project.id, {
      name: 't2',
      status: 'completed',
      assigneeId: uEng.id,
      estimatedHours: 16,
    })
    await seedTask(project.id, { name: 't3', assigneeId: uQa.id, estimatedHours: 4 })
    await seedTask(project.id, {
      name: 't4',
      status: 'completed',
      assigneeId: uOther.id,
      estimatedHours: 10,
    })
    await seedTask(project.id, { name: 't5 无负责人', estimatedHours: 20 })

    const tree = await deptService.getProjectObsTree(org.id, project.id)
    const engNode = findTreeNode(tree, 'ENG')
    const qaNode = findTreeNode(tree, 'QA')
    const rdNode = findTreeNode(tree, 'RD')

    assert.isNotNull(engNode)
    assert.equal(engNode!.leaderName, '张工程')
    assert.deepEqual(engNode!.metrics, {
      memberCount: 1, // uEng（uOther 不是项目成员）
      taskCount: 3, // t1 / t2 / t4
      completedTaskCount: 2, // t2 / t4
      totalEstimatedHours: 34, // 8 + 16 + 10
    })
    assert.deepEqual(qaNode!.metrics, {
      memberCount: 1,
      taskCount: 1,
      completedTaskCount: 0,
      totalEstimatedHours: 4,
    })
    // 父节点汇总直属 + 子树
    assert.deepEqual(rdNode!.metrics, {
      memberCount: 2,
      taskCount: 4,
      completedTaskCount: 2,
      totalEstimatedHours: 38,
    })
  })

  test('OBS / RACI / LOB 跨组织项目 → 404', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('agg-iso-a') })
    const ownerB = await createUser({ email: uniqueEmail('agg-iso-b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    await setupProject(orgA, ownerA)
    const { project: projectB } = await setupProject(orgB, ownerB)

    await assert.rejects(
      () => deptService.getProjectObsTree(orgA.id, projectB.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => metricsService.getRaciMatrix(orgA.id, projectB.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => metricsService.getLobMetrics(orgA.id, projectB.id),
      ResourceNotFoundException,
    )
  })

  // ---------------- RACI 矩阵 + 任务字段放行 ----------------

  test('RACI 矩阵：R/A/C/I 按行任务 × 列用户正确交叉', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('raci-owner'), fullName: '项目经理' })
    const uEng = await createUser({ email: uniqueEmail('raci-eng'), fullName: '张工程' })
    const uConsult = await createUser({ email: uniqueEmail('raci-consult'), fullName: '钱顾问' })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [{ user: uEng, role: 'member' }])
    // uConsult 仅组织成员（非项目成员）：可作为咨询人出现在矩阵但不在 members 列表

    const taskR = await seedTask(project.id, {
      name: '任务-R',
      assigneeId: uEng.id,
      reviewerId: owner.id,
      consultedUserIds: [uConsult.id],
      informedUserIds: [owner.id],
    })
    const taskS = await seedTask(project.id, {
      name: '任务-S',
      assigneeId: owner.id,
      reviewerId: owner.id,
    })
    await seedTask(project.id, { name: '任务-无角色' })

    const result = await metricsService.getRaciMatrix(org.id, project.id)
    assert.lengthOf(result.tasks, 3)
    assert.equal(result.members.length, 2)
    const memberIds = result.members.map((member) => member.id).sort()
    assert.deepEqual(memberIds, [owner.id, uEng.id].sort())

    const cellR = result.matrix[taskR.id]
    assert.isDefined(cellR)
    assert.deepEqual(cellR![uEng.id], ['R'])
    assert.deepEqual(cellR![owner.id], ['A', 'I'])
    assert.deepEqual(cellR![uConsult.id], ['C'])

    const cellS = result.matrix[taskS.id]
    assert.deepEqual(cellS![owner.id], ['R', 'A'])
  })

  test('TaskService 放行 RACI/LOB 字段：写读闭环 + 组织边界拦截', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('raci-svc-owner') })
    const member = await createUser({ email: uniqueEmail('raci-svc-member') })
    const consult = await createUser({ email: uniqueEmail('raci-svc-consult') })
    const outsiderOrg = await createUser({ email: uniqueEmail('raci-svc-foreign') })
    const org = await createOrganization(owner)
    const foreignOrg = await createOrganization(outsiderOrg)
    const { project } = await setupProject(org, owner, [
      { user: member, role: 'member' },
      { user: consult, role: 'member' },
    ])

    const taskService = await app.container.make(TaskService)
    const created = await taskService.create(
      org.id,
      project.id,
      {
        name: 'RACI 任务',
        assigneeId: member.id,
        locationUnit: 'Floor-1',
        cycleStage: '结构施工',
        consultedUserIds: [consult.id],
      },
      owner.id,
    )
    assert.deepEqual(created.consultedUserIds, [consult.id])
    assert.equal(created.locationUnit, 'Floor-1')
    assert.equal(created.cycleStage, '结构施工')

    const updated = await taskService.update(
      org.id,
      project.id,
      created.id,
      {
        informedUserIds: [consult.id, member.id],
        locationUnit: 'Zone-B',
      },
      owner.id,
    )
    assert.deepEqual(updated.consultedUserIds, [consult.id])
    assert.deepEqual(updated.informedUserIds, [consult.id, member.id])
    assert.equal(updated.locationUnit, 'Zone-B')

    // 越界：外组织用户 ID → 422
    await assert.rejects(
      () =>
        taskService.update(
          org.id,
          project.id,
          created.id,
          {
            consultedUserIds: [Number(foreignOrg.ownerId)],
          },
          owner.id,
        ),
      ValidationException,
    )
    // 无效正整数 → 422
    await assert.rejects(
      () =>
        taskService.update(
          org.id,
          project.id,
          created.id,
          {
            consultedUserIds: [0],
          },
          owner.id,
        ),
      ValidationException,
    )

    // 清空数组 / 置空 LOB 字段
    const cleared = await taskService.update(
      org.id,
      project.id,
      created.id,
      {
        consultedUserIds: [],
        informedUserIds: [],
        cycleStage: null,
      },
      owner.id,
    )
    assert.deepEqual(cleared.consultedUserIds, [])
    assert.deepEqual(cleared.informedUserIds, [])
    assert.equal(cleared.cycleStage, null)
    assert.equal(cleared.locationUnit, 'Zone-B')
  })

  // ---------------- LOB 流水聚合 ----------------

  test('LOB：单元排序、活动工期/斜率、节拍与碰撞/间断诊断', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('lob-owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const day = (value: string): DateTime => DateTime.fromISO(value)
    // 创建顺序即单元内工序出现序：结构施工 → 水电预埋 → 二次装修
    // 结构施工：F1 1/1-1/2；F2 1/3-1/3（与 F1 间隔 2 天）；F3 1/3-1/4（与 F2 同日 → 碰撞）
    const f1Struct = await seedTask(project.id, {
      name: 'F1 结构施工',
      locationUnit: 'Floor-1',
      cycleStage: '结构施工',
      startDate: day('2026-01-01'),
      endDate: day('2026-01-02'),
    })
    const f2Struct = await seedTask(project.id, {
      name: 'F2 结构施工',
      locationUnit: 'Floor-2',
      cycleStage: '结构施工',
      startDate: day('2026-01-03'),
      endDate: day('2026-01-03'),
    })
    const f3Struct = await seedTask(project.id, {
      name: 'F3 结构施工',
      locationUnit: 'Floor-3',
      cycleStage: '结构施工',
      startDate: day('2026-01-03'),
      endDate: day('2026-01-04'),
    })
    // 水电预埋：F1 1/5；F2 1/9（间隔 4 天 → 间断 gap）
    await seedTask(project.id, {
      name: 'F1 水电预埋',
      locationUnit: 'Floor-1',
      cycleStage: '水电预埋',
      startDate: day('2026-01-05'),
      endDate: day('2026-01-05'),
    })
    await seedTask(project.id, {
      name: 'F2 水电预埋',
      locationUnit: 'Floor-2',
      cycleStage: '水电预埋',
      startDate: day('2026-01-09'),
      endDate: day('2026-01-09'),
    })
    // 二次装修：F1 单条 1/10-1/12
    const f1Decor = await seedTask(project.id, {
      name: 'F1 二次装修',
      locationUnit: 'Floor-1',
      cycleStage: '二次装修',
      startDate: day('2026-01-10'),
      endDate: day('2026-01-12'),
    })
    // 无关任务（无单元/工序）不参与
    await seedTask(project.id, { name: '普通任务' })

    const result = await metricsService.getLobMetrics(org.id, project.id)
    assert.deepEqual(result.units, ['Floor-1', 'Floor-2', 'Floor-3'])
    assert.deepEqual(result.stages, ['结构施工', '水电预埋', '二次装修'])
    assert.lengthOf(result.activities, 6)

    const byTask = new Map(result.activities.map((activity) => [activity.taskId, activity]))
    const f1StructActivity = byTask.get(f1Struct.id)!
    assert.equal(f1StructActivity.durationDays, 2)
    assert.equal(f1StructActivity.slopeRate, 0.5) // 工序首条 → 1/工期
    const f2StructActivity = byTask.get(f2Struct.id)!
    assert.equal(f2StructActivity.slopeRate, 0.5) // 与 F1 开始间隔 2 天 → 1/2
    const f3StructActivity = byTask.get(f3Struct.id)!
    assert.equal(f3StructActivity.durationDays, 2)
    assert.equal(f3StructActivity.slopeRate, null) // 与 F2 同日开始 → 无法测斜率
    const f1DecorActivity = byTask.get(f1Decor.id)!
    assert.equal(f1DecorActivity.durationDays, 3)
    assert.equal(f1DecorActivity.slopeRate, 0.333) // 1/3 保留 3 位

    // 单元内工序顺序：结构 → 水电 → 装修
    const floor1Order = result.activities
      .filter((activity) => activity.unit === 'Floor-1')
      .map((activity) => activity.stage)
    assert.deepEqual(floor1Order, ['结构施工', '水电预埋', '二次装修'])

    const structureRhythm = result.rhythmSummary.find((row) => row.stage === '结构施工')!
    assert.equal(structureRhythm.activityCount, 3)
    assert.equal(structureRhythm.avgDurationDays, 1.667) // (2+1+2)/3
    assert.equal(structureRhythm.avgTaktDays, 1) // (2+0)/2
    assert.equal(structureRhythm.collision, true)
    assert.equal(structureRhythm.gap, false)
    assert.deepEqual(structureRhythm.diagnostics, ['STAGE_COLLISION'])

    const waterRhythm = result.rhythmSummary.find((row) => row.stage === '水电预埋')!
    assert.equal(waterRhythm.activityCount, 2)
    assert.equal(waterRhythm.avgTaktDays, 4)
    assert.equal(waterRhythm.gap, true)
    assert.deepEqual(waterRhythm.diagnostics, ['STAGE_GAP'])

    const decorRhythm = result.rhythmSummary.find((row) => row.stage === '二次装修')!
    assert.equal(decorRhythm.activityCount, 1)
    assert.equal(decorRhythm.avgTaktDays, null)
    assert.equal(decorRhythm.collision, false)
    assert.equal(decorRhythm.gap, false)
    assert.deepEqual(decorRhythm.diagnostics, [])
  })

  test('LOB：自然序单元排序 Floor-2 < Floor-10', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('lob-sort') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const day = (value: string): DateTime => DateTime.fromISO(value)
    await seedTask(project.id, {
      name: '单元 10',
      locationUnit: 'Floor-10',
      cycleStage: '砌筑',
      startDate: day('2026-02-01'),
      endDate: day('2026-02-01'),
    })
    await seedTask(project.id, {
      name: '单元 2',
      locationUnit: 'Floor-2',
      cycleStage: '砌筑',
      startDate: day('2026-01-01'),
      endDate: day('2026-01-01'),
    })

    const result = await metricsService.getLobMetrics(org.id, project.id)
    assert.deepEqual(result.units, ['Floor-2', 'Floor-10'])
  })
})
