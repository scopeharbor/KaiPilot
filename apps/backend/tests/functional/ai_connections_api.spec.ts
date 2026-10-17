/**
 * ai-gateway-abstraction-test-debt —— 覆盖 2.3/2.2：
 *   AiConnectionsController API 测试 + RBAC 权限。
 * 依赖共享夹具 auth/_helpers 与 ai/_helpers。
 *
 * 注意：createOrganization 已把 owner 用户加为 owner 角色成员。
 * 各测试用例用 owner 执行管理操作；403 测试复用第二个 viewer 用户。
 */
import { test } from '@japa/runner'
import type { AiConnectionDto, AiConnectionTestResult } from '@aiproj/types'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'

const BASE = '/api/v1/ai/connections'

/** 从单对象响应取 data 字段 */
function dataOf<T>(body: unknown): T {
  return (body as { data: T }).data
}

async function login(client: any, email: string) {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

test.group('AiConnectionsController API', (group) => {
  useAiDatabase(group)

  test('GET 列表 - 未认证返回 401', async ({ client }) => {
    const res = await client.get(BASE)
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('GET 列表 - 空列表', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)
    const res = await client.get(BASE).bearerToken(token)
    res.assertStatus(200)
    assert.deepEqual(res.body(), { data: [] })
  })

  test('POST 创建 - 成功', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.post(BASE).bearerToken(token).json({
      displayName: '新连接',
      protocol: 'openai_compatible',
      apiKey: 'sk-test-123',
      model: 'gpt-5.4-mini',
    })
    res.assertStatus(201)
    const dto = dataOf<AiConnectionDto>(res.body())
    assert.equal(dto.displayName, '新连接')
    assert.isTrue(dto.hasKey)
    assert.isTrue(dto.isActive)
    assert.notProperty(dto, 'apiKey')
  })

  test('POST 创建 - 支持只提交模型列表', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        displayName: '多模型连接',
        protocol: 'openai_compatible',
        apiKey: 'sk-test-123',
        models: [
          {
            modelName: 'draft-model',
            capabilities: ['chat', 'project_draft'],
            rpmLimit: 30,
            tpmLimit: 20_000,
            isActive: true,
          },
          {
            modelName: 'ocr-model',
            capabilities: ['ocr', 'vision'],
            rpmLimit: null,
            tpmLimit: null,
            isActive: true,
          },
        ],
      })
    res.assertStatus(201)
    const dto = dataOf<AiConnectionDto>(res.body())
    assert.equal(dto.model, 'draft-model')
    assert.lengthOf(dto.models, 2)
    assert.equal(dto.models[0].modelName, 'draft-model')
    assert.deepEqual(dto.models[1].capabilities, ['ocr', 'vision'])
    assert.notProperty(dto, 'apiKey')
  })

  test('POST 创建 - validation error', async ({ client }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.post(BASE).bearerToken(token).json({
      displayName: '',
      protocol: 'invalid_protocol',
    })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('POST 创建 - 无权限返回 403', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client.post(BASE).bearerToken(token).json({
      displayName: '越权创建',
      protocol: 'openai_compatible',
      model: 'gpt-4o',
    })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('GET :id 详情', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)
    const c = await client.post(BASE).bearerToken(token).json({
      displayName: '详情测试',
      protocol: 'openai_compatible',
      model: 'gpt-4o',
      apiKey: 'sk-detail',
    })
    const id = dataOf<AiConnectionDto>(c.body()).id

    const res = await client.get(`${BASE}/${id}`).bearerToken(token)
    res.assertStatus(200)
    const detail = dataOf<AiConnectionDto>(res.body())
    assert.equal(detail.displayName, '详情测试')
    assert.notProperty(detail, 'apiKey')
  })

  test('GET :id 不存在返回 404', async ({ client }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)
    const res = await client.get(`${BASE}/99999`).bearerToken(token)
    res.assertStatus(404)
  })

  test('PATCH :id 更新', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)
    const c = await client.post(BASE).bearerToken(token).json({
      displayName: '改名前',
      protocol: 'openai_compatible',
      model: 'gpt-4o',
      apiKey: 'sk-old',
    })
    const id = dataOf<AiConnectionDto>(c.body()).id

    const res = await client
      .patch(`${BASE}/${id}`)
      .bearerToken(token)
      .json({ displayName: '改名后' })
    res.assertStatus(200)
    assert.equal(dataOf<AiConnectionDto>(res.body()).displayName, '改名后')
  })

  test('DELETE :id 删除', async ({ client }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)
    const c = await client.post(BASE).bearerToken(token).json({
      displayName: '待删除',
      protocol: 'openai_compatible',
      model: 'gpt-4o',
      apiKey: 'sk-del',
    })
    const id = dataOf<AiConnectionDto>(c.body()).id

    const res = await client.delete(`${BASE}/${id}`).bearerToken(token)
    res.assertStatus(204)
  })

  test('DELETE 无权限返回 403', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client.delete(`${BASE}/1`).bearerToken(token)
    res.assertStatus(403)
  })

  test('POST :id/test 无权限返回 403', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client.post(`${BASE}/1/test`).bearerToken(token)
    res.assertStatus(403)
  })

  test('POST :id/test 停用连接返回错误', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)
    const c = await client.post(BASE).bearerToken(token).json({
      displayName: '停用测试',
      protocol: 'openai_compatible',
      model: 'gpt-4o',
      apiKey: 'sk-test',
      isActive: false,
    })
    const id = dataOf<AiConnectionDto>(c.body()).id

    const res = await client.post(`${BASE}/${id}/test`).bearerToken(token)
    res.assertStatus(200)
    const testData = dataOf<AiConnectionTestResult>(res.body())
    assert.isFalse(testData.ok)
    assert.equal(testData.errorKind, 'VALIDATION_ERROR')
  })
})
