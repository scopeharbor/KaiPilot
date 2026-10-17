import AuditLog from '#models/audit_log'
import Comment from '#models/comment'
import Task from '#models/task'
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
import type Organization from '#models/organization'
import {
  STRONG_PASSWORD,
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

async function setupProject(org: Organization, creator: User) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { project }
}

test.group('Comments API', (group) => {
  useAuthDatabase(group)

  let org: Organization
  let owner: User
  let token: string
  let projectId: number

  group.each.setup(async ({ context }) => {
    owner = await createUser({ email: uniqueEmail('comment-owner') })
    org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    projectId = project.id
    token = await login(context.client, owner)
  })

  // ---------------------------------------------------------------------------
  // 项目级评论
  // ---------------------------------------------------------------------------

  test('创建项目级评论成功', async ({ client, assert }) => {
    const response = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ body: '这是项目级评论', bodyFormat: 'plain' })

    response.assertStatus(201)
    assert.equal(response.body().data.body, '这是项目级评论')
    assert.equal(response.body().data.targetType, 'project')
    assert.isNull(response.body().data.taskId)
  })

  test('列出项目级评论', async ({ client, assert }) => {
    // 清理前序测试留下的评论，确保测试隔离
    await Comment.query().where('project_id', projectId).delete()

    // 创建两条评论
    await Comment.create({
      organizationId: org.id,
      projectId,
      taskId: null,
      authorId: owner.id,
      body: '评论 1',
      bodyFormat: 'plain',
    })
    await Comment.create({
      organizationId: org.id,
      projectId,
      taskId: null,
      authorId: owner.id,
      body: '评论 2',
      bodyFormat: 'plain',
    })

    const response = await client
      .get(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    assert.equal(response.body().meta.total, 2)
    assert.lengthOf(response.body().data, 2)
  })

  // ---------------------------------------------------------------------------
  // 任务级评论
  // ---------------------------------------------------------------------------

  test('创建任务级评论成功', async ({ client, assert }) => {
    const task = await Task.create({
      projectId,
      name: '测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    const response = await client
      .post(`/api/v1/projects/${projectId}/tasks/${task.id}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ body: '这是任务级评论' })

    response.assertStatus(201)
    assert.equal(response.body().data.body, '这是任务级评论')
    assert.equal(response.body().data.entityType, 'task')
    assert.equal(response.body().data.entityId, task.id)
    assert.equal(response.body().data.taskId, task.id)
  })

  // ---------------------------------------------------------------------------
  // 编辑与删除
  // ---------------------------------------------------------------------------

  test('编辑本人评论成功', async ({ client, assert }) => {
    const comment = await Comment.create({
      organizationId: org.id,
      projectId,
      taskId: null,
      authorId: owner.id,
      body: '原始内容',
      bodyFormat: 'plain',
    })

    const response = await client
      .patch(`/api/v1/projects/${projectId}/comments/${comment.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ body: '修改后的内容' })

    response.assertStatus(200)
    assert.equal(response.body().data.body, '修改后的内容')
    assert.isNotNull(response.body().data.editedAt)
  })

  test('删除本人评论成功', async ({ client, assert }) => {
    const comment = await Comment.create({
      organizationId: org.id,
      projectId,
      taskId: null,
      authorId: owner.id,
      body: '将被删除',
      bodyFormat: 'plain',
    })

    const response = await client
      .delete(`/api/v1/projects/${projectId}/comments/${comment.id}`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(204)

    // 验证软删除（使用原生查询绕过默认作用域）
    const deleted = (await Comment.queryOnlyTrashed()
      .where('id', comment.id)
      .first()) as Comment | null
    assert.isNotNull(deleted?.deletedAt)
  })

  // ---------------------------------------------------------------------------
  // 审计事件
  // ---------------------------------------------------------------------------

  test('创建评论写入审计日志', async ({ client, assert }) => {
    await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ body: '审计测试评论' })

    const logs = await AuditLog.query().where('entity_type', 'project').where('action', 'create')

    assert.isTrue(logs.length > 0)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'COMMENT_CREATED')
  })

  // ---------------------------------------------------------------------------
  // 校验
  // ---------------------------------------------------------------------------

  test('空正文被拒', async ({ client }) => {
    const response = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ body: '' })

    response.assertStatus(422)
  })

  test('超长正文被拒', async ({ client }) => {
    const response = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ body: 'x'.repeat(5001) })

    response.assertStatus(422)
  })

  test('非法格式被拒', async ({ client }) => {
    const response = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ body: '评论', bodyFormat: 'html' })

    response.assertStatus(422)
  })
})
