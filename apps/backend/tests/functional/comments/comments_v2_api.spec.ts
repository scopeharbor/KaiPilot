import CommentMention from '#models/comment_mention'
import Task from '#models/task'
import type ChangeRequest from '#models/change_request'
import type Document from '#models/document'
import type Risk from '#models/risk'
import DB from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type Organization from '#models/organization'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
  addOrgMember,
} from '../auth/_helpers.js'
import { DateTime } from 'luxon'

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

async function createTestTask(projectId: number): Promise<Task> {
  return Task.create({
    projectId,
    name: '测试任务',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
  })
}

async function createTestRisk(org: Organization, projectId: number, creator: User): Promise<Risk> {
  const { default: Risk } = await import('#models/risk')
  return Risk.create({
    organizationId: org.id,
    projectId,
    title: '测试风险',
    description: '测试风险描述',
    category: 'technical',
    probability: 3,
    impact: 3,
    score: 9,
    status: 'identified',
    riskLevel: 'medium',
    priority: 'normal',
    identifiedAt: DateTime.now(),
    createdBy: creator.id,
    updatedBy: creator.id,
  })
}

async function createTestFile(
  _org: Organization,
  projectId: number,
  _creator: User,
): Promise<Document> {
  const { default: Document } = await import('#models/document')
  return Document.create({
    projectId,
    name: '测试文档',
    documentType: 'document',
    createdBy: _creator.id,
    isTemplate: false,
    aiGenerated: false,
  })
}

async function createTestChangeRequest(
  org: Organization,
  projectId: number,
  _creator: User,
): Promise<ChangeRequest> {
  const { default: ChangeRequest } = await import('#models/change_request')
  return ChangeRequest.create({
    organizationId: org.id,
    projectId,
    crCode: `CR-${Date.now()}`,
    title: '测试变更请求',
    changeType: 'scope',
    status: 'draft',
  })
}

