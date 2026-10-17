import Notification from '#models/notification'
import Organization from '#models/organization'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type User from '#models/user'
import { CanonicalRole, ProjectRoleName, ROLE_PERMISSIONS } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  orgBearer,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * 2026-09-25 企业团队演练发现的协同缺陷回归：
 * 项目经理（组织普通成员）能管任务、指派有通知、成员不能自改排期、改期沿依赖顺延、
 * 完成计 100% 并汇总项目进度、阻塞原因与通知、WBS 子树汇总、组织人数上限、AI 岗位筛选。
 */
async function setup() {
  const owner = await createUser({ email: uniqueEmail('collab-owner') })
  const org = await createOrganization(owner)
  const pm = await createUser({ email: uniqueEmail('collab-pm') })
  const member = await createUser({ email: uniqueEmail('collab-member') })
  await addOrgMember(org, pm, 'member')
  await addOrgMember(org, member, 'member')
  const { project } = await createProjectWithMember(
    org,
    owner,
    pm,
    ProjectRoleName.PROJECT_MANAGER,
    [...ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]],
  )
  const memberRole = await ProjectRole.create({
    projectId: project.id,
    name: ProjectRoleName.MEMBER,
    description: '成员',
    permissions: [...ROLE_PERMISSIONS[CanonicalRole.MEMBER]] as unknown as string[],
    isSystem: true,
  })
  await ProjectMember.create({
    projectId: project.id,
    userId: member.id,
    projectRoleId: memberRole.id,
    isActive: true,
  })
  const t1 = await Task.create({
    projectId: project.id,
    name: '账户服务现状梳理',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: DateTime.fromISO('2026-10-12'),
    endDate: DateTime.fromISO('2026-10-16'),
    durationDays: 5,
    assigneeId: member.id,
    aiMetadata: JSON.stringify({ assigneeHint: '后端开发' }) as never,
  })
  const t2 = await Task.create({
    projectId: project.id,
    name: '账户需求规则定义',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: DateTime.fromISO('2026-10-19'),
    endDate: DateTime.fromISO('2026-10-21'),
    durationDays: 3,
    assigneeId: member.id,
    aiMetadata: JSON.stringify({ assigneeHint: '测试' }) as never,
  })
  await TaskDependency.create({
    predecessorId: t1.id,
    successorId: t2.id,
    type: 'fs',
    lagDays: 0,
  })
  return { owner, org, pm, member, project, t1, t2 }
}

async function notificationsOf(user: User, type: string) {
  return Notification.query().where('recipient_id', user.id).where('type', type)
}

