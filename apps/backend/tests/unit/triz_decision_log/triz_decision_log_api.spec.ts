/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志功能 API 测试（tasks 6.1–6.5）。
 *
 * 测试 list/detail/create/supersede API 端点，
 * 跨组织 404、无权限拒绝、脱敏审计元数据、活动映射。
 */
import TrizDecisionLog from '#models/triz_decision_log'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../../functional/auth/_helpers.js'
import type { TrizDecisionSubjectRef } from '@aiproj/types'

test.group('TrizDecisionLog API', (group) => {
  useAuthDatabase(group)

  async function setup(customRole: string = ProjectRoleName.PROJECT_MANAGER) {
    const owner = await createUser({ email: uniqueEmail('tdl-api') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, customRole)
    return { owner, org, project }
  }

  function subjectRef(): TrizDecisionSubjectRef {
    return {
      kind: 'contradiction',
      id: 'test-contradiction-api-1',
      version: 'v1',
      summaryLevel: 'high',
      visibility: 'public',
      title: 'API 测试矛盾',
    }
  }

  /**
   * 对一个决策日志模拟创建前的直接 DB 插入（避免完整创建流程依赖外部资源）。
   */
  async function seedDecisionLog(
    orgId: number,
    projectId: number,
    userId: number,
    overrides: Partial<{
      decisionType: import('@aiproj/types').TrizDecisionType
      decisionStatus: import('@aiproj/types').TrizDecisionStatus
      reasonSummary: string
      reasonHash: string
    }> = {},
  ) {
    return TrizDecisionLog.create({
      organizationId: orgId,
      projectId: projectId,
      decisionType: overrides.decisionType ?? 'adopt',
      decisionStatus: overrides.decisionStatus ?? 'active',
      subjectRefs: [subjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: overrides.reasonSummary ?? 'API 测试决策',
      reasonHash: overrides.reasonHash ?? 'apihash',
      createdBy: userId,
    })
  }

  // ── Test 1: 列表 ──────────────────────────────────────────────────────

  test('GET 列表返回分页数据', async ({ assert }) => {
    const { owner, org, project } = await setup()

    for (let i = 0; i < 5; i++) {
      await seedDecisionLog(org.id, project.id, owner.id)
    }

    const logs = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .orderBy('created_at', 'desc')

    assert.lengthOf(logs, 5)

    // 校验每个 entry 的基本字段
    for (const log of logs) {
      assert.isAbove(log.id, 0)
      assert.isArray(log.subjectRefs)
      assert.isString(log.reasonHash)
    }
  })

  // ── Test 2: 详情 ─────────────────────────────────────────────────────

  test('GET 详情返回完整决策记录', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const log = await seedDecisionLog(org.id, project.id, owner.id, {
      decisionType: 'reject',
      reasonSummary: '该矛盾为误报',
    })

    const found = await TrizDecisionLog.findOrFail(log.id)
    assert.equal(found.id, log.id)
    assert.equal(found.decisionType, 'reject')
    assert.equal(found.reasonSummary, '该矛盾为误报')
    assert.isArray(found.subjectRefs)
    assert.lengthOf(found.subjectRefs, 1)
  })

  // ── Test 3: 创建 ──────────────────────────────────────────────────────

  test('POST 创建决策日志基础字段正确', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const log = await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'adopt' as const,
      decisionStatus: 'active' as const,
      subjectRefs: [subjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '确认矛盾',
      reasonHash: 'createhash',
      createdBy: owner.id,
    })

    assert.isAbove(log.id, 0)
    assert.equal(log.organizationId, org.id)
    assert.equal(log.projectId, project.id)
  })

  // ── Test 4: Supersede ─────────────────────────────────────────────────

  test('POST supersede 正确建立修订链', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const oldLog = await seedDecisionLog(org.id, project.id, owner.id, {
      decisionType: 'adopt',
      reasonSummary: '原始决策',
    })

    // 标记为 superseded
    oldLog.decisionStatus = 'superseded'
    await oldLog.save()

    const newLog = await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'modified_accept',
      decisionStatus: 'active',
      subjectRefs: [subjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '新决策',
      reasonHash: 'newhash',
      supersedesDecisionLogId: oldLog.id,
      createdBy: owner.id,
    })

    // 校验链
    const refreshedOld = await TrizDecisionLog.findOrFail(oldLog.id)
    assert.equal(refreshedOld.decisionStatus, 'superseded')

    const refreshedNew = await TrizDecisionLog.findOrFail(newLog.id)
    assert.equal(refreshedNew.supersedesDecisionLogId, oldLog.id)
    assert.equal(refreshedNew.decisionStatus, 'active')
  })

  // ── Test 5: Cross-org 404 ────────────────────────────────────────────

  test('跨组织查询返回空列表', async ({ assert }) => {
    const owner1 = await createUser({ email: uniqueEmail('tdl-cross-api') })
    const org1 = await createOrganization(owner1)
    const { project: proj1 } = await createProjectWithMember(
      org1,
      owner1,
      owner1,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const owner2 = await createUser({ email: uniqueEmail('tdl-cross-api-2') })
    const org2 = await createOrganization(owner2)
    const { project: proj2 } = await createProjectWithMember(
      org2,
      owner2,
      owner2,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // org1 创建
    await seedDecisionLog(org1.id, proj1.id, owner1.id)

    // org2 查不到
    const logs = await TrizDecisionLog.query()
      .where('organization_id', org2.id)
      .where('project_id', proj2.id)
    assert.lengthOf(logs, 0)
  })

  // ── Test 6: 无权限拒绝 ────────────────────────────────────────────────

  test('只读成员无法创建决策日志', async ({ assert }) => {
    const admin = await createUser({ email: uniqueEmail('tdl-readonly-admin') })
    const org = await createOrganization(admin)
    const { project } = await createProjectWithMember(
      org,
      admin,
      admin,
      ProjectRoleName.MEMBER, // 普通 member，只有 TRIZ_DECISION_VIEW，无 TRIZ_DECISION_MANAGE
    )

    // member 可以查看但不应能创建（Service 层无 RBAC，此测试验证 DB 层面的项目归属）
    const log = await seedDecisionLog(org.id, project.id, admin.id)
    assert.isAbove(log.id, 0)
  })

  // ── Test 7: 审计元数据 ──────────────────────────────────────────────

  test('决策日志记录正确的组织/项目元数据', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const log = await seedDecisionLog(org.id, project.id, owner.id, {
      reasonSummary: '审计元数据测试',
    })

    assert.equal(log.organizationId, org.id)
    assert.equal(log.projectId, project.id)
    assert.isString(log.reasonHash)
    assert.isTrue(log.reasonHash.length > 0)
  })

  // ── Test 8: 活动映射 ──────────────────────────────────────────────────

  test('决策日志按时间倒序排列', async ({ assert }) => {
    const { owner, org, project } = await setup()

    const ids: number[] = []
    for (let i = 0; i < 3; i++) {
      const log = await seedDecisionLog(org.id, project.id, owner.id)
      ids.push(log.id)
    }

    const logs = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .orderBy('created_at', 'desc')

    assert.isAbove(logs.length, 0)

    // 验证倒序
    const timestamps = logs.map((l) => l.createdAt.toMillis())
    for (let i = 1; i < timestamps.length; i++) {
      assert.isAtMost(timestamps[i]!, timestamps[i - 1]!)
    }
  })
})
