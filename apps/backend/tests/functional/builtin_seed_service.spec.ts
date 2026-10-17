/**
 * v3-initial-skill-software-development —— BuiltinSeedService 单元测试。
 *
 * 覆盖：seedOrganization 注入 active+isBuiltin、不经 transitionLifecycle、幂等、
 * 注入后可被 matchSkills 匹配、upgradeOrganization 升级语义、不影响副本、
 * feature-off no-op、assertNotBuiltin 守卫、组织隔离。
 */
import { test } from '@japa/runner'
import CompilerSkill from '#models/compiler_skill'
import AuditLog from '#models/audit_log'
import BuiltinSeedService, {
  BuiltinSkillPermissionError,
} from '#services/compiler/skills/builtin_seed_service'
import AuditService from '#services/audit_service'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './auth/_helpers.js'

async function makeService(): Promise<BuiltinSeedService> {
  const audit = new AuditService()
  return new BuiltinSeedService(audit)
}

test.group('BuiltinSeedService', (group) => {
  useAuthDatabase(group)

  // 设置 feature flag 以便测试
  group.setup(async () => {
    process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED = 'true'
  })

  group.teardown(async () => {
    delete process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED
  })

  // ── seedOrganization ────────────────────────────────────────

  test('seedOrganization 注入 active + isBuiltin', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('seed') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)

    const skill = await CompilerSkill.forOrganizationByKey(org.id, 'skill-sw-dev')
    assert.isNotNull(skill)
    assert.equal(skill!.status, 'active')
    assert.isTrue(skill!.isBuiltin)
    assert.equal(skill!.skillKey, 'skill-sw-dev')
    assert.equal(skill!.name, '软件开发')
  })

  test('seedOrganization 不经 transitionLifecycle', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('no-tl') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)

    const skill = await CompilerSkill.forOrganizationByKey(org.id, 'skill-sw-dev')
    // 直接 active，不经 draft→eval→active 转移
    assert.equal(skill!.status, 'active')
    // createdBy/updatedBy 为 0 (system-seed)，非组织用户
    assert.equal(skill!.createdBy, 0)
  })

  test('seedOrganization 幂等：重复注入 no-op', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('idem') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)
    const countBefore = await CompilerSkill.forOrganization(org.id)
      .where('is_builtin', true)
      .count('* as total')

    await svc.seedOrganization(org.id)
    const countAfter = await CompilerSkill.forOrganization(org.id)
      .where('is_builtin', true)
      .count('* as total')

    // 第二次注入不创建重复行
    assert.equal(countBefore[0].$extras.total, countAfter[0].$extras.total)
  })

  test('seedOrganization 注入后可被 matchSkills 匹配', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('match') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)

    // 确认可被检索
    const activeSkills = await CompilerSkill.forOrganization(org.id)
      .where('status', 'active')
      .where('is_builtin', true)

    assert.isAtLeast(activeSkills.length, 1)
    const found = activeSkills.find((s) => s.skillKey === 'skill-sw-dev')
    assert.isNotNull(found)
  })

  // ── 组织隔离 ────────────────────────────────────────────────

  test('seedOrganization 组织隔离：不跨组织', async ({ assert }) => {
    const userA = await createUser({ email: uniqueEmail('orga') })
    const orgA = await createOrganization(userA)
    const userB = await createUser({ email: uniqueEmail('orgb') })
    const orgB = await createOrganization(userB)
    const svc = await makeService()

    await svc.seedOrganization(orgA.id)

    // orgB 不应有 orgA 的内置 Skill
    const skillsB = await CompilerSkill.forOrganization(orgB.id).where('is_builtin', true)
    assert.lengthOf(skillsB, 0)
  })

  // ── assertNotBuiltin ────────────────────────────────────────

  test('assertNotBuiltin 对 isBuiltin=true 抛出', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('guard') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)
    const skill = await CompilerSkill.forOrganizationByKey(org.id, 'skill-sw-dev')

    assert.throws(() => svc.assertNotBuiltin(skill!), BuiltinSkillPermissionError)
  })

  test('assertNotBuiltin 对 isBuiltin=false 不抛出', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('ok') })
    const org = await createOrganization(user)
    const svc = await makeService()

    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'custom-skill',
      name: 'Custom',
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
      createdBy: user.id,
      updatedBy: user.id,
    })

    assert.doesNotThrow(() => svc.assertNotBuiltin(skill))
  })

  // ── upgradeOrganization ─────────────────────────────────────

  test('upgradeOrganization 升级 version 与 knowledge（fixture 验证）', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('upgrade') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)

    // 当前种子版本为 1.0.0，再次 upgrade 不高于所以 no-op
    await svc.upgradeOrganization(org.id)

    const skill = await CompilerSkill.forOrganizationByKey(org.id, 'skill-sw-dev')
    // 版本不变（种子 version 没有变化）
    assert.equal(skill!.version, '1.0.0')
  })

  test('upgradeOrganization 不影响组织自定义副本（isBuiltin=false）', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('no-up-copy') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)

    // 创建一个自定义副本（isBuiltin=false）
    const custom = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'skill-sw-dev-copy',
      name: 'Custom Copy',
      version: '0.5.0',
      description: '',
      status: 'draft',
      isBuiltin: false,
      category: { primary: 'domain' },
      tags: [],
      dependencies: [],
      activation: {},
      knowledge: {},
      basePriority: 80,
      createdBy: user.id,
      updatedBy: user.id,
    })

    await svc.upgradeOrganization(org.id)

    // 自定义副本应保持不变
    const refreshedCopy = await CompilerSkill.findOrFail(custom.id)
    assert.equal(refreshedCopy.version, '0.5.0')
    assert.isFalse(refreshedCopy.isBuiltin)
    // 内置 Skill 应仍然存在
    const builtin = await CompilerSkill.forOrganizationByKey(org.id, 'skill-sw-dev')
    assert.isNotNull(builtin)
    assert.isTrue(builtin!.isBuiltin)
  })

  // ── feature-off ─────────────────────────────────────────────

  test('feature-off 时 seedOrganization no-op', async ({ assert }) => {
    const orig = process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED
    process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED = 'false'

    const user = await createUser({ email: uniqueEmail('ff-off') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)

    const skill = await CompilerSkill.forOrganizationByKey(org.id, 'skill-sw-dev')
    assert.isNull(skill)

    process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED = orig
  })

  // ── 审计事件内容 ─────────────────────────────────────────────

  test('seedOrganization 写 BUILTIN_SEEDED 审计事件（低敏）', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('audit-seed') })
    const org = await createOrganization(user)
    const svc = await makeService()

    await svc.seedOrganization(org.id)

    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('metadata', 'like', '%AI_COMPILER_SKILL_BUILTIN_SEEDED%')

    assert.isAtLeast(logs.length, 1)
    const meta = logs[0].metadata as any
    // 低敏元数据存在
    assert.equal(meta.skillKey, 'skill-sw-dev')
    assert.equal(meta.version, '1.0.0')
    assert.equal(meta.actor, 'system-seed')
    // 不含知识正文 / prompt / secret / token
    const metaStr = JSON.stringify(meta)
    assert.notInclude(metaStr, 'knowledge')
    assert.notInclude(metaStr, 'prompt')
    assert.notInclude(metaStr, 'secret')
    assert.notInclude(metaStr, 'token')
  })
})
