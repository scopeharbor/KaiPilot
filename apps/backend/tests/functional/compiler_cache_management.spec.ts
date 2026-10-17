/**
 * v2-5-compiler-cache-management-api —— Compiler 缓存管理集成测试（真实 login flow + DB）。
 *
 * 覆盖：
 * - 切片 1 GET /cache（task 3.4/3.5）：低敏、storeKind/count/policy 版本/enabled 正确、
 *   跨组织只见自身、无权限 403 不泄漏、未认证 401、无 Redis 默认走内存 store 完整可用
 * - 切片 2 预览（task 4.3）：将清除计数正确、no-delete、非法范围 VALIDATION_ERROR
 * - 切片 3 失效（task 5.5/5.6）：需显式确认才清除、RBAC 拒绝、审计写入、非法范围不清除、
 *   no-auto-apply（不触发 Compiler run、不 apply artifact、不写业务表）
 *
 * 认证走真实登录（POST /api/v1/auth/login → accessToken），非假 token。
 */
import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import { memoryCacheStore } from '#services/cache/cache_factory'
import { MemoryCacheStore } from '#services/cache/cache_store'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

type CacheTestResponse<T> = { data: T }
type CacheErrorResponse = { error?: { code?: string } }

/** 清空进程内共享内存缓存（store 单例跨用例持有，须逐用例清零）。 */
function clearCache() {
  const store = memoryCacheStore()
  if (store instanceof MemoryCacheStore) store.clear()
}

/** 以生产键格式（stage:<stageId>:<hash>）向共享内存 store 预填组织缓存。 */
async function seedStage(orgId: number, stageId: string, n: number): Promise<void> {
  const store = memoryCacheStore()
  for (let i = 0; i < n; i++) {
    await store.set(orgId, `stage:${stageId}:h${i}`, JSON.stringify({ v: i }), 3600)
  }
}

async function loginToken(client: any, email: string): Promise<string> {
  const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  return (login.body() as CacheTestResponse<{ accessToken: string }>).data.accessToken
}

// =============================================================================
// 切片 1 —— 只读盘点
// =============================================================================

test.group('Compiler Cache - Slice 1 (Inventory)', (group) => {
  useAuthDatabase(group)
  group.each.setup(clearCache)

  test('GET /cache 返回 storeKind/count/cachePolicyVersion/stageCacheEnabled', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    const token = await loginToken(client, owner.email)

    const res = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))

    res.assertStatus(200)
    const body = res.body() as CacheTestResponse<{
      organizationId: number
      storeKind: string
      count: number
      cachePolicyVersion: string
      stageCacheEnabled: boolean
      sampleKeyHashes: string[]
    }>
    assert.equal(body.data.organizationId, org.id)
    assert.equal(body.data.storeKind, 'memory')
    assert.equal(body.data.count, 3)
    assert.equal(body.data.cachePolicyVersion, '1')
    assert.isBoolean(body.data.stageCacheEnabled)
    assert.isArray(body.data.sampleKeyHashes)
  })

  test('GET /cache 低敏：无缓存值正文/prompt/token/artifact', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 2)
    const token = await loginToken(client, owner.email)

    const res = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))

    res.assertStatus(200)
    const json = JSON.stringify(res.body())
    assert.notInclude(json, 'prompt')
    assert.notInclude(json, 'secret')
    assert.notInclude(json, 'modelOutput')
    assert.notInclude(json, 'artifact')
    // 预填的缓存值正文（{"v":0}）不得出现在盘点响应里
    assert.notInclude(json, '"v":')
  })

  test('GET /cache?stageId= 按 stage 细分计数', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    await seedStage(org.id, 'dag_stub', 2)
    const token = await loginToken(client, owner.email)

    const res = await client
      .get('/api/v1/ai/compiler/cache?stageId=intent_parsing')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))

    res.assertStatus(200)
    const body = res.body() as CacheTestResponse<{ count: number; stageId: string }>
    assert.equal(body.data.count, 3)
    assert.equal(body.data.stageId, 'intent_parsing')
  })

  test('GET /cache?stageId= 拒绝 Redis glob 通配符', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    await seedStage(org.id, 'dag_stub', 2)
    const token = await loginToken(client, owner.email)

    const res = await client
      .get('/api/v1/ai/compiler/cache?stageId=*')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))

    res.assertStatus(400)
    assert.equal((res.body() as CacheErrorResponse).error?.code, 'VALIDATION_ERROR')
    const inv = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    assert.equal((inv.body() as CacheTestResponse<{ count: number }>).data.count, 5)
  })

  test('GET /cache 跨组织只见自身范围', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('orga') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('orgb') })
    const orgB = await createOrganization(ownerB)
    await seedStage(orgA.id, 'intent_parsing', 2)
    await seedStage(orgB.id, 'intent_parsing', 5)
    const token = await loginToken(client, ownerA.email)

    const res = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(orgA.id))

    res.assertStatus(200)
    assert.equal(
      (res.body() as CacheTestResponse<{ count: number }>).data.count,
      2,
      '只见 A 的缓存条目，不含 B 的 5 条',
    )
  })

  test('GET /cache 无权限用户 403 PERMISSION_DENIED', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')
    const token = await loginToken(client, member.email)

    const res = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))

    res.assertStatus(403)
    assert.equal((res.body() as CacheErrorResponse).error?.code, 'PERMISSION_DENIED')
    // 不泄漏缓存规模/存在性
    assert.notInclude(JSON.stringify(res.body()), 'count')
  })

  test('GET /cache 未认证 401', async ({ client }) => {
    const res = await client.get('/api/v1/ai/compiler/cache')
    res.assertStatus(401)
  })
})

