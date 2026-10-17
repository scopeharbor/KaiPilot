// v3-chart-gallery-data-foundation W5.5 —— 图表馆 API 集成套件
//
// 覆盖 design D5 端点树的真实 HTTP 闭环（方法 × 路径 × 状态码 × 载荷）：
// 章程审批生命周期、需求/RTM/任务绑定、议题状态机、干系人四象限、沟通计划
// 启停、部门树 path/depth、RACI/LOB/EVM/S 曲线/燃尽/SPC/帕累托/OBS 聚合。
// 权限与 403/404 语义另见 security/chart_gallery_security_isolation.spec.ts。
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type Organization from '#models/organization'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

/** 装配组织 + 项目（owner 兼项目经理，org owner 具备组织管理员权限集）。 */
async function setupOwner() {
  const owner = await createUser({ email: uniqueEmail('gallery-owner') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

/** 追加项目成员（org 成员 + 项目角色；同名角色复用既有行避免 UNIQUE 冲突）。 */
async function addProjectMember(
  org: Organization,
  projectId: number,
  user: User,
  roleName: string,
): Promise<void> {
  await addOrgMember(org, user, 'member')
  const existing = await ProjectRole.query()
    .where('project_id', projectId)
    .where('name', roleName)
    .first()
  const role =
    existing ??
    (await ProjectRole.create({
      projectId,
      name: roleName,
      description: roleName,
      permissions: [],
      isSystem: true,
    }))
  await ProjectMember.create({
    projectId,
    userId: user.id,
    projectRoleId: role.id,
    isActive: true,
  })
}

async function makeTask(projectId: number, name: string, overrides: Record<string, unknown> = {}) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    isCriticalPath: false,
    isOnLongestPath: false,
    ...overrides,
  })
}

function charterPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: '图表馆集成章程',
    vision: '平台级经典图表能力',
    scope: '本期范围',
    objectives: ['目标一'],
    successCriteria: ['准则一'],
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    ...overrides,
  }
}

