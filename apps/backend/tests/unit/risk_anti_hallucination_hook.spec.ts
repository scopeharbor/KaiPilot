import Risk from '#models/risk'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import RiskLevelService from '#services/risk_level_service'
import RiskHistoryService from '#services/risk_history_service'
import RiskInvalidationService from '#services/risk_invalidation_service'
import RiskService from '#services/risk_service'
import { test } from '@japa/runner'
import type { AiMarker } from '@aiproj/types'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/**
 * Task 8.4 — 反幻觉钩子：验证风险 AIMarker 字段就绪，可被 anti-hallucination 系统读取。
 * 本 change 只保证字段完整，不实现 HL 逻辑本身。
 */
test.group('Risk AIMarker 反幻觉钩子', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('hl-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return {
      owner,
      org,
      project,
      service: new RiskService(
        new AuditService(),
        new RiskLevelService(),
        new RiskHistoryService(),
        new RiskInvalidationService(),
      ),
    }
  }

  test('AI 建议来源的风险携带完整 AIMarker', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: 'AI 建议风险',
        description: '来自 AI 建议的风险',
        category: 'technical',
        probability: 4,
        impact: 3,
        aiMetadata: {
          aiMarker: {
            confidence: 0.85,
            source: 'inferred',
            reason: '基于项目技术栈分析',
            needsConfirmation: true,
          },
          suggestionBatchId: 'batch-test-001',
        },
      },
      owner.id,
    )

    // 验证 aiMetadata 可解析
    assert.isNotNull(risk.aiMetadata)
    const parsed = JSON.parse(risk.aiMetadata!)
    const marker: AiMarker = parsed.aiMarker

    // AIMarker 四字段齐全
    assert.isNumber(marker.confidence)
    assert.isTrue(marker.confidence >= 0 && marker.confidence <= 1)
    assert.include(['inferred', 'explicit', 'default'], marker.source)
    assert.isString(marker.reason)
    assert.isTrue(marker.reason.length > 0)
    assert.isBoolean(marker.needsConfirmation)
  })

  test('草案来源的风险携带 sourceDraftId 和 AIMarker', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const db = await import('@adonisjs/lucid/services/db')

    const risks = await db.default.transaction(async (trx) => {
      return service.batchCreateFromDraft({
        trx,
        organizationId: org.id,
        projectId: project.id,
        draftId: 'draft-hl-test',
        draftVersion: 1,
        selectedRiskHints: [
          {
            id: 'rh-hl-1',
            title: '草案风险',
            description: '来自草案的风险',
            category: 'schedule',
            probability: 3,
            impact: 4,
            mitigation: '缓解措施',
            aiMarker: {
              confidence: 0.7,
              source: 'inferred',
              reason: 'AI 草案推断',
              needsConfirmation: true,
            },
          },
        ],
        actorUserId: owner.id,
      })
    })

    assert.lengthOf(risks, 1)
    const parsed = JSON.parse(risks[0]!.aiMetadata!)

    // 验证 sourceDraftId
    assert.equal(parsed.sourceDraftId, 'draft-hl-test')
    assert.equal(parsed.sourceDraftVersion, 1)

    // 验证 AIMarker
    const marker: AiMarker = parsed.aiMarker
    assert.equal(marker.confidence, 0.7)
    assert.equal(marker.source, 'inferred')
    assert.equal(marker.reason, 'AI 草案推断')
    assert.isTrue(marker.needsConfirmation)
  })

  test('手动创建的风险 aiMetadata 为 null（非 AI 来源）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '手动风险',
        description: '用户手动创建',
      },
      owner.id,
    )

    assert.isNull(risk.aiMetadata)
  })

  test('风险可通过 project_id 批量查询（反幻觉读取路径）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建混合来源风险
    await service.create(
      org.id,
      project.id,
      {
        title: '手动风险',
        description: '手动',
      },
      owner.id,
    )

    await service.create(
      org.id,
      project.id,
      {
        title: 'AI 风险',
        description: 'AI',
        aiMetadata: {
          aiMarker: {
            confidence: 0.8,
            source: 'inferred',
            reason: '测试',
            needsConfirmation: true,
          },
          suggestionBatchId: 'batch-verify',
        },
      },
      owner.id,
    )

    // 批量查询（反幻觉系统读取路径）
    const allRisks = await Risk.query().where('project_id', project.id).whereNull('deleted_at')

    assert.lengthOf(allRisks, 2)

    // 筛选 AI 来源
    const aiRisks = allRisks.filter((r) => r.aiMetadata !== null)
    assert.lengthOf(aiRisks, 1)
    assert.equal(aiRisks[0]!.title, 'AI 风险')
  })
})
