/**
 * v3-skill-as-plugin-adapter —— 注入路径接线测试（task 5.3）。
 *
 * 覆盖要求：
 * - 插件来源注入正例（守卫链全过）
 * - 守卫拒绝对插件来源同样生效（L3 排除）
 * - 解析失败降级不阻断回合
 * - 未启用插件不参与注入
 *
 * 纪律：使用 truncate() 生命周期，禁止 group 级 migrate。
 */
import { test } from '@japa/runner'
import { createOrganization, createUser, useAiDatabase } from './ai/_helpers.js'
import SkillRegistryService from '#services/compiler/skills/skill_registry_service'
import { SkillActivationResolver } from '#services/compiler/skill_activation_resolver'
import { CopilotSkillActivationService } from '#services/copilot/copilot_skill_activation_service'
import PluginSkillAdapterService from '#services/plugin_skill_adapter_service'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import CompilerSkill from '#models/compiler_skill'
import AuditService from '#services/audit_service'
import { buildSkillKnowledgeSection } from '#services/compiler/skill_knowledge_section_builder'
import { FIXTURE_PLUGIN_ID, FIXTURE_VERSION } from '@aiproj/types'

async function seedPluginSkillFixture(
  orgId: number,
  userId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    skillKey?: string
    isL3Synthetic?: boolean
  } = {},
) {
  const skillKey = opts.skillKey ?? 'dev-patterns'
  const status = opts.status ?? 'enabled'

  // 创建宿主 Skill
  const hostSkill = await CompilerSkill.create({
    organizationId: orgId,
    skillKey,
    name: 'Development Patterns',
    version: '1.0.0',
    description: 'Dev Skill Description',
    status: 'active',
    category: { primary: 'engineering' } as any,
    tags: ['dev'] as any,
    activation: {
      triggers: [{ type: 'project_type', value: 'software' }],
      confidenceThreshold: 0.5,
    } as any,
    knowledge: {
      rules: [
        {
          id: 'rule-1',
          title: 'Code Review Rule',
          content: 'All code must be reviewed',
          sourceRefs: [
            {
              sourceId: 'rule-source-1',
              layer: opts.isL3Synthetic ? 'L3' : 'L2',
              provenanceType: opts.isL3Synthetic ? 'synthetic' : 'curated',
            },
          ],
        },
      ],
      patterns: [],
      antiPatterns: [],
      checklists: [],
    } as any,
    provenance: {
      origin: 'plugin',
      pluginId: FIXTURE_PLUGIN_ID,
    } as any,
    basePriority: 10,
    createdBy: userId,
    updatedBy: userId,
  })

  // 创建 Release
  const release = await PluginPrivateRegistryRelease.create({
    organizationId: orgId,
    pluginIdentity: FIXTURE_PLUGIN_ID,
    version: FIXTURE_VERSION,
    packageDigest: 'sha256:pkg-001',
    manifestDigest: 'sha256:manifest-001',
    compatibilityDigest: 'sha256:compat-001',
    upstreamReceiptRef: 'receipt-uuid-1',
    status: 'approved',
    metadata: JSON.stringify({
      contributions: [
        {
          contributionKey: 'dev-skill-bundle',
          seamKey: 'skill-adapter.skill-bundle',
          seamVersion: '1.0.0',
          payload: {
            skillKey,
            skillVersion: '1.0.0',
            lifecycleRef: 'active',
          },
        },
      ],
    }),
    rowVersion: 1,
  })

  // 创建 Installation
  const installation = await PluginInstallation.create({
    organizationId: orgId,
    pluginId: FIXTURE_PLUGIN_ID,
    version: FIXTURE_VERSION,
    releaseId: release.id,
    status,
    permissionConfirmation: status === 'enabled' ? ({ confirmedBy: String(userId) } as any) : null,
    packageDigest: release.packageDigest,
    manifestDigest: release.manifestDigest,
    compatibilityDigest: release.compatibilityDigest,
    rowVersion: 1,
  })

  return { hostSkill, release, installation }
}

class InMemoryArtifactStore {
  private artifacts: any[] = []
  async save(record: any) {
    this.artifacts.push(record.payload)
    return record
  }
  async queryByRunId(_runId: number, _organizationId: number, _kind?: string) {
    return this.artifacts
  }
}

