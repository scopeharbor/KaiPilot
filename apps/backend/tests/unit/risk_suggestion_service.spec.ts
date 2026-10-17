import AiConnection from '#models/ai_connection'
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import { ProjectRoleName } from '#rbac'
import AuditService, { AuditEvent } from '#services/audit_service'
import RiskSuggestionService, {
  resetRiskSuggestionRateLimitForTest,
} from '#services/risk_suggestion_service'
import CryptoService from '#services/crypto_service'
import { ValidationException } from '#exceptions/api_exception'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('RiskSuggestionService', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    resetRiskSuggestionRateLimitForTest()
  })

  const validSuggestionPayload = JSON.stringify([
    {
      title: '关键人员不可用',
      description: '核心成员在关键阶段不可用可能影响交付节奏。',
      category: 'resource',
      probability: 3,
      impact: 4,
      suggestedMitigation: '提前安排备份负责人并拆分关键任务。',
      aiMarker: {
        confidence: 0.82,
        source: 'inferred',
        reason: '项目上下文显示资源数量有限。',
        needsConfirmation: true,
      },
    },
  ])

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('suggestion-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const crypto = new CryptoService()
    // 与真实解析器一致：组织有启用的连接才解析为 source='user'，否则是 mock（服务据此拒绝）。
    const service = new RiskSuggestionService(new AuditService(), crypto).setAdapterResolverForTest(
      async ({ organizationId }) => ({
        gateway: {
          generate: async () => ({
            rawText: validSuggestionPayload,
            triggeredErrors: [],
            outputTokens: null,
            firstTokenMs: 0,
            totalMs: 0,
            usingRealAdapter: false,
          }),
        } as any,
        provider: 'test',
        model: 'risk-suggestion-test',
        usingRealAdapter: false,
        source: (await AiConnection.query()
          .where('organization_id', Number(organizationId))
          .where('is_active', true)
          .first())
          ? 'user'
          : 'mock',
      }),
    )
    return { owner, org, project, service, crypto }
  }

  async function createTestConnection(orgId: number, crypto: CryptoService) {
    return AiConnection.create({
      organizationId: orgId,
      displayName: 'Test Connection',
      protocol: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEncrypted: crypto.encrypt('test-api-key'),
      model: 'gpt-4',
      isActive: true,
    })
  }

  test('无活跃 AI 连接时抛 VALIDATION_ERROR', async ({ assert }) => {
    const { org, project, service } = await setup()

    try {
      await service.suggest(org.id, project.id, { title: '测试项目' }, 1)
      assert.fail('应该抛出异常')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
      assert.include((error as ValidationException).message, 'AI 连接')
    }
  })

  test('写 RISK_AI_SUGGESTED 审计', async ({ assert }) => {
    const { owner, org, project, service, crypto } = await setup()
    await createTestConnection(org.id, crypto)

    const result = await service.suggest(org.id, project.id, { title: '测试项目' }, owner.id)
    assert.lengthOf(result.suggestions, 1)

    const audit = await AuditLog.query()
      .where('action', 'ai_generate')
      .where('project_id', project.id)
      .firstOrFail()
    assert.equal(audit.userId, owner.id)
    assert.equal(audit.metadata?.event, AuditEvent.RISK_AI_SUGGESTED)
    assert.equal(audit.metadata?.candidateCount, 1)
  })

  test('限流：30秒内同一项目不能重复触发', async ({ assert }) => {
    const { owner, org, project, service, crypto } = await setup()
    await createTestConnection(org.id, crypto)

    await service.suggest(org.id, project.id, { title: '测试项目' }, owner.id)

    // 第二次调用应该被限流
    try {
      await service.suggest(org.id, project.id, { title: '测试项目' }, owner.id)
      assert.fail('应该被限流')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
      assert.include((error as ValidationException).message, '频繁')
    }
  })

  test('不同项目不受同一限流窗口影响', async ({ assert }) => {
    const { owner, org, project, service, crypto } = await setup()
    await createTestConnection(org.id, crypto)

    const otherProject = await Project.create({
      organizationId: org.id,
      name: '另一个项目',
      status: 'active',
      priority: 'medium',
      healthStatus: 'green',
      createdBy: owner.id,
    })

    await service.suggest(org.id, project.id, { title: '项目 A' }, owner.id)

    // 第二次调用（项目 B）不应该被限流
    const result = await service.suggest(org.id, otherProject.id, { title: '项目 B' }, owner.id)
    assert.lengthOf(result.suggestions, 1)
  })
})
