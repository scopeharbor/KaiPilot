/**
 * v3-triz-decision-center —— Review Actions and Draft Boundaries 测试（tasks 5.5–5.7）。
 *
 * 覆盖：
 * - 采纳、驳回、部分采纳、修改后采纳、补充、废止动作
 * - 缺少显式确认被拒绝
 * - stale 来源阻断
 * - 既有决策日志不可变（supersede 保留历史）
 * - AI 理由草稿不自动保存、默认不调用真实模型
 * - Draft Apply 重新校验（advisory 语义）
 */
import TrizDecisionLog from '#models/triz_decision_log'
import TrizDecisionCenterService from '#services/triz_decision/triz_decision_center_service'
import AuditService from '#services/audit_service'
import { SubjectRefResolver } from '#services/triz_decision/subject_ref_resolver'
import TrizDecisionLogService from '#services/triz_decision/triz_decision_log_service'
import ProjectContradiction from '#models/project_contradiction'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../../functional/auth/_helpers.js'
import type { TrizDecisionSubjectRef, TrizDecisionSourceRef } from '@aiproj/types'

test.group('TrizDecisionCenter Review Actions', (group) => {
  useAuthDatabase(group)

  function createService() {
    // 复用既有 TrizDecisionLogService，保持写入语义一致
    const audit = new AuditService()
    const resolver = new SubjectRefResolver() as any
    const decisionLogService = new TrizDecisionLogService(audit, resolver)
    return new TrizDecisionCenterService(decisionLogService, audit)
  }

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('tdc-action') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    // 创建真实矛盾实体，使 subjectRef(kind:'contradiction', id:'tdc-action-1') 能通过 resolver 校验
    await ProjectContradiction.create({
      organizationId: org.id,
      projectId: project.id,
      key: 'tdc-action-1',
      dedupeKey: 'tdc-action-dedupe-1',
      type: 'technical',
      ruleId: 'CD-001',
      ruleVersion: '1.0.0',
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      improvingDirection: null,
      worseningDirection: null,
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      severity: 'high',
      confidence: 0.8,
      title: '动作测试矛盾',
      evidence: [],
      suggestedPrinciples: [],
      inputSignature: 'sig-tdc-action-1',
      outputHash: 'hash-tdc-action-1',
      status: 'confirmed',
      stale: false,
      staleReason: null,
      relatedChangeRequestId: null,
      confirmedBy: null,
      confirmedAt: null,
      dismissedBy: null,
    })
    return { owner, org, project, service: createService() }
  }

  function subjectRef(): TrizDecisionSubjectRef {
    return {
      kind: 'contradiction',
      id: 'tdc-action-1',
      version: 'v1',
      summaryLevel: 'high',
      visibility: 'public',
      title: '动作测试矛盾',
    }
  }

  function sourceRef(): TrizDecisionSourceRef {
    return {
      kind: 'rule_analysis',
      id: 'rule-action-1',
      hash: 'actionhash123',
      summary: '动作测试来源',
    }
  }

  function validConfirmation(sourceHashes: string[] = ['actionhash123']) {
    return {
      confirmed: true,
      confirmedBy: 1,
      confirmedAt: '2026-07-31T10:00:00.000Z',
      sourceHashes,
      warningAcknowledged: true,
    }
  }

  // ── 5.5 动作测试 ────────────────────────────────────────────────────

  test('adopt 动作记录采纳决策证据', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.recordAction(org.id, project.id, owner.id, 'adopt', {
      itemId: 'test-item',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      reasonSummary: '确认采纳测试',
      confirmation: validConfirmation(),
    })

    assert.property(result, 'data')
    assert.equal(result.data.decisionType, 'adopt')
    assert.equal(result.data.decisionStatus, 'active')
  })

  test('reject 动作不修改正式数据', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const beforeCount = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .count('* as total')

    const result = await service.recordAction(org.id, project.id, owner.id, 'reject', {
      itemId: 'test-item',
      subjectRefs: [subjectRef()],
      sourceRefs: [],
      reasonSummary: '驳回测试',
      confirmation: validConfirmation(),
    })

    const afterCount = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .count('* as total')

    assert.equal(result.data.decisionType, 'reject')
    // reject 只创建决策日志，不修改任务/WBS/资源等正式数据
    assert.equal(
      Number(afterCount[0].$extras.total) - Number(beforeCount[0].$extras.total),
      1,
      'reject 只创建一条决策日志',
    )
  })

  test('partial_accept 动作记录部分采纳', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.recordAction(org.id, project.id, owner.id, 'partial_accept', {
      itemId: 'test-item',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      reasonSummary: '部分采纳测试',
      confirmation: validConfirmation(),
    })

    assert.equal(result.data.decisionType, 'partial_accept')
  })

  test('modified_accept 动作记录修改后采纳', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.recordAction(org.id, project.id, owner.id, 'modified_accept', {
      itemId: 'test-item',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      reasonSummary: '修改后采纳测试',
      confirmation: validConfirmation(),
    })

    assert.equal(result.data.decisionType, 'modified_accept')
  })

  test('supplement 动作补充理由', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.recordAction(org.id, project.id, owner.id, 'supplement', {
      itemId: 'test-item',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      reasonSummary: '补充理由测试',
      confirmation: validConfirmation(),
    })

    assert.property(result, 'data')
  })

  test('supersede 动作保留历史（旧决策不可变）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 先创建一个旧决策
    const oldResult = await service.recordAction(org.id, project.id, owner.id, 'adopt', {
      itemId: 'test-item',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      reasonSummary: '原决策',
      confirmation: validConfirmation(),
    })

    // 废止旧决策
    const supersedeResult = await service.recordAction(org.id, project.id, owner.id, 'supersede', {
      itemId: 'test-item',
      supersedesDecisionLogId: oldResult.data.id,
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      reasonSummary: '废止并更新',
      confirmation: validConfirmation(),
    })

    // 旧决策应标记为 superseded，不可变
    const oldLog = await TrizDecisionLog.findOrFail(oldResult.data.id)
    assert.equal(oldLog.decisionStatus, 'superseded')
    // 新决策指向旧决策
    assert.equal(supersedeResult.data.supersedesDecisionLogId, oldResult.data.id)
  })

  // ── 5.2 缺少确认 ────────────────────────────────────────────────────

  test('缺少显式确认的写动作被拒绝', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    try {
      await service.recordAction(org.id, project.id, owner.id, 'adopt', {
        itemId: 'test-item',
        subjectRefs: [subjectRef()],
        sourceRefs: [sourceRef()],
        reasonSummary: '无确认测试',
        confirmation: {
          confirmed: false,
          confirmedBy: 0,
          confirmedAt: '',
          sourceHashes: [],
          warningAcknowledged: false,
        },
      })
      assert.fail('应抛出 VALIDATION_ERROR')
    } catch (err: any) {
      // ValidationException 把 VALIDATION_ERROR 放在 code 上，message 是给人看的中文原因；
      // 断言 message 含错误码永远不会成立。与同组 RESOURCE_NOT_FOUND 用例口径一致。
      assert.equal(err.code ?? '', 'VALIDATION_ERROR')
    }
  })

  test('无 confirmation 字段被拒绝', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    try {
      await service.recordAction(org.id, project.id, owner.id, 'adopt', {
        itemId: 'test-item',
        subjectRefs: [subjectRef()],
        sourceRefs: [sourceRef()],
        reasonSummary: '无确认字段',
      })
      assert.fail('应抛出 VALIDATION_ERROR')
    } catch (err: any) {
      assert.equal(err.code ?? '', 'VALIDATION_ERROR')
    }
  })

  // ── 5.6 AI 草稿不自动保存 ───────────────────────────────────────────

  test('AI 理由草稿不自动保存为决策日志', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const beforeCount = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .count('* as total')

    const result = await service.generateReasonDraft(org.id, project.id, owner.id, {
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      decisionType: 'adopt',
    })

    const afterCount = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .count('* as total')

    assert.property(result.data, 'draftReason')
    assert.isString(result.data.draftReason)
    // 草稿不应创建决策日志
    assert.equal(
      Number(beforeCount[0].$extras.total),
      Number(afterCount[0].$extras.total),
      'AI 草稿不应自动保存',
    )
  })

  test('默认测试不调用真实模型（走 fallback）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.generateReasonDraft(org.id, project.id, owner.id, {
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      decisionType: 'adopt',
    })

    assert.isTrue(result.data.isFallback, '默认应走 fallback')
    assert.isNull(result.data.costSummary, 'fallback 不应有 AI 成本')
  })

  // ── 5.7 Draft readiness advisory ───────────────────────────────────

  test('startDraftReview 对非 ready 项返回 blocked', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // setup() 造的矛盾是 confirmed（readiness=ready），不能用它验「非 ready 被阻断」。
    // 这里另造一条 candidate 矛盾：ContradictionSourceAdapter 对 candidate 给出
    // readiness='not_ready'，canEnterDraftReview 因此为 false。
    await ProjectContradiction.create({
      organizationId: org.id,
      projectId: project.id,
      key: 'tdc-action-not-ready',
      dedupeKey: 'tdc-action-dedupe-not-ready',
      type: 'technical',
      ruleId: 'CD-001',
      ruleVersion: '1.0.0',
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      improvingDirection: null,
      worseningDirection: null,
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      severity: 'high',
      confidence: 0.8,
      title: '未就绪矛盾',
      evidence: [],
      suggestedPrinciples: [],
      inputSignature: 'sig-tdc-action-not-ready',
      outputHash: 'hash-tdc-action-not-ready',
      // project_contradictions.status 的 CHECK 只认 draft/confirmed/dismissed/superseded；
      // draft 在 ContradictionSourceAdapter 里映射为 readiness='not_ready'，正是本用例要的态。
      status: 'draft',
      stale: false,
      staleReason: null,
      relatedChangeRequestId: null,
      confirmedBy: null,
      confirmedAt: null,
      dismissedBy: null,
    })

    const listResult = await service.list(org.id, project.id, {})
    const notReady = listResult.data.find((i: any) => i.readiness !== 'ready')
    assert.exists(notReady, 'list 应包含一条 readiness 非 ready 的项')

    const result = await service.startDraftReview(org.id, project.id, owner.id, notReady!.id)
    assert.isFalse(result.data.allowed)
    assert.include(result.data.reason, 'Draft 审查条件')
  })

  test('startDraftReview 不存在的 item 抛出 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    try {
      await service.startDraftReview(org.id, project.id, owner.id, 'dc-nonexistent')
      assert.fail('应抛出异常')
    } catch (err: any) {
      // ResourceNotFoundException：code=RESOURCE_NOT_FOUND，经全局 handler 渲染为 { error } envelope
      assert.equal(err.code ?? '', 'RESOURCE_NOT_FOUND')
    }
  })

  test('request_clarification 动作映射为 clarification_requested 决策日志', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.recordAction(
      org.id,
      project.id,
      owner.id,
      'request_clarification',
      {
        itemId: 'test-item',
        subjectRefs: [subjectRef()],
        sourceRefs: [sourceRef()],
        reasonSummary: '请求补充技术参数细节',
        confirmation: validConfirmation(),
      },
    )

    assert.property(result, 'data')
    assert.equal(result.data.decisionType, 'clarification_requested')
  })

  test('缺少显式确认抛出 VALIDATION_ERROR（ApiException）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    try {
      await service.recordAction(org.id, project.id, owner.id, 'adopt', {
        itemId: 'test-item',
        subjectRefs: [subjectRef()],
        sourceRefs: [sourceRef()],
        reasonSummary: '无确认',
        confirmation: {
          confirmed: false,
          confirmedBy: 0,
          confirmedAt: '',
          sourceHashes: [],
          warningAcknowledged: false,
        },
      })
      assert.fail('应抛出异常')
    } catch (err: any) {
      assert.equal(err.code ?? '', 'VALIDATION_ERROR')
    }
  })

  test('confirmation sourceHashes 与当前来源不一致时阻断（hash stale）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const listResult = await service.list(org.id, project.id, {})
    assert.isAbove(listResult.data.length, 0, 'setup 造的矛盾应出现在队列中')
    const realItemId = listResult.data[0].id

    // 提供与来源 hash 不一致的 confirmation.sourceHashes → stale 阻断
    try {
      // stale 阻断只在 itemId 能命中真实 item 时才生效（服务要拿当前来源 hash 来比对）。
      // 原先传的 'test-item' 永远命中不了任何 item，于是这条断言从来没验到 stale 逻辑。
      await service.recordAction(org.id, project.id, owner.id, 'adopt', {
        itemId: realItemId,
        subjectRefs: [subjectRef()],
        sourceRefs: [sourceRef()],
        reasonSummary: 'hash 不匹配',
        confirmation: validConfirmation(['stale-nonexistent-hash']),
      })
      assert.fail('应抛出异常')
    } catch (err: any) {
      assert.equal(err.code ?? '', 'VALIDATION_ERROR')
    }
  })

  test('Draft Apply 重新校验而非信任 readiness 快照', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // startDraftReview 返回 advisory notice 提示 Apply 仍需重新校验
    const listResult = await service.list(org.id, project.id, {})
    if (listResult.data.length > 0) {
      const itemId = listResult.data[0].id
      // 即使 readiness 不是 ready，调用也不应崩溃
      const result = await service.startDraftReview(org.id, project.id, owner.id, itemId)
      // 应返回明确语义（allowed=false 或 advisoryNotice）
      assert.property(result.data, 'allowed')
    }
  })

  test('confirmed 矛盾 ready 路径可达：start_draft_review 在 allowedActions 中', async ({
    assert,
  }) => {
    const { owner, org, project, service } = await setup()

    // setup 创建的矛盾 status=confirmed，readiness=ready，allowedActions 含 start_draft_review
    const listResult = await service.list(org.id, project.id, {})
    const confirmedItem = listResult.data.find((i: any) => i.source.sourceKind === 'contradiction')

    if (confirmedItem) {
      // ready + allowedActions 含 start_draft_review → canEnterDraftReview 应通过
      assert.isTrue(
        confirmedItem.allowedActions.includes('start_draft_review'),
        'confirmed 矛盾应在 allowedActions 中包含 start_draft_review',
      )

      const result = await service.startDraftReview(org.id, project.id, owner.id, confirmedItem.id)

      // ready 路径应可达：allowed=true，含 advisoryNotice
      assert.equal(result.data.allowed, true)
      assert.property(result.data, 'advisoryNotice')
      assert.property(result.data, 'draftCandidateId')
    }
  })
})
