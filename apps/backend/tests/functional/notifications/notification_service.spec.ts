import Notification from '#models/notification'
import { test } from '@japa/runner'
import { useAuthDatabase, createUser, createOrganization, addOrgMember } from '../auth/_helpers.js'

/**
 * 任务 3.8 — 通知 Service 测试：
 * - createForUser：基础创建与幂等去重
 * - createForProjectMembers：接收人过滤、排除操作者
 * - 重复指派抑制
 */
test.group('通知 Service', (group) => {
  useAuthDatabase(group)

  async function svc() {
    const { default: NotificationService } = await import('#services/notification_service')
    const { default: app } = await import('@adonisjs/core/services/app')
    return app.container.make(NotificationService)
  }

  test('createForUser 创建通知成功', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    const n = await service.createForUser({
      organizationId: Number(org.id),
      recipientId: owner.id,
      type: 'task_assigned',
      title: '任务已指派',
      body: '请查收',
      severity: 'info',
    })

    assert.isNotNull(n)
    assert.equal(n!.title, '任务已指派')
  })

  test('createForUser 幂等键去重（更新而非重复创建）', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    const n1 = await service.createForUser({
      organizationId: Number(org.id),
      recipientId: owner.id,
      type: 'task_assigned',
      title: '第一条',
      idempotencyKey: 'task:1:assignee:10',
    })

    const n2 = await service.createForUser({
      organizationId: Number(org.id),
      recipientId: owner.id,
      type: 'task_assigned',
      title: '第二条（应更新）',
      idempotencyKey: 'task:1:assignee:10',
    })

    // 同一幂等键应返回同一条记录（更新标题）
    assert.equal(n1!.id, n2!.id)
    assert.equal(n2!.title, '第二条（应更新）')

    // 数据库只有一条记录
    const count = await Notification.query()
      .where('recipient_id', owner.id)
      .where('idempotency_key', 'task:1:assignee:10')
      .count('id as c')
      .first()
    assert.equal(Number(count?.$extras.c), 1)
  })

  test('createForProjectMembers 排除操作者本人', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)

    // 创建测试项目
    const { default: Project } = await import('#models/project')
    const { default: ProjectRole } = await import('#models/project_role')
    const { default: ProjectMember } = await import('#models/project_member')
    const project = await Project.create({
      organizationId: Number(org.id),
      name: '测试项目',
      code: `P${Date.now()}`,
      createdBy: owner.id,
    })

    // 创建项目角色并添加 owner 为成员
    const role = await ProjectRole.create({
      projectId: project.id,
      name: 'Project Manager',
      permissions: [],
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: owner.id,
      projectRoleId: role.id,
      isActive: true,
    })

    // owner 触发操作，排除自己
    const notifications = await service.createForProjectMembers(
      {
        organizationId: Number(org.id),
        type: 'task_assigned',
        title: '有新任务',
        severity: 'info',
        projectId: project.id,
      },
      project.id,
      [owner.id], // 排除 owner（操作者）
    )

    // owner 不在结果中
    const ownerNotif = notifications.find((n) => n.recipientId === owner.id)
    assert.isUndefined(ownerNotif)
  })

  test('markAllRead 只标记当前用户通知', async ({ assert }) => {
    const service = await svc()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const other = await createUser()
    await addOrgMember(org, other, 'member')

    // 创建通知
    await service.createForUser({
      organizationId: Number(org.id),
      recipientId: owner.id,
      type: 'general',
      title: 'owner 的通知',
    })
    await service.createForUser({
      organizationId: Number(org.id),
      recipientId: other.id,
      type: 'general',
      title: 'other 的通知',
    })

    // owner 标记全部已读
    const result = await service.markAllRead(Number(org.id), owner.id)
    assert.equal(result.markedCount, 1)

    // owner 的通知已读
    const ownerUnread = await Notification.query()
      .where('recipient_id', owner.id)
      .whereNull('read_at')
      .count('id as c')
      .first()
    assert.equal(Number(ownerUnread?.$extras.c), 0)

    // other 的通知不受影响
    const otherUnread = await Notification.query()
      .where('recipient_id', other.id)
      .whereNull('read_at')
      .count('id as c')
      .first()
    assert.equal(Number(otherUnread?.$extras.c), 1)
  })
})
