import AuditLog from '#models/audit_log'
import Risk from '#models/risk'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import RiskLevelService from '#services/risk_level_service'
import RiskHistoryService from '#services/risk_history_service'
import RiskInvalidationService from '#services/risk_invalidation_service'
import RiskService from '#services/risk_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { RISK_ALLOWED_TRANSITIONS } from '@aiproj/types'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('RiskService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('risk-owner') })
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

  // ---------------- CRUD ----------------

  test('create 默认 identified 状态，服务端计算 score', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '技术风险',
        description: '新框架学习曲线陡峭',
        category: 'technical',
        probability: 4,
        impact: 3,
      },
      owner.id,
    )

    assert.equal(risk.status, 'identified')
    assert.equal(risk.probability, 4)
    assert.equal(risk.impact, 3)
    assert.equal(risk.score, 12)
    assert.equal(risk.category, 'technical')
    assert.equal(risk.organizationId, org.id)
    assert.equal(risk.projectId, project.id)
  })

  test('create 写 RISK_CREATED 审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '审计测试风险',
        description: '测试审计写入',
      },
      owner.id,
    )

    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('entity_id', risk.id)
      .where('action', 'create')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'RISK_CREATED')
  })

  test('create 默认概率/影响为 3，得分 9', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '默认评分风险',
        description: '测试默认值',
      },
      owner.id,
    )

    assert.equal(risk.probability, 3)
    assert.equal(risk.impact, 3)
    assert.equal(risk.score, 9)
  })

  test('create 携带 aiMetadata 时正确存储', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: 'AI 风险',
        description: 'AI 建议的风险',
        aiMetadata: {
          aiMarker: {
            confidence: 0.8,
            source: 'inferred',
            reason: '测试',
            needsConfirmation: true,
          },
          suggestionBatchId: 'batch-123',
        },
      },
      owner.id,
    )

    const parsed = JSON.parse(risk.aiMetadata!)
    assert.equal(parsed.aiMarker.confidence, 0.8)
    assert.equal(parsed.suggestionBatchId, 'batch-123')
  })

  test('list 返回分页结果', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    for (let i = 0; i < 5; i++) {
      await service.create(
        org.id,
        project.id,
        {
          title: `风险 ${i}`,
          description: `描述 ${i}`,
        },
        owner.id,
      )
    }

    const result = await service.list(org.id, project.id, { page: 1, perPage: 3 })
    assert.lengthOf(result.data, 3)
    assert.equal(result.meta.total, 5)
    assert.equal(result.meta.totalPages, 2)
  })

  test('list 按 category 筛选', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await service.create(
      org.id,
      project.id,
      {
        title: '技术风险',
        description: '描述',
        category: 'technical',
      },
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      {
        title: '进度风险',
        description: '描述',
        category: 'schedule',
      },
      owner.id,
    )

    const result = await service.list(org.id, project.id, { category: 'technical' })
    assert.lengthOf(result.data, 1)
    assert.equal(result.data[0]!.category, 'technical')
  })

  test('list 按 status 筛选', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '待推进风险',
        description: '描述',
      },
      owner.id,
    )

    await service.create(
      org.id,
      project.id,
      {
        title: '另一个风险',
        description: '描述',
      },
      owner.id,
    )

    // 推进第一个风险的状态
    await service.transitionStatus(org.id, project.id, risk.id, 'analyzing', owner.id)

    const result = await service.list(org.id, project.id, { status: 'analyzing' })
    assert.lengthOf(result.data, 1)
    assert.equal(result.data[0]!.status, 'analyzing')
  })

  test('update 重算 score', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '更新测试',
        description: '描述',
        probability: 2,
        impact: 2,
      },
      owner.id,
    )
    assert.equal(risk.score, 4)

    const updated = await service.update(
      org.id,
      project.id,
      risk.id,
      {
        probability: 5,
        impact: 5,
      },
      owner.id,
    )
    assert.equal(updated.score, 25)
  })

  test('update 残余评估：全空或齐全', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '残余测试',
        description: '描述',
      },
      owner.id,
    )

    // 齐全
    const updated = await service.update(
      org.id,
      project.id,
      risk.id,
      {
        residualProbability: 2,
        residualImpact: 3,
      },
      owner.id,
    )
    assert.equal(updated.residualProbability, 2)
    assert.equal(updated.residualImpact, 3)
    assert.equal(updated.residualScore, 6)

    // 全空
    const cleared = await service.update(
      org.id,
      project.id,
      risk.id,
      {
        residualProbability: null,
        residualImpact: null,
      },
      owner.id,
    )
    assert.isNull(cleared.residualProbability)
    assert.isNull(cleared.residualImpact)
    assert.isNull(cleared.residualScore)
  })

  test('update 残余部分提供抛 VALIDATION_ERROR', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '部分残余测试',
        description: '描述',
      },
      owner.id,
    )

    try {
      await service.update(
        org.id,
        project.id,
        risk.id,
        {
          residualProbability: 2,
          residualImpact: null,
        },
        owner.id,
      )
      assert.fail('应该抛出异常')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('softDelete 设置 deletedAt', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '删除测试',
        description: '描述',
      },
      owner.id,
    )

    await service.softDelete(org.id, project.id, risk.id, owner.id)

    const deleted = await Risk.query().where('id', risk.id).first()
    assert.isNotNull(deleted?.deletedAt)

    // 列表中不应出现
    const list = await service.list(org.id, project.id)
    assert.lengthOf(list.data, 0)
  })

  test('softDelete 写 RISK_DELETED 审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '审计删除测试',
        description: '描述',
      },
      owner.id,
    )

    await service.softDelete(org.id, project.id, risk.id, owner.id)

    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('entity_id', risk.id)
      .where('action', 'delete')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'RISK_DELETED')
  })

  // ---------------- 状态机 ----------------

  test('transitionStatus 合法转换', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '状态机测试',
        description: '描述',
      },
      owner.id,
    )
    assert.equal(risk.status, 'identified')

    const analyzing = await service.transitionStatus(
      org.id,
      project.id,
      risk.id,
      'analyzing',
      owner.id,
    )
    assert.equal(analyzing.status, 'analyzing')

    const mitigating = await service.transitionStatus(
      org.id,
      project.id,
      risk.id,
      'mitigating',
      owner.id,
    )
    assert.equal(mitigating.status, 'mitigating')

    const resolved = await service.transitionStatus(
      org.id,
      project.id,
      risk.id,
      'resolved',
      owner.id,
    )
    assert.equal(resolved.status, 'resolved')
  })

  test('transitionStatus 非法转换抛 VALIDATION_ERROR', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '非法转换测试',
        description: '描述',
      },
      owner.id,
    )

    try {
      await service.transitionStatus(org.id, project.id, risk.id, 'resolved', owner.id)
      assert.fail('应该抛出异常')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('transitionStatus closed 为终态', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '终态测试',
        description: '描述',
      },
      owner.id,
    )

    // identified → closed
    await service.transitionStatus(org.id, project.id, risk.id, 'closed', owner.id)

    // closed 不能转换到任何状态
    for (const target of RISK_ALLOWED_TRANSITIONS.closed) {
      try {
        await service.transitionStatus(org.id, project.id, risk.id, target, owner.id)
        assert.fail(`closed → ${target} 应该抛出异常`)
      } catch (error) {
        assert.instanceOf(error, ValidationException)
      }
    }
  })

  test('transitionStatus 写 RISK_STATUS_CHANGED 审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const risk = await service.create(
      org.id,
      project.id,
      {
        title: '审计状态测试',
        description: '描述',
      },
      owner.id,
    )

    await service.transitionStatus(org.id, project.id, risk.id, 'analyzing', owner.id)

    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('entity_id', risk.id)
      .where('action', 'update')

    const statusLog = logs.find((l) => l.metadata?.event === 'RISK_STATUS_CHANGED')
    assert.isNotNull(statusLog)
    const metadata = statusLog!.metadata as Record<string, unknown>
    assert.equal(metadata.from, 'identified')
    assert.equal(metadata.to, 'analyzing')
  })

  // ---------------- 矩阵 ----------------

  test('matrix 返回 25 个单元格', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await service.create(
      org.id,
      project.id,
      {
        title: '矩阵测试',
        description: '描述',
        probability: 3,
        impact: 4,
      },
      owner.id,
    )

    const result = await service.matrix(org.id, project.id, 'inherent')
    assert.lengthOf(result.cells, 25)
  })

  test('matrix 概率-影响单元格计数正确', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await service.create(
      org.id,
      project.id,
      {
        title: '风险 A',
        description: '描述',
        probability: 3,
        impact: 4,
      },
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      {
        title: '风险 B',
        description: '描述',
        probability: 3,
        impact: 4,
      },
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      {
        title: '风险 C',
        description: '描述',
        probability: 2,
        impact: 2,
      },
      owner.id,
    )

    const result = await service.matrix(org.id, project.id, 'inherent')
    const cell34 = result.cells.find((c) => c.probability === 3 && c.impact === 4)
    const cell22 = result.cells.find((c) => c.probability === 2 && c.impact === 2)

    assert.equal(cell34?.count, 2)
    assert.equal(cell22?.count, 1)
  })

  test('matrix residual 基线只纳入残余齐全的风险', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await service.create(
      org.id,
      project.id,
      {
        title: '有残余',
        description: '描述',
        probability: 4,
        impact: 4,
        residualProbability: 2,
        residualImpact: 2,
      },
      owner.id,
    )

    await service.create(
      org.id,
      project.id,
      {
        title: '无残余',
        description: '描述',
        probability: 3,
        impact: 3,
      },
      owner.id,
    )

    const result = await service.matrix(org.id, project.id, 'residual')
    const totalRisks = result.cells.reduce((sum, c) => sum + c.count, 0)
    assert.equal(totalRisks, 1) // 只有有残余的那条
  })

  // ---------------- 组织隔离 ----------------

  test('跨组织访问抛 ResourceNotFoundException', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const otherOwner = await createUser({ email: uniqueEmail('risk-other') })
    const otherOrg = await createOrganization(otherOwner)

    await service.create(
      org.id,
      project.id,
      {
        title: '隔离测试',
        description: '描述',
      },
      owner.id,
    )

    try {
      await service.list(otherOrg.id, project.id)
      // 如果项目不属于该组织，应该返回空
      const result = await service.list(otherOrg.id, project.id)
      assert.lengthOf(result.data, 0)
    } catch (error) {
      assert.instanceOf(error, ResourceNotFoundException)
    }
  })

  // ---------------- batchCreateFromDraft ----------------

  test('batchCreateFromDraft 批量创建风险', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const db = await import('@adonisjs/lucid/services/db')

    const risks = await db.default.transaction(async (trx) => {
      return service.batchCreateFromDraft({
        trx,
        organizationId: org.id,
        projectId: project.id,
        draftId: 'draft-test-1',
        draftVersion: 1,
        selectedRiskHints: [
          {
            id: 'rh-1',
            title: '草案风险 1',
            description: '描述 1',
            category: 'technical',
            probability: 3,
            impact: 4,
            mitigation: '缓解措施',
            aiMarker: {
              confidence: 0.7,
              source: 'inferred',
              reason: 'AI 推断',
              needsConfirmation: true,
            },
          },
          {
            id: 'rh-2',
            title: '草案风险 2',
            description: '描述 2',
            category: 'schedule',
            probability: 2,
            impact: 3,
            mitigation: '缓解措施 2',
            aiMarker: {
              confidence: 0.6,
              source: 'inferred',
              reason: 'AI 推断 2',
              needsConfirmation: true,
            },
          },
        ],
        actorUserId: owner.id,
      })
    })

    assert.lengthOf(risks, 2)
    assert.equal(risks[0]!.title, '草案风险 1')
    assert.equal(risks[0]!.score, 12)
    assert.equal(risks[1]!.title, '草案风险 2')
    assert.equal(risks[1]!.score, 6)

    // 验证 aiMetadata 包含 sourceDraftId
    const parsed0 = JSON.parse(risks[0]!.aiMetadata!)
    assert.equal(parsed0.sourceDraftId, 'draft-test-1')
    assert.equal(parsed0.sourceDraftVersion, 1)
  })

  test('batchCreateFromDraft 空数组不创建', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const db = await import('@adonisjs/lucid/services/db')

    const risks = await db.default.transaction(async (trx) => {
      return service.batchCreateFromDraft({
        trx,
        organizationId: org.id,
        projectId: project.id,
        draftId: 'draft-test-2',
        draftVersion: 1,
        selectedRiskHints: [],
        actorUserId: owner.id,
      })
    })

    assert.lengthOf(risks, 0)
  })
})
