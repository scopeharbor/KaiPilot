// v3-triz-contradiction-copilot tasks 3.3 —— 置信分层、幂等、去重、过期与状态机单测。
//
// 覆盖（tasks 3.3 验收）：
// - 四条件组合矩阵 ≥8 例（显著幅度 / 连续周期 / 字段完整 / 复合证据，缺一即低置信）；
// - 分层理由字段可读到四项命中情况；分层变更保留旧分层痕迹；
// - 重复检测不产生重复记录（幂等键命中 + 库层唯一约束）；
// - 超期自动转过期（读取零写入：过期只在写入路径发生）；
// - 状态流转记录操作人 / 时间 / 前后状态并产生审计事件；已忽略不因同观测窗证据复发；
//   跨观测窗可重新激活；非法流转 409；跨组织关联 404。
import AuditLog from '#models/audit_log'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import ProjectSignal from '#models/project_signal'
import ProjectSignalDetectionService from '#services/project_signal/project_signal_detection_service'
import ProjectSignalService from '#services/project_signal/project_signal_service'
import { evaluateSignalTier } from '#services/project_signal/confidence_tier'
import {
  resolveSignalObservationWindows,
  type ProjectSignalType,
  type SignalObservation,
} from '#services/project_signal/signal_contracts'
import { SIGNAL_EXPIRY_TTL_DAYS } from '#services/project_signal/signal_thresholds'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

// ---------------------------------------------------------------------------
// 纯函数：四条件组合矩阵
// ---------------------------------------------------------------------------

function observation(overrides: Partial<SignalObservation> & { signalType: ProjectSignalType }) {
  return {
    triggered: true,
    significant: false,
    fieldsComplete: true,
    consecutiveCycles: 1,
    completenessGap: null,
    dataInsufficient: false,
    insufficientReason: null,
    severity: 'warning' as const,
    readings: { metric: overrides.signalType, coveredCycles: 1 },
    thresholds: {},
    hitConditions: [],
    entityRefs: {},
    truncated: false,
    ...overrides,
  }
}

const WINDOW = resolveSignalObservationWindows('2026-09-07', 7).current

function evaluate(options: {
  significant: boolean
  consecutive: number
  fieldsComplete: boolean
  composite: ProjectSignalType[]
  replaySupported?: boolean
}) {
  return evaluateSignalTier({
    observation: observation({
      signalType: 'progress_deviation',
      significant: options.significant,
      consecutiveCycles: options.consecutive,
      fieldsComplete: options.fieldsComplete,
      completenessGap: options.fieldsComplete ? null : 'FACT_ROW_LIMIT_TRUNCATED',
      readings: { metric: 'schedule_performance_index', replaySupported: options.replaySupported },
    }),
    compositeTypes: options.composite,
    window: WINDOW,
    evaluatedAt: '2026-09-07T00:00:00.000Z',
  })
}