// =============================================================================
// 切片 2 —— 只读失效预览
// =============================================================================

test.group('Compiler Cache - Slice 2 (Preview)', (group) => {
  useAuthDatabase(group)
  group.each.setup(clearCache)

  test('预览将清除计数正确且 no-delete', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    await seedStage(org.id, 'dag_stub', 2)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/cache/invalidation/preview')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'stage', stageId: 'intent_parsing' })

    res.assertStatus(200)
    const body = res.body() as CacheTestResponse<{ affectedCount: number; remainingCount: number }>
    assert.equal(body.data.affectedCount, 3)
    assert.equal(body.data.remainingCount, 2)

    // no-delete：预览后总盘点不变
    const inv = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    assert.equal((inv.body() as CacheTestResponse<{ count: number }>).data.count, 5)
  })

  test('非法失效范围 → VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/cache/invalidation/preview')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'keyGlob', keyPrefix: 'stage:*' })

    res.assertStatus(400)
    assert.equal((res.body() as CacheErrorResponse).error?.code, 'VALIDATION_ERROR')
  })

  test('stage 范围拒绝 Redis glob 通配符 stageId', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    await seedStage(org.id, 'dag_stub', 2)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/cache/invalidation/preview')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'stage', stageId: '*' })

    res.assertStatus(400)
    assert.equal((res.body() as CacheErrorResponse).error?.code, 'VALIDATION_ERROR')
    const inv = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    assert.equal(
      (inv.body() as CacheTestResponse<{ count: number }>).data.count,
      5,
      '校验失败不扩大匹配也不删除',
    )
  })
})

// =============================================================================
// 切片 3 —— 受控失效写入
// =============================================================================

test.group('Compiler Cache - Slice 3 (Invalidation)', (group) => {
  useAuthDatabase(group)
  group.each.setup(clearCache)

  test('未显式确认（confirm=false）不清除 → 400', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/cache/invalidation')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'organization', confirm: false })

    res.assertStatus(400)
    assert.equal((res.body() as CacheErrorResponse).error?.code, 'VALIDATION_ERROR')
    // 未清除
    const inv = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    assert.equal((inv.body() as CacheTestResponse<{ count: number }>).data.count, 3)
  })

  test('确认后清除并返回 removedCount + 写低敏审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    await seedStage(org.id, 'dag_stub', 2)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/cache/invalidation')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'stage', stageId: 'intent_parsing', confirm: true })

    res.assertStatus(200)
    assert.equal((res.body() as CacheTestResponse<{ removedCount: number }>).data.removedCount, 3)

    // 缓存实际减少
    const inv = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    assert.equal((inv.body() as CacheTestResponse<{ count: number }>).data.count, 2)

    // 审计写入（低敏：action=delete、event=AI_COMPILER_CACHE_INVALIDATED、含 scope/removedCount）
    const log = await AuditLog.query()
      .where('organization_id', org.id)
      .where('action', 'delete')
      .orderBy('id', 'desc')
      .first()
    assert.isNotNull(log)
    assert.equal((log!.metadata as any).event, 'AI_COMPILER_CACHE_INVALIDATED')
    assert.equal((log!.metadata as any).scope, 'stage')
    assert.equal((log!.metadata as any).removedCount, 3)
    // 低敏：审计不含缓存值正文
    assert.notInclude(JSON.stringify(log!.metadata), '"v":')
  })

  test('无 manage 权限用户 403（RBAC + 组织隔离）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')
    await seedStage(org.id, 'intent_parsing', 3)
    const token = await loginToken(client, member.email)

    const res = await client
      .post('/api/v1/ai/compiler/cache/invalidation')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'organization', confirm: true })

    res.assertStatus(403)
    assert.equal((res.body() as CacheErrorResponse).error?.code, 'PERMISSION_DENIED')
  })

  test('非法失效范围不清除任何条目 → VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 3)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/cache/invalidation')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'stage', confirm: true }) // stage 缺 stageId

    res.assertStatus(400)
    assert.equal((res.body() as CacheErrorResponse).error?.code, 'VALIDATION_ERROR')
    const inv = await client
      .get('/api/v1/ai/compiler/cache')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    assert.equal(
      (inv.body() as CacheTestResponse<{ count: number }>).data.count,
      3,
      '校验失败不清除任何条目',
    )
  })

  test('no-auto-apply：失效只清加速层，不触发 run/apply、不写业务表', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('cacheadmin') })
    const org = await createOrganization(owner)
    await seedStage(org.id, 'intent_parsing', 2)
    const token = await loginToken(client, owner.email)

    await client
      .post('/api/v1/ai/compiler/cache/invalidation')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
      .json({ scope: 'organization', confirm: true })

    // 不得触发 Compiler run / artifact apply（无 ai_generate/apply 审计）
    const generative = await AuditLog.query()
      .where('organization_id', org.id)
      .whereIn('action', ['ai_generate', 'apply'])
    assert.lengthOf(generative, 0, '失效不触发任何 run/apply')

    // 唯一副作用是一条 delete（缓存失效）审计
    const deletes = await AuditLog.query()
      .where('organization_id', org.id)
      .where('action', 'delete')
    assert.lengthOf(deletes, 1)
  })
})
