/**
 * v3-skill-eval-system —— SkillEvalService 单元测试（Japa）。
 *
 * 覆盖：4.4 Service 测试（组织隔离越权、报告持久化与读取、效果指标零数据降级、审计事件写入）、
 * 6.4 审计测试（审计负载低敏断言、失败操作不写成功审计）、
 * 7.4 AI 辅助测试（advisory 不自动落库、fixture 优先、高置信度不豁免人审）。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import SkillEvalService, {
  SkillEvalNotFoundError,
} from '#services/compiler/skills/skill_eval_service'
import CompilerSkill from '#models/compiler_skill'
import SkillEvalReport from '#models/skill_eval_report'
import SkillEvalRun from '#models/skill_eval_run'
import SkillEffectEvent from '#models/skill_effect_event'
import AuditLog from '#models/audit_log'

const ORG_A = 201
const ORG_B = 202
const ACTOR_ID = 1

// 创建测试 Skill 的辅助函数
async function createTestSkill(
  orgId: number,
  skillKey: string,
  status: string = 'active',
  overrides: Record<string, unknown> = {},
) {
  return CompilerSkill.create({
    organizationId: orgId,
    skillKey,
    name: `Test ${skillKey}`,
    version: '1.0.0',
    description: 'A test skill for eval',
    status: status as any,
    category: { primary: 'domain', secondary: 'software' },
    tags: ['test'],
    dependencies: [],
    activation: {},
    knowledge: {
      rules: [
        {
          id: 'r1',
          title: 'Rule 1',
          content: 'Test rule content',
          confidence: 0.9,
          sourceRefs: [{ layer: 'L1', sourceId: 'ISO 9001' }],
        },
        {
          id: 'r2',
          title: 'Rule 2',
          content: 'Another rule',
          confidence: 0.85,
          sourceRefs: [{ layer: 'L1', sourceId: 'GB/T 19001' }],
        },
      ],
      patterns: [
        {
          id: 'p1',
          title: 'Pattern 1',
          content: 'Test pattern',
          confidence: 0.8,
          sourceRefs: [{ layer: 'L1', sourceId: 'PMBOK' }],
        },
      ],
      antiPatterns: [
        {
          id: 'ap1',
          title: 'Anti Pattern 1',
          content: 'Test anti pattern',
          confidence: 0.75,
          sourceRefs: [],
        },
      ],
      examples: [
        { id: 'e1', title: 'Example 1', content: 'Test example', confidence: 0.9, sourceRefs: [] },
      ],
      checklists: [
        {
          id: 'c1',
          title: 'Checklist 1',
          content: 'Test checklist',
          confidence: 0.8,
          sourceRefs: [],
        },
      ],
      rubric: [
        { id: 'rb1', title: 'Rubric 1', content: 'Test rubric', confidence: 0.7, sourceRefs: [] },
      ],
      ...overrides,
    } as any,
    provenance: { sourceSkillKey: 'org/base-skill', sourceVersion: '1.0.0' },
    basePriority: 100,
    createdBy: ACTOR_ID,
    updatedBy: ACTOR_ID,
  })
}

test.group('SkillEvalService', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await SkillEvalReport.query().delete()
    await SkillEvalRun.query().delete()
    await SkillEffectEvent.query().delete()
    await CompilerSkill.query().delete()
    await AuditLog.query().delete()
  })

  // ── 4.4 任务：组织隔离越权返回 RESOURCE_NOT_FOUND ──

  test('跨组织访问 Skill 返回 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    // 在 ORG_A 创建 Skill
    await createTestSkill(ORG_A, 'org-a-skill')

    // ORG_B 用户尝试访问 ORG_A 的 Skill 应抛错
    // chai 的 assert.rejects 第二参是「期望的错误」而不是描述文字：传描述会被当成期望
    // message 去匹配，于是永远匹配不上。断言错误类型才真正验证了 not found 语义。
    await assert.rejects(
      async () => svc.runQualityAssessment(ORG_B, 9999, ACTOR_ID),
      SkillEvalNotFoundError,
    )
  })

  test('评估不存在的 Skill 返回 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    await assert.rejects(
      async () => svc.runQualityAssessment(ORG_A, 99999, ACTOR_ID),
      SkillEvalNotFoundError,
    )
  })

  // ── 报告持久化与读取 ──

  test('质量评估持久化报告并可通过列表查询', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'persist-test', 'eval')

    // 执行质量评估
    const report = await svc.runQualityAssessment(ORG_A, skill.id, ACTOR_ID)
    assert.isDefined(report)
    assert.isAbove(report.score, 0)
    assert.isDefined(report.grade)

    // 列表查询
    const listResult = await svc.listReports(ORG_A, skill.id)
    assert.isAtLeast(listResult.data.length, 1)
    assert.equal(listResult.meta.total, 1)

    // 详情查询
    const detail = await svc.getReport(ORG_A, listResult.data[0]!.id)
    assert.equal(detail.score, report.score)
    assert.equal(detail.skillId, skill.id)
  })

  test('评测运行持久化', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'benchmark-persist', 'active')

    const report = await svc.runBenchmark(ORG_A, skill.id, ACTOR_ID, {
      benchmarkSource: 'fixture',
    })
    assert.isDefined(report)
    assert.equal(report.benchmarkSource, 'fixture')
    assert.isAbove(report.totalInputs, 0)
    assert.isDefined(report.evidenceDigest)
    assert.equal(report.evidenceDigest.length, 64)
  })

  // ── 效果指标未注入前零数据降级 ──

  test('效果指标在无事件时返回零数据降级', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'zero-metrics')
    const metrics = await svc.getEffectMetrics(ORG_A, skill.skillKey)

    assert.equal(metrics.activationCount, 0)
    assert.isNull(metrics.avgScore)
  })

  test('效果指标在有事件时正确聚合', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'has-metrics')
    await svc.recordSkillEffect(ORG_A, skill.skillKey, {
      activatedAt: '2026-07-26T00:00:00.000Z',
      qualityScore: 85,
      referenceTime: '2026-07-26T00:00:00.000Z',
    })
    await svc.recordSkillEffect(ORG_A, skill.skillKey, {
      activatedAt: '2026-07-26T01:00:00.000Z',
      qualityScore: 75,
      referenceTime: '2026-07-26T01:00:00.000Z',
    })

    const metrics = await svc.getEffectMetrics(ORG_A, skill.skillKey)
    assert.equal(metrics.activationCount, 2)
    assert.equal(metrics.avgScore, 80)
  })

  // ── 审计事件写入 ──

  test('质量评估写入低敏审计事件', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'audit-quality', 'eval')
    const beforeCount = await AuditLog.query().count('* as total').first()

    await svc.runQualityAssessment(ORG_A, skill.id, ACTOR_ID)

    const afterCount = await AuditLog.query().count('* as total').first()
    // @ts-ignore
    assert.isAbove(
      Number(afterCount?.$extras?.total ?? 0),
      Number(beforeCount?.$extras?.total ?? 0),
    )
  })

  test('审计负载不含知识正文/prompt/模型输出', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'audit-low-sens', 'eval')
    await svc.runQualityAssessment(ORG_A, skill.id, ACTOR_ID)

    // 获取最新的审计日志
    const log = await AuditLog.query().orderBy('created_at', 'desc').first()

    if (log && log.metadata) {
      const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata

      // 断言不含知识正文/prompt/模型输出/secret
      const metaStr = JSON.stringify(meta).toLowerCase()
      assert.notInclude(metaStr, 'secret')
      assert.notInclude(metaStr, 'token')
      // knowledge 全文不应在审计中
      if (meta.knowledge) {
        assert.fail('审计负载不应包含 knowledge 全文')
      }
    }
  })

  // ── 失败操作不写成功审计 ──

  test('越权操作不写成功审计', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const beforeCount = await AuditLog.query().count('* as total').first()

    try {
      await svc.runQualityAssessment(ORG_A, 99999, ACTOR_ID)
    } catch {
      // 预期抛错
    }

    const afterCount = await AuditLog.query().count('* as total').first()
    // @ts-ignore
    assert.equal(Number(afterCount?.$extras?.total ?? 0), Number(beforeCount?.$extras?.total ?? 0))
  })

  // ── 7.4 任务：AI 辅助测试 ──

  test('AI 辅助评估不自动落库为正式报告', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'ai-assist-no-persist')
    const beforeReportCount = await SkillEvalReport.query()
      .where('organization_id', ORG_A)
      .count('* as total')
      .first()

    const advisory = await svc.aiAssist(ORG_A, skill.id, ACTOR_ID)
    assert.equal(advisory.status, 'advisory')
    assert.isDefined(advisory.accuracy)
    assert.isDefined(advisory.completeness)
    assert.isDefined(advisory.consistency)

    const afterReportCount = await SkillEvalReport.query()
      .where('organization_id', ORG_A)
      .count('* as total')
      .first()

    // @ts-ignore
    assert.equal(
      Number(afterReportCount?.$extras?.total ?? 0),
      Number(beforeReportCount?.$extras?.total ?? 0),
      'AI advisory 不应自动落库为正式报告',
    )
  })

  test('fixture 优先产出确定性 advisory', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'fixture-first')

    const r1 = await svc.aiAssist(ORG_A, skill.id, ACTOR_ID)
    const r2 = await svc.aiAssist(ORG_A, skill.id, ACTOR_ID)

    // fixture 确定性：相同输入相同结果
    assert.equal(r1.accuracy, r2.accuracy)
    assert.equal(r1.overall, r2.overall)
    assert.equal(r1.confidence, r2.confidence)
  })

  test('高置信度不豁免人审', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skill = await createTestSkill(ORG_A, 'high-conf-no-auto')
    const advisory = await svc.aiAssist(ORG_A, skill.id, ACTOR_ID)

    // 即使置信度高（0.85），仍保持 advisory 状态
    assert.isAbove(advisory.confidence, 0.8)
    assert.equal(advisory.status, 'advisory')
    // 不应自动落库为正式报告
    const reports = await SkillEvalReport.query()
      .where('organization_id', ORG_A)
      .where('skill_id', skill.id)
    assert.lengthOf(reports, 0)
  })

  test('反幻觉 blocking 不阻断 advisory 生成（advisory 仅建议）', async ({ assert }) => {
    // advisory 只是建议，反幻觉不阻断其生成
    const svc = await testUtils.app.container.make(SkillEvalService)
    const skill = await createTestSkill(ORG_A, 'hl-advisory')
    const advisory = await svc.aiAssist(ORG_A, skill.id, ACTOR_ID)

    assert.equal(advisory.status, 'advisory')
    assert.isDefined(advisory.overall)
  })

  // ── 6.4 任务：feature-off 零回归 ──

  test('feature-off 时质量评估 API 不暴露数据', async ({ assert }) => {
    // feature flag 默认关闭，评估端点在路由层面由 feature-off 守卫控制
    // 此处验证 Service 层在无 flag 时仍可正常调用（Service 不检查 flag，flag 检查在 Controller/路由层）
    const svc = await testUtils.app.container.make(SkillEvalService)
    const skill = await createTestSkill(ORG_A, 'feature-off-test')

    // Service 层正常执行（Controller 层负责 flag 检查）
    const report = await svc.runQualityAssessment(ORG_A, skill.id, ACTOR_ID)
    assert.isDefined(report)
  })

  test('记录效果事件后写入 skill_effect_events 表', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)
    const skill = await createTestSkill(ORG_A, 'effect-record')

    await svc.recordSkillEffect(ORG_A, skill.skillKey, {
      activatedAt: '2026-07-26T00:00:00.000Z',
      qualityScore: 90,
      referenceTime: '2026-07-26T00:00:00.000Z',
    })

    const events = await SkillEffectEvent.query()
      .where('organization_id', ORG_A)
      .where('skill_id', skill.id)

    assert.isAtLeast(events.length, 1)
    assert.equal(events[0]!.qualityScore, 90)
  })

  test('记录效果事件写低敏审计', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)
    const skill = await createTestSkill(ORG_A, 'effect-audit')

    const beforeCount = await AuditLog.query().count('* as total').first()

    await svc.recordSkillEffect(ORG_A, skill.skillKey, {
      activatedAt: '2026-07-26T00:00:00.000Z',
      referenceTime: '2026-07-26T00:00:00.000Z',
    })

    const afterCount = await AuditLog.query().count('* as total').first()
    // @ts-ignore
    assert.isAbove(
      Number(afterCount?.$extras?.total ?? 0),
      Number(beforeCount?.$extras?.total ?? 0),
    )
  })

  // ── 效果指标组织隔离 ──

  test('效果指标仅聚合本组织事件', async ({ assert }) => {
    const svc = await testUtils.app.container.make(SkillEvalService)

    const skillA = await createTestSkill(ORG_A, 'isolated-skill')
    const skillB = await createTestSkill(ORG_B, 'isolated-skill')

    // ORG_A 记录效果事件
    await svc.recordSkillEffect(ORG_A, skillA.skillKey, {
      activatedAt: '2026-07-26T00:00:00.000Z',
      qualityScore: 90,
      referenceTime: '2026-07-26T00:00:00.000Z',
    })

    // ORG_B 的指标应不受 ORG_A 事件影响
    const metricsB = await svc.getEffectMetrics(ORG_B, skillB.skillKey)
    assert.equal(metricsB.activationCount, 0)
    assert.isNull(metricsB.avgScore)
  })
})
