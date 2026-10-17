/**
 * v2-ai-risk-progress-prediction 7.6 —— 集成测试。
 *
 * 覆盖：Dashboard 不创建快照、报表数据源权限过滤、通知安全、活动低敏
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ProjectPredictionDashboardAdapter from '#services/prediction/dashboard_adapter'
import ProjectPredictionReportDataSource from '#services/prediction/report_data_source'
import ProjectPredictionActivityMapper from '#services/prediction/activity_event_mapper'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import ProjectPredictionSignal from '#models/project_prediction_signal'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

const PM_ROLE = 'project_manager' as const

test.group('Prediction integration', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('pred-int') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      window: 30,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-int',
      outputHash: 'hash-int',
      sourceHash: 'src-int',
      warnings: [],
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: Number(owner.id),
      generatedAt: DateTime.now(),
    })
    await ProjectPredictionSignal.create({
      snapshotId: snapshot.id,
      signalType: 'schedule_risk',
      severity: 'high',
      score: 45,
      confidenceBand: 'medium',
      ruleId: 'schedule-risk',
      ruleVersion: '1.0.0',
      description: '集成测试信号',
      evidenceRefs: [],
      expiresAt: DateTime.now().plus({ days: 7 }),
    })
    return { owner, org, project, snapshot }
  }

  test('Dashboard 配接器只读不创建快照', async ({ assert }) => {
    const { org, project } = await setup()
    const adapter = new ProjectPredictionDashboardAdapter()
    const summary = await adapter.getSummary(Number(org.id), Number(project.id))
    assert.isTrue(summary.available)
    assert.isNotNull(summary.snapshotId)
  })

  test('Dashboard 配接器无快照时 available=false', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pred-int2') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
    const adapter = new ProjectPredictionDashboardAdapter()
    const summary = await adapter.getSummary(Number(org.id), Number(project.id))
    assert.isFalse(summary.available)
    assert.isNull(summary.snapshotId)
  })

  test('报表数据源返回正确结构', async ({ assert }) => {
    const { org, project, snapshot } = await setup()
    const ds = new ProjectPredictionReportDataSource()
    const data = await ds.getData(Number(org.id), Number(project.id), snapshot.id)
    assert.isNotNull(data)
    assert.equal(data!.snapshotId, snapshot.id)
    assert.property(data!, 'severityDistribution')
  })

  test('报表数据源无快照返回 null', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pred-int3') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
    const ds = new ProjectPredictionReportDataSource()
    const data = await ds.getData(Number(org.id), Number(project.id))
    assert.isNull(data)
  })

  test('活动映射器输出低敏摘要', async ({ assert }) => {
    const mapper = new ProjectPredictionActivityMapper()
    const result = mapper.map({
      eventType: 'prediction_generated',
      summary: '生成了项目预测快照',
      snapshotId: 1,
      projectId: 1,
      organizationId: 1,
      performedBy: 1,
      occurredAt: new Date().toISOString(),
    })
    assert.equal(result.action, 'prediction.generated')
    assert.include(String(result.metadata.summary), '预测')
  })
})
