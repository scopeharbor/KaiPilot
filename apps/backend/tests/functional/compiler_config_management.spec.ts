/**
 * v2-5-compiler-config-management-api —— Compiler 配置管理集成测试（真实 login flow + DB）。
 *
 * 覆盖：
 * - 切片 1：只读解析（低敏字段断言、跨组织隔离、无权限拒绝、生效配置解析正确）
 * - 切片 2：只读 preview（差异正确、no-write、no-execute、校验错误）
 * - 切片 3：受控编排写入（需确认落库、Policy/RBAC 拒绝、每次写入新版本、审计、no-auto-apply）
 * - 运行时接线：feature-off 零行为变化回归
 * - 安全：低敏投影、RBAC 拒绝不泄漏存在性
 *
 * 认证走真实登录（POST /api/v1/auth/login → accessToken），非假 token。组织由登录时嵌入
 * JWT 的 organizationId 决定（tenant_middleware 从 payload 解析，不读任何请求头）；因此「跨组织」
 * 在真实登录下由「org 绑定于 token」保证，测试以组织隔离断言取代不可达的 404 路径。
 */
import { test } from '@japa/runner'
import CompilerConfigProfile from '#models/compiler_config_profile'
import CompilerRun from '#models/compiler_run'
import { CompilerBudgetPolicyResolver } from '#services/compiler/budget_policy_resolver'
import { isCompilerStageCacheEnabled } from '#services/compiler/stage_cache_service'
import { getEffectiveConfig } from '#services/compiler/compiler_config_service'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function loginToken(client: any, email: string): Promise<string> {
  const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  return login.body().data.accessToken
}

// =============================================================================
// 切片 1 —— 只读解析 API
// =============================================================================

test.group('Compiler Config - Slice 1 (Read API)', (group) => {
  useAuthDatabase(group)

  test('GET /config 返回生效配置（无 profile 时回落系统默认）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    const org = await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .get('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body() as any
    assert.exists(body.data)
    assert.equal(body.data.organizationId, org.id)
    assert.equal(body.data.source, 'system_default')
    assert.isNull(body.data.sourceVersion)
    assert.exists(body.data.featureToggles)
    assert.exists(body.data.cachePolicyVersion)
    assert.exists(body.data.cacheTtlSeconds)
    assert.exists(body.data.cacheStoreKind)
  })

  test('GET /config 包含低敏字段（无 prompt/secret/token）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .get('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const json = JSON.stringify(res.body())
    assert.notInclude(json, 'prompt')
    assert.notInclude(json, 'secret')
    assert.notInclude(json, 'token')
    assert.notInclude(json, 'modelOutput')
    assert.notInclude(json, 'artifact')
  })

  test('GET /config/profile 返回版本历史', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    const org = await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .get('/api/v1/ai/compiler/config/profile')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body() as any
    assert.exists(body.data)
    assert.equal(body.data.organizationId, org.id)
    assert.isArray(body.data.history)
  })

  test('GET /config - 无权限用户返回 403', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')
    const token = await loginToken(client, member.email)

    const res = await client
      .get('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(403)
    assert.equal((res.body() as any).error?.code, 'PERMISSION_DENIED')
  })

  test('GET /config 跨组织隔离：只见自身范围（看不到他组 profile）', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('cfgA') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('cfgB') })
    await createOrganization(ownerB)

    // B 写入一个 active profile
    const tokenB = await loginToken(client, ownerB.email)
    const wb = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${tokenB}`)
      .json({ featureToggles: { stageCacheEnabled: false }, confirm: true })
    wb.assertStatus(200)

    // A 读取自身生效配置：回落系统默认，看不到 B 的 profile
    const tokenA = await loginToken(client, ownerA.email)
    const res = await client
      .get('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${tokenA}`)

    res.assertStatus(200)
    const body = res.body() as any
    assert.equal(body.data.organizationId, orgA.id)
    assert.equal(body.data.source, 'system_default', 'A 看不到 B 的 profile')
    assert.isNull(body.data.sourceVersion)
  })

  test('GET /config - 未认证返回 401', async ({ client }) => {
    const res = await client.get('/api/v1/ai/compiler/config')
    res.assertStatus(401)
  })
})

// =============================================================================
// 切片 2 —— 只读 preview / 差异
// =============================================================================

