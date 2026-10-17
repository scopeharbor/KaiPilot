/**
 * v3-skill-registry-and-lifecycle —— Compiler Skills API 集成测试。
 *
 * 覆盖：CRUD 端点、生命周期转移、匹配预览、feature-off、越权、边界。
 */
import { test } from '@japa/runner'
import env from '#start/env'
import CompilerSkill from '#models/compiler_skill'
import AuditLog from '#models/audit_log'
import type User from '#models/user'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function loginOrg(client: any, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setupOrgUser(client: any) {
  const email = uniqueEmail('skill')
  const user = await createUser({ email })
  const org = await createOrganization(user)
  const token = await loginOrg(client, user)
  return { user, org, token }
}

test.group('Compiler Skills API', (group) => {
  useAuthDatabase(group)

  // Skill Registry 默认关闭（.env.example 为 false）；用例自行开启，不依赖本机 .env
  group.setup(() => {
    const previous = env.get('COMPILER_SKILL_REGISTRY_ENABLED') ?? false
    env.set('COMPILER_SKILL_REGISTRY_ENABLED', true)
    return () => env.set('COMPILER_SKILL_REGISTRY_ENABLED', previous)
  })

  // ── 创建 ────────────────────────────────────────────────────

  test('POST /skills 创建 draft 成功', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)

    const res = await client
      .post('/api/v1/ai/compiler/skills')
      .header('Authorization', `Bearer ${token}`)
      .json({
        skillKey: 'api-create',
        name: 'API 创建测试',
        version: '1.0.0',
        description: 'API test',
        category: { primary: 'domain' },
        tags: ['api'],
        activation: { stages: ['intent_parsing'] },
        knowledge: { rules: [{ rule: 'test' }] },
        basePriority: 100,
      })

    assert.equal(res.status(), 201)
    const b = res.body() as any
    assert.equal(b.data.skillKey, 'api-create')
    assert.equal(b.data.status, 'draft')
  })

  test('POST /skills 无效 skillKey 返回 400', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)

    const res = await client
      .post('/api/v1/ai/compiler/skills')
      .header('Authorization', `Bearer ${token}`)
      .json({
        skillKey: 'invalid key!',
        name: 'Bad key',
        version: '1.0.0',
        category: { primary: 'domain' },
      })

    assert.equal(res.status(), 400)
    assert.equal((res.body() as any).error.code, 'VALIDATION_ERROR')
  })

  test('POST /skills 重复 skillKey 同组织返回错误', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'dup-key',
      name: 'First',
      version: '1.0.0',
      description: '',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .post('/api/v1/ai/compiler/skills')
      .header('Authorization', `Bearer ${token}`)
      .json({
        skillKey: 'dup-key',
        name: 'Duplicate',
        version: '2.0.0',
        category: { primary: 'domain' },
      })

    // 应该因唯一约束冲突而失败
    assert.isAtLeast(res.status(), 400)
  })

  // ── 列表与详情 ──────────────────────────────────────────────

  test('GET /skills 返回组织内 Skill 列表', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'list-1',
      name: 'L1',
      version: '1.0.0',
      description: '',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .get('/api/v1/ai/compiler/skills')
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    const listData = (res.body() as any).data as any[]
    assert.isArray(listData)
    assert.isAtLeast(listData.length, 1)
  })

  test('GET /skills/:id 返回详情', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'show-me',
      name: 'Show Me',
      version: '1.0.0',
      description: 'Details',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .get(`/api/v1/ai/compiler/skills/${skill.id}`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    assert.equal((res.body() as any).data.skillKey, 'show-me')
  })

  test('GET /skills/:id 跨组织返回 404', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)

    // 创建另一个组织的 Skill
    const otherUser = await createUser({ email: uniqueEmail('other') })
    const otherOrg = await createOrganization(otherUser)
    const skill = await CompilerSkill.create({
      organizationId: otherOrg.id,
      skillKey: 'other-org',
      name: 'Other Org',
      version: '1.0.0',
      description: '',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: otherUser.id,
      updatedBy: otherUser.id,
    })

    const res = await client
      .get(`/api/v1/ai/compiler/skills/${skill.id}`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 404)
  })

  // ── 更新与删除 ──────────────────────────────────────────────

  test('PATCH /skills/:id 更新 draft 成功', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'patch-me',
      name: 'Original',
      version: '1.0.0',
      description: 'Before',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .patch(`/api/v1/ai/compiler/skills/${skill.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'Updated Name' })

    assert.equal(res.status(), 200)
    assert.equal((res.body() as any).data.name, 'Updated Name')
  })

  test('DELETE /skills/:id 删除 draft 成功', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'del-me',
      name: 'Delete Me',
      version: '1.0.0',
      description: '',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .delete(`/api/v1/ai/compiler/skills/${skill.id}`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 204)

    const found = await CompilerSkill.find(skill.id)
    assert.isNull(found)
  })

  // ── 生命周期转移 ──────────────────────────────────────────

  test('POST /skills/:id/lifecycle draft→eval 成功', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'lifecycle-test',
      name: 'LC',
      version: '1.0.0',
      description: '',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skill.id}/lifecycle`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'eval' })

    assert.equal(res.status(), 200)
    assert.equal((res.body() as any).data.status, 'eval')
  })

  test('POST /skills/:id/lifecycle draft→active 被拒 (eval gate)', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'skip-eval',
      name: 'Skip Eval',
      version: '1.0.0',
      description: '',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skill.id}/lifecycle`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'active' })

    assert.equal(res.status(), 400)
    assert.equal((res.body() as any).error.code, 'VALIDATION_ERROR')
  })

  // ── 匹配 ────────────────────────────────────────────────────

  test('POST /skills/match 返回匹配的 active Skill', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'match-test',
      name: 'Match Test',
      version: '1.0.0',
      description: '',
      status: 'active',
      category: { primary: 'domain' },
      tags: [],
      activation: { stages: ['intent_parsing'], projectTypes: ['software'] },
      knowledge: {},
      basePriority: 200,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const res = await client
      .post('/api/v1/ai/compiler/skills/match')
      .header('Authorization', `Bearer ${token}`)
      .json({
        stageId: 'intent_parsing',
        projectType: 'software',
      })

    assert.equal(res.status(), 200)
    const matchData = (res.body() as any).data as any[]
    assert.isArray(matchData)
    assert.isAtLeast(matchData.length, 1)
  })

  // ── 审计 ────────────────────────────────────────────────────

  test('创建 Skill 写入审计', async ({ client, assert }) => {
    const { org, token } = await setupOrgUser(client)

    await client
      .post('/api/v1/ai/compiler/skills')
      .header('Authorization', `Bearer ${token}`)
      .json({
        skillKey: 'audit-api',
        name: 'Audit API',
        version: '1.0.0',
        category: { primary: 'domain' },
      })

    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('metadata', 'like', '%AI_COMPILER_SKILL_CREATED%')

    assert.isAtLeast(logs.length, 1)
  })

  test('生命周期转移写入审计', async ({ client, assert }) => {
    const { org, user, token } = await setupOrgUser(client)

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'audit-lc',
      name: 'Audit LC',
      version: '1.0.0',
      description: '',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: user.id,
      updatedBy: user.id,
    })

    await client
      .post(`/api/v1/ai/compiler/skills/${skill.id}/lifecycle`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'eval' })

    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('metadata', 'like', '%AI_COMPILER_SKILL_LIFECYCLE_TRANSITIONED%')

    assert.isAtLeast(logs.length, 1)
  })
})

// ── 内置 Skill 专用测试（v3-initial-skill-software-development） ──

test.group('Compiler Skills API — 内置 Skill', (group) => {
  useAuthDatabase(group)

  // Skill Registry 默认关闭（.env.example 为 false）；用例自行开启，不依赖本机 .env
  group.setup(() => {
    const previous = env.get('COMPILER_SKILL_REGISTRY_ENABLED') ?? false
    env.set('COMPILER_SKILL_REGISTRY_ENABLED', true)
    return () => env.set('COMPILER_SKILL_REGISTRY_ENABLED', previous)
  })

  group.setup(async () => {
    process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED = 'true'
  })

  group.teardown(async () => {
    delete process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED
  })

  test('编辑内置 Skill 返回 PERMISSION_DENIED', async ({ client, assert }) => {
    const { org, token } = await setupOrgUser(client)

    const builtin = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'builtin-no-edit',
      name: 'Builtin No Edit',
      version: '1.0.0',
      description: '',
      status: 'active',
      isBuiltin: true,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 0,
      updatedBy: 0,
    })

    const res = await client
      .patch(`/api/v1/ai/compiler/skills/${builtin.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'Hacked Name' })

    assert.equal(res.status(), 403)
    assert.equal((res.body() as any).error.code, 'PERMISSION_DENIED')
  })

  test('删除内置 Skill 返回 PERMISSION_DENIED', async ({ client, assert }) => {
    const { org, token } = await setupOrgUser(client)

    const builtin = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'builtin-no-del',
      name: 'Builtin No Del',
      version: '1.0.0',
      description: '',
      status: 'active',
      isBuiltin: true,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 0,
      updatedBy: 0,
    })

    const res = await client
      .delete(`/api/v1/ai/compiler/skills/${builtin.id}`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 403)
    assert.equal((res.body() as any).error.code, 'PERMISSION_DENIED')

    // 确认行保留
    const found = await CompilerSkill.find(builtin.id)
    assert.isNotNull(found)
  })

  test('转移内置 Skill 生命周期返回 PERMISSION_DENIED', async ({ client, assert }) => {
    const { org, token } = await setupOrgUser(client)

    const builtin = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'builtin-no-transition',
      name: 'Builtin No Transition',
      version: '1.0.0',
      description: '',
      status: 'active',
      isBuiltin: true,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 0,
      updatedBy: 0,
    })

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${builtin.id}/lifecycle`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'deprecated' })

    assert.equal(res.status(), 403)
    assert.equal((res.body() as any).error.code, 'PERMISSION_DENIED')
  })

  test('基于内置 Skill 创建副本为 draft 且非内置', async ({ client, assert }) => {
    const { org, token } = await setupOrgUser(client)

    const builtin = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'builtin-src',
      name: 'Builtin Src',
      version: '1.0.0',
      description: 'Source for duplicate',
      status: 'active',
      isBuiltin: true,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: { rules: [{ id: 'r1', title: 'Test Rule', content: 'Some content' }] },
      basePriority: 100,
      createdBy: 0,
      updatedBy: 0,
    })

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${builtin.id}/duplicate`)
      .header('Authorization', `Bearer ${token}`)
      .json({ newSkillKey: 'my-copy' })

    assert.equal(res.status(), 201)
    const b = res.body() as any
    assert.equal(b.data.skillKey, 'my-copy')
    assert.equal(b.data.status, 'draft')
    assert.isFalse(b.data.isBuiltin ?? true)
  })

  test('副本 skillKey 唯一冲突返回 VALIDATION_ERROR', async ({ client, assert }) => {
    const { org, user: orgUser, token } = await setupOrgUser(client)

    const builtin = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'builtin-conflict',
      name: 'Builtin Conflict',
      version: '1.0.0',
      description: '',
      status: 'active',
      isBuiltin: true,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 0,
      updatedBy: 0,
    })

    // 先创建同 key 的普通 Skill
    await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'already-taken',
      name: 'Already Taken',
      version: '1.0.0',
      description: '',
      status: 'draft',
      isBuiltin: false,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: orgUser.id,
      updatedBy: orgUser.id,
    })

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${builtin.id}/duplicate`)
      .header('Authorization', `Bearer ${token}`)
      .json({ newSkillKey: 'already-taken' })

    assert.equal(res.status(), 400)
    assert.equal((res.body() as any).error.code, 'VALIDATION_ERROR')
  })

  test('GET /skills 在 feature-off 时不暴露 isBuiltin', async ({ client, assert }) => {
    const orig = process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED
    process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED = 'false'
    const { org, token } = await setupOrgUser(client)

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'ff-hidden',
      name: 'FF Hidden',
      version: '1.0.0',
      description: '',
      status: 'active',
      isBuiltin: true,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 0,
      updatedBy: 0,
    })

    const res = await client
      .get(`/api/v1/ai/compiler/skills/${skill.id}`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    const b = res.body() as any
    // feature-off：响应不包含 isBuiltin
    assert.isUndefined(b.data.isBuiltin)

    process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED = orig
  })
})
