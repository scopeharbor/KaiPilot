import Comment from '#models/comment'
import CommentMention from '#models/comment_mention'
import OrganizationMember from '#models/organization_member'
import Risk from '#models/risk'
import Task from '#models/task'
import ChangeRequest from '#models/change_request'
import { ProjectRoleName } from '#rbac'
import CommentService from '#services/comment_service'
import CommentTargetResolver from '#services/comment_target_resolver'
import AuditService from '#services/audit_service'
import CommentNotificationService from '#services/comment_notification_service'
import NotificationService from '#services/notification_service'
import CommentPolicy from '#policies/comment_policy'
import RbacService from '#services/rbac_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

// ---------------------------------------------------------------------------
// V2 CommentService 单元测试 (tasks 2.8)
// ---------------------------------------------------------------------------

test.group('CommentService V2', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('cs-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const task = await Task.create({
      projectId: project.id,
      name: '评论测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '评论测试风险',
      description: '风险描述',
      category: 'technical',
      probability: 3,
      impact: 4,
      score: 12,
      status: 'identified',
      riskLevel: 'medium',
      priority: 'medium',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
    })
    const cr = await ChangeRequest.create({
      organizationId: org.id,
      projectId: project.id,
      changeType: 'scope',
      title: '评论测试变更请求',
      crCode: `CR-${Date.now()}`,
      priority: 'medium',
      status: 'draft',
    })
    const service = new CommentService(
      new AuditService(),
      new CommentTargetResolver(),
      new CommentNotificationService(new NotificationService()),
    )
    return { owner, org, project, task, risk, cr, service }
  }

  // ---------------------------------------------------------------------------
  // 2.4 创建实体评论
  // ---------------------------------------------------------------------------

  test('1. 创建实体评论（task）', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '任务评论正文' },
      owner.id,
    )

    assert.isNotNull(comment.id)
    assert.equal(comment.entityType, 'task')
    assert.equal(comment.entityId, task.id)
    assert.equal(comment.authorId, owner.id)
    assert.equal(comment.body, '任务评论正文')
    assert.equal(comment.status, 'open')
    assert.isNull(comment.parentId)
  })

  test('2. 创建实体评论（risk）', async ({ assert }) => {
    const { owner, org, project, risk, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'risk',
      risk.id,
      { body: '风险评论正文' },
      owner.id,
    )

    assert.isNotNull(comment.id)
    assert.equal(comment.entityType, 'risk')
    assert.equal(comment.entityId, risk.id)
    assert.equal(comment.body, '风险评论正文')
  })

  test('3. 创建实体评论（change_request）', async ({ assert }) => {
    const { owner, org, project, cr, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'change_request',
      cr.id,
      { body: '变更请求评论正文' },
      owner.id,
    )

    assert.isNotNull(comment.id)
    assert.equal(comment.entityType, 'change_request')
    assert.equal(comment.entityId, cr.id)
    assert.equal(comment.body, '变更请求评论正文')
  })

  // ---------------------------------------------------------------------------
  // 2.4 回复
  // ---------------------------------------------------------------------------

  test('4. 创建回复（parentId）', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const root = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '根评论' },
      owner.id,
    )

    const reply = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '一级回复', parentId: root.id },
      owner.id,
    )

    assert.isNotNull(reply.id)
    assert.equal(reply.parentId, root.id)
    assert.equal(reply.entityType, 'task')
  })

  test('5. 拒绝跨实体回复', async ({ assert }) => {
    const { owner, org, project, task, risk, service } = await setup()

    const root = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '任务根评论' },
      owner.id,
    )

    // 尝试在 risk 实体下回复 task 的根评论
    await assert.rejects(
      async () =>
        service.create(
          org.id,
          project.id,
          'risk',
          risk.id,
          { body: '跨实体回复', parentId: root.id },
          owner.id,
        ),
      ValidationException,
      '回复必须与父评论属于同一实体',
    )
  })

  test('6. 拒绝二级嵌套回复', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const root = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '根评论' },
      owner.id,
    )

    const reply1 = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '一级回复', parentId: root.id },
      owner.id,
    )

    // 尝试回复一级回复（二级嵌套）
    await assert.rejects(
      async () =>
        service.create(
          org.id,
          project.id,
          'task',
          task.id,
          { body: '二级嵌套回复', parentId: reply1.id },
          owner.id,
        ),
      ValidationException,
      '已回复的评论不能再回复，请直接在根评论下回复',
    )
  })

  test('7. 拒绝回复已删除评论', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const root = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '即将被删除的根评论' },
      owner.id,
    )

    // 软删除
    await service.softDelete(org.id, project.id, root.id, owner.id)

    // 尝试回复已删除的评论（软删除评论被默认作用域屏蔽，抛出 ResourceNotFoundException）
    await assert.rejects(
      async () =>
        service.create(
          org.id,
          project.id,
          'task',
          task.id,
          { body: '回复已删除评论', parentId: root.id },
          owner.id,
        ),
      ResourceNotFoundException,
      '回复的父评论不存在',
    )
  })

  // ---------------------------------------------------------------------------
  // 2.6 解决/重新打开
  // ---------------------------------------------------------------------------

  test('8. 解决根评论', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '待解决评论' },
      owner.id,
    )

    const resolved = await service.resolve(org.id, project.id, comment.id, owner.id)

    assert.equal(resolved.status, 'resolved')
    assert.equal(resolved.resolvedBy, owner.id)
    assert.isNotNull(resolved.resolvedAt)
  })

  test('9. 拒绝解决回复', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const root = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '根评论' },
      owner.id,
    )

    const reply = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '一级回复', parentId: root.id },
      owner.id,
    )

    await assert.rejects(
      async () => service.resolve(org.id, project.id, reply.id, owner.id),
      ValidationException,
      '只能解决根评论线程，不能单独解决回复',
    )
  })

  test('10. 重新打开已解决的评论', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '先解决再打开' },
      owner.id,
    )

    await service.resolve(org.id, project.id, comment.id, owner.id)
    const reopened = await service.reopen(org.id, project.id, comment.id, owner.id)

    assert.equal(reopened.status, 'open')
    assert.isNull(reopened.resolvedBy)
    assert.isNull(reopened.resolvedAt)
  })

  // ---------------------------------------------------------------------------
  // 2.5 编辑和软删除
  // ---------------------------------------------------------------------------

  test('11. 软删除评论', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '将被删除' },
      owner.id,
    )

    // 软删除不应抛出异常
    await service.softDelete(org.id, project.id, comment.id, owner.id)

    // service.getComment 的内部查询使用 Comment.query() + whereNull('deleted_at')
    // 因此软删除后 should throw ResourceNotFoundException
    await assert.rejects(
      async () => service.getComment(org.id, project.id, comment.id),
      ResourceNotFoundException,
    )
  })

  test('12. 编辑评论', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '原始内容', bodyFormat: 'plain' },
      owner.id,
    )

    const updated = await service.update(
      org.id,
      project.id,
      comment.id,
      { body: '编辑后的内容', bodyFormat: 'markdown' },
      owner.id,
    )

    assert.equal(updated.body, '编辑后的内容')
    assert.equal(updated.bodyFormat, 'markdown')
    assert.isNotNull(updated.editedAt)
  })

  test('13. 拒绝编辑已删除评论', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '将删后不能编辑' },
      owner.id,
    )

    await service.softDelete(org.id, project.id, comment.id, owner.id)

    // 软删除的评论被默认作用域屏蔽，commentOrFail 抛出 ResourceNotFoundException
    await assert.rejects(
      async () =>
        service.update(org.id, project.id, comment.id, { body: '试图编辑已删除评论' }, owner.id),
      ResourceNotFoundException,
      '评论不存在',
    )
  })

  // ---------------------------------------------------------------------------
  // 2.7 Mention
  // ---------------------------------------------------------------------------

  test('14. 创建提及', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const mentionedUser = await createUser({ email: uniqueEmail('mentioned1') })
    // v3-multitenant-database-isolation §6.1：被提及用户必须是本组织成员——
    // 原 fixture 只建了用户、没加入组织，而 `createMentions` 现在会整批拒绝组织外
    // 的 user id（否则他租用户会收到提及通知，且其 full_name/email 会随
    // `preload('mentions')` 回传给本组织）。
    await addOrgMember(org, mentionedUser, 'member')

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '包含 @提及', mentions: [mentionedUser.id] },
      owner.id,
    )

    const mentions = await CommentMention.query().where('comment_id', comment.id)
    assert.lengthOf(mentions, 1)
    assert.equal(mentions[0]!.mentionedUserId, mentionedUser.id)
  })

  test('15. 提及去重（同一用户出现两次）', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '重复提及', mentions: [owner.id, owner.id] },
      owner.id,
    )

    const mentions = await CommentMention.query().where('comment_id', comment.id)
    // owner.id 只出现一次，尽管被传了两次
    assert.lengthOf(mentions, 1)
  })

  // ---------------------------------------------------------------------------
  // 2.3 列表
  // ---------------------------------------------------------------------------

  test('16. 列出实体评论', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    // 创建 3 条根评论
    await service.create(org.id, project.id, 'task', task.id, { body: '评论 A' }, owner.id)
    await service.create(org.id, project.id, 'task', task.id, { body: '评论 B' }, owner.id)
    await service.create(org.id, project.id, 'task', task.id, { body: '评论 C' }, owner.id)

    const result = await service.listEntityComments(org.id, project.id, 'task', task.id)

    assert.equal(result.meta.total, 3)
    assert.lengthOf(result.data, 3)
  })

  test('17. 实体评论数量统计', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    // 通过 service.create 创建 -> 同时写入 entity 和 task_id
    await service.create(org.id, project.id, 'task', task.id, { body: '计数1' }, owner.id)
    await service.create(org.id, project.id, 'task', task.id, { body: '计数2' }, owner.id)

    const count = await service.getTaskCommentCount(org.id, project.id, task.id)

    assert.equal(count, 2)
  })

  // ---------------------------------------------------------------------------
  // 组织隔离
  // ---------------------------------------------------------------------------

  test('18. 跨组织隔离（不同组织返回 not found）', async ({ assert }) => {
    const { owner, org, project, task, service } = await setup()

    // 创建另一个组织
    const otherOwner = await createUser({ email: uniqueEmail('other-org') })
    const otherOrg = await createOrganization(otherOwner)

    // 用正确的 org/project 创建评论
    const comment = await service.create(
      org.id,
      project.id,
      'task',
      task.id,
      { body: '本组织评论' },
      owner.id,
    )

    // 跨组织 getComment（project 属于 org，不属于 otherOrg）
    await assert.rejects(
      async () => service.getComment(otherOrg.id, project.id, comment.id),
      ResourceNotFoundException,
    )

    // 对不存在的目标做列表
    await assert.rejects(
      async () => service.listEntityComments(org.id, project.id, 'task', 99999),
      ResourceNotFoundException,
    )
  })
})

