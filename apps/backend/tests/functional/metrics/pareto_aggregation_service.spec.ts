/**
 * v3-chart-gallery-data-foundation —— W4.8 ParetoAggregationService 功能测试。
 *
 * 确定性场景（手工核算）：
 * - issue_type：6 bug + 2 blocker + 1 technical + 1 other → 60/20/10/10%，
 *   bug/blocker 为 vital few（累计 80% 边界规则：前一项 < 80 才打标）；
 * - issue_severity / risk_category / change_type 三维计数与中文标签；
 * - 空数据、频次并列稳定性、跨组织 404。
 */
import ChangeRequest from '#models/change_request'
import Issue, { type IssueSeverity, type IssueType } from '#models/issue'
import Risk from '#models/risk'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import ParetoAggregationService from '#services/pareto_aggregation_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('ParetoAggregationService', (group) => {
  useAuthDatabase(group)

  let paretoSvc: ParetoAggregationService
  group.each.setup(() => {
    paretoSvc = new ParetoAggregationService()
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('pareto-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'Project Manager')
    return { owner, org, project }
  }

  async function createIssue(
    organizationId: number,
    projectId: number,
    reportedBy: number,
    code: string,
    type: IssueType,
    severity: IssueSeverity = 'minor',
  ) {
    return Issue.create({
      organizationId,
      projectId,
      reportedBy,
      code,
      title: `议题-${code}`,
      type,
      severity,
    })
  }

  async function createRisk(
    organizationId: number,
    projectId: number,
    title: string,
    category: string,
  ) {
    return Risk.create({
      organizationId,
      projectId,
      title,
      description: `${title} 描述`,
      category,
      probability: 1,
      impact: 1,
      score: 1,
      status: 'identified',
      riskLevel: 'low',
      priority: 'normal',
      identifiedAt: DateTime.now(),
      createdBy: 1,
    })
  }

  async function createChange(
    organizationId: number,
    projectId: number,
    requesterId: number,
    index: number,
    changeType: string,
  ) {
    return ChangeRequest.create({
      crCode: `CR-PARETO-${process.pid}-${index}`,
      organizationId,
      projectId,
      requesterId,
      requestedBy: requesterId,
      title: `变更-${index}`,
      changeType,
      status: 'approved',
      priority: 'medium',
    })
  }

  test('issue_type：降序、百分比、累计与 80% vital few 边界', async ({ assert }) => {
    const { org, project, owner } = await setupProject()
    // 6 bug + 2 blocker + 1 technical + 1 other
    for (let i = 0; i < 6; i++) await createIssue(org.id, project.id, owner.id, `B-${i}`, 'bug')
    for (let i = 0; i < 2; i++) await createIssue(org.id, project.id, owner.id, `K-${i}`, 'blocker')
    await createIssue(org.id, project.id, owner.id, 'T-1', 'technical')
    await createIssue(org.id, project.id, owner.id, 'O-1', 'other')

    const result = await paretoSvc.getPareto(org.id, project.id, 'issue_type')

    assert.equal(result.dimension, 'issue_type')
    assert.equal(result.totalCount, 10)
    assert.deepEqual(
      result.items.map((i) => ({ category: i.category, label: i.label, count: i.count })),
      [
        { category: 'bug', label: '功能缺陷', count: 6 },
        { category: 'blocker', label: '阻塞障碍', count: 2 },
        // 同频并列按类别名升序：other < technical
        { category: 'other', label: '其他', count: 1 },
        { category: 'technical', label: '技术问题', count: 1 },
      ],
    )
    assert.deepEqual(
      result.items.map((i) => i.percentage),
      [60, 20, 10, 10],
    )
    assert.deepEqual(
      result.items.map((i) => i.cumulativePercentage),
      [60, 80, 90, 100],
    )
    // 前两项累计 <= 80 → vital few；第三项起为次要因素
    assert.deepEqual(
      result.items.map((i) => i.isVitalFew),
      [true, true, false, false],
    )
  })

  test('issue_severity：严重度分布与标签', async ({ assert }) => {
    const { org, project, owner } = await setupProject()
    for (let i = 0; i < 3; i++)
      await createIssue(org.id, project.id, owner.id, `M-${i}`, 'bug', 'major')
    await createIssue(org.id, project.id, owner.id, 'C-1', 'bug', 'critical')
    await createIssue(org.id, project.id, owner.id, 'T-1', 'bug', 'trivial')

    const result = await paretoSvc.getPareto(org.id, project.id, 'issue_severity')

    assert.equal(result.totalCount, 5)
    assert.deepEqual(
      result.items.map((i) => [i.category, i.label, i.count, i.percentage, i.cumulativePercentage]),
      [
        ['major', '严重', 3, 60, 60],
        ['critical', '致命', 1, 20, 80],
        ['trivial', '轻微', 1, 20, 100],
      ],
    )
    assert.deepEqual(
      result.items.map((i) => i.isVitalFew),
      [true, true, false],
    )
  })

  test('risk_category：风险分类聚合', async ({ assert }) => {
    const { org, project } = await setupProject()
    for (let i = 0; i < 6; i++) await createRisk(org.id, project.id, `技术风险-${i}`, 'technical')
    for (let i = 0; i < 2; i++) await createRisk(org.id, project.id, `进度风险-${i}`, 'schedule')
    await createRisk(org.id, project.id, '法律风险', 'legal')
    await createRisk(org.id, project.id, '其他风险', 'other')

    const result = await paretoSvc.getPareto(org.id, project.id, 'risk_category')

    assert.equal(result.totalCount, 10)
    assert.deepEqual(
      result.items.map((i) => [i.category, i.label, i.count]),
      [
        ['technical', '技术', 6],
        ['schedule', '进度', 2],
        ['legal', '法律合规', 1],
        ['other', '其他', 1],
      ],
    )
    assert.deepEqual(
      result.items.map((i) => i.isVitalFew),
      [true, true, false, false],
    )
  })

  test('change_type：变更动因聚合', async ({ assert }) => {
    const { org, project, owner } = await setupProject()
    for (let i = 0; i < 5; i++) await createChange(org.id, project.id, owner.id, i, 'scope')
    for (let i = 0; i < 3; i++) await createChange(org.id, project.id, owner.id, 10 + i, 'cost')
    await createChange(org.id, project.id, owner.id, 20, 'risk')
    await createChange(org.id, project.id, owner.id, 21, 'other')

    const result = await paretoSvc.getPareto(org.id, project.id, 'change_type')

    assert.equal(result.totalCount, 10)
    assert.deepEqual(
      result.items.map((i) => [i.category, i.label, i.count]),
      [
        ['scope', '范围变更', 5],
        ['cost', '成本变更', 3],
        // 同频并列按类别名升序：other < risk
        ['other', '其他变更', 1],
        ['risk', '风险变更', 1],
      ],
    )
    assert.deepEqual(
      result.items.map((i) => i.isVitalFew),
      [true, true, false, false],
    )
  })

  test('80% 边界内多小项：前一项累计 < 80 即打标', async ({ assert }) => {
    const { org, project, owner } = await setupProject()
    // 5 bug + 5 other：50/50 —— 第二项前累计 50 < 80 → 两问均 vital
    for (let i = 0; i < 5; i++) await createIssue(org.id, project.id, owner.id, `A-${i}`, 'bug')
    for (let i = 0; i < 5; i++) await createIssue(org.id, project.id, owner.id, `B-${i}`, 'other')

    const result = await paretoSvc.getPareto(org.id, project.id, 'issue_type')

    assert.deepEqual(
      result.items.map((i) => [i.category, i.percentage, i.cumulativePercentage, i.isVitalFew]),
      [
        ['bug', 50, 50, true],
        ['other', 50, 100, true],
      ],
    )
  })

  test('空数据：totalCount 0 且 items 空数组', async ({ assert }) => {
    const { org, project } = await setupProject()
    const result = await paretoSvc.getPareto(org.id, project.id, 'issue_type')
    assert.equal(result.totalCount, 0)
    assert.deepEqual(result.items, [])
  })

  test('跨组织访问返回 404（ResourceNotFoundException）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('pareto-owner-a') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(orgA, ownerA, ownerA, 'Project Manager')
    await createIssue(orgA.id, project.id, ownerA.id, 'X-1', 'bug')

    const userB = await createUser({ email: uniqueEmail('pareto-user-b') })
    const orgB = await createOrganization(userB)

    for (const dimension of [
      'issue_type',
      'issue_severity',
      'risk_category',
      'change_type',
    ] as const) {
      let caught: unknown
      try {
        await paretoSvc.getPareto(orgB.id, project.id, dimension)
      } catch (error) {
        caught = error
      }
      assert.instanceOf(caught, ResourceNotFoundException)
    }
  })
})