test.group('团队协同：项目经理 / 成员 / 通知 / 汇总', (group) => {
  useAuthDatabase(group)

  test('组织普通成员被设为项目经理：本项目内可改任务、指派，有效权限接口返回下放权限', async ({
    client,
    assert,
  }) => {
    const { org, pm, member, project, t1 } = await setup()
    const auth = await orgBearer(pm, org.id)

    const perms = await client
      .get(`/api/v1/projects/${project.id}/my-permissions`)
      .header('Authorization', auth)
    perms.assertStatus(200)
    assert.includeMembers(perms.body().data.permissions, ['task:update', 'task:assign'])

    const reassign = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${t1.id}`)
      .header('Authorization', auth)
      .json({ assigneeId: pm.id })
    reassign.assertStatus(200)
    assert.lengthOf(await notificationsOf(pm, 'task_assigned'), 0, '指派给自己不发通知')
    assert.lengthOf(await notificationsOf(member, 'task_unassigned'), 1, '原负责人收到取消指派通知')

    const back = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${t1.id}`)
      .header('Authorization', auth)
      .json({ assigneeId: member.id })
    back.assertStatus(200)
    assert.lengthOf(await notificationsOf(member, 'task_assigned'), 1, '新负责人收到指派通知')
  })

  test('成员可推进自己任务的进度，但不能自行改排期（需项目经理）', async ({ client, assert }) => {
    const { org, member, project, t1 } = await setup()
    const auth = await orgBearer(member, org.id)

    const progress = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${t1.id}`)
      .header('Authorization', auth)
      .json({ progressPercent: 40, startDate: '2026-10-12' })
    progress.assertStatus(200)

    const slip = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${t1.id}`)
      .header('Authorization', auth)
      .json({ endDate: '2026-10-21' })
    slip.assertStatus(403)
    assert.include(slip.body().error.message, '项目经理')
    await t1.refresh()
    assert.equal(t1.endDate?.toISODate(), '2026-10-16')
  })

  test('项目经理推迟截止日：后续任务沿依赖自动顺延，负责人收到排期调整通知', async ({
    client,
    assert,
  }) => {
    const { org, pm, member, project, t1, t2 } = await setup()
    const response = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${t1.id}`)
      .header('Authorization', await orgBearer(pm, org.id))
      .json({ endDate: '2026-10-21', durationDays: 8 })
    response.assertStatus(200)
    assert.isTrue(
      (response.body().meta.warnings as string[]).some((w) => w.includes('顺延')),
      '响应提示已顺延后续任务',
    )
    await t2.refresh()
    assert.isTrue(t2.startDate!.toISODate()! > '2026-10-21', '后续任务开始日晚于新截止日')
    const scheduleNotices = await notificationsOf(member, 'task_schedule_changed')
    assert.isAtLeast(scheduleNotices.length, 1)
  })

  test('看板完成：进度记 100%、项目总进度汇总、项目经理收到完成通知', async ({
    client,
    assert,
  }) => {
    const { org, pm, member, project, t1 } = await setup()
    const auth = await orgBearer(member, org.id)
    for (const targetColumn of ['in_progress', 'completed']) {
      const moved = await client
        .post(`/api/v1/projects/${project.id}/kanban/move`)
        .header('Authorization', auth)
        .json({ taskId: t1.id, targetColumn })
      moved.assertStatus(200)
    }
    await t1.refresh()
    assert.equal(t1.status, 'completed')
    assert.equal(t1.progressPercent, 100)
    const refreshed = await Project.findOrFail(project.id)
    assert.isAbove(Number(refreshed.progressPercent), 0)
    assert.lengthOf(await notificationsOf(pm, 'task_completed'), 1)
  })

  test('前置未完成就开工：响应带提示；标记阻塞：记录原因并通知项目经理', async ({
    client,
    assert,
  }) => {
    const { org, pm, member, project, t2 } = await setup()
    const auth = await orgBearer(member, org.id)
    const start = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', auth)
      .json({ taskId: t2.id, targetColumn: 'in_progress' })
    start.assertStatus(200)
    assert.isTrue((start.body().meta.warnings as string[]).some((w) => w.includes('还没完成')))
    assert.lengthOf(await notificationsOf(pm, 'task_predecessor_pending'), 1)

    const blocked = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', auth)
      .json({
        taskId: t2.id,
        targetColumn: 'other',
        targetStatus: 'blocked',
        note: '等待 DBA 库表评审',
      })
    blocked.assertStatus(200)
    assert.equal(blocked.body().data.customFields.blockedReason, '等待 DBA 库表评审')
    const notices = await notificationsOf(pm, 'task_blocked')
    assert.lengthOf(notices, 1)
    assert.include(notices[0]!.body ?? '', '等待 DBA 库表评审')
  })

  test('看板拖动联动（2026-09-29）：晚开工顺延排期并带动后续；完成勾满步骤；重开取消最后一步；退回待处理清零', async ({
    client,
    assert,
  }) => {
    const { org, member, project, t1, t2 } = await setup()
    const auth = await orgBearer(member, org.id)
    // 计划两周前就该开工
    const today = DateTime.now().setZone('Asia/Shanghai').toISODate()!
    t1.startDate = DateTime.fromISO(today).minus({ days: 14 })
    t1.endDate = DateTime.fromISO(today).minus({ days: 10 })
    t1.customFields = { execution: { steps: ['读代码', '画现状图', '写结论'] } }
    await t1.save()
    t2.startDate = DateTime.fromISO(today).minus({ days: 7 })
    t2.endDate = DateTime.fromISO(today).minus({ days: 5 })
    await t2.save()
    const move = (taskId: number, targetColumn: string) =>
      client
        .post(`/api/v1/projects/${project.id}/kanban/move`)
        .header('Authorization', auth)
        .json({ taskId, targetColumn })

    const start = await move(t1.id, 'in_progress')
    start.assertStatus(200)
    assert.isTrue((start.body().meta.warnings as string[]).some((w) => w.includes('晚开工')))
    await t1.refresh()
    await t2.refresh()
    assert.isTrue(t1.startDate!.toISODate()! >= today, '开工日顺延到今天（或下一个工作日）')
    assert.equal(t1.durationDays, 5, '工期不变')
    assert.isTrue(t2.startDate!.toISODate()! > t1.endDate!.toISODate()!, '后续任务沿依赖顺延')

    const done = await move(t1.id, 'completed')
    done.assertStatus(200)
    await t1.refresh()
    const execution = () => (t1.customFields as { execution: { stepsDone: boolean[] } }).execution
    assert.deepEqual(execution().stepsDone, [true, true, true])
    assert.equal(t1.progressPercent, 100)

    const reopen = await move(t1.id, 'in_progress')
    reopen.assertStatus(200)
    await t1.refresh()
    assert.deepEqual(execution().stepsDone, [true, true, false])
    assert.equal(t1.progressPercent, 67)

    const back = await move(t1.id, 'pending')
    back.assertStatus(200)
    await t1.refresh()
    assert.deepEqual(execution().stepsDone, [false, false, false])
    assert.equal(t1.progressPercent, 0)
    assert.isNull(t1.actualStartDate)
  })

  test('WBS 工作包汇总其下全部任务：一个阻塞则整包显示受阻，起止取全体范围', async ({
    client,
    assert,
  }) => {
    const { org, pm, project, t1, t2 } = await setup()
    const auth = await orgBearer(pm, org.id)
    const node = await client
      .post(`/api/v1/projects/${project.id}/wbs/nodes`)
      .header('Authorization', auth)
      .json({ name: '账户服务需求梳理', taskId: t1.id })
    node.assertStatus(201)
    const nodeId = node.body().data.id
    await Task.query().whereIn('id', [t1.id, t2.id]).update({ wbs_node_id: nodeId })
    await Task.query().where('id', t1.id).update({ status: 'completed' })
    await Task.query().where('id', t2.id).update({ status: 'blocked' })

    const tree = await client
      .get(`/api/v1/projects/${project.id}/wbs-tree?include=task`)
      .header('Authorization', auth)
    tree.assertStatus(200)
    const row = (tree.body().data as Array<{ id: number; rollup?: Record<string, unknown> }>).find(
      (n) => n.id === nodeId,
    )
    assert.deepInclude(row?.rollup, {
      status: 'blocked',
      taskCount: 2,
      completedCount: 1,
      blockedCount: 1,
      startDate: '2026-10-12',
      endDate: '2026-10-21',
    })
  })

  test('按 AI 建议岗位筛选任务，岗位清单计数', async ({ client, assert }) => {
    const { org, pm, project, t1 } = await setup()
    const auth = await orgBearer(pm, org.id)
    const list = await client
      .get(`/api/v1/projects/${project.id}/tasks?roleHint=${encodeURIComponent('后端')}`)
      .header('Authorization', auth)
    list.assertStatus(200)
    assert.deepEqual(
      list.body().data.map((t: { id: number }) => t.id),
      [t1.id],
    )
    assert.equal(list.body().data[0].roleHint, '后端开发')

    const hints = await client
      .get(`/api/v1/projects/${project.id}/tasks/role-hints`)
      .header('Authorization', auth)
    hints.assertStatus(200)
    assert.sameDeepMembers(hints.body().data, [
      { role: '后端开发', count: 1 },
      { role: '测试', count: 1 },
    ])
  })

  test('组织人数达到上限后再邀请 → 422 并说明上限', async ({ client, assert }) => {
    const { owner, org } = await setup()
    await Organization.query().where('id', org.id).update({ max_members: 3 })
    const outsider = await createUser({ email: uniqueEmail('collab-outsider') })
    const response = await client
      .post(`/api/v1/organizations/${org.id}/members/invite`)
      .header('Authorization', await orgBearer(owner, org.id))
      .json({ email: outsider.email, role: 'member' })
    response.assertStatus(422)
    assert.include(response.body().error.message, '上限 3 人')
  })
})
