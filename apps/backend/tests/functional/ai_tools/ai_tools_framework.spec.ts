/**
 * v3-ai-tools-orchestration-layer —— 执行框架 Japa 功能测试（tasks W1 1.11，W3 收尾修订）。
 *
 * 覆盖：GET /api/v1/ai/tools 工具清单（8 个在册工具 + 完整元数据契约，无测试残留）；
 * 未登录 401；信封不合法 422 VALIDATION_ERROR；未知工具 404 RESOURCE_NOT_FOUND；
 * 缺少 ai:trigger 403 PERMISSION_DENIED（含 REJECTED 审计）；合法调用 200 SUCCESS
 * （含 RL-12 审计留痕 parametersHash）；对非写工具 confirm 422（RL-01）。
 *
 * W3 修订说明：W2 落地后注册表由 `handlers/index` 静态装配并 seal（RL-14），
 * 本文件不再注册任何测试探针——全部工具级断言使用真实在册工具与真实业务 fixture，
 * 单跑与合跑（sealed 世界）行为一致，且不污染 GET /ai/tools 清单。
 */
import AuditLog from '#models/audit_log'
import type User from '#models/user'
import { AI_TOOLS_NAMES } from '#services/ai_tools/handlers/index'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken as string
}

/** 建一个带 PM 成员的 org + project。 */
async function orgWithProject(owner: User) {
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { org, project }
}