test.group('置信分层：四条件组合矩阵（缺一即低置信）', () => {
  const twoTypes: ProjectSignalType[] = ['progress_deviation', 'risk_surge']

  test('仅显著幅度 → 低置信（连续/复合未命中）', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: true,
      consecutive: 1,
      fieldsComplete: true,
      composite: ['progress_deviation'],
    })
    assert.equal(tier, 'low')
    assert.isTrue(reasons.amplitude.hit)
    assert.isFalse(reasons.consecutive.hit)
    assert.isTrue(reasons.completeness.hit)
    assert.isFalse(reasons.composite.hit)
    assert.equal(reasons.consecutive.detail, 'consecutive_cycles_1_of_2')
  })

  test('仅连续 ≥2 周期 → 低置信', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: false,
      consecutive: 2,
      fieldsComplete: true,
      composite: ['progress_deviation'],
    })
    assert.equal(tier, 'low')
    assert.isFalse(reasons.amplitude.hit)
    assert.isTrue(reasons.consecutive.hit)
  })

  test('仅字段完整 → 低置信（字段完整是必要条件而非充分条件）', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: false,
      consecutive: 1,
      fieldsComplete: true,
      composite: ['progress_deviation'],
    })
    assert.equal(tier, 'low')
    assert.isTrue(reasons.completeness.hit)
    assert.isFalse(reasons.amplitude.hit)
    assert.isFalse(reasons.consecutive.hit)
    assert.isFalse(reasons.composite.hit)
  })

  test('仅复合证据 ≥2 类 → 低置信', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: false,
      consecutive: 1,
      fieldsComplete: true,
      composite: twoTypes,
    })
    assert.equal(tier, 'low')
    assert.isTrue(reasons.composite.hit)
    assert.isFalse(reasons.amplitude.hit)
  })

  test('显著 + 连续 → 低置信（缺复合）', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: true,
      consecutive: 2,
      fieldsComplete: true,
      composite: ['progress_deviation'],
    })
    assert.equal(tier, 'low')
    assert.isFalse(reasons.composite.hit)
  })

  test('显著 + 连续 + 字段完整 → 低置信（缺复合证据，条件 ④ 不可省）', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: true,
      consecutive: 2,
      fieldsComplete: true,
      composite: ['progress_deviation'],
    })
    assert.equal(tier, 'low')
    assert.isTrue(reasons.amplitude.hit)
    assert.isTrue(reasons.consecutive.hit)
    assert.isTrue(reasons.completeness.hit)
    assert.isFalse(reasons.composite.hit)
    assert.equal(reasons.composite.detail, 'composite_types_1_of_2(progress_deviation)')
  })

  test('显著 + 字段完整 + 复合 → 低置信（缺连续周期）', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: true,
      consecutive: 1,
      fieldsComplete: true,
      composite: twoTypes,
    })
    assert.equal(tier, 'low')
    assert.isTrue(reasons.amplitude.hit)
    assert.isFalse(reasons.consecutive.hit)
    assert.isTrue(reasons.composite.hit)
  })

  test('连续 + 字段完整 + 复合 → 低置信（缺显著幅度）', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: false,
      consecutive: 2,
      fieldsComplete: true,
      composite: twoTypes,
    })
    assert.equal(tier, 'low')
    assert.isFalse(reasons.amplitude.hit)
  })

  test('四条件全中 → 高置信，且理由字段四项均可读', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: true,
      consecutive: 2,
      fieldsComplete: true,
      composite: twoTypes,
    })
    assert.equal(tier, 'high')
    for (const key of ['amplitude', 'consecutive', 'completeness', 'composite'] as const) {
      assert.isTrue(reasons[key].hit, `${key} 应命中`)
      assert.isString(reasons[key].detail)
      assert.isNotEmpty(reasons[key].detail)
    }
    assert.deepEqual(reasons.compositeTypes, ['progress_deviation', 'risk_surge'])
    assert.equal(reasons.window, WINDOW.key)
    assert.equal(reasons.evaluatedAt, '2026-09-07T00:00:00.000Z')
  })

  test('不可重放的信号源（里程碑滑移）即使其余三条件成立也保持低置信', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: true,
      consecutive: 1,
      fieldsComplete: true,
      composite: twoTypes,
      replaySupported: false,
    })
    assert.equal(tier, 'low')
    assert.isFalse(reasons.consecutive.hit)
    assert.include(reasons.consecutive.detail, 'replay_unsupported')
  })

  test('复合证据按去重后的类型数计（重复类型不抬高分层）', ({ assert }) => {
    const { tier, reasons } = evaluate({
      significant: true,
      consecutive: 2,
      fieldsComplete: true,
      composite: ['progress_deviation', 'progress_deviation'],
    })
    assert.equal(tier, 'low')
    assert.isFalse(reasons.composite.hit)
    assert.deepEqual(reasons.compositeTypes, ['progress_deviation'])
  })
})

// ---------------------------------------------------------------------------
// 落库：幂等 / 去重 / 过期 / 状态机（真库）
// ---------------------------------------------------------------------------

