import AuditLog from '#models/audit_log'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import MilestoneService, { deriveMilestoneDisplayStatus } from '#services/milestone_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/** 通知服务桩：不产生实际通知，仅满足 DI */
function mockNotificationService() {
  return {
    createForUser: async () => null,
    createForProjectMembers: async () => [],
    listForUser: async () => ({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    }),
    getUnreadCount: async () => ({ unreadCount: 0 }),
    markRead: async () => ({ success: true, readAt: '' }),
    markAllRead: async () => ({ success: true, markedCount: 0 }),
  } as never
}

test.group('MilestoneService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('milestone-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return {
      owner,
      org,
      project,
      service: new MilestoneService(new AuditService(), mockNotificationService()),
    }
  }

  // ---------------- CRUD ----------------

  test('create 默认 not_started、autoCalculated=false、displayOrder 自增，并写 MILESTONE_CREATED 审计', async ({
    assert,
  }) => {
    const { owner, org, project, service } = await setup()

    const first = await service.create(org.id, project.id, { name: '需求冻结' }, owner.id)
    const second = await service.create(org.id, project.id, { name: '设计评审' }, owner.id)

    assert.equal(first.status, 'not_started')
    assert.isFalse(first.autoCalculated)
    assert.equal(first.displayOrder, 0)
    assert.equal(second.displayOrder, 1)

    const logs = await AuditLog.query()
      .where('entity_type', 'milestone')
      .where('entity_id', first.id)
      .where('action', 'create')
    assert.isAbove(logs.length, 0)
  })

  test('create 非法状态归一为 not_started', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const m = await service.create(
      org.id,
      project.id,
      { name: '里程碑', status: 'bogus' },
      owner.id,
    )
    assert.equal(m.status, 'not_started')
  })

  test('update 修改字段与状态，delete 后列表不再包含', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const m = await service.create(org.id, project.id, { name: '旧名' }, owner.id)

    const updated = await service.update(
      org.id,
      project.id,
      m.id,
      { name: '新名', status: 'planned', plannedDate: '2026-09-01' },
      owner.id,
    )
    assert.equal(updated.name, '新名')
    assert.equal(updated.status, 'planned')
    assert.equal(updated.plannedDate?.toISODate(), '2026-09-01')

    await service.delete(org.id, project.id, m.id, owner.id)
    const { data } = await service.list(org.id, project.id)
    assert.isFalse(data.some((v) => v.milestone.id === m.id))
  })

  test('update 非法状态抛 ValidationException', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const m = await service.create(org.id, project.id, { name: '里程碑' }, owner.id)
    await assert.rejects(
      () => service.update(org.id, project.id, m.id, { status: 'bogus' }, owner.id),
      ValidationException,
    )
  })

  // ---------------- 排序 ----------------

  test('list 按 display_order → planned_date → id 稳定排序', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await service.create(
      org.id,
      project.id,
      { name: 'B', displayOrder: 2, plannedDate: '2026-01-01' },
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      { name: 'A', displayOrder: 1, plannedDate: '2026-06-01' },
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      { name: 'C', displayOrder: 1, plannedDate: '2026-03-01' },
      owner.id,
    )

    const { data, meta } = await service.list(org.id, project.id)
    // displayOrder 1(planned 03<06) → A? 不：display_order 相同再比 planned_date：C(03) 先于 A(06)
    assert.deepEqual(
      data.map((v) => v.milestone.name),
      ['C', 'A', 'B'],
    )
    assert.equal(meta.total, 3)
  })

  // ---------------- 状态推导三分支（纯函数） ----------------

  test('deriveMilestoneDisplayStatus：逾期未达成 → missed', ({ assert }) => {
    assert.equal(
      deriveMilestoneDisplayStatus('planned', '2020-01-01', { today: '2026-07-06' }),
      'missed',
    )
  })

  test('deriveMilestoneDisplayStatus：未逾期但项目预测完工晚于目标 → at_risk', ({ assert }) => {
    assert.equal(
      deriveMilestoneDisplayStatus('planned', '2026-09-01', {
        today: '2026-07-06',
        projectPredictedEnd: '2026-12-01',
      }),
      'at_risk',
    )
  })

  test('deriveMilestoneDisplayStatus：achieved 恒 sticky，逾期也不被 missed 覆盖', ({ assert }) => {
    assert.equal(
      deriveMilestoneDisplayStatus('achieved', '2020-01-01', {
        today: '2026-07-06',
        projectPredictedEnd: '2030-01-01',
      }),
      'achieved',
    )
  })

  test('deriveMilestoneDisplayStatus：无目标日期回落持久化态', ({ assert }) => {
    assert.equal(deriveMilestoneDisplayStatus('planned', null, { today: '2026-07-06' }), 'planned')
    // 未逾期且无项目预测完工 → 回落原态
    assert.equal(
      deriveMilestoneDisplayStatus('planned', '2999-01-01', { today: '2026-07-06' }),
      'planned',
    )
  })

  // ---------------- 状态推导（经 DB 列表口径） ----------------

  test('list 叠加展示态：逾期里程碑 displayStatus=missed 且 storedStatus 不变', async ({
    assert,
  }) => {
    const { owner, org, project, service } = await setup()
    const m = await service.create(
      org.id,
      project.id,
      { name: '逾期', status: 'planned', plannedDate: '2020-01-01' },
      owner.id,
    )
    const { data } = await service.list(org.id, project.id)
    const view = data.find((v) => v.milestone.id === m.id)!
    assert.equal(view.displayStatus, 'missed')
    assert.equal(view.storedStatus, 'planned')
    assert.isTrue(view.derived)
  })

  test('list 叠加展示态：项目预测完工晚于未来目标 → at_risk', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await Task.create({
      projectId: project.id,
      name: '晚完工任务',
      status: 'in_progress',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.fromISO('2999-06-01'),
    })
    const m = await service.create(
      org.id,
      project.id,
      { name: '风险', status: 'planned', plannedDate: '2999-01-01' },
      owner.id,
    )
    const { data } = await service.list(org.id, project.id)
    const view = data.find((v) => v.milestone.id === m.id)!
    assert.equal(view.displayStatus, 'at_risk')
    assert.equal(view.storedStatus, 'planned')
  })

  test('人工确认 achieved：写 MILESTONE_ACHIEVED 审计且列表不被推导覆盖', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const m = await service.create(
      org.id,
      project.id,
      { name: '已达成', status: 'planned', plannedDate: '2020-01-01' },
      owner.id,
    )
    // 逾期，但人工确认达成后应恒为 achieved
    await service.update(org.id, project.id, m.id, { status: 'achieved' }, owner.id)

    const achievedLogs = await AuditLog.query()
      .where('entity_type', 'milestone')
      .where('entity_id', m.id)
      .where('action', 'update')
    assert.isAbove(achievedLogs.length, 0)

    const { data } = await service.list(org.id, project.id)
    const view = data.find((v) => v.milestone.id === m.id)!
    assert.equal(view.displayStatus, 'achieved')
    assert.equal(view.storedStatus, 'achieved')
    assert.isFalse(view.derived)
  })

  // ---------------- 组织隔离 ----------------

  test('跨组织 findInOrgOrFail 抛 404（不泄露存在性）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const m = await service.create(org.id, project.id, { name: '隔离' }, owner.id)

    const otherOwner = await createUser({ email: uniqueEmail('other') })
    const otherOrg = await createOrganization(otherOwner)

    await assert.rejects(
      () => service.findInOrgOrFail(otherOrg.id, m.id),
      ResourceNotFoundException,
    )
    // 同组织可取
    const found = await service.findInOrgOrFail(org.id, m.id)
    assert.equal(found.id, m.id)
  })

  test('跨组织 list 抛 404（项目归属校验）', async ({ assert }) => {
    const { org, project } = await setup()
    const otherOwner = await createUser({ email: uniqueEmail('other') })
    const otherOrg = await createOrganization(otherOwner)
    const otherService = new MilestoneService(new AuditService(), mockNotificationService())

    await assert.rejects(
      () => otherService.list(otherOrg.id, project.id),
      ResourceNotFoundException,
    )
    // 断言 org 变量已使用（同组织 list 正常）
    const { meta } = await otherService.list(org.id, project.id)
    assert.equal(meta.total, 0)
  })

  test('create 以 achieved 创建写 MILESTONE_ACHIEVED 审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const m = await service.create(
      org.id,
      project.id,
      { name: '直接达成', status: 'achieved' },
      owner.id,
    )
    const logs = await AuditLog.query().where('entity_type', 'milestone').where('entity_id', m.id)
    // MILESTONE_CREATED(create) + MILESTONE_ACHIEVED(update action) 两条
    assert.isAtLeast(logs.length, 2)
  })

  test('update/delete 不存在的里程碑抛 404', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await assert.rejects(
      () => service.update(org.id, project.id, 999999, { name: 'x' }, owner.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.delete(org.id, project.id, 999999, owner.id),
      ResourceNotFoundException,
    )
  })

  test('listForProject 返回全部里程碑视图（不分页）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await service.create(org.id, project.id, { name: 'M1' }, owner.id)
    await service.create(org.id, project.id, { name: 'M2' }, owner.id)
    const views = await service.listForProject(org.id, project.id)
    assert.lengthOf(views, 2)
    assert.property(views[0]!, 'displayStatus')
  })
})
