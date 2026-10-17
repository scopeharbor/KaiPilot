import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames, hasUniqueIndex, tableSql } from './_helpers.js'
import CompilerSkill from '#models/compiler_skill'

/**
 * v3-skill-registry-and-lifecycle —— compiler_skills 表结构 + Model 序列化测试。
 *
 * 覆盖：表字段、唯一约束、JSON 列序列化往返、Model 创建
 */
test.group('compiler_skills 表结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('compiler_skills 表包含所有必需字段', async ({ assert }) => {
    const cols = await columnNames('compiler_skills')
    for (const c of [
      'id',
      'organization_id',
      'skill_key',
      'name',
      'version',
      'description',
      'status',
      'is_builtin',
      'category',
      'tags',
      'activation',
      'knowledge',
      'provenance',
      'base_priority',
      'created_by',
      'updated_by',
      'created_at',
      'updated_at',
    ]) {
      assert.include(cols, c, `compiler_skills 应含字段 ${c}`)
    }
    // 确保不含 deleted_at（只写不删）
    assert.notInclude(cols, 'deleted_at', 'compiler_skills 不应含软删除字段')
  })

  test('compiler_skills 有 (organization_id, skill_key) 唯一约束', async ({ assert }) => {
    assert.isTrue(
      await hasUniqueIndex('compiler_skills', ['organization_id', 'skill_key']),
      '(organization_id, skill_key) 应有唯一索引',
    )
  })

  test('compiler_skills 有 organization_id 索引', async ({ assert }) => {
    const { indexNames } = await import('./_helpers.js')
    const idxs = await indexNames('compiler_skills')
    assert.include(idxs, 'idx_cs_org_status', '应有 idx_cs_org_status 索引')
    assert.include(idxs, 'idx_cs_org_key', '应有 idx_cs_org_key 索引')
    assert.include(idxs, 'idx_cs_org_updated', '应有 idx_cs_org_updated 索引')
    assert.include(idxs, 'idx_cs_org_builtin', '应有 idx_cs_org_builtin 索引')
  })

  test('status 默认值为 draft', async ({ assert }) => {
    const sql = await tableSql('compiler_skills')
    assert.include(sql.toLowerCase(), 'draft', 'status 默认值应含 draft')
  })
})

test.group('compiler_skills Model 序列化', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('创建 CompilerSkill 并读取 JSON 列往返', async ({ assert }) => {
    const skill = await CompilerSkill.create({
      organizationId: 1,
      skillKey: 'test-serialization',
      name: '序列化测试',
      version: '1.0.0',
      description: 'Testing JSON serialization roundtrip',
      status: 'draft',
      category: { primary: 'domain', secondary: 'software_engineering' },
      tags: ['json', 'test'],
      activation: {
        stages: ['intent_parsing'],
        projectTypes: ['software'],
        domains: ['ai'],
        complexityRange: { min: 10, max: 100 },
      },
      knowledge: {
        rules: [{ rule: 'Always validate input' }],
        patterns: ['Singleton pattern'],
        antiPatterns: ['God object'],
        examples: [{ name: 'example1' }],
        checklists: ['Check A', 'Check B'],
        rubric: { criteria: ['C1', 'C2'] },
      },
      provenance: {
        sourceSkillKey: 'org/domain-v1',
        sourceVersion: '0.5.0',
        importedAt: '2026-07-01T00:00:00.000Z',
        importNote: 'Initial import',
      },
      basePriority: 100,
      createdBy: 1,
      updatedBy: 1,
    })

    // 读取并验证
    const found = await CompilerSkill.findOrFail(skill.id)

    assert.equal(found.organizationId, 1)
    assert.equal(found.skillKey, 'test-serialization')
    assert.equal(found.status, 'draft')
    assert.equal(found.basePriority, 100)

    // JSON 列往返
    assert.deepEqual(found.category, { primary: 'domain', secondary: 'software_engineering' })
    assert.deepEqual(found.tags, ['json', 'test'])
    assert.deepEqual(found.activation, {
      stages: ['intent_parsing'],
      projectTypes: ['software'],
      domains: ['ai'],
      complexityRange: { min: 10, max: 100 },
    })
    assert.deepEqual(found.knowledge, {
      rules: [{ rule: 'Always validate input' }],
      patterns: ['Singleton pattern'],
      antiPatterns: ['God object'],
      examples: [{ name: 'example1' }],
      checklists: ['Check A', 'Check B'],
      rubric: { criteria: ['C1', 'C2'] },
    })
    assert.deepEqual(found.provenance, {
      sourceSkillKey: 'org/domain-v1',
      sourceVersion: '0.5.0',
      importedAt: '2026-07-01T00:00:00.000Z',
      importNote: 'Initial import',
    })
  })

  test('provenance 可为空', async ({ assert }) => {
    const skill = await CompilerSkill.create({
      organizationId: 1,
      skillKey: 'test-no-provenance',
      name: '无来源 Skill',
      version: '1.0.0',
      description: 'No provenance',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 1,
      updatedBy: 1,
    })

    const found = await CompilerSkill.findOrFail(skill.id)
    assert.isNull(found.provenance)
  })

  test('唯一约束：同一组织内 skill_key 唯一', async ({ assert }) => {
    await CompilerSkill.create({
      organizationId: 1,
      skillKey: 'unique-key-test',
      name: 'First',
      version: '1.0.0',
      description: 'First skill',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 1,
      updatedBy: 1,
    })

    // 同一组织相同 skill_key 应失败
    await assert.rejects(async () => {
      await CompilerSkill.create({
        organizationId: 1,
        skillKey: 'unique-key-test',
        name: 'Duplicate',
        version: '2.0.0',
        description: 'Duplicate skill key',
        status: 'draft',
        category: { primary: 'domain' },
        tags: [],
        activation: {},
        knowledge: {},
        basePriority: 100,
        createdBy: 1,
        updatedBy: 1,
      })
    })

    // 不同组织相同 skill_key 应成功
    const skill = await CompilerSkill.create({
      organizationId: 2,
      skillKey: 'unique-key-test',
      name: 'Other Org',
      version: '1.0.0',
      description: 'Same key, different org',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 1,
      updatedBy: 1,
    })
    assert.isNotNull(skill.id)
  })

  test('forOrganization 作用域查询', async ({ assert }) => {
    // 创建不同组织的 Skill
    await CompilerSkill.create({
      organizationId: 10,
      skillKey: 'org-a-skill',
      name: 'Org A Skill',
      version: '1.0.0',
      description: 'Belongs to org 10',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 1,
      updatedBy: 1,
    })
    await CompilerSkill.create({
      organizationId: 20,
      skillKey: 'org-b-skill',
      name: 'Org B Skill',
      version: '1.0.0',
      description: 'Belongs to org 20',
      status: 'draft',
      category: { primary: 'domain' },
      tags: [],
      activation: {},
      knowledge: {},
      basePriority: 100,
      createdBy: 1,
      updatedBy: 1,
    })

    const org20Skills = await CompilerSkill.forOrganization(20)
    assert.lengthOf(org20Skills, 1)
    assert.equal(org20Skills[0].skillKey, 'org-b-skill')
  })
})