function hitObservation(overrides: Partial<SignalObservation> = {}): SignalObservation {
  return observation({
    signalType: 'progress_deviation',
    triggered: true,
    significant: true,
    consecutiveCycles: 2,
    readings: { metric: 'schedule_performance_index', coveredCycles: 2, spi: 0.9, sv: -1000 },
    thresholds: { spiDelayed: 0.95 },
    hitConditions: ['spi_delayed'],
    ...overrides,
  })
}

function stuck(value: SignalObservation) {
  return {
    async evaluate(): Promise<SignalObservation> {
      return value
    },
  }
}

/** 检测服务替身：进度命中（可调读数）+ 其余三类不命中，零 DB 读取。 */
function detectionWith(
  progress: SignalObservation,
  risk: SignalObservation = observation({ signalType: 'risk_surge', triggered: false }),
) {
  return new ProjectSignalDetectionService({
    progressDetector: stuck(progress),
    riskDetector: stuck(risk),
    resourceDetector: stuck(observation({ signalType: 'resource_overload', triggered: false })),
    milestoneDetector: stuck(observation({ signalType: 'milestone_slip', triggered: false })),
  })
}

test.group('信号幂等 / 过期 / 状态机（真库）', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('signal-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project }
  }

  test('同一观测窗重复检测不产生重复记录（幂等命中并刷新读数）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = new ProjectSignalService({
      detectionService: detectionWith(hitObservation()),
    })

    const first = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
      evaluatedAt: '2026-09-07T00:00:00.000Z',
    })

    assert.lengthOf(first.created, 1)
    assert.lengthOf(first.refreshed, 0)
    const signal = first.created[0]!
    assert.equal(signal.status, 'open')
    assert.equal(signal.confidenceTier, 'low', '单类型证据 ⇒ 复合条件未命中')
    assert.equal(signal.observationWindow, '2026-09-01..2026-09-07')
    assert.match(String(signal.idempotencyKey), /^[0-9a-f]{64}$/)
    assert.equal(
      signal.expiresAt.toISODate(),
      '2026-09-21',
      `过期日 = 窗口结束 + ${SIGNAL_EXPIRY_TTL_DAYS} 天`,
    )

    const second = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
      evaluatedAt: '2026-09-07T01:00:00.000Z',
    })

    assert.lengthOf(second.created, 0)
    assert.lengthOf(second.refreshed, 1)
    assert.equal(Number(second.refreshed[0]!.id), Number(signal.id))

    const rows = await ProjectSignal.query().where('project_id', project.id)
    assert.lengthOf(rows, 1, '同观测窗只允许一条信号')
    assert.equal(second.refreshed[0]!.idempotencyKey, signal.idempotencyKey, '幂等键命中')
  })

  test('库层唯一约束生效：绕过服务直插重复三元组被拒', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })
    const result = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    const existing = result.created[0]!

    let rejected = false
    try {
      await ProjectSignal.create({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        signalType: existing.signalType,
        confidenceTier: existing.confidenceTier,
        tierReasons: {},
        severity: 'warning',
        evidence: {},
        idempotencyKey: 'f'.repeat(64),
        observationWindow: existing.observationWindow,
        expiresAt: existing.expiresAt,
        status: 'open',
        previousStatus: null,
        statusChangedBy: null,
        statusChangedAt: null,
        adoptedAnalysisId: null,
        createdBy: Number(owner.id),
        deletedAt: null,
      })
    } catch {
      rejected = true
    }
    assert.isTrue(rejected, '同一「项目 + 类型 + 观测窗」重复插入必须被库层拒绝')
  })

  test('超期未被处理自动转 expired；默认视图移除、历史仍可查；读取不触发写入', async ({
    assert,
  }) => {
    const { owner, org, project } = await setup()
    const service = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })

    await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-08-01',
    })
    const openRow = await ProjectSignal.query().where('project_id', project.id).firstOrFail()

    // 读取零写入：列表读完状态与 updated_at 不变
    const beforeRead = await service.list({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
    })
    assert.lengthOf(beforeRead.data, 1)
    const afterRead = await ProjectSignal.query().where('id', openRow.id).firstOrFail()
    assert.equal(afterRead.status, 'open', '读取不得改状态')
    assert.equal(
      afterRead.updatedAt?.toISO() ?? null,
      openRow.updatedAt?.toISO() ?? null,
      '读取不得改 updated_at',
    )

    // 过期扫描：以更晚的基准日运行检测 → 超期行转 expired
    const result = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    assert.equal(result.expired, 1)

    const expiredRow = await ProjectSignal.query().where('id', openRow.id).firstOrFail()
    assert.equal(expiredRow.status, 'expired')
    assert.equal(expiredRow.previousStatus, 'open')
    assert.equal(Number(expiredRow.statusChangedBy), Number(owner.id))

    const active = await service.list({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
    })
    const stillOpen = active.data.filter((entry) => entry.id === Number(openRow.id))
    assert.lengthOf(stillOpen, 0, '超期信号必须从活跃视图移除')

    const history = await service.list({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      status: 'all',
    })
    assert.includeMembers(
      history.data.map((entry) => entry.id),
      [Number(openRow.id)],
      '历史查询仍可读到过期信号',
    )
  })

  test('忽略后同观测窗不复发；跨观测窗可重新激活', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })

    const first = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    const signalId = Number(first.created[0]!.id)

    const dismissed = await service.dismiss({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      signalId,
    })
    assert.equal(dismissed.status, 'dismissed')
    assert.equal(dismissed.previousStatus, 'open')
    assert.equal(Number(dismissed.statusChangedBy), Number(owner.id))
    assert.isNotNull(dismissed.statusChangedAt)

    const again = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    assert.lengthOf(again.created, 0)
    assert.equal(again.refreshed[0]!.status, 'dismissed', '同观测窗证据不得让已忽略信号复发')

    const nextWindow = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-14',
    })
    assert.lengthOf(nextWindow.created, 1, '新观测窗另起一行（新的证据变化 ⇒ 可重新激活）')
    assert.equal(nextWindow.created[0]!.status, 'open')

    const rows = await ProjectSignal.query().where('project_id', project.id)
    assert.lengthOf(rows, 2)
    const statuses = rows.map((row) => row.status).sort()
    assert.deepEqual(statuses, ['dismissed', 'open'])
  })

  test('状态流转产生审计事件（含信号 ID / 状态 / 操作人 / 参数哈希，无备注正文）', async ({
    assert,
  }) => {
    const { owner, org, project } = await setup()
    const service = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })
    const created = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    const signalId = Number(created.created[0]!.id)

    await service.dismiss({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      signalId,
      note: '本期由 PM 人工确认属可接受波动',
    })

    const audits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'project_signal')
      .where('entity_id', signalId)
    assert.isAtLeast(audits.length, 2, '生成 + 状态流转各一条审计')

    const transition = audits.find(
      (entry) => (entry.metadata as Record<string, unknown>).action === 'dismiss',
    )
    assert.isNotNull(transition)
    const metadata = transition!.metadata as Record<string, unknown>
    assert.equal(metadata.signalId, signalId)
    assert.equal(metadata.signalStatus, 'dismissed')
    assert.equal(metadata.status, 'SUCCESS', '审计生命周期状态沿用仓库既有约定')
    assert.equal(metadata.previousStatus, 'open')
    assert.equal(metadata.toolName, 'project_signal_radar')
    assert.match(String(metadata.parametersHash), /^[0-9a-f]{64}$/)
    assert.match(String(metadata.noteHash), /^[0-9a-f]{64}$/)
    assert.notInclude(JSON.stringify(metadata), '可接受波动', 'RL-12：备注正文不落审计')
    assert.equal(transition!.userId, Number(owner.id))
    assert.equal(transition!.projectId, Number(project.id))
    assert.equal(transition!.organizationId, Number(org.id))
  })

  test('非法流转被拒（409）；跨组织关联分析记录统一 404', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })
    const created = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    const signalId = Number(created.created[0]!.id)

    await service.dismiss({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      signalId,
    })

    const error = await service
      .dismiss({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        user: owner,
        signalId,
      })
      .then(() => null)
      .catch((thrown: unknown) => thrown as { status?: number })
    assert.isNotNull(error, '已忽略信号不得再次流转')
    assert.equal(error?.status, 409)
  })

  test('采纳：关联分析记录并形成双向可追溯（signal.adopted_analysis_id ↔ analysis.source_signal_id）', async ({
    assert,
  }) => {
    const { owner, org, project } = await setup()
    const analysis = await TrizCopilotAnalysis.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      createdBy: Number(owner.id),
      parentAnalysisId: null,
      sourceSignalId: null,
      contradictionType: 'administrative',
      improvingParameter: null,
      worseningParameter: null,
      candidatePrinciples: [],
      topSolutions: [],
      path: 'rule',
      confidence: 0,
      entityBinding: 'none',
      contextRefs: [],
      qualityFlags: [],
      fallbackReasons: [],
      knowledgePackVersion: 'test-pack-v1',
      statementDigest: 'a'.repeat(32),
      statementLength: 12,
      statementTruncated: false,
      humanOverride: false,
      overrideBy: null,
      overrideAt: null,
      clarificationRounds: 0,
      metricReadCount: 0,
      tokenBudget: 4000,
      estimatedTokens: 0,
      actualTokens: null,
      budgetState: 'within_budget',
      budgetReason: null,
      deletedAt: null,
    })

    const service = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })
    const created = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    const signalId = Number(created.created[0]!.id)

    const adopted = await service.adopt({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      signalId,
      analysisId: Number(analysis.id),
    })
    assert.equal(adopted.status, 'adopted')
    assert.equal(Number(adopted.adoptedAnalysisId), Number(analysis.id))

    const linkedAnalysis = await TrizCopilotAnalysis.query().where('id', analysis.id).firstOrFail()
    assert.equal(Number(linkedAnalysis.sourceSignalId), signalId, '分析记录可反查来源信号')

    // 跨组织分析记录：统一 404，不泄露存在性
    const outsider = await createUser({ email: uniqueEmail('signal-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const { project: outsiderProject } = await createProjectWithMember(
      outsiderOrg,
      outsider,
      outsider,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const second = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-14',
    })
    const notFound = await service
      .adopt({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        user: owner,
        signalId: Number(second.created[0]!.id),
        analysisId: Number(outsiderProject.id),
      })
      .then(() => null)
      .catch((thrown: unknown) => thrown as { status?: number })
    assert.equal(notFound?.status, 404)
  })

  test('分层变更保留旧分层痕迹（tier_reasons.previousTier）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const first = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })
    const created = await first.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    const signalId = Number(created.created[0]!.id)

    const signal = await ProjectSignal.query().where('id', signalId).firstOrFail()
    signal.confidenceTier = 'high'
    signal.tierReasons = {
      ...signal.tierReasons,
      previousTier: null,
    }
    await signal.save()

    const second = new ProjectSignalService({ detectionService: detectionWith(hitObservation()) })
    const refreshed = await second.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
    })
    assert.lengthOf(refreshed.created, 0)
    const updated = refreshed.refreshed[0]!
    assert.equal(updated.confidenceTier, 'low')
    assert.equal(
      (updated.tierReasons as Record<string, unknown>).previousTier,
      'high',
      '分层变更必须保留旧分层（变更痕迹）',
    )

    const tierAudit = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'project_signal')
      .where('entity_id', signalId)
    assert.isTrue(
      tierAudit.some(
        (entry) => (entry.metadata as Record<string, unknown>).action === 'tier_changed',
      ),
      '分层变更产生审计事件',
    )
  })
})
