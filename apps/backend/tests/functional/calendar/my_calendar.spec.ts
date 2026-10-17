// 日历第 3 批：个人工作日历（休假 / 个人工作日）、「我的日历」跨项目、快速新建避开休假。
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import AuditLog from '#models/audit_log'
import Task from '#models/task'
import ProjectMember from '#models/project_member'
import { ProjectRoleName } from '#rbac'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  orgBearer,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

function task(
  projectId: number,
  name: string,
  assigneeId: number | null,
  start: string,
  end = start,
) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    assigneeId,
    progressPercent: 0,
    startDate: DateTime.fromISO(start),
    endDate: DateTime.fromISO(end),
  })
}

test.group('日历第 3 批 · 个人工作日历与我的日历', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const me = await createUser({ email: uniqueEmail('mycal-me'), fullName: '李开发' })
    const boss = await createUser({ email: uniqueEmail('mycal-boss'), fullName: '王经理' })
    const org = await createOrganization(boss)
    await addOrgMember(org, me, 'member')
    const a = await createProjectWithMember(org, boss, boss, ProjectRoleName.PROJECT_MANAGER)
    const b = await createProjectWithMember(org, boss, boss, ProjectRoleName.PROJECT_MANAGER)
    const hidden = await createProjectWithMember(org, boss, boss, ProjectRoleName.PROJECT_MANAGER)
    a.project.name = '食堂订餐'
    await a.project.save()
    b.project.name = '官网改版'
    await b.project.save()
    for (const { project, role } of [a, b]) {
      await ProjectMember.create({
        projectId: project.id,
        userId: me.id,
        projectRoleId: role.id,
        isActive: true,
      })
    }
    return { me, boss, org, a: a.project, b: b.project, hidden: hidden.project }
  }

  test('个人工作日历：读默认为空，改了记审计，非法输入 422', async ({ client, assert }) => {
    const { me, org } = await setup()
    const auth = await orgBearer(me, org.id)
    const empty = await client.get('/api/v1/me/working-calendar').header('Authorization', auth)
    empty.assertStatus(200)
    assert.deepEqual(empty.body().data, { workdays: null, leaves: [] })

    const saved = await client
      .put('/api/v1/me/working-calendar')
      .header('Authorization', auth)
      .json({
        workdays: [1, 2, 3, 4, 5],
        leaves: [{ startDate: '2026-10-14', endDate: '2026-10-13', note: '体检' }],
      })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().data.leaves, [
      {
        id: '2026-10-13_2026-10-14_0',
        startDate: '2026-10-13',
        endDate: '2026-10-14',
        note: '体检',
      },
    ])
    const again = await client.get('/api/v1/me/working-calendar').header('Authorization', auth)
    assert.deepEqual(again.body().data.workdays, [1, 2, 3, 4, 5])

    const log = await AuditLog.query()
      .where('entity_type', 'user')
      .where('entity_id', me.id)
      .where('action', 'update')
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.isNotNull(log)

    const bad = await client
      .put('/api/v1/me/working-calendar')
      .header('Authorization', auth)
      .json({ workdays: [9], leaves: [] })
    bad.assertStatus(422)
  })

  test('我的日历：跨项目只列指派给我的任务（带项目名），不看非成员项目，附休假与项目清单', async ({
    client,
    assert,
  }) => {
    const { me, boss, org, a, b, hidden } = await setup()
    await task(a.id, '订单导出接口', me.id, '2026-10-12', '2026-10-13')
    await task(b.id, '首页改版', me.id, '2026-10-20')
    await task(a.id, '别人的任务', boss.id, '2026-10-12')
    await task(hidden.id, '看不到的项目里的任务', me.id, '2026-10-12')
    await task(a.id, '十二月的任务', me.id, '2026-12-01')
    const auth = await orgBearer(me, org.id)
    await client
      .put('/api/v1/me/working-calendar')
      .header('Authorization', auth)
      .json({ workdays: null, leaves: [{ startDate: '2026-10-15', endDate: '2026-10-16' }] })

    const res = await client
      .get('/api/v1/me/calendar')
      .qs({ dateFrom: '2026-10-01', dateTo: '2026-10-31' })
      .header('Authorization', auth)
    res.assertStatus(200)
    const body = res.body()
    assert.sameMembers(
      body.data.map(
        (item: { name: string; projectName: string }) => `${item.projectName}/${item.name}`,
      ),
      ['食堂订餐/订单导出接口', '官网改版/首页改版'],
    )
    assert.sameMembers(
      body.projects.map((item: { name: string }) => item.name),
      ['食堂订餐', '官网改版'],
    )
    assert.lengthOf(body.personalCalendar.leaves, 1)

    // 窗口里没有任务：给出前后最近的排期日
    const empty = await client
      .get('/api/v1/me/calendar')
      .qs({ dateFrom: '2026-11-01', dateTo: '2026-11-30' })
      .header('Authorization', auth)
    assert.deepEqual(empty.body().meta.nearestScheduled, {
      before: '2026-10-20',
      after: '2026-12-01',
    })
  })

  test('快速新建：成员休假时负责人改选这几天上班的人；指定休假的人会提示冲突', async ({
    client,
    assert,
  }) => {
    const { me, boss, org, a } = await setup()
    // 王经理手上任务多，正常会选李开发；李开发 10/12–10/13 休假
    await task(a.id, '评审', boss.id, '2026-10-12')
    await client
      .put('/api/v1/me/working-calendar')
      .header('Authorization', await orgBearer(me, org.id))
      .json({ workdays: null, leaves: [{ startDate: '2026-10-12', endDate: '2026-10-13' }] })

    const auth = await orgBearer(boss, org.id)
    const res = await client
      .post(`/api/v1/projects/${a.id}/tasks/calendar-suggest`)
      .header('Authorization', auth)
      .json({ startDate: '2026-10-12', text: '写导出接口', ai: false })
    res.assertStatus(200)
    assert.equal(res.body().data.tasks[0].assigneeId, boss.id)

    const later = await client
      .post(`/api/v1/projects/${a.id}/tasks/calendar-suggest`)
      .header('Authorization', auth)
      .json({ startDate: '2026-10-14', text: '写导出接口', ai: false })
    assert.equal(later.body().data.tasks[0].assigneeId, me.id)

    const check = await client
      .post(`/api/v1/projects/${a.id}/tasks/calendar-suggest`)
      .header('Authorization', auth)
      .json({
        startDate: '2026-10-12',
        check: [
          { name: '写导出接口', startDate: '2026-10-12', endDate: '2026-10-14', assigneeId: me.id },
        ],
      })
    assert.deepInclude(check.body().data.conflicts[0], {
      code: 'assignee_off',
      message: '李开发 10/12、10/13 休假或不上班',
    })
  })
})
