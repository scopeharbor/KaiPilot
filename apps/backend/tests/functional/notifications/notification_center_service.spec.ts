import Notification from '#models/notification'
import NotificationService, {
  TYPE_GROUP_MAP,
  TYPE_GROUP_LABELS,
  getTypeGroup,
} from '#services/notification_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { useAuthDatabase, createUser, createOrganization } from '../auth/_helpers.js'

/**
 * V2 通知中心 Service 测试：
 * - 类型组映射
 * - 筛选组合（状态 + 类型组 + 项目 + 时间范围）
 * - 隐藏默认过滤
 * - 稳定排序
 * - 批量操作幂等
 */
test.group('通知中心 Service', (group) => {
  useAuthDatabase(group)

  async function svc() {
    const { default: App } = await import('@adonisjs/core/services/app')
    return App.container.make(NotificationService)
  }

  test('类型组映射关系完整', async ({ assert }) => {
    // 每个通知类型都应有类型组映射
    assert.equal(TYPE_GROUP_MAP['task_assigned'], 'assignments')
    assert.equal(TYPE_GROUP_MAP['task_unassigned'], 'assignments')
    assert.equal(TYPE_GROUP_MAP['comment_added'], 'mentions')
    assert.equal(TYPE_GROUP_MAP['attachment_added'], 'system')
    assert.equal(TYPE_GROUP_MAP['project_archived'], 'system')
    assert.equal(TYPE_GROUP_MAP['project_restored'], 'system')
    assert.equal(TYPE_GROUP_MAP['milestone_due'], 'system')
    assert.equal(TYPE_GROUP_MAP['milestone_overdue'], 'system')
    assert.equal(TYPE_GROUP_MAP['ai_draft_confirmed'], 'approvals')
    assert.equal(TYPE_GROUP_MAP['ai_draft_imported'], 'approvals')
    assert.equal(TYPE_GROUP_MAP['report_exported'], 'system')
    assert.equal(TYPE_GROUP_MAP['report_export_failed'], 'system')
    assert.equal(TYPE_GROUP_MAP['general'], 'system')
  })

  test('类型组中文标签完整', async ({ assert }) => {
    assert.equal(TYPE_GROUP_LABELS['all'], '全部')
    assert.equal(TYPE_GROUP_LABELS['unread'], '未读')
    assert.equal(TYPE_GROUP_LABELS['mentions'], '@提及')
    assert.equal(TYPE_GROUP_LABELS['assignments'], '任务')
    assert.equal(TYPE_GROUP_LABELS['approvals'], '审批')
    assert.equal(TYPE_GROUP_LABELS['system'], '系统')
  })

  test('getTypeGroup 返回正确分组', async ({ assert }) => {
    assert.equal(getTypeGroup('task_assigned'), 'assignments')
    assert.equal(getTypeGroup('comment_added'), 'mentions')
    assert.equal(getTypeGroup('report_exported'), 'system')
    assert.equal(getTypeGroup('ai_draft_confirmed'), 'approvals')
    assert.equal(getTypeGroup('general'), 'system')
  })

  test('listForUser 默认过滤隐藏通知', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    // 创建一条可见和一条隐藏通知
    await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '可见通知',
      severity: 'info',
    })
    const hidden = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '隐藏通知',
      severity: 'info',
    })
    await hidden.merge({ hiddenAt: DateTime.now() }).save()

    const result = await service.listForUser(Number(org.id), owner.id, {}, 1, 20)
    assert.equal(result.meta.total, 1)
    assert.equal(result.data[0].title, '可见通知')
  })

  test('hidden=only 只返回隐藏通知', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '可见',
      severity: 'info',
    })
    const h = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '已隐藏',
      severity: 'info',
    })
    await h.merge({ hiddenAt: DateTime.now() }).save()

    const result = await service.listForUser(Number(org.id), owner.id, { hidden: 'only' }, 1, 20)
    assert.equal(result.meta.total, 1)
    assert.equal(result.data[0].title, '已隐藏')
  })

  test('stableSort 按 created_at desc, id desc 排序', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    // 创建三条通知（同一时间精度确保 id 降序生效）
    const n1 = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '通知C',
      severity: 'info',
    })
    const n2 = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '通知B',
      severity: 'info',
    })
    const n3 = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '通知A',
      severity: 'info',
    })

    const result = await service.listForUser(Number(org.id), owner.id, {}, 1, 20)
    assert.equal(result.meta.total, 3)
    // id 降序: n3 > n2 > n1
    assert.equal(result.data[0].title, '通知A')
    assert.equal(result.data[1].title, '通知B')
    assert.equal(result.data[2].title, '通知C')
    void n1
    void n2
    void n3
  })

  test('typeGroup 过滤正确', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '指派通知',
      severity: 'info',
    })
    await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'comment_added',
      title: '评论通知',
      severity: 'info',
    })
    await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'report_exported',
      title: '系统通知',
      severity: 'info',
    })

    const assignments = await service.listForUser(
      Number(org.id),
      owner.id,
      { typeGroup: 'assignments' },
      1,
      20,
    )
    assert.equal(assignments.meta.total, 1)
    assert.equal(assignments.data[0].title, '指派通知')

    const mentions = await service.listForUser(
      Number(org.id),
      owner.id,
      { typeGroup: 'mentions' },
      1,
      20,
    )
    assert.equal(mentions.meta.total, 1)
    assert.equal(mentions.data[0].title, '评论通知')

    const system = await service.listForUser(
      Number(org.id),
      owner.id,
      { typeGroup: 'system' },
      1,
      20,
    )
    assert.equal(system.meta.total, 1)
    assert.equal(system.data[0].title, '系统通知')
  })

  test('批量标记已读幂等', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    const n1 = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '未读通知',
      severity: 'info',
    })

    // 第一次批量标记已读
    const r1 = await service.batchOperation(Number(org.id), owner.id, [n1.id], 'mark_read')
    assert.equal(r1.affectedCount, 1)

    // 第二次（幂等：已读的不会被再次标记）
    const r2 = await service.batchOperation(Number(org.id), owner.id, [n1.id], 'mark_read')
    assert.equal(r2.affectedCount, 0)
  })

  test('批量标记未读', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    const n1 = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '已读通知',
      severity: 'info',
      readAt: DateTime.now(),
    })

    const r = await service.batchOperation(Number(org.id), owner.id, [n1.id], 'mark_unread')
    assert.equal(r.affectedCount, 1)

    await n1.refresh()
    assert.isNull(n1.readAt)
  })

  test('批量隐藏', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    const n1 = await Notification.create({
      recipientId: owner.id,
      organizationId: Number(org.id),
      type: 'task_assigned',
      title: '待隐藏通知',
      severity: 'info',
    })

    const r = await service.batchOperation(Number(org.id), owner.id, [n1.id], 'hide')
    assert.equal(r.affectedCount, 1)

    await n1.refresh()
    assert.isNotNull(n1.hiddenAt)
  })

  test('generateTargetSummary 返回低敏摘要', async ({ assert }) => {
    const service = await svc()
    const summary = service.generateTargetSummary('task', {
      event: 'task_assigned',
      status: 'in_progress',
    })
    assert.equal(summary?.type, '任务')
    assert.equal(summary?.status, 'in_progress')
  })

  test('generateTargetSummary 无目标类型返回 null', async ({ assert }) => {
    const service = await svc()
    assert.isNull(service.generateTargetSummary(null, null))
  })

  test('幂等键重发更新已有通知：metadata 对象在 SQLite / PG 上都能写入并读回为对象', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = await svc()
    const base = {
      organizationId: org.id,
      recipientId: user.id,
      type: 'task_assigned' as const,
      title: '任务已指派给你',
      idempotencyKey: `meta-roundtrip-${Date.now()}`,
    }
    await service.createForUser({ ...base, metadata: { taskName: '第一次', projectId: 1 } })
    // 第二次命中幂等键，走「更新已有通知」分支（原先在 SQLite 上绑定对象报错）
    await service.createForUser({ ...base, metadata: { taskName: '第二次', projectId: 1 } })

    const rows = await Notification.query().where('idempotency_key', base.idempotencyKey)
    assert.lengthOf(rows, 1)
    assert.deepEqual(rows[0].metadata, { taskName: '第二次', projectId: 1 })
  })
})