// ---------------------------------------------------------------------------
// V2 CommentPolicy 单元测试 (tasks 2.9)
// ---------------------------------------------------------------------------

test.group('CommentPolicy V2', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('policy-owner') })
    const org = await createOrganization(owner)
    return { owner, org }
  }

  async function createComment(
    orgId: number,
    projectId: number,
    authorId: number,
  ): Promise<Comment> {
    return Comment.create({
      organizationId: orgId,
      projectId: projectId,
      entityType: 'task',
      entityId: 1,
      authorId,
      body: '策略测试评论',
      bodyFormat: 'plain',
      status: 'open',
    })
  }

  // ---------------------------------------------------------------------------
  // 角色权限
  // ---------------------------------------------------------------------------

  test('1. 项目经理拥有全部评论权限', async ({ assert }) => {
    const { owner, org } = await setup()
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const policy = new CommentPolicy(new RbacService())

    assert.isTrue(await policy.view(owner, org.id, project.id))
    assert.isTrue(await policy.create(owner, org.id, project.id))
    assert.isTrue(await policy.updateSelf(owner, org.id, project.id))
    assert.isTrue(await policy.deleteSelf(owner, org.id, project.id))
    assert.isTrue(await policy.moderate(owner, org.id, project.id))

    // resolve（作者本人或 moderate 角色）
    const selfComment = await createComment(org.id, project.id, owner.id)
    assert.isTrue(await policy.canResolve(owner, org.id, project.id, selfComment))
  })

  test('2. 普通成员可以创建/查看/编辑本人/删除本人但不能 moderate', async ({ assert }) => {
    const { owner, org } = await setup()
    const member = await createUser({ email: uniqueEmail('policy-member') })
    const { project } = await createProjectWithMember(org, owner, member, ProjectRoleName.MEMBER)

    const policy = new CommentPolicy(new RbacService())

    assert.isTrue(await policy.view(member, org.id, project.id))
    assert.isTrue(await policy.create(member, org.id, project.id))
    assert.isTrue(await policy.updateSelf(member, org.id, project.id))
    assert.isTrue(await policy.deleteSelf(member, org.id, project.id))
    assert.isFalse(await policy.moderate(member, org.id, project.id))

    // 成员可以解决本人评论
    const selfComment = await createComment(org.id, project.id, member.id)
    assert.isTrue(await policy.canResolve(member, org.id, project.id, selfComment))
  })

  test('3. 外部协作者权限有限', async ({ assert }) => {
    const { owner, org } = await setup()
    const collaborator = await createUser({ email: uniqueEmail('policy-collab') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      collaborator,
      ProjectRoleName.EXTERNAL_COLLABORATOR,
    )

    const policy = new CommentPolicy(new RbacService())

    assert.isTrue(await policy.view(collaborator, org.id, project.id))
    assert.isTrue(await policy.create(collaborator, org.id, project.id))
    assert.isTrue(await policy.updateSelf(collaborator, org.id, project.id))
    assert.isTrue(await policy.deleteSelf(collaborator, org.id, project.id))
    assert.isFalse(await policy.moderate(collaborator, org.id, project.id))
  })

  test('4. 只读观察者只能查看，不能创建/编辑/删除', async ({ assert }) => {
    const { owner, org } = await setup()
    const viewer = await createUser({ email: uniqueEmail('policy-viewer') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      viewer,
      ProjectRoleName.READONLY_OBSERVER,
    )

    const policy = new CommentPolicy(new RbacService())

    assert.isTrue(await policy.view(viewer, org.id, project.id))
    assert.isFalse(await policy.create(viewer, org.id, project.id))
    assert.isFalse(await policy.updateSelf(viewer, org.id, project.id))
    assert.isFalse(await policy.deleteSelf(viewer, org.id, project.id))
    assert.isFalse(await policy.moderate(viewer, org.id, project.id))
  })

  test('5. 组织管理员拥有全部权限', async ({ assert }) => {
    const { owner, org } = await setup()
    const admin = await createUser({ email: uniqueEmail('policy-admin') })
    const { project } = await createProjectWithMember(org, owner, admin, ProjectRoleName.MEMBER)

    // 让 admin 成为组织管理员
    await OrganizationMember.create({
      organizationId: org.id,
      userId: admin.id,
      role: 'admin',
    })

    const policy = new CommentPolicy(new RbacService())

    assert.isTrue(await policy.view(admin, org.id, project.id))
    assert.isTrue(await policy.create(admin, org.id, project.id))
    assert.isTrue(await policy.updateSelf(admin, org.id, project.id))
    assert.isTrue(await policy.deleteSelf(admin, org.id, project.id))
    assert.isTrue(await policy.moderate(admin, org.id, project.id))

    // 管理员可以解决他人评论
    const otherComment = await createComment(org.id, project.id, owner.id)
    assert.isTrue(await policy.canResolve(admin, org.id, project.id, otherComment))
  })

  // ---------------------------------------------------------------------------
  // 行级权限
  // ---------------------------------------------------------------------------

  test('6. canUpdate 本人为 true，他人为 false', async ({ assert }) => {
    const { owner, org } = await setup()
    const other = await createUser({ email: uniqueEmail('other-user') })
    const { project } = await createProjectWithMember(org, owner, other, ProjectRoleName.MEMBER)

    const policy = new CommentPolicy(new RbacService())

    const ownComment = await createComment(org.id, project.id, owner.id)
    const otherComment = await createComment(org.id, project.id, other.id)

    assert.isTrue(await policy.canUpdate(owner, org.id, project.id, ownComment))
    assert.isFalse(await policy.canUpdate(owner, org.id, project.id, otherComment))
  })

  test('7. canDelete 本人或 moderate 为 true，否则 false', async ({ assert }) => {
    const { owner, org } = await setup()
    const member = await createUser({ email: uniqueEmail('delete-member') })
    const { project } = await createProjectWithMember(org, owner, member, ProjectRoleName.MEMBER)

    const policy = new CommentPolicy(new RbacService())

    const memberComment = await createComment(org.id, project.id, member.id)
    const ownerComment = await createComment(org.id, project.id, owner.id)

    // 成员可以删除本人评论
    assert.isTrue(await policy.canDelete(member, org.id, project.id, memberComment))
    // 成员不能删除他人评论（不具备 moderate）
    assert.isFalse(await policy.canDelete(member, org.id, project.id, ownerComment))

    // 项目经理（具备 moderate）可以删除他人评论
    const manager = await createUser({ email: uniqueEmail('delete-manager') })
    const { project: pmProject } = await createProjectWithMember(
      org,
      owner,
      manager,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const otherComment = await createComment(org.id, pmProject.id, owner.id)
    assert.isTrue(await policy.canDelete(manager, org.id, pmProject.id, otherComment))
  })

  test('8. canResolve 作者或 moderate 为 true，否则 false', async ({ assert }) => {
    const { owner, org } = await setup()
    const member = await createUser({ email: uniqueEmail('resolve-member') })
    const { project } = await createProjectWithMember(org, owner, member, ProjectRoleName.MEMBER)

    const policy = new CommentPolicy(new RbacService())

    const memberComment = await createComment(org.id, project.id, member.id)
    const ownerComment = await createComment(org.id, project.id, owner.id)

    // 成员可以解决本人评论（create 权限即可 resolve 本人）
    assert.isTrue(await policy.canResolve(member, org.id, project.id, memberComment))
    // 成员不能解决他人评论（不具备 moderate）
    assert.isFalse(await policy.canResolve(member, org.id, project.id, ownerComment))

    // 项目经理（moderate）可以解决他人评论
    const manager = await createUser({ email: uniqueEmail('resolve-manager') })
    const { project: pmProject } = await createProjectWithMember(
      org,
      owner,
      manager,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const otherComment = await createComment(org.id, pmProject.id, owner.id)
    assert.isTrue(await policy.canResolve(manager, org.id, pmProject.id, otherComment))
  })
})