test.group('Chart Gallery API 集成', (group) => {
  useAuthDatabase(group)

  test('章程全生命周期：创建 → 编辑 → 提交 → 驳回升版 → 批准', async ({ assert, client }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const base = `/api/v1/projects/${project.id}/charter`

    const notFound = await client.get(base).header('Authorization', `Bearer ${token}`)
    notFound.assertStatus(200)
    assert.isNull(notFound.body().data)

    const created = await client
      .post(base)
      .header('Authorization', `Bearer ${token}`)
      .json(charterPayload())
    created.assertStatus(200)
    assert.equal(created.body().data.approvalStatus, 'draft')
    assert.equal(created.body().data.version, 1)

    const updated = await client
      .patch(base)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '修订标题', businessCase: '立项通过' })
    updated.assertStatus(200)
    assert.equal(updated.body().data.title, '修订标题')

    // 未提交直接审批 → 422
    const earlyApprove = await client
      .post(`${base}/approve`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'approve' })
    earlyApprove.assertStatus(422)

    const submitted = await client.post(`${base}/submit`).header('Authorization', `Bearer ${token}`)
    submitted.assertStatus(200)
    assert.equal(submitted.body().data.approvalStatus, 'pending_approval')

    // 审批中直接编辑 → 422
    const editDuringApproval = await client
      .patch(base)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '审批中修改' })
    editDuringApproval.assertStatus(422)

    const rejected = await client
      .post(`${base}/approve`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'reject' })
    rejected.assertStatus(200)
    assert.equal(rejected.body().data.approvalStatus, 'rejected')

    // 驳回后编辑 = 升版 v2，重新提交并批准
    const revised = await client
      .patch(base)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '驳回修订' })
    revised.assertStatus(200)
    assert.equal(revised.body().data.version, 2)

    await client.post(`${base}/submit`).header('Authorization', `Bearer ${token}`)
    const approved = await client
      .post(`${base}/approve`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'approve' })
    approved.assertStatus(200)
    assert.equal(approved.body().data.approvalStatus, 'approved')
    assert.equal(approved.body().data.approvedBy, owner.id)
    assert.isNotNull(approved.body().data.approvedAt)

    // 已批准禁止直接编辑
    const afterApprove = await client
      .patch(base)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '终态修改' })
    afterApprove.assertStatus(422)
  })

  test('章程创建载荷校验 422 与无权限 403', async ({ assert, client }) => {
    const { owner, org, project } = await setupOwner()
    const viewer = await createUser({ email: uniqueEmail('gallery-viewer') })
    await addProjectMember(org, project.id, viewer, ProjectRoleName.READONLY_OBSERVER)

    const ownerToken = await login(client, owner)
    const bad = await client
      .post(`/api/v1/projects/${project.id}/charter`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ title: '', scope: 'x', objectives: [], successCriteria: [], startDate: '2026/01/01' })
    bad.assertStatus(422)
    assert.equal(bad.body().error.code, 'VALIDATION_ERROR')

    const viewerToken = await login(client, viewer)
    const denied = await client
      .post(`/api/v1/projects/${project.id}/charter`)
      .header('Authorization', `Bearer ${viewerToken}`)
      .json(charterPayload())
    denied.assertStatus(403)
    assert.equal(denied.body().error.code, 'PERMISSION_DENIED')

    // 仅项目 PM（非组织管理员）无权审批：charter:approve 归组织管理员
    const pm = await createUser({ email: uniqueEmail('gallery-pm') })
    await addProjectMember(org, project.id, pm, ProjectRoleName.PROJECT_MANAGER)
    await client
      .post(`/api/v1/projects/${project.id}/charter`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json(charterPayload())
    await client
      .post(`/api/v1/projects/${project.id}/charter/submit`)
      .header('Authorization', `Bearer ${ownerToken}`)
    const pmToken = await login(client, pm)
    const pmApprove = await client
      .post(`/api/v1/projects/${project.id}/charter/approve`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ action: 'approve' })
    pmApprove.assertStatus(403)
  })

  test('需求 CRUD + 验收准则状态流转 + 任务绑定/解绑 + RTM 矩阵', async ({ assert, client }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const base = `/api/v1/projects/${project.id}/requirements`
    const task = await makeTask(project.id, '实现多轮问答')

    // 创建（自动编号 REQ-001）
    const created = await client
      .post(base)
      .header('Authorization', `Bearer ${token}`)
      .json({
        title: '支持多轮追问',
        description: '对话流内可连续追问',
        priority: 'high',
        acceptanceCriteria: [
          { id: 'ac-1', statement: '追问上下文完整', status: 'pending' },
          { id: 'ac-2', statement: '回答引用来源', status: 'pending' },
        ],
      })
    created.assertStatus(201)
    assert.equal(created.body().data.code, 'REQ-001')
    const reqId = created.body().data.id

    const listed = await client.get(base).header('Authorization', `Bearer ${token}`)
    listed.assertStatus(200)
    assert.equal(listed.body().meta.total, 1)

    // 单项验收准则状态流转 pending → passed
    const criterion = await client
      .patch(`${base}/${reqId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ criterionUpdates: [{ id: 'ac-1', status: 'passed' }] })
    criterion.assertStatus(200)
    assert.equal(criterion.body().data.acceptanceCriteria[0].status, 'passed')

    // 绑定任务并查 RTM
    const bound = await client
      .post(`${base}/${reqId}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ taskId: task.id })
    bound.assertStatus(201)

    const matrix = await client.get(`${base}/rtm-matrix`).header('Authorization', `Bearer ${token}`)
    matrix.assertStatus(200)
    assert.equal(matrix.body().data.totalRequirements, 1)
    assert.equal(matrix.body().data.coveragePercent, 100)
    assert.lengthOf(matrix.body().data.matrix, 1)
    assert.equal(matrix.body().data.matrix[0].linkedTasks[0].id, task.id)
    assert.equal(matrix.body().data.matrix[0].criteriaPassRate, 50)

    const detail = await client.get(`${base}/${reqId}`).header('Authorization', `Bearer ${token}`)
    detail.assertStatus(200)
    assert.lengthOf(detail.body().data.requirementTasks, 1)

    // 解绑 + 软删除
    const unbound = await client
      .delete(`${base}/${reqId}/tasks/${task.id}`)
      .header('Authorization', `Bearer ${token}`)
    unbound.assertStatus(204)

    const destroyed = await client
      .delete(`${base}/${reqId}`)
      .header('Authorization', `Bearer ${token}`)
    destroyed.assertStatus(204)
    const afterDelete = await client
      .get(`${base}/${reqId}`)
      .header('Authorization', `Bearer ${token}`)
    afterDelete.assertStatus(404)
    assert.equal(afterDelete.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('需求绑定跨组织任务 → 404；重复编号 → 422', async ({ assert, client }) => {
    const { owner, project } = await setupOwner()
    const outsider = await createUser({ email: uniqueEmail('gallery-foreign') })
    const otherOrg = await createOrganization(outsider)
    const { project: otherProject } = await createProjectWithMember(
      otherOrg,
      outsider,
      outsider,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const foreignTask = await makeTask(otherProject.id, '他组织任务')

    const token = await login(client, owner)
    const base = `/api/v1/projects/${project.id}/requirements`

    const first = await client
      .post(base)
      .header('Authorization', `Bearer ${token}`)
      .json({ code: 'REQ-DUP', title: '重复编号测试' })
    first.assertStatus(201)

    const dup = await client
      .post(base)
      .header('Authorization', `Bearer ${token}`)
      .json({ code: 'REQ-DUP', title: '第二份' })
    dup.assertStatus(422)

    const crossOrg = await client
      .post(`${base}/${first.body().data.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ taskId: foreignTask.id })
    crossOrg.assertStatus(404)
    assert.equal(crossOrg.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('议题登记/编号/状态机（resolved 根因守卫）/软删除', async ({ assert, client }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const base = `/api/v1/projects/${project.id}/issues`
    const task = await makeTask(project.id, '检索服务')

    const created = await client
      .post(base)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '检索超时', severity: 'major', relatedTaskId: task.id })
    created.assertStatus(201)
    assert.equal(created.body().data.code, 'ISS-001')
    const issueId = created.body().data.id

    // resolved 缺根因 → 422
    const noRootCause = await client
      .patch(`${base}/${issueId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'resolved' })
    noRootCause.assertStatus(422)

    const inProgress = await client
      .patch(`${base}/${issueId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'in_progress' })
    inProgress.assertStatus(200)

    const resolved = await client
      .patch(`${base}/${issueId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'resolved', rootCause: '缓存键未刷新', resolution: '清理缓存并发布' })
    resolved.assertStatus(200)
    assert.equal(resolved.body().data.status, 'resolved')
    assert.isNotNull(resolved.body().data.resolvedAt)

    const closed = await client
      .patch(`${base}/${issueId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'closed' })
    closed.assertStatus(200)
    assert.isNotNull(closed.body().data.closedAt)

    const reopened = await client
      .patch(`${base}/${issueId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'open' })
    reopened.assertStatus(200)
    assert.isNull(reopened.body().data.closedAt)

    const listed = await client
      .get(`${base}?status=open`)
      .header('Authorization', `Bearer ${token}`)
    listed.assertStatus(200)
    assert.equal(listed.body().meta.total, 1)

    const destroyed = await client
      .delete(`${base}/${issueId}`)
      .header('Authorization', `Bearer ${token}`)
    destroyed.assertStatus(204)
    const gone = await client.get(`${base}/${issueId}`).header('Authorization', `Bearer ${token}`)
    gone.assertStatus(404)
  })

  test('干系人登记/四象限聚合/更新/删除', async ({ assert, client }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const base = `/api/v1/projects/${project.id}/stakeholders`

    const created = await client
      .post(base)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '监管机构代表',
        stakeholderType: 'external',
        powerLevel: 'high',
        interestLevel: 'low',
        attitude: 'neutral',
        expectations: '按期报送进展',
        contactInfo: { email: 'regulator@example.test' },
      })
    created.assertStatus(201)
    assert.equal(created.body().data.stakeholderType, 'external')
    // 未显式给 strategy：按 high/low 自动推导为「令其满意」
    assert.equal(created.body().data.managementStrategy, 'keep_satisfied')
    const stakeholderId = created.body().data.id

    const quadrant = await client
      .get(`${base}?view=quadrant`)
      .header('Authorization', `Bearer ${token}`)
    quadrant.assertStatus(200)
    assert.equal(quadrant.body().data.summary.keepSatisfied, 1)
    assert.lengthOf(quadrant.body().data.quadrants.keepSatisfied, 1)

    const updated = await client
      .patch(`${base}/${stakeholderId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ interestLevel: 'high', managementStrategy: 'manage_closely' })
    updated.assertStatus(200)
    assert.equal(updated.body().data.managementStrategy, 'manage_closely')

    const destroyed = await client
      .delete(`${base}/${stakeholderId}`)
      .header('Authorization', `Bearer ${token}`)
    destroyed.assertStatus(204)
    const listed = await client.get(base).header('Authorization', `Bearer ${token}`)
    listed.assertStatus(200)
    assert.equal(listed.body().meta.total, 0)
  })

  test('沟通计划 CRUD 与启停开关', async ({ assert, client }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const base = `/api/v1/projects/${project.id}/communication-plans`

    const created = await client.post(base).header('Authorization', `Bearer ${token}`).json({
      name: '月度干系人简报',
      ownerId: owner.id,
      communicationType: 'report',
      purpose: '向管理层同步里程碑进展',
      frequency: 'monthly',
      channel: 'pdf_export',
      audience: '管理层与关键干系人',
      deliverable: '月报 PDF',
    })
    created.assertStatus(201)
    assert.isTrue(created.body().data.isActive)
    const planId = created.body().data.id

    const disabled = await client
      .patch(`${base}/${planId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ isActive: false })
    disabled.assertStatus(200)
    assert.isFalse(disabled.body().data.isActive)

    const inactiveOnly = await client
      .get(`${base}?isActive=false`)
      .header('Authorization', `Bearer ${token}`)
    inactiveOnly.assertStatus(200)
    assert.equal(inactiveOnly.body().meta.total, 1)

    const destroyed = await client
      .delete(`${base}/${planId}`)
      .header('Authorization', `Bearer ${token}`)
    destroyed.assertStatus(204)
  })

  test('部门树：根/子节点 path/depth 维护、跨层更新与删除守卫', async ({ assert, client }) => {
    const { owner } = await setupOwner()
    const token = await login(client, owner)

    const emptyTree = await client
      .get('/api/v1/departments')
      .header('Authorization', `Bearer ${token}`)
    emptyTree.assertStatus(200)
    assert.deepEqual(emptyTree.body().data, [])

    const root = await client
      .post('/api/v1/departments')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '研发中心', code: 'RND', description: '研发组织' })
    root.assertStatus(201)
    assert.equal(root.body().data.depth, 0)
    assert.equal(root.body().data.path, `/${root.body().data.id}/`)

    const child = await client
      .post('/api/v1/departments')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '前端工程组', code: 'FE', parentId: root.body().data.id })
    child.assertStatus(201)
    assert.equal(child.body().data.depth, 1)
    assert.equal(child.body().data.path, `/${root.body().data.id}/${child.body().data.id}/`)

    const renamed = await client
      .patch(`/api/v1/departments/${root.body().data.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '研发与创新中心' })
    renamed.assertStatus(200)
    assert.equal(renamed.body().data.name, '研发与创新中心')

    // 删除存在子部门的根节点 → 422
    const blocked = await client
      .delete(`/api/v1/departments/${root.body().data.id}`)
      .header('Authorization', `Bearer ${token}`)
    blocked.assertStatus(422)

    const tree = await client.get('/api/v1/departments').header('Authorization', `Bearer ${token}`)
    tree.assertStatus(200)
    assert.lengthOf(tree.body().data, 1)
    assert.lengthOf(tree.body().data[0].children, 1)

    const removed = await client
      .delete(`/api/v1/departments/${child.body().data.id}`)
      .header('Authorization', `Bearer ${token}`)
    removed.assertStatus(204)
    const removedRoot = await client
      .delete(`/api/v1/departments/${root.body().data.id}`)
      .header('Authorization', `Bearer ${token}`)
    removedRoot.assertStatus(204)
  })

  test('度量聚合端点：RACI / OBS / EVM / S 曲线 / 燃尽 / LOB / SPC / 帕累托', async ({
    assert,
    client,
  }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const pid = project.id

    // 数据种子：部门 + 任务（RACI/LOB/SPC/EVM 输入）+ 议题（帕累托输入）
    const dept = await client
      .post('/api/v1/departments')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '工程部', code: 'ENG' })
    const deptId = dept.body().data.id

    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const day = (offsetDays: number) =>
      DateTime.fromJSDate(new Date(today.getTime() + offsetDays * 86400000))
    const pastStart = day(-10)
    const pastEnd = day(-2)

    await Task.create({
      projectId: pid,
      name: '多轮问答',
      status: 'completed',
      priority: 'medium',
      taskType: 'task',
      assigneeId: owner.id,
      startDate: pastStart,
      endDate: pastEnd,
      actualStartDate: pastStart,
      actualEndDate: pastEnd,
      costEstimateCents: 10000,
      costActualCents: 8000,
      progressPercent: 100,
      isCriticalPath: false,
      isOnLongestPath: false,
    })
    const runningTask = await Task.create({
      projectId: pid,
      name: '流水施工-结构',
      status: 'in_progress',
      priority: 'medium',
      taskType: 'task',
      locationUnit: 'Floor-1',
      cycleStage: '结构施工',
      assigneeId: owner.id,
      startDate: day(-3),
      endDate: day(4),
      costEstimateCents: 20000,
      progressPercent: 40,
      isCriticalPath: false,
      isOnLongestPath: false,
    })
    await Task.create({
      projectId: pid,
      name: '流水施工-水电',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      locationUnit: 'Floor-1',
      cycleStage: '水电预埋',
      assigneeId: owner.id,
      startDate: day(5),
      endDate: day(9),
      costEstimateCents: 15000,
      progressPercent: 0,
      isCriticalPath: false,
      isOnLongestPath: false,
    })

    await client
      .post(`/api/v1/projects/${pid}/issues`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '缺陷A', type: 'bug', severity: 'major' })
    await client
      .post(`/api/v1/projects/${pid}/issues`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '缺陷B', type: 'bug', severity: 'critical' })
    await client
      .post(`/api/v1/projects/${pid}/issues`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '阻塞C', type: 'blocker', severity: 'major' })

    // RACI：owner 为 R（assignee）+ A（reviewer），验证行/列打标
    runningTask.reviewerId = owner.id
    await runningTask.save()

    const raci = await client
      .get(`/api/v1/projects/${pid}/raci-matrix`)
      .header('Authorization', `Bearer ${token}`)
    raci.assertStatus(200)
    assert.isAbove(raci.body().data.tasks.length, 0)
    assert.isTrue(raci.body().data.matrix[runningTask.id]?.[owner.id]?.includes('R'))
    assert.isTrue(raci.body().data.matrix[runningTask.id]?.[owner.id]?.includes('A'))

    const obs = await client
      .get(`/api/v1/projects/${pid}/obs-tree`)
      .header('Authorization', `Bearer ${token}`)
    obs.assertStatus(200)
    assert.lengthOf(obs.body().data, 1)
    assert.equal(obs.body().data[0].id, deptId)

    const evm = await client
      .get(`/api/v1/projects/${pid}/metrics/evm?asOfDate=${iso(today)}`)
      .header('Authorization', `Bearer ${token}`)
    evm.assertStatus(200)
    assert.equal(typeof evm.body().data.bac, 'number')
    assert.equal(typeof evm.body().data.ev, 'number')
    assert.isTrue(['on_track', 'ahead', 'delayed'].includes(evm.body().data.scheduleStatus))

    const curve = await client
      .get(`/api/v1/projects/${pid}/metrics/evm/s-curve`)
      .header('Authorization', `Bearer ${token}`)
    curve.assertStatus(200)
    assert.isArray(curve.body().data.points)

    const burndown = await client
      .get(`/api/v1/projects/${pid}/metrics/burndown?metric=task`)
      .header('Authorization', `Bearer ${token}`)
    burndown.assertStatus(200)
    assert.equal(burndown.body().data.metric, 'task')

    const lob = await client
      .get(`/api/v1/projects/${pid}/metrics/lob`)
      .header('Authorization', `Bearer ${token}`)
    lob.assertStatus(200)
    assert.deepEqual(lob.body().data.units, ['Floor-1'])
    assert.deepEqual(lob.body().data.stages, ['结构施工', '水电预埋'])

    const spc = await client
      .get(`/api/v1/projects/${pid}/metrics/control-chart?metric=cycle_time`)
      .header('Authorization', `Bearer ${token}`)
    spc.assertStatus(200)
    assert.equal(spc.body().data.summary.metric, 'cycle_time')

    const pareto = await client
      .get(`/api/v1/projects/${pid}/metrics/pareto?dimension=issue_type`)
      .header('Authorization', `Bearer ${token}`)
    pareto.assertStatus(200)
    assert.equal(pareto.body().data.totalCount, 3)
    assert.equal(pareto.body().data.items[0].category, 'bug')
  })

  test('度量端点非法参数 → 422', async ({ client }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const pid = project.id

    const badEvm = await client
      .get(`/api/v1/projects/${pid}/metrics/evm?asOfDate=not-a-date`)
      .header('Authorization', `Bearer ${token}`)
    badEvm.assertStatus(422)

    const badBurndown = await client
      .get(`/api/v1/projects/${pid}/metrics/burndown?metric=story`)
      .header('Authorization', `Bearer ${token}`)
    badBurndown.assertStatus(422)

    const badPareto = await client
      .get(`/api/v1/projects/${pid}/metrics/pareto?dimension=issue_owner`)
      .header('Authorization', `Bearer ${token}`)
    badPareto.assertStatus(422)
  })

  test('任务 PATCH 放行 RACI/LOB 字段（consulted/informed/locationUnit/cycleStage）', async ({
    assert,
    client,
  }) => {
    const { owner, project } = await setupOwner()
    const token = await login(client, owner)
    const task = await makeTask(project.id, 'RACI 配置任务')
    const taskPath = `/api/v1/projects/${project.id}/tasks/${task.id}`

    const res = await client
      .patch(taskPath)
      .header('Authorization', `Bearer ${token}`)
      .json({
        consultedUserIds: [owner.id],
        informedUserIds: [],
        locationUnit: 'Zone-B',
        cycleStage: '二次装修',
      })
    res.assertStatus(200)
    assert.deepEqual(res.body().data.consultedUserIds, [owner.id])
    assert.equal(res.body().data.locationUnit, 'Zone-B')
    assert.equal(res.body().data.cycleStage, '二次装修')

    // 跨组织成员注入 → 服务层组织边界校验（422，RL-05 双重拦截）
    const outsider = await createUser({ email: uniqueEmail('gallery-foreign-id') })
    const injected = await client
      .patch(taskPath)
      .header('Authorization', `Bearer ${token}`)
      .json({ consultedUserIds: [outsider.id] })
    injected.assertStatus(422)
  })
})
