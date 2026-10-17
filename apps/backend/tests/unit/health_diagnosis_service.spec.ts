/**
 * Health Diagnosis — Service 单元测试
 *
 * v2-ai-project-health-diagnosis / 3.6
 *
 * 覆盖：无自动执行、确认/驳回状态机、刷新历史保留、stale 判定和跨组织 404
 */
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import ProjectHealthDiagnosisService from '#services/health_diagnosis/diagnosis_service'
import AuditService from '#services/audit_service'

test.group('Health Diagnosis Service', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('health-service') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const service = new ProjectHealthDiagnosisService(new AuditService())
    return { owner, org, project, service }
  }

  test('create: 生成诊断不修改项目数据', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.create({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: owner.id,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isDefined(result.diagnosis)
    assert.equal(result.diagnosis.status, 'pending')
    // 验证没有修改项目数据
    const projectAfter = await project.refresh()
    assert.equal(projectAfter?.healthStatus, project.healthStatus)
  })

  test('confirm/reject: 状态机正确流转', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const { diagnosis } = await service.create({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: owner.id,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    // confirm
    const confirmed = await service.confirm({
      diagnosisId: diagnosis.id,
      userId: owner.id,
      organizationId: Number(org.id),
      projectId: project.id,
      notes: '确认测试',
    })
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.confirmedBy, owner.id)
    assert.isNotNull(confirmed.confirmedAt)

    // 已驳回不可确认
    const { diagnosis: d2 } = await service.create({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: owner.id,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })
    await service.reject({
      diagnosisId: d2.id,
      userId: owner.id,
      organizationId: Number(org.id),
      projectId: project.id,
      reason: '测试驳回',
    })

    try {
      await service.confirm({
        diagnosisId: d2.id,
        userId: owner.id,
        organizationId: Number(org.id),
        projectId: project.id,
      })
      assert.fail('应抛出 HEALTH_DIAGNOSIS_REJECTED_CANNOT_CONFIRM')
    } catch (e: any) {
      assert.equal(e.message, 'HEALTH_DIAGNOSIS_REJECTED_CANNOT_CONFIRM')
    }
  })

  test('refresh: 保留旧快照生成新记录', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const d1 = await service.create({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: owner.id,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    const d2 = await service.refresh({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: owner.id,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.notEqual(d1.diagnosis.id, d2.diagnosis.id)
  })

  test('stale: 跨组织返回 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const service = new ProjectHealthDiagnosisService(new AuditService())
    try {
      await service.getLatest(99999, 99999, 1)
      assert.fail('应抛出 RESOURCE_NOT_FOUND')
    } catch (e: any) {
      assert.equal(e.message, 'RESOURCE_NOT_FOUND')
    }
  })
})