test.group('Compiler Config - Slice 2 (Preview)', (group) => {
  useAuthDatabase(group)

  test('POST /config/preview 返回有效差异', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/config/preview')
      .header('Authorization', `Bearer ${token}`)
      .json({
        featureToggles: { stageCacheEnabled: true },
        budgetPolicies: [],
        cachePolicy: { policyVersion: '1', ttlSeconds: 7200, storeKind: 'auto' },
      })

    res.assertStatus(200)
    const body = res.body() as any
    assert.exists(body.data)
    assert.isTrue(body.data.valid)
    assert.isArray(body.data.diff)
    assert.exists(body.data.impactPreview)
    assert.isAbove(body.data.prospectiveVersion, 0)
  })

  test('POST /config/preview 未知开关返回校验错误', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/config/preview')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { unknownToggle: true } })

    res.assertStatus(200)
    const body = res.body() as any
    assert.isFalse(body.data.valid)
    assert.isNotEmpty(body.data.validationErrors)
    assert.include(body.data.validationErrors[0], '未知开关')
  })

  test('POST /config/preview 无副作用（不新增版本）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    const org = await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const before = await CompilerConfigProfile.forOrganization(org.id).count('* as count')
    const beforeTotal = Number(before[0].$extras?.count ?? 0)

    const res = await client
      .post('/api/v1/ai/compiler/config/preview')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: true } })

    res.assertStatus(200)

    const after = await CompilerConfigProfile.forOrganization(org.id).count('* as count')
    const afterTotal = Number(after[0].$extras?.count ?? 0)
    assert.equal(afterTotal, beforeTotal)
  })

  test('POST /config/preview - 无权限返回 403', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')
    const token = await loginToken(client, member.email)

    const res = await client
      .post('/api/v1/ai/compiler/config/preview')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: true } })

    res.assertStatus(403)
    assert.equal((res.body() as any).error?.code, 'PERMISSION_DENIED')
  })
})

// =============================================================================
// 切片 3 —— 受控编排写入
// =============================================================================