test.group('Plugin Skill Injection', (group) => {
  useAiDatabase(group)

  test('Compiler & Copilot 侧已启用插件来源 Skill 正常激活注入（正例）', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    await seedPluginSkillFixture(org.id, user.id, { status: 'enabled' })

    const audit = new AuditService()
    const registry = new SkillRegistryService(audit)
    const adapter = new PluginSkillAdapterService()

    // 1. Compiler SkillActivationResolver
    const resolver = new SkillActivationResolver(
      registry,
      new InMemoryArtifactStore() as any,
      adapter,
    )
    const ref = await resolver.resolve(1001, org.id, { projectType: 'software' })

    assert.isNotNull(ref)
    assert.include(ref!.activatedSkillKeys, 'dev-patterns')

    // 组装 skillKnowledge section
    const sectionResult = buildSkillKnowledgeSection(ref!, 'stage_wbs_decomposition', 2000)
    assert.isNotNull(sectionResult.section)
    assert.equal(sectionResult.l3RejectedCount, 0)

    // 2. Copilot SkillActivationService
    const copilotService = new CopilotSkillActivationService(registry, adapter)
    const copilotOutcome = await copilotService.resolve(org.id, { projectType: 'software' })

    assert.isTrue(copilotOutcome.ok)
    if (copilotOutcome.ok && copilotOutcome.result) {
      assert.include(copilotOutcome.result.skillKeys, 'dev-patterns')
      assert.isAtLeast(copilotOutcome.result.guidanceItems.length, 1)
    }
  })

  test('未启用插件的 Skill 被排除在激活与注入之外', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    // 插件处于 installed（未启用）
    await seedPluginSkillFixture(org.id, user.id, { status: 'installed' })

    const audit = new AuditService()
    const registry = new SkillRegistryService(audit)
    const adapter = new PluginSkillAdapterService()

    // Compiler 侧
    const resolver = new SkillActivationResolver(
      registry,
      new InMemoryArtifactStore() as any,
      adapter,
    )
    const ref = await resolver.resolve(1002, org.id, { projectType: 'software' })
    // 该 Skill 是未启用插件贡献的，过滤后没有激活项
    assert.isNull(ref)

    // Copilot 侧
    const copilotService = new CopilotSkillActivationService(registry, adapter)
    const copilotOutcome = await copilotService.resolve(org.id, { projectType: 'software' })
    assert.isTrue(copilotOutcome.ok)
    if (copilotOutcome.ok) {
      assert.isUndefined(copilotOutcome.result)
    }
  })

  test('L3 合成条目同样被守卫拦截拒绝（红线守护）', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    await seedPluginSkillFixture(org.id, user.id, { status: 'enabled', isL3Synthetic: true })

    const audit = new AuditService()
    const registry = new SkillRegistryService(audit)
    const adapter = new PluginSkillAdapterService()

    const resolver = new SkillActivationResolver(
      registry,
      new InMemoryArtifactStore() as any,
      adapter,
    )
    const ref = await resolver.resolve(1003, org.id, { projectType: 'software' })
    assert.isNotNull(ref)

    // 经 buildSkillKnowledgeSection 投影后，L3 条目被拦截
    const sectionResult = buildSkillKnowledgeSection(ref!, 'stage_wbs_decomposition', 2000)
    assert.isAtLeast(sectionResult.l3RejectedCount, 1)
  })

  test('无插件组织零行为变化', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    // 创建普通非插件来源的 Skill
    await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'native-skill',
      name: 'Native Skill',
      version: '1.0.0',
      description: 'Native',
      status: 'active',
      category: { primary: 'engineering' } as any,
      tags: ['native'] as any,
      activation: {
        triggers: [{ type: 'project_type', value: 'software' }],
        confidenceThreshold: 0.5,
      } as any,
      knowledge: {
        rules: [
          { id: 'nr-1', title: 'Native Rule', content: 'Rule', sourceRefs: [{ layer: 'L2' }] },
        ],
        patterns: [],
        antiPatterns: [],
        checklists: [],
      } as any,
      basePriority: 10,
      createdBy: user.id,
      updatedBy: user.id,
    })

    const audit = new AuditService()
    const registry = new SkillRegistryService(audit)
    const adapter = new PluginSkillAdapterService()

    const resolver = new SkillActivationResolver(
      registry,
      new InMemoryArtifactStore() as any,
      adapter,
    )
    const ref = await resolver.resolve(1004, org.id, { projectType: 'software' })

    assert.isNotNull(ref)
    assert.include(ref!.activatedSkillKeys, 'native-skill')
  })
})