test.group('V2 评论 API (统一实体评论)', (group) => {
  useAuthDatabase(group)

  let org: Organization
  let owner: User
  let token: string
  let projectId: number

  group.each.setup(async ({ context }) => {
    owner = await createUser({ email: uniqueEmail('v2-comment-owner') })
    org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    projectId = project.id
    token = await login(context.client, owner)
  })

  // ---------------------------------------------------------------------------
  // 1. Entity comment CRUD
  // ---------------------------------------------------------------------------

  test('1.1 创建和列出 task 实体评论', async ({ client, assert }) => {
    const task = await createTestTask(projectId)

    // 创建
    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '任务评论正文', bodyFormat: 'plain' })

    createRes.assertStatus(201)
    assert.equal(createRes.body().data.body, '任务评论正文')
    assert.equal(createRes.body().data.entityType, 'task')
    assert.equal(createRes.body().data.entityId, task.id)

    // 列出
    const listRes = await client
      .get(`/api/v1/projects/${projectId}/comments?entityType=task&entityId=${task.id}`)
      .header('Authorization', `Bearer ${token}`)

    listRes.assertStatus(200)
    assert.equal(listRes.body().meta.total, 1)
  })

  test('1.2 创建和列出 risk 实体评论', async ({ client, assert }) => {
    const risk = await createTestRisk(org, projectId, owner)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'risk', entityId: risk.id, body: '风险评论' })

    createRes.assertStatus(201)

    const listRes = await client
      .get(`/api/v1/projects/${projectId}/comments?entityType=risk&entityId=${risk.id}`)
      .header('Authorization', `Bearer ${token}`)

    listRes.assertStatus(200)
    assert.equal(listRes.body().meta.total, 1)
  })

  test('1.3 创建和列出 file 实体评论', async ({ client, assert }) => {
    const file = await createTestFile(org, projectId, owner)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'file', entityId: file.id, body: '文件评论' })

    createRes.assertStatus(201)

    const listRes = await client
      .get(`/api/v1/projects/${projectId}/comments?entityType=file&entityId=${file.id}`)
      .header('Authorization', `Bearer ${token}`)

    listRes.assertStatus(200)
    assert.equal(listRes.body().meta.total, 1)
  })

  test('1.4 创建和列出 change_request 实体评论', async ({ client, assert }) => {
    const cr = await createTestChangeRequest(org, projectId, owner)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'change_request', entityId: cr.id, body: '变更请求评论' })

    createRes.assertStatus(201)

    const listRes = await client
      .get(`/api/v1/projects/${projectId}/comments?entityType=change_request&entityId=${cr.id}`)
      .header('Authorization', `Bearer ${token}`)

    listRes.assertStatus(200)
    assert.equal(listRes.body().meta.total, 1)
  })

  // ---------------------------------------------------------------------------
  // 2. Reply
  // ---------------------------------------------------------------------------

  test('2 创建根评论后回复，验证出现在回复列表', async ({ client, assert }) => {
    const task = await createTestTask(projectId)

    // 创建根评论
    const rootRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '根评论' })

    rootRes.assertStatus(201)
    const rootId = rootRes.body().data.id

    // 创建回复
    const replyRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '回复内容', parentId: rootId })

    replyRes.assertStatus(201)
    assert.equal(replyRes.body().data.parentId, rootId)

    // 查看根评论详情应包含回复
    const showRes = await client
      .get(`/api/v1/projects/${projectId}/comments/${rootId}`)
      .header('Authorization', `Bearer ${token}`)

    showRes.assertStatus(200)
    const data = showRes.body().data
    assert.exists(data.replies)
    assert.isAtLeast(data.replies.length, 1)
    assert.equal(data.replies[0].body, '回复内容')
  })

  // ---------------------------------------------------------------------------
  // 3. Cross-entity reply rejection
  // ---------------------------------------------------------------------------

  test('3 回复时 entityType 不同应返回校验错误', async ({ client, assert }) => {
    const task = await createTestTask(projectId)
    const risk = await createTestRisk(org, projectId, owner)

    // 创建 task 实体根评论
    const rootRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '任务根评论' })

    rootRes.assertStatus(201)
    const rootId = rootRes.body().data.id

    // 用 risk 实体回复 task 评论 → 应被拒
    const replyRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'risk', entityId: risk.id, body: '跨实体回复', parentId: rootId })

    replyRes.assertStatus(422)
    assert.exists(replyRes.body().error)
  })

  // ---------------------------------------------------------------------------
  // 4. Nested reply rejection
  // ---------------------------------------------------------------------------

  test('4 回复已有 parentId 的回复应返回校验错误', async ({ client, assert }) => {
    const task = await createTestTask(projectId)

    // 根评论
    const rootRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '根评论' })

    rootRes.assertStatus(201)
    const rootId = rootRes.body().data.id

    // 第一层回复
    const reply1Res = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '第一层回复', parentId: rootId })

    reply1Res.assertStatus(201)
    const reply1Id = reply1Res.body().data.id

    // 尝试回复第一层回复（二级嵌套）→ 应被拒
    const reply2Res = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '第二层回复', parentId: reply1Id })

    reply2Res.assertStatus(422)
    assert.exists(reply2Res.body().error)
  })

  // ---------------------------------------------------------------------------
  // 5. Deleted parent reply rejection
  // ---------------------------------------------------------------------------

  test('5 回复已软删除的评论应返回校验错误', async ({ client, assert }) => {
    const task = await createTestTask(projectId)

    // 创建根评论
    const rootRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '即将删除的根评论' })

    rootRes.assertStatus(201)
    const rootId = rootRes.body().data.id

    // 删除根评论
    const delRes = await client
      .delete(`/api/v1/projects/${projectId}/comments/${rootId}`)
      .header('Authorization', `Bearer ${token}`)
    delRes.assertStatus(204)

    // 回复已删除的根评论 → 应被拒
    const replyRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '回复已删除评论', parentId: rootId })

    replyRes.assertStatus(404) // 软删除的父评论被 default scope 排除，返回 404
    assert.exists(replyRes.body().error)
  })

  // ---------------------------------------------------------------------------
  // 6. Comment resolve
  // ---------------------------------------------------------------------------

  test('6 解决评论 → status 变为 resolved，resolvedBy 有值', async ({ client, assert }) => {
    const task = await createTestTask(projectId)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '待解决的评论' })

    createRes.assertStatus(201)
    const commentId = createRes.body().data.id

    const resolveRes = await client
      .post(`/api/v1/projects/${projectId}/comments/${commentId}/resolve`)
      .header('Authorization', `Bearer ${token}`)

    resolveRes.assertStatus(200)
    assert.equal(resolveRes.body().data.status, 'resolved')
    assert.isNotNull(resolveRes.body().data.resolvedBy)
  })

  // ---------------------------------------------------------------------------
  // 7. Comment reopen
  // ---------------------------------------------------------------------------

  test('7 重新打开已解决评论 → status 恢复 open，resolvedBy 为 null', async ({
    client,
    assert,
  }) => {
    const task = await createTestTask(projectId)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '待重新打开的评论' })

    createRes.assertStatus(201)
    const commentId = createRes.body().data.id

    // 先解决
    const resolveRes1 = await client
      .post(`/api/v1/projects/${projectId}/comments/${commentId}/resolve`)
      .header('Authorization', `Bearer ${token}`)
    resolveRes1.assertStatus(200)

    // 重新打开
    const reopenRes = await client
      .post(`/api/v1/projects/${projectId}/comments/${commentId}/reopen`)
      .header('Authorization', `Bearer ${token}`)

    reopenRes.assertStatus(200)
    assert.equal(reopenRes.body().data.status, 'open')
    assert.isNull(reopenRes.body().data.resolvedBy)
  })

  // ---------------------------------------------------------------------------
  // 8. Reply resolve rejection
  // ---------------------------------------------------------------------------

  test('8 尝试解决回复（有 parentId）应返回校验错误', async ({ client, assert }) => {
    const task = await createTestTask(projectId)

    // 根评论
    const rootRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '根评论' })

    rootRes.assertStatus(201)
    const rootId = rootRes.body().data.id

    // 回复
    const replyRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '回复', parentId: rootId })

    replyRes.assertStatus(201)
    const replyId = replyRes.body().data.id

    // 尝试解决回复 → 应被拒
    const resolveRes = await client
      .post(`/api/v1/projects/${projectId}/comments/${replyId}/resolve`)
      .header('Authorization', `Bearer ${token}`)

    resolveRes.assertStatus(422)
    assert.exists(resolveRes.body().error)
  })

  // ---------------------------------------------------------------------------
  // 9. Mention creation
  // ---------------------------------------------------------------------------

  test('9 创建含 mentions 的评论应生成提及记录', async ({ client, assert }) => {
    const task = await createTestTask(projectId)
    const mentionedUser = await createUser({ email: uniqueEmail('mentioned') })
    await addOrgMember(org, mentionedUser, 'member')

    // 将 mentionedUser 加为项目成员（提及候选需是项目成员）
    await createProjectWithMember(org, owner, mentionedUser, ProjectRoleName.MEMBER)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        entityType: 'task',
        entityId: task.id,
        body: '@用户 你好',
        mentions: [mentionedUser.id],
      })

    createRes.assertStatus(201)
    const commentId = createRes.body().data.id

    // 验证 mention 记录
    const mentions = await CommentMention.query()
      .where('comment_id', commentId)
      .where('mentioned_user_id', mentionedUser.id)

    assert.isAtLeast(mentions.length, 1)
  })

  // ---------------------------------------------------------------------------
  // 10. Mention candidates
  // ---------------------------------------------------------------------------

  test('10 GET mention-candidates 应返回项目成员', async ({ client, assert }) => {
    const memberUser = await createUser({ email: uniqueEmail('mention-candidate') })
    await addOrgMember(org, memberUser, 'member')
    await createProjectWithMember(org, owner, memberUser, ProjectRoleName.MEMBER)

    const res = await client
      .get(`/api/v1/projects/${projectId}/comments/mention-candidates`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.isArray(res.body().data)
    // 应至少包含 owner 自己
    assert.isTrue(res.body().data.some((c: { userId: number }) => c.userId === owner.id))
  })

  // ---------------------------------------------------------------------------
  // 11. Permission: readonly observer
  // ---------------------------------------------------------------------------

  test('11 READONLY_OBSERVER 可查看评论但不能创建', async ({ client }) => {
    const task = await createTestTask(projectId)
    const viewer = await createUser({ email: uniqueEmail('viewer') })
    await addOrgMember(org, viewer, 'member')
    // 为现有项目创建 READONLY_OBSERVER 角色并加入成员
    const readerRole = await ProjectRole.create({
      projectId,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: ProjectRoleName.READONLY_OBSERVER,
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId,
      userId: viewer.id,
      projectRoleId: readerRole.id,
      isActive: true,
    })
    const viewerToken = await login(client, viewer)

    // 创建一条评论以便查看
    const pmCreate = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: 'PM 创建的评论' })
    pmCreate.assertStatus(201)

    // 查看 → 应通过
    const listRes = await client
      .get(`/api/v1/projects/${projectId}/comments?entityType=task&entityId=${task.id}`)
      .header('Authorization', `Bearer ${viewerToken}`)

    listRes.assertStatus(200)

    // 创建 → 应被拒（403 Permission denied）
    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${viewerToken}`)
      .json({ entityType: 'task', entityId: task.id, body: '观察者尝试评论' })

    createRes.assertStatus(403)
  })

  // ---------------------------------------------------------------------------
  // 12. Permission: external collaborator
  // ---------------------------------------------------------------------------

  test('12 EXTERNAL_COLLABORATOR 可对可见实体创建评论', async ({ client, assert }) => {
    const task = await createTestTask(projectId)
    const collab = await createUser({ email: uniqueEmail('external-collab') })
    await addOrgMember(org, collab, 'member')
    // 为现有项目创建 EXTERNAL_COLLABORATOR 角色并加入成员
    const collabRole = await ProjectRole.create({
      projectId,
      name: ProjectRoleName.EXTERNAL_COLLABORATOR,
      description: ProjectRoleName.EXTERNAL_COLLABORATOR,
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId,
      userId: collab.id,
      projectRoleId: collabRole.id,
      isActive: true,
    })
    const collabToken = await login(client, collab)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${collabToken}`)
      .json({ entityType: 'task', entityId: task.id, body: '外部协作者评论' })

    createRes.assertStatus(201)
    assert.equal(createRes.body().data.body, '外部协作者评论')
  })

  // ---------------------------------------------------------------------------
  // 13. Cross-org isolation
  // ---------------------------------------------------------------------------

  test('13 组织 A 的评论在组织 B 中不可见', async ({ client, assert }) => {
    const taskA = await createTestTask(projectId)

    // 组织 A 创建评论
    const createA = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: taskA.id, body: '组织A的评论' })
    createA.assertStatus(201)

    // 创建组织 B
    const ownerB = await createUser({ email: uniqueEmail('org-b-owner') })
    const orgB = await createOrganization(ownerB)
    const { project: projectB } = await setupProject(orgB, ownerB)
    const tokenB = await login(client, ownerB)

    const taskB = await createTestTask(projectB.id)

    // 组织 B 查询 projectB 的任何实体 → 不应看到组织 A 的评论
    const listRes = await client
      .get(`/api/v1/projects/${projectB.id}/comments?entityType=task&entityId=${taskB.id}`)
      .header('Authorization', `Bearer ${tokenB}`)

    listRes.assertStatus(200)
    assert.equal(listRes.body().meta.total, 0)
  })

  // ---------------------------------------------------------------------------
  // 14. Soft delete preserves placeholder
  // ---------------------------------------------------------------------------

  test('14 软删除后 body 为 null', async ({ client, assert }) => {
    const task = await createTestTask(projectId)

    const createRes = await client
      .post(`/api/v1/projects/${projectId}/comments`)
      .header('Authorization', `Bearer ${token}`)
      .json({ entityType: 'task', entityId: task.id, body: '即将被删除的正文' })

    createRes.assertStatus(201)
    const commentId = createRes.body().data.id

    // 删除
    const delRes = await client
      .delete(`/api/v1/projects/${projectId}/comments/${commentId}`)
      .header('Authorization', `Bearer ${token}`)
    delRes.assertStatus(204)

    // 通过 Lucid from() 绕过 @beforeFind 默认作用域，直接查 DB
    const rows = await DB.from('comments').where('id', commentId).whereNotNull('deleted_at')
    assert.lengthOf(rows, 1)
    const deleted = rows[0]
    assert.isNotNull(deleted?.deleted_at ?? null)
    // body 在 DB 中仍存在（序列化时由模型置为 null）
    assert.isNotNull(deleted?.body)
  })
})
