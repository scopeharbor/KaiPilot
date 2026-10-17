/**
 * 知识库列表 API 状态过滤与详情契约功能测试。
 *
 * 修复回归（真实产品 bug）：
 * - 列表曾硬过滤 `status='active'`，`status` 参数被忽略 → 待审/草稿不可达；
 * - 检索校验曾读 `request.body()`（GET 无 body）→ 所有 query 参数都到不了服务层；
 * - 详情曾返回低敏投影，而 api-contract 冻结点要求完整 `KnowledgeItem`
 *   （审查抽屉依赖 content/reviewHistory）。
 *
 * 覆盖：
 * - GET /api/v1/knowledge 缺省只返回 active（契约「status 参数，默认 active」）；
 * - `?status=pending` / `?status=draft` 返回对应状态条目（治理视图可达）；
 * - 非法 status → 400 VALIDATION_ERROR（枚举收紧）；
 * - GET /api/v1/knowledge/:id 返回完整 KnowledgeItem（含 content/reviewHistory）；
 * - 跨组织隔离不因 status 过滤而失效。
 */
import { test } from '@japa/runner'
import KnowledgeItem from '#models/knowledge_item'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAuthDatabase,
} from './auth/_helpers.js'

const BASE = '/api/v1/knowledge'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 直接落库知识条目（功能测试只验证 HTTP 契约链路，不走 Service）。 */
async function seedItem(
  orgId: number,
  actorId: number,
  over: { status: 'draft' | 'pending' | 'active'; title: string; content?: string },
): Promise<KnowledgeItem> {
  return KnowledgeItem.create({
    organizationId: orgId,
    layer: 'L1',
    layerMeta: {} as never,
    title: over.title,
    content: over.content ?? '正文内容',
    status: over.status,
    domain: '进度管理',
    purpose: '规划',
    complexity: null,
    provenance: {
      sources: [{ layer: 'L1', sourceId: 'src-1', title: '来源 1' }],
    } as never,
    reviewHistory: [] as never,
    isSynthetic: false,
    syntheticMethod: null,
    createdBy: actorId,
    updatedBy: null,
    lastReferencedAt: null,
    retentionDays: null,
  })
}

test.group('Knowledge API 列表状态过滤（契约冻结点）', (group) => {
  useAuthDatabase(group)

  test('缺省只返回 active；status=pending/draft 返回对应条目', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const token = await login(client, owner.email)
    await seedItem(org.id, owner.id, { status: 'draft', title: '草稿条目' })
    await seedItem(org.id, owner.id, { status: 'pending', title: '待审条目' })
    await seedItem(org.id, owner.id, { status: 'active', title: '活跃条目' })

    // 缺省 → 仅 active
    const def = await client.get(BASE).bearerToken(token)
    def.assertStatus(200)
    const defData = def.body().data as Array<{ title: string; status: string }>
    assert.equal(defData.length, 1, '缺省应只返回 active 条目')
    assert.equal(defData[0].title, '活跃条目')
    assert.equal(def.body().meta.total, 1)

    // status=pending → 待审治理视图
    const pendings = await client.get(`${BASE}?status=pending`).bearerToken(token)
    pendings.assertStatus(200)
    const pendingData = pendings.body().data as Array<{ title: string; status: string }>
    assert.equal(pendingData.length, 1)
    assert.equal(pendingData[0].title, '待审条目')
    assert.equal(pendingData[0].status, 'pending')

    // status=draft → 草稿视图
    const drafts = await client.get(`${BASE}?status=draft`).bearerToken(token)
    drafts.assertStatus(200)
    const draftData = drafts.body().data as Array<{ title: string }>
    assert.equal(draftData.length, 1)
    assert.equal(draftData[0].title, '草稿条目')
  })

  test('非法 status 参数 → 400 VALIDATION_ERROR（枚举收紧）', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const res = await client.get(`${BASE}?status=__nope__`).bearerToken(token)
    res.assertStatus(400)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
  })

  test('详情返回完整 KnowledgeItem（content/reviewHistory 契约可达）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const token = await login(client, owner.email)
    const item = await seedItem(org.id, owner.id, {
      status: 'pending',
      title: '待审详情条目',
      content: '可审查的正文内容',
    })

    const res = await client.get(`${BASE}/${item.id}`).bearerToken(token)
    res.assertStatus(200)
    const body = res.body().data as Record<string, unknown>
    assert.equal(body.title, '待审详情条目')
    assert.equal(body.status, 'pending')
    assert.equal(body.content, '可审查的正文内容')
    assert.isArray(body.reviewHistory)
    assert.isObject(body.layerMeta)
  })

  test('跨组织隔离不因 status 过滤而失效', async ({ client, assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    await seedItem(orgA.id, ownerA.id, { status: 'active', title: 'A 组织条目' })

    const ownerB = await createUser()
    await createOrganization(ownerB)
    const tokenB = await login(client, ownerB.email)
    const res = await client.get(`${BASE}?status=pending`).bearerToken(tokenB)
    res.assertStatus(200)
    assert.equal(res.body().data.length, 0, '其他组织看不到任何状态条目')
  })
})
