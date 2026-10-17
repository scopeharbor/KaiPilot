/**
 * v3-skill-registry-and-lifecycle —— SkillRegistryService 单元测试。
 *
 * 覆盖：CRUD（创建/更新/删除）、draft-only 编辑约束、query/match 仅 active、
 * 合法/非法状态转移、无自动上线、审计写入。
 *
 * Service ≥90% 覆盖率目标。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import SkillRegistryService from '#services/compiler/skills/skill_registry_service'
import CompilerSkill from '#models/compiler_skill'
import AuditLog from '#models/audit_log'

const ORG_ID = 101

test.group('SkillRegistryService', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    // 清空数据以隔离测试
    await CompilerSkill.query().delete()
    await AuditLog.query().delete()
  })

  // ── CRUD ───────────────────────────────────────────────

  test('创建 draft Skill 成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'test-create',
        name: '测试创建',
        version: '1.0.0',
        description: 'A test skill',
        category: { primary: 'domain' },
        tags: ['test'],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    assert.equal(skill.skillKey, 'test-create')
    assert.equal(skill.status, 'draft')
    assert.equal(skill.organizationId, ORG_ID)
    assert.equal(skill.basePriority, 100)
  })

  test('创建时写入审计日志', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    await svc.create(
      ORG_ID,
      {
        skillKey: 'audit-test',
        name: '审计测试',
        version: '1.0.0',
        description: 'Audit test',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const logs = await AuditLog.query()
      .where('organization_id', ORG_ID)
      .where('metadata', 'like', '%AI_COMPILER_SKILL_CREATED%')

    assert.isAtLeast(logs.length, 1, '应写入创建审计日志')
  })

  test('审计日志不含敏感内容', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    await svc.create(
      ORG_ID,
      {
        skillKey: 'sensitive-test',
        name: '敏感内容测试',
        version: '1.0.0',
        description: 'Sensitive test',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: { rules: [{ rule: 'secret info' }] },
        basePriority: 100,
      },
      1,
    )

    const logs = await AuditLog.query()
      .where('organization_id', ORG_ID)
      .where('metadata', 'like', '%AI_COMPILER_SKILL_CREATED%')

    // 审计负载不应含 knowledge 正文
    if (logs.length > 0) {
      const metadata = logs[0].metadata ?? ''
      assert.notInclude(JSON.stringify(metadata), 'secret info', '审计不含知识包正文')
    }
  })

  test('更新 draft Skill 成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'test-update',
        name: '原始名称',
        version: '1.0.0',
        description: 'Before update',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const updated = await svc.update(
      ORG_ID,
      skill.id,
      {
        name: '更新后名称',
        description: 'After update',
      },
      1,
    )

    assert.equal(updated.name, '更新后名称')
    assert.equal(updated.description, 'After update')
  })

  test('非 draft 状态不可编辑', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'test-frozen',
        name: '冻结测试',
        version: '1.0.0',
        description: 'Will be frozen',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    // 转移到 eval
    await svc.transitionLifecycle(ORG_ID, skill.id, 'eval', 1)

    // 尝试编辑 eval 状态的 Skill 应失败
    await assert.rejects(async () => {
      await svc.update(ORG_ID, skill.id, { name: '不应更新' }, 1)
    })
  })

  test('非 draft 状态不可删除', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'test-delete-frozen',
        name: '删除冻结测试',
        version: '1.0.0',
        description: 'Will be frozen',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await svc.transitionLifecycle(ORG_ID, skill.id, 'eval', 1)

    await assert.rejects(async () => {
      await svc.softDeleteDraft(ORG_ID, skill.id, 1)
    })
  })

  test('删除 draft 成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'test-delete',
        name: '删除测试',
        version: '1.0.0',
        description: 'Will be deleted',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await svc.softDeleteDraft(ORG_ID, skill.id, 1)

    const found = await CompilerSkill.find(skill.id)
    assert.isNull(found)
  })

  test('getById 返回正确的 Skill', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'test-get',
        name: '获取测试',
        version: '1.0.0',
        description: 'Get by id test',
        category: { primary: 'domain' },
        tags: ['read'],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const found = await svc.getById(ORG_ID, skill.id)
    assert.equal(found.skillKey, 'test-get')
  })

  test('getById 跨组织 404', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'test-cross-get',
        name: '跨组织获取',
        version: '1.0.0',
        description: 'Cross org get',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await assert.rejects(async () => {
      await svc.getById(9999, skill.id)
    })
  })

  // ── listByOrg ───────────────────────────────────────────

  test('listByOrg 返回组织内所有 Skill', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    await svc.create(
      ORG_ID,
      {
        skillKey: 'list-1',
        name: 'L1',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )
    await svc.create(
      ORG_ID,
      {
        skillKey: 'list-2',
        name: 'L2',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const result = await svc.listByOrg(ORG_ID)
    assert.equal(result.data.length, 2)
    assert.equal(result.total, 2)
  })

  test('listByOrg 不返回其他组织的 Skill', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    await svc.create(
      ORG_ID,
      {
        skillKey: 'my-skill',
        name: 'My Skill',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )
    await svc.create(
      202,
      {
        skillKey: 'other-skill',
        name: 'Other Skill',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const result = await svc.listByOrg(ORG_ID)
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].skillKey, 'my-skill')
  })

  // ── query/match ───────────────────────────────────────────

  test('query 仅返回 active Skill', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)

    // 创建 draft 和 active
    await svc.create(
      ORG_ID,
      {
        skillKey: 'draft-for-query',
        name: 'Draft',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await svc.create(
      ORG_ID,
      {
        skillKey: 'active-for-query',
        name: 'Active',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    // 转移第二个到 active
    const second = await CompilerSkill.forOrganization(ORG_ID)
      .where('skill_key', 'active-for-query')
      .first()
    await svc.transitionLifecycle(ORG_ID, second!.id, 'eval', 1)
    await svc.transitionLifecycle(ORG_ID, second!.id, 'active', 1)

    const result = await svc.query(ORG_ID, {})
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].skillKey, 'active-for-query')
  })

  test('match 仅返回 active 且匹配的 Skill', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)

    await svc.create(
      ORG_ID,
      {
        skillKey: 'match-active',
        name: 'Match Active',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: { stages: ['intent_parsing'], projectTypes: ['software'] },
        knowledge: {},
        basePriority: 200,
      },
      1,
    )

    // 转移
    const skill = await CompilerSkill.forOrganization(ORG_ID)
      .where('skill_key', 'match-active')
      .first()
    await svc.transitionLifecycle(ORG_ID, skill!.id, 'eval', 1)
    await svc.transitionLifecycle(ORG_ID, skill!.id, 'active', 1)

    const results = await svc.match(ORG_ID, {
      stageId: 'intent_parsing',
      projectType: 'software',
    })

    assert.isAtLeast(results.length, 1)
    assert.equal(results[0].skill.skillKey, 'match-active')
  })

  // ── 生命周期 ───────────────────────────────────────────

  test('合法转移 draft→eval 成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'trans-draft-eval',
        name: '转移测试',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const result = await svc.transitionLifecycle(ORG_ID, skill.id, 'eval', 1)
    assert.equal(result.status, 'eval')
  })

  test('合法转移 eval→active 成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'trans-eval-active',
        name: '上线测试',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await svc.transitionLifecycle(ORG_ID, skill.id, 'eval', 1)
    const result = await svc.transitionLifecycle(ORG_ID, skill.id, 'active', 1)
    assert.equal(result.status, 'active')
  })

  test('合法转移 active→deprecated 成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'trans-active-depr',
        name: '废弃测试',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await svc.transitionLifecycle(ORG_ID, skill.id, 'eval', 1)
    await svc.transitionLifecycle(ORG_ID, skill.id, 'active', 1)
    const result = await svc.transitionLifecycle(ORG_ID, skill.id, 'deprecated', 1)
    assert.equal(result.status, 'deprecated')
  })

  test('非法转移 draft→active 被拒绝 (eval gate)', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'trans-skip-eval',
        name: '跳级测试',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await assert.rejects(async () => {
      await svc.transitionLifecycle(ORG_ID, skill.id, 'active', 1)
    })
  })

  test('非法转移 deprecatd→active 被拒绝 (终态)', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'trans-terminal',
        name: '终态测试',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await svc.transitionLifecycle(ORG_ID, skill.id, 'eval', 1)
    await svc.transitionLifecycle(ORG_ID, skill.id, 'active', 1)
    await svc.transitionLifecycle(ORG_ID, skill.id, 'deprecated', 1)

    await assert.rejects(async () => {
      await svc.transitionLifecycle(ORG_ID, skill.id, 'active', 1)
    })
  })

  test('eval→active 无自动上线——eval 状态 Skill 不在 match 结果中', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)

    await svc.create(
      ORG_ID,
      {
        skillKey: 'eval-no-auto',
        name: '非自动上线',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: { stages: ['intent_parsing'] },
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const skill = await CompilerSkill.forOrganization(ORG_ID)
      .where('skill_key', 'eval-no-auto')
      .first()
    await svc.transitionLifecycle(ORG_ID, skill!.id, 'eval', 1)

    // eval 状态不在 match 中（match 仅返回 active）
    const results = await svc.match(ORG_ID, { stageId: 'intent_parsing' })
    assert.equal(results.length, 0, 'eval 状态 Skill 不应出现在 match 结果中')
  })

  test('生命周期转移写入审计', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'audit-trans',
        name: '审计转移',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await svc.transitionLifecycle(ORG_ID, skill.id, 'eval', 1)

    const logs = await AuditLog.query()
      .where('organization_id', ORG_ID)
      .where('metadata', 'like', '%AI_COMPILER_SKILL_LIFECYCLE_TRANSITIONED%')

    assert.isAtLeast(logs.length, 1, '应写入生命周期转移审计日志')
  })

  // ── 组织隔离 ───────────────────────────────────────────

  test('跨组织 listByOrg 不可见', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    await svc.create(
      ORG_ID,
      {
        skillKey: 'iso-list',
        name: 'Iso List',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    // 从其他组织查询
    const result = await svc.listByOrg(999)
    assert.equal(result.data.length, 0)
    assert.equal(result.total, 0)
  })

  test('跨组织 match 不可见', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    await svc.create(
      ORG_ID,
      {
        skillKey: 'iso-match',
        name: 'Iso Match',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: { stages: ['intent_parsing'] },
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    const skill = await CompilerSkill.forOrganization(ORG_ID)
      .where('skill_key', 'iso-match')
      .first()
    await svc.transitionLifecycle(ORG_ID, skill!.id, 'eval', 1)
    await svc.transitionLifecycle(ORG_ID, skill!.id, 'active', 1)

    const results = await svc.match(999, { stageId: 'intent_parsing' })
    assert.equal(results.length, 0)
  })

  test('跨组织转移被拒绝 (not found)', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillRegistryService)
    const skill = await svc.create(
      ORG_ID,
      {
        skillKey: 'iso-trans',
        name: 'Iso Trans',
        version: '1.0.0',
        description: '',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
      },
      1,
    )

    await assert.rejects(async () => {
      await svc.transitionLifecycle(999, skill.id, 'eval', 1)
    })
  })
})