test.group('Compiler Config - Slice 3 (Write)', (group) => {
  useAuthDatabase(group)

  test('POST /config 需 confirm=true 才落库', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: false }, confirm: false })

    res.assertStatus(400)
    const body = res.body() as any
    assert.equal(body.error?.code, 'VALIDATION_ERROR')
    assert.include(body.error?.message, '显式确认')
  })

  test('POST /config confirm=true 成功写入并产生新版本', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    const org = await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)
      .json({
        featureToggles: { stageCacheEnabled: true },
        budgetPolicies: [
          {
            name: 'test-policy',
            scope: 'organization',
            scopeValue: String(org.id),
            enabled: true,
            onSoftLimit: 'warn',
            onHardLimit: 'block',
          },
        ],
        cachePolicy: { policyVersion: '1', ttlSeconds: 3600, storeKind: 'auto' },
        confirm: true,
      })

    res.assertStatus(200)
    const body = res.body() as any
    assert.exists(body.data)
    assert.isAbove(body.data.version, 0)
    assert.isTrue(body.data.isActive)
    assert.isArray(body.data.budgetPolicyNames)
    assert.include(body.data.budgetPolicyNames, 'test-policy')
  })

  test('POST /config 每次写入产生新版本号', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const res1 = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: true }, confirm: true })
    res1.assertStatus(200)
    const v1 = (res1.body() as any).data.version

    const res2 = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: false }, confirm: true })
    res2.assertStatus(200)
    const v2 = (res2.body() as any).data.version

    assert.isAbove(v2, v1)
  })

  test('PATCH /config/activate 切换版本激活状态', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const create = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: true }, confirm: true })
    create.assertStatus(200)
    const version = (create.body() as any).data.version

    const deactivate = await client
      .patch('/api/v1/ai/compiler/config/activate')
      .header('Authorization', `Bearer ${token}`)
      .json({ version, active: false, confirm: true })

    deactivate.assertStatus(200)
    assert.isFalse((deactivate.body() as any).data.isActive)

    const reactivate = await client
      .patch('/api/v1/ai/compiler/config/activate')
      .header('Authorization', `Bearer ${token}`)
      .json({ version, active: true, confirm: true })

    reactivate.assertStatus(200)
    assert.isTrue((reactivate.body() as any).data.isActive)
  })

  test('POST /config - 无 manage 权限返回 403', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')
    const token = await loginToken(client, member.email)

    const res = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: true }, confirm: true })

    res.assertStatus(403)
    assert.equal((res.body() as any).error?.code, 'PERMISSION_DENIED')
  })

  test('POST /config 跨组织隔离：A 的写入不进入 B 的版本历史', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('wA') })
    await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('wB') })
    const orgB = await createOrganization(ownerB)

    const tokenA = await loginToken(client, ownerA.email)
    const wa = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${tokenA}`)
      .json({ featureToggles: { stageCacheEnabled: true }, confirm: true })
    wa.assertStatus(200)

    const tokenB = await loginToken(client, ownerB.email)
    const hist = await client
      .get('/api/v1/ai/compiler/config/profile')
      .header('Authorization', `Bearer ${tokenB}`)

    hist.assertStatus(200)
    const body = hist.body() as any
    assert.equal(body.data.organizationId, orgB.id)
    assert.isEmpty(body.data.history, 'B 看不到 A 写入的版本')
  })

  test('POST /config 写入不触发 Compiler run（no-auto-apply）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cfgadmin') })
    const org = await createOrganization(owner)
    const token = await loginToken(client, owner.email)

    const before = await CompilerRun.query().where('organization_id', org.id).count('* as count')
    const beforeTotal = Number(before[0].$extras?.count ?? 0)

    const res = await client
      .post('/api/v1/ai/compiler/config')
      .header('Authorization', `Bearer ${token}`)
      .json({ featureToggles: { stageCacheEnabled: true }, confirm: true })
    res.assertStatus(200)

    // 配置写入不得触发任何 Compiler run（no-auto-apply 红线）
    const after = await CompilerRun.query().where('organization_id', org.id).count('* as count')
    const afterTotal = Number(after[0].$extras?.count ?? 0)
    assert.equal(afterTotal, beforeTotal)
    assert.equal(afterTotal, 0)
  })
})

// =============================================================================
// 运行时接线 —— feature-off 零行为变化回归
// =============================================================================

test.group('Compiler Config - Runtime Wiring (Feature-off)', (group) => {
  useAuthDatabase(group)

  test('budget resolver 无 profile 时保持 DEFAULT_POLICY', async ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    const result = resolver.resolve({ organizationId: 99999 })
    assert.isUndefined(result.softLimit)
    assert.isUndefined(result.hardLimit)
    assert.equal(result.onSoftLimit, 'warn')
    assert.equal(result.onHardLimit, 'block')
    assert.equal(result.currency, 'CNY')
    assert.isEmpty(result.appliedPolicies)
  })

  test('budget resolver loadFromPolicies 加载策略', async ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.loadFromPolicies([
      {
        name: 'org-default',
        scope: 'organization',
        scopeValue: '1',
        enabled: true,
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        softLimit: 100,
      },
    ])
    const result = resolver.resolve({ organizationId: 1 })
    assert.equal(result.softLimit, 100)
    assert.include(result.appliedPolicies, 'org-default')
  })

  test('budget resolver loadFromPolicies 空数组不改变默认', async ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.loadFromPolicies([])
    const result = resolver.resolve({ organizationId: 1 })
    assert.equal(result.currency, 'CNY')
  })

  test('stage cache toggle 无 profile 时回落 env 默认', async ({ assert }) => {
    const envValue = isCompilerStageCacheEnabled()
    assert.isBoolean(envValue)
  })

  test('getEffectiveConfig 无 profile 时 source=system_default', async ({ assert }) => {
    const config = await getEffectiveConfig(99999)
    assert.equal(config.source, 'system_default')
    assert.isNull(config.sourceVersion)
    assert.isArray(config.budgetPolicyNames)
    assert.isEmpty(config.budgetPolicyNames)
  })

  test('getEffectiveConfig 同组织同版本解析确定性', async ({ assert }) => {
    const config1 = await getEffectiveConfig(88888)
    const config2 = await getEffectiveConfig(88888)
    assert.equal(config1.cachePolicyVersion, config2.cachePolicyVersion)
    assert.equal(config1.cacheTtlSeconds, config2.cacheTtlSeconds)
    assert.equal(config1.cacheStoreKind, config2.cacheStoreKind)
    assert.equal(config1.source, config2.source)
  })
})
