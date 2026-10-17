import Comment from '#models/comment'
import CommentMention from '#models/comment_mention'
import OrganizationMember from '#models/organization_member'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { DateTime } from 'luxon'

test.group('Comment Model V2', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('v2-comment-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    // 创建测试任务
    const task = await Task.create({
      projectId: project.id,
      name: 'V2 测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    return { owner, org, project, task }
  }

  // ---------------------------------------------------------------------------
  // V2 实体类型
  // ---------------------------------------------------------------------------

  test('V2 创建 entity_type=task 评论', async ({ assert }) => {
    const { owner, org, project, task } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: 'V2 实体评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    assert.isNotNull(comment.id)
    assert.equal(comment.entityType, 'task')
    assert.equal(comment.entityId, task.id)
    assert.equal(comment.targetType, 'task')
    assert.equal(comment.status, 'open')
    assert.isFalse(comment.isResolved)
  })

  test('V2 创建 entity_type=risk 评论', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'risk',
      entityId: 100,
      authorId: owner.id,
      body: '风险评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    assert.equal(comment.entityType, 'risk')
    assert.equal(comment.entityId, 100)
    assert.equal(comment.targetType, 'risk')
  })

  test('V2 创建 entity_type=change_request 评论', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'change_request',
      entityId: 200,
      authorId: owner.id,
      body: '变更请求评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    assert.equal(comment.entityType, 'change_request')
    assert.equal(comment.targetType, 'change_request')
  })

  test('V2 创建 entity_type=file 评论', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'file',
      entityId: 300,
      authorId: owner.id,
      body: '文件评论',
      bodyFormat: 'markdown',
      status: 'open',
    })

    assert.equal(comment.entityType, 'file')
    assert.equal(comment.bodyFormat, 'markdown')
  })

  test('V2 创建 entity_type=milestone 评论', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'milestone',
      entityId: 400,
      authorId: owner.id,
      body: '里程碑评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    assert.equal(comment.entityType, 'milestone')
    assert.equal(comment.targetType, 'milestone')
  })

  // ---------------------------------------------------------------------------
  // 回复关系
  // ---------------------------------------------------------------------------

  test('V2 创建回复评论（parent_id）', async ({ assert }) => {
    const { owner, org, project, task } = await setup()

    const root = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: '根评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    const reply = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: '一级回复',
      bodyFormat: 'plain',
      parentId: root.id,
      status: 'open',
    })

    assert.isNotNull(reply.id)
    assert.equal(reply.parentId, root.id)

    // 验证回复查询
    const loadedRoot = await Comment.query().where('id', root.id).preload('replies').first()
    assert.isNotNull(loadedRoot)
    assert.isTrue(loadedRoot!.replies.length >= 1)
    assert.equal(loadedRoot!.replies[0]!.id, reply.id)
  })

  // ---------------------------------------------------------------------------
  // 评论状态
  // ---------------------------------------------------------------------------

  test('V2 评论解决状态', async ({ assert }) => {
    const { owner, org, project, task } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: '待解决评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    // 初始状态
    assert.equal(comment.status, 'open')
    assert.isFalse(comment.isResolved)

    // 标记解决
    comment.status = 'resolved'
    comment.resolvedBy = owner.id
    comment.resolvedAt = DateTime.now()
    await comment.save()

    assert.isTrue(comment.isResolved)
    assert.equal(comment.resolvedBy, owner.id)
    assert.isNotNull(comment.resolvedAt)
  })

  // ---------------------------------------------------------------------------
  // Mention 模型
  // ---------------------------------------------------------------------------

  test('CommentMention 创建和查询', async ({ assert }) => {
    const { owner, org, project, task } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: '包含 @提及',
      bodyFormat: 'plain',
      status: 'open',
    })

    // 创建提及记录
    const mentionedUser = await createUser({ email: uniqueEmail('mentioned') })
    // 先把 mentionedUser 加入组织
    await OrganizationMember.create({
      organizationId: org.id,
      userId: mentionedUser.id,
      role: 'member',
    })

    const mention = await CommentMention.create({
      organizationId: org.id,
      projectId: project.id,
      commentId: comment.id,
      mentionedUserId: mentionedUser.id,
      createdBy: owner.id,
    })

    assert.isNotNull(mention.id)
    assert.equal(mention.mentionedUserId, mentionedUser.id)
    assert.equal(mention.commentId, comment.id)
    assert.equal(mention.organizationId, org.id)
    assert.equal(mention.projectId, project.id)

    // 验证预加载
    const loadedComment = await Comment.query()
      .where('id', comment.id)
      .preload('mentions', (q) => q.preload('mentionedUser'))
      .first()
    assert.isNotNull(loadedComment)
    assert.isTrue(loadedComment!.mentions.length >= 1)
    assert.equal(loadedComment!.mentions[0]!.mentionedUserId, mentionedUser.id)
  })

  test('CommentMention 唯一约束去重', async ({ assert }) => {
    const { owner, org, project, task } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: '去重测试',
      bodyFormat: 'plain',
      status: 'open',
    })

    await CommentMention.create({
      organizationId: org.id,
      projectId: project.id,
      commentId: comment.id,
      mentionedUserId: owner.id,
      createdBy: owner.id,
    })

    // 重复插入应抛出错误
    await assert.rejects(async () => {
      await CommentMention.create({
        organizationId: org.id,
        projectId: project.id,
        commentId: comment.id,
        mentionedUserId: owner.id,
        createdBy: owner.id,
      })
    })
  })

  // ---------------------------------------------------------------------------
  // V1 兼容性
  // ---------------------------------------------------------------------------

  test('V2 模型兼容 V1 taskId 风格评论', async ({ assert }) => {
    const { owner, org, project, task } = await setup()

    // V1 风格：使用 taskId，不使用 entity
    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: task.id,
      authorId: owner.id,
      body: 'V1 兼容评论',
      bodyFormat: 'plain',
    })

    assert.equal(comment.taskId, task.id)
    assert.isUndefined(comment.entityType)
    assert.equal(comment.targetType, 'task')

    // V2 风格：使用 entity
    const v2comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: 'V2 风格评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    assert.equal(v2comment.entityType, 'task')
    assert.equal(v2comment.entityId, task.id)
    assert.equal(v2comment.targetType, 'task')
  })

  // ---------------------------------------------------------------------------
  // 组织隔离
  // ---------------------------------------------------------------------------

  test('CommentMention 冗余组织字段实现隔离', async ({ assert }) => {
    const { owner, org, project, task } = await setup()
    const anotherOrg = await createOrganization(
      await createUser({ email: uniqueEmail('other-org-owner') }),
    )
    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      authorId: owner.id,
      body: '包含提及的评论',
      bodyFormat: 'plain',
      status: 'open',
    })

    const mention = await CommentMention.create({
      organizationId: org.id,
      projectId: project.id,
      commentId: comment.id,
      mentionedUserId: owner.id,
      createdBy: owner.id,
    })

    assert.equal(mention.organizationId, org.id)
    assert.notEqual(mention.organizationId, anotherOrg.id)
  })
})
