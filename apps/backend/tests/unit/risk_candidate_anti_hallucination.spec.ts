import Risk from '#models/risk'
import RiskSignalCandidate from '#models/risk_signal_candidate'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/**
 * 规则候选反幻觉/人工确认测试。
 *
 * 核心原则：候选评估、查看、拒绝、过期均不写入正式风险表。
 * 只有用户显式「采纳」后才通过 RiskService.create 创建正式记录。
 */
test.group('风险候选反幻觉确认', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('candidate-hl') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project }
  }

  test('创建候选不产生正式风险', async ({ assert }) => {
    const { org, project } = await setup()

    // 统计创建前风险数
    const beforeCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    // 创建候选（模拟规则引擎输出）
    await RiskSignalCandidate.create({
      organizationId: org.id,
      projectId: project.id,
      ruleId: 'overdue-task',
      ruleVersion: '1.0',
      severity: 'medium',
      evidence: [{ type: 'task', id: 1, title: '逾期任务', detail: '逾期 5 天' }],
      recommendedAction: '审查逾期任务',
      confidence: 0.95,
      idempotencyKey: 'overdue-task-999-3',
      source: 'rule_engine',
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    // 统计创建后风险数
    const afterCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    assert.equal(beforeCount, afterCount, '候选创建不应增加正式风险数')
  })

  test('批量创建候选也不产生正式风险', async ({ assert }) => {
    const { org, project } = await setup()

    const beforeCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    // 批量创建多个候选
    for (let i = 0; i < 5; i++) {
      await RiskSignalCandidate.create({
        organizationId: org.id,
        projectId: project.id,
        ruleId: `rule-${i}`,
        ruleVersion: '1.0',
        severity: 'medium',
        evidence: [{ type: 'task', id: i, title: `任务 ${i}`, detail: `逾期 ${i + 1} 天` }],
        recommendedAction: `处理规则 ${i}`,
        confidence: 0.9,
        idempotencyKey: `batch-${i}-${Date.now()}`,
        source: 'rule_engine',
        expiresAt: DateTime.now().plus({ days: 7 }),
      })
    }

    const afterCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    assert.equal(beforeCount, afterCount, '批量候选创建不应增加正式风险数')
  })

  test('查看候选不改变风险数', async ({ assert }) => {
    const { org, project } = await setup()

    // 创建一些候选
    await RiskSignalCandidate.create({
      organizationId: org.id,
      projectId: project.id,
      ruleId: 'critical-path-drift',
      ruleVersion: '1.0',
      severity: 'high',
      evidence: [{ type: 'task', id: 2, title: '关键任务', detail: '延期 3 天' }],
      recommendedAction: '评估关键路径影响',
      confidence: 0.9,
      idempotencyKey: 'cpd-999-1',
      source: 'rule_engine',
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    // 统计查看前的风险数
    const beforeCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    // 查看候选（模拟列表查询）
    const candidates = await RiskSignalCandidate.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('status', 'pending')

    assert.isAtLeast(candidates.length, 1)

    // 查看后的风险数应不变
    const afterCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    assert.equal(beforeCount, afterCount, '查看候选不应改变正式风险数')
  })

  test('拒绝候选不产生正式风险', async ({ assert }) => {
    const { org, project } = await setup()

    // 创建候选
    const candidate = await RiskSignalCandidate.create({
      organizationId: org.id,
      projectId: project.id,
      ruleId: 'resource-overload',
      ruleVersion: '1.0',
      severity: 'medium',
      evidence: [{ type: 'resource', id: 3, title: '开发者', detail: '过载 30%' }],
      recommendedAction: '调整资源分配',
      confidence: 0.85,
      idempotencyKey: 'ro-999-1',
      source: 'rule_engine',
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    // 拒绝前风险数
    const beforeCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    // 执行拒绝（模拟 controller 行为）
    candidate.status = 'rejected'
    candidate.resolvedAt = DateTime.now()
    await candidate.save()

    // 拒绝后风险数应不变
    const afterCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    assert.equal(beforeCount, afterCount, '拒绝候选不应产生正式风险')

    // 验证候选状态已更新
    const reloaded = await RiskSignalCandidate.find(candidate.id)
    assert.equal(reloaded!.status, 'rejected')
    assert.isNotNull(reloaded!.resolvedAt)
  })

  test('过期的候选被忽略（不查询到 pending 过期候选）', async ({ assert }) => {
    const { org, project } = await setup()
    const db = await import('@adonisjs/lucid/services/db')

    // 创建已过期候选：因为 CHECK 约束 expires_at > created_at，
    // 需要直接通过 db.insert 同时设置 created_at 和 expires_at
    const now = DateTime.now()
    const expiredKey = `expired-${Date.now()}`
    await db.default.table('risk_signal_candidates').insert({
      organization_id: org.id,
      project_id: project.id,
      rule_id: 'overdue-task',
      rule_version: '1.0',
      severity: 'low',
      evidence: JSON.stringify([{ type: 'task', id: 4, title: '已过期候选', detail: '过期测试' }]),
      recommended_action: '测试过期',
      confidence: 0.5,
      idempotency_key: expiredKey,
      source: 'rule_engine',
      expires_at: now.minus({ days: 1 }).toISO()!,
      created_at: now.minus({ days: 2 }).toISO()!,
      updated_at: now.toISO()!,
    })
    const expiredCandidate = await RiskSignalCandidate.query()
      .where('idempotency_key', expiredKey)
      .firstOrFail()

    // 创建未过期候选
    const activeCandidate = await RiskSignalCandidate.create({
      organizationId: org.id,
      projectId: project.id,
      ruleId: 'overdue-task',
      ruleVersion: '1.0',
      severity: 'medium',
      evidence: [{ type: 'task', id: 5, title: '活跃候选', detail: '活跃测试' }],
      recommendedAction: '测试活跃',
      confidence: 0.9,
      idempotencyKey: `active-${Date.now()}`,
      source: 'rule_engine',
      expiresAt: DateTime.now().plus({ days: 7 }), // 未过期
    })

    // 查询 pending 且未过期的候选
    const activePending = await RiskSignalCandidate.query()
      .where('project_id', project.id)
      .where('status', 'pending')
      .where('expires_at', '>', DateTime.now().toSQL()!)

    // 只应查到未过期的候选
    assert.lengthOf(activePending, 1)
    assert.equal(activePending[0]!.id, activeCandidate.id)

    // 过期候选的 status 未变（仍然是 pending），但被查询过滤排除
    const expiredReloaded = await RiskSignalCandidate.find(expiredCandidate.id)
    assert.equal(expiredReloaded!.status, 'pending')

    // 过期的候选应不影响风险计数
    const riskCount = await Risk.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    assert.equal(riskCount, 0, '过期候选不应产生正式风险')
  })
})