test.group('AI tools orchestration framework', (group) => {
  useAuthDatabase(group)

  test('GET /api/v1/ai/tools 返回 8 个在册工具与完整元数据契约', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('tools-owner') })
    await createOrganization(owner)
    const token = await login(client, owner)
    const response = await client.get('/api/v1/ai/tools').header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    const body = response.body()
    assert.isArray(body.data)
    assert.isNumber(body.meta?.total)
    assert.equal(body.meta.total, body.data.length)
    const names = (body.data as Array<{ name: string }>).map((item) => item.name).sort()
    assert.deepEqual(names, [...AI_TOOLS_NAMES].sort())
    for (const descriptor of body.data) {
      // 完整元数据契约（spec：name/description/parameters/requiredPermissions/sideEffect）
      assert.isString(descriptor.name)
      assert.isString(descriptor.description)
      assert.isAbove(descriptor.description.length, 0)
      assert.isArray(descriptor.requiredPermissions)
      assert.isObject(descriptor.parameters)
      assert.isObject(descriptor.parametersJsonSchema)
      assert.isTrue(['read', 'navigate', 'write'].includes(descriptor.sideEffect))
      // 禁止泄漏 handler 实现（RL-14 元数据纯净性）
      assert.isUndefined(descriptor.handler)
    }
    // 注册表已静态装配并 seal（RL-14），无任何测试残留工具
    assert.isFalse(
      body.data.some((item: { name: string }) => item.name.includes('probe')),
      '工具清单不应包含测试探针',
    )
  })

  test('未登录请求返回 401 AUTH_REQUIRED', async ({ client }) => {
    const listing = await client.get('/api/v1/ai/tools')
    listing.assertStatus(401)
    listing.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
    const execute = await client.post('/api/v1/ai/tools/execute').json({
      toolName: 'get_project_summary',
      parameters: {},
    })
    execute.assertStatus(401)
  })

  test('信封不合法返回 422 VALIDATION_ERROR', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('tools-422-owner') })
    await createOrganization(owner)
    const token = await login(client, owner)
    const missingToolName = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({ parameters: { projectId: 1 } })
    missingToolName.assertStatus(422)
    missingToolName.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    const missingParameters = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({ toolName: 'get_project_summary' })
    missingParameters.assertStatus(422)
    const badPreviewToken = await client
      .post('/api/v1/ai/tools/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'get_project_summary',
        previewToken: 'not-hex',
        parameters: { projectId: 1 },
      })
    badPreviewToken.assertStatus(422)
  })

  test('未知工具名返回 404 RESOURCE_NOT_FOUND', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('tools-404-owner') })
    await createOrganization(owner)
    const token = await login(client, owner)
    const response = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({ toolName: 'definitely_not_registered_tool', parameters: {} })
    response.assertStatus(404)
    response.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('缺少 ai:trigger 权限执行被 403 拦截且留下 REJECTED 审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('tools-403-owner') })
    const viewer = await createUser({ email: uniqueEmail('tools-403-viewer') })
    const org = await createOrganization(owner)
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer)
    // viewer（READONLY_OBSERVER）无 ai:trigger：策略层在工具逻辑前拦截，入参不生效
    const response = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({ toolName: 'get_project_summary', parameters: { projectId: 1 } })
    response.assertStatus(403)
    response.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    // 同角色无 ai:confirm：写工具 confirm 同样被 403 拦截（tasks 2.11 确认门禁）
    const confirmDenied = await client
      .post('/api/v1/ai/tools/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'update_task_schedule',
        previewToken: 'a'.repeat(64),
        parameters: { projectId: 1 },
      })
    confirmDenied.assertStatus(403)
    confirmDenied.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    // RL-12：拦截调用同样留痕（REJECTED + PERMISSION_DENIED + parametersHash，无明文）
    const viewerRejects = await AuditLog.query()
      .where('entity_type', 'ai_tool')
      .where('action', 'reject')
      .where('user_id', viewer.id)
      .orderBy('id', 'desc')
    assert.isAtLeast(viewerRejects.length, 2)
    const rejectedToolNames = viewerRejects.map(
      (row) => (row.metadata as Record<string, unknown>)['toolName'],
    )
    assert.include(rejectedToolNames, 'get_project_summary')
    assert.include(rejectedToolNames, 'update_task_schedule')
    for (const row of viewerRejects) {
      const metadata = row.metadata as Record<string, unknown>
      assert.equal(metadata['status'], 'REJECTED')
      assert.equal(metadata['errorCode'], 'PERMISSION_DENIED')
      assert.match(metadata['parametersHash'] as string, /^[0-9a-f]{64}$/)
      assert.isFalse(JSON.stringify(metadata).includes('projectId'))
    }
  })

  test('具备 ai:trigger 的 owner 执行只读工具返回 200 SUCCESS 且审计留痕', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('tools-200-owner') })
    const { org, project } = await orgWithProject(owner)
    await Task.create({
      projectId: project.id,
      name: '框架冒烟任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: DateTime.fromISO('2026-07-01'),
      endDate: DateTime.fromISO('2026-07-03'),
      durationDays: 3,
    })
    const token = await login(client, owner)
    const response = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({ toolName: 'get_project_summary', parameters: { projectId: project.id } })
    response.assertStatus(200)
    const body = response.body()
    assert.equal(body.meta.toolName, 'get_project_summary')
    assert.equal(body.meta.status, 'SUCCESS')
    assert.isNumber(body.meta.durationMs)
    assert.equal(body.data.id, project.id)
    assert.equal(body.data.taskCount, 1)
    const audit = await AuditLog.query()
      .where('entity_type', 'ai_tool')
      .where('action', 'ai_generate')
      .where('user_id', owner.id)
      .where('organization_id', org.id)
      .orderBy('id', 'desc')
      .first()
    assert.isNotNull(audit)
    const metadata = audit!.metadata as Record<string, unknown>
    assert.equal(metadata['toolName'], 'get_project_summary')
    assert.equal(metadata['status'], 'SUCCESS')
    assert.match(metadata['parametersHash'] as string, /^[0-9a-f]{64}$/)
    assert.isFalse(JSON.stringify(metadata).includes('框架冒烟任务'))
  })

  test('对非写工具调用 confirm 返回 422（仅 write 工具可确认，RL-01）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('tools-confirm-owner') })
    await createOrganization(owner)
    const token = await login(client, owner)
    const previewToken = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const response = await client
      .post('/api/v1/ai/tools/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({ toolName: 'get_project_summary', previewToken, parameters: { projectId: 1 } })
    response.assertStatus(422)
    response.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })
})
