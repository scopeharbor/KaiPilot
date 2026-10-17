import Comment from '#models/comment'
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

test.group('Comment Model', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('comment-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project }
  }

  // ---------------------------------------------------------------------------
  // 项目级评论
  // ---------------------------------------------------------------------------

  test('创建项目级评论（taskId = null）', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '这是项目级评论',
      bodyFormat: 'plain',
    })

    assert.isNotNull(comment.id)
    assert.equal(comment.organizationId, org.id)
    assert.equal(comment.projectId, project.id)
    assert.isNull(comment.taskId)
    assert.equal(comment.authorId, owner.id)
    assert.equal(comment.body, '这是项目级评论')
    assert.equal(comment.bodyFormat, 'plain')
    assert.isNull(comment.editedAt ?? null)
    assert.isNull(comment.deletedAt ?? null)
  })

  // ---------------------------------------------------------------------------
  // 任务级评论
  // ---------------------------------------------------------------------------

  test('创建任务级评论（taskId 非空）', async ({ assert }) => {
    const { owner, org, project } = await setup()

    // 创建测试任务
    const task = await Task.create({
      projectId: project.id,
      name: '测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: task.id,
      authorId: owner.id,
      body: '这是任务级评论',
      bodyFormat: 'plain',
    })

    assert.isNotNull(comment.id)
    assert.equal(comment.taskId, task.id)
    assert.equal(comment.body, '这是任务级评论')
  })

  // ---------------------------------------------------------------------------
  // 软删除字段
  // ---------------------------------------------------------------------------

  test('软删除评论设置 deletedAt 和 deletedBy', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '将被删除的评论',
      bodyFormat: 'plain',
    })

    // 软删除
    comment.deletedAt = DateTime.now()
    comment.deletedBy = owner.id
    await comment.save()

    assert.isNotNull(comment.deletedAt)
    assert.equal(comment.deletedBy, owner.id)
    assert.isTrue(comment.isDeleted)
  })

  // ---------------------------------------------------------------------------
  // 组织隔离字段
  // ---------------------------------------------------------------------------

  test('评论绑定组织 ID 实现数据隔离', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '组织隔离测试',
      bodyFormat: 'plain',
    })

    assert.equal(comment.organizationId, org.id)

    // 验证可以通过 organizationId 查询过滤
    const found = await Comment.query()
      .where('organization_id', org.id)
      .where('id', comment.id)
      .first()

    assert.isNotNull(found)
  })

  // ---------------------------------------------------------------------------
  // 计算属性
  // ---------------------------------------------------------------------------

  test('targetType 返回 project 或 task', async ({ assert }) => {
    const { owner, org, project } = await setup()

    // 项目级评论
    const projectComment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '项目评论',
      bodyFormat: 'plain',
    })
    assert.equal(projectComment.targetType, 'project')

    // 创建任务级评论
    const task = await Task.create({
      projectId: project.id,
      name: '测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    const taskComment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: task.id,
      authorId: owner.id,
      body: '任务评论',
      bodyFormat: 'plain',
    })
    assert.equal(taskComment.targetType, 'task')
  })

  test('isEdited 返回编辑状态', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '原始内容',
      bodyFormat: 'plain',
    })

    assert.isFalse(comment.isEdited)

    // 编辑后
    comment.editedAt = DateTime.now()
    assert.isTrue(comment.isEdited)
  })

  // ---------------------------------------------------------------------------
  // 序列化策略：软删除评论不暴露正文
  // ---------------------------------------------------------------------------

  test('序列化时软删除评论不暴露正文', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '敏感内容',
      bodyFormat: 'plain',
    })

    // 未删除时正文可见
    const normalData = comment.serialize()
    assert.equal(normalData.body, '敏感内容')

    // 软删除后正文不暴露
    comment.deletedAt = DateTime.now()
    const deletedData = comment.serialize()
    assert.isNull(deletedData.body)
  })

  // ---------------------------------------------------------------------------
  // 默认作用域：排除软删除
  // ---------------------------------------------------------------------------

  test('默认查询排除软删除评论', async ({ assert }) => {
    const { owner, org, project } = await setup()

    // 创建两条评论
    const comment1 = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '评论 1',
      bodyFormat: 'plain',
    })

    const comment2 = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '评论 2',
      bodyFormat: 'plain',
    })

    // 软删除一条
    comment1.deletedAt = DateTime.now()
    await comment1.save()

    // 默认查询只返回未删除的
    const visible = await Comment.query().where('project_id', project.id)
    assert.lengthOf(visible, 1)
    assert.equal(visible[0]!.id, comment2.id)
  })

  test('queryWithTrashed 包含软删除评论', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '将被删除',
      bodyFormat: 'plain',
    })

    comment.deletedAt = DateTime.now()
    await comment.save()

    const all = await Comment.queryWithTrashed().where('project_id', project.id)
    assert.isTrue(all.length >= 1)
  })
})
