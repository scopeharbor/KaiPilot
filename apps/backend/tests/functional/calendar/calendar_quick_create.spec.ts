// 日历快速新建的 AI 补全端点：规则补全（空输入建议 / 一句话拆多条 / 拖曳范围）、冲突重算、模型不可用退回规则、组织隔离。
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import AuditLog from '#models/audit_log'
import Task from '#models/task'
import Milestone from '#models/milestone'
import WbsNode from '#models/wbs_node'
import ProjectMember from '#models/project_member'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  orgBearer,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

const URL = (projectId: number) => `/api/v1/projects/${projectId}/tasks/calendar-suggest`

test.group('日历快速新建 · AI 补全端点', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('qc-owner'), fullName: '王经理' })
    const dev = await createUser({ email: uniqueEmail('qc-dev'), fullName: '李开发' })
    const org = await createOrganization(owner)
    const { project, role } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await ProjectMember.create({
      projectId: project.id,
      userId: dev.id,
      projectRoleId: role.id,
      isActive: true,
    })
    project.startDate = DateTime.fromISO('2026-10-01')
    project.endDate = DateTime.fromISO('2026-12-31')
    await project.save()

    // 汇总节点（有子工作包）不算 WBS 缺口
    const root = await WbsNode.create({
      projectId: project.id,
      code: '1',
      name: '食堂订餐',
      depth: 0,
      isLeaf: false,
      collapsed: false,
      displayOrder: 0,
    })
    const busy = await WbsNode.create({
      projectId: project.id,
      parentId: root.id,
      code: '1.1',
      name: '订单导出',
      depth: 1,
      isLeaf: true,
      collapsed: false,
      displayOrder: 0,
    })
    await WbsNode.create({
      projectId: project.id,
      parentId: root.id,
      code: '1.2',
      name: '数据迁移',
      depth: 1,
      isLeaf: true,
      collapsed: false,
      displayOrder: 1,
    })
    // 王经理这段时间已有 3 件进行中的任务（过载）；「订单导出」已有任务，「数据迁移」是 WBS 缺口
    for (const name of ['评审需求', '排期会议', '验收准备']) {
      await Task.create({
        projectId: project.id,
        name,
        status: 'in_progress',
        priority: 'medium',
        taskType: 'task',
        assigneeId: owner.id,
        progressPercent: 0,
        wbsNodeId: busy.id,
        startDate: DateTime.fromISO('2026-10-12'),
        endDate: DateTime.fromISO('2026-10-16'),
      })
    }
    await Milestone.create({
      projectId: project.id,
      name: '内测上线',
      status: 'not_started',
      plannedDate: DateTime.fromISO('2026-10-20'),
      displayOrder: 1,
      autoCalculated: false,
    })
    const auth = await orgBearer(owner, org.id)
    return { owner, dev, org, project, auth }
  }

  test('空输入（规则）：从 WBS 缺口与临近里程碑给建议，负责人选负载最轻的并附理由', async ({
    client,
    assert,
  }) => {
    const { project, auth, dev } = await setup()
    const res = await client
      .post(URL(project.id))
      .header('Authorization', auth)
      .json({ startDate: '2026-10-12', ai: false })
    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.source, 'rules')
    const names = data.tasks.map((task: { name: string }) => task.name)
    assert.include(names, '启动数据迁移：拆出第一批任务')
    assert.include(names, '内测上线前的验收检查')
    assert.notInclude(names, '启动食堂订餐：拆出第一批任务')
    const first = data.tasks[0]
    assert.equal(first.assigneeId, dev.id)
    assert.equal(first.assigneeName, '李开发')
    assert.match(first.assigneeReason, /任务最少/)
    assert.equal(first.wbsNodeName, '1.2 数据迁移')
    assert.includeMembers(first.aiFields, ['name', 'dates', 'assignee', 'wbs', 'priority'])
    // 小卡片可改负责人 / 工作包的候选
    assert.sameMembers(
      data.options.members.map((item: { name: string }) => item.name),
      ['王经理', '李开发'],
    )
    assert.includeDeepMembers(data.options.workPackages, [
      { id: first.wbsNodeId, label: '1.2 数据迁移' },
    ])
  })

  test('一句话拆多条：按先后接排到下一个工作日；拖曳范围单条时起止用用户选的', async ({
    client,
    assert,
  }) => {
    const { project, auth } = await setup()
    const split = await client
      .post(URL(project.id))
      .header('Authorization', auth)
      .json({ startDate: '2026-10-16', text: '整理导出需求；开发导出接口', ai: false })
    split.assertStatus(200)
    const [a, b] = split.body().data.tasks
    assert.equal(a.name, '整理导出需求')
    assert.equal(a.startDate, '2026-10-16')
    // 10-16 周五 → 下一条跳过周末从 10-19 周一开始
    assert.equal(b.startDate, '2026-10-19')
    assert.equal(b.wbsNodeName, '1.1 订单导出')
    assert.notInclude(a.aiFields, 'name')

    const ranged = await client
      .post(URL(project.id))
      .header('Authorization', auth)
      .json({ startDate: '2026-10-12', endDate: '2026-10-14', text: '紧急：写回归测试', ai: false })
    const task = ranged.body().data.tasks[0]
    assert.equal(task.startDate, '2026-10-12')
    assert.equal(task.endDate, '2026-10-14')
    assert.equal(task.durationDays, 3)
    assert.equal(task.priority, 'highest')
    assert.notInclude(task.aiFields, 'dates')
  })

  test('check：用户改过卡片后重算冲突（过载 / 非工作日 / 跨里程碑 / 同名）', async ({
    client,
    assert,
  }) => {
    const { project, auth, owner } = await setup()
    const res = await client
      .post(URL(project.id))
      .header('Authorization', auth)
      .json({
        startDate: '2026-10-12',
        check: [
          {
            name: '评审需求',
            startDate: '2026-10-17',
            endDate: '2026-10-22',
            assigneeId: owner.id,
          },
        ],
      })
    res.assertStatus(200)
    const codes = res.body().data.conflicts[0].map((item: { code: string }) => item.code)
    assert.sameMembers(codes, ['overload', 'non_working', 'after_milestone', 'duplicate'])
  })

  test('没有可用模型：退回规则补全，仍返回可建的卡并说明', async ({ client, assert }) => {
    const { project, auth } = await setup()
    const res = await client
      .post(URL(project.id))
      .header('Authorization', auth)
      .json({ startDate: '2026-10-13', text: '准备内测数据' })
    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.source, 'rules')
    assert.match(data.note, /规则/)
    assert.equal(data.tasks[0].name, '准备内测数据')
  })

  test('确认建立：走正式建任务接口，审计记下来源与 AI 补的字段', async ({ client, assert }) => {
    const { project, auth, dev } = await setup()
    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', auth)
      .json({
        name: '盘点旧库表结构',
        startDate: '2026-10-12',
        endDate: '2026-10-13',
        assigneeId: dev.id,
        customFields: { source: 'calendar-quick-create', aiFields: ['name', 'assignee'] },
      })
    res.assertStatus(201)
    const log = await AuditLog.query()
      .where('entity_type', 'task')
      .where('entity_id', res.body().data.id)
      .where('action', 'create')
      .firstOrFail()
    const metadata =
      typeof log.metadata === 'string' ? JSON.parse(log.metadata) : (log.metadata as object)
    assert.containsSubset(metadata, {
      source: 'calendar-quick-create',
      aiFields: ['name', 'assignee'],
    })
  })

  test('组织隔离：别的组织的人拿不到这个项目', async ({ client, assert }) => {
    const { project } = await setup()
    const outsider = await createUser({ email: uniqueEmail('qc-out') })
    const otherOrg = await createOrganization(outsider)
    const res = await client
      .post(URL(project.id))
      .header('Authorization', await orgBearer(outsider, otherOrg.id))
      .json({ startDate: '2026-10-12', ai: false })
    assert.oneOf(res.status(), [403, 404])
  })
})
