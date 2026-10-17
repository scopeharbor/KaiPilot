// OKR 级联与对齐 Audit 测试
// v3-okr-cascade-and-alignment §3.12
//
// 本文件原先 8 个用例是 `assert.isTrue(true)` 占位，只有第 9 个（枚举存在性）是真的。
// 核查发现：这 9 个审计事件**只在 AuditEvent 枚举里声明过，服务与控制器一次都没写过**——
// 占位测试恰好把「审计从未实现」这件事盖住了。
// 现已在 OkrCascadeAlignmentService 接入审计写入，这里按规范
// 「Audit relation write omits sensitive fields」逐条断言：
// 记 actor / 组织 / OKR id / 动作 / 变更字段名 / reason code / hash 引用 / 时间戳，
// 不记 prompt 文本、模型输出、完整备注、Authorization 头、API key、token 与跨组织数据。

import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import OkrCascadePlanItem from '#models/okr_cascade_plan_item'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrPolicy from '#policies/okr_policy'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import OkrCascadeAlignmentService from '#services/okr_cascade_alignment_service'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './auth/_helpers.js'

/** 审计里绝不允许出现的敏感样本（写进夹具，再断言它们没被落库）。 */
const SENSITIVE_SAMPLES = {
  prompt: '你是一个 OKR 助手，请根据以下上下文生成……',
  modelOutput: '模型完整输出正文：建议把目标拆成三个 KR……',
  fullNote: '这是一段很长的拒绝备注正文，里面可能含有业务机密与个人信息',
  authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret-token-value',
  apiKey: 'sk-live-0123456789abcdefghijklmnop',
}

function buildService() {
  const rbac = new RbacService()
  const policy = new OkrPolicy(rbac, new OrganizationPolicy(rbac))
  return new OkrCascadeAlignmentService(policy, new AuditService())
}

async function setupOrgWithObjective(prefix: string) {
  const owner = await createUser({ email: uniqueEmail(prefix) })
  const org = await createOrganization(owner)
  const cycle = await OkrCycle.create({
    organizationId: org.id,
    title: '2026 Q3',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    status: 'active',
  })
  const objective = await OkrObjective.create({
    organizationId: org.id,
    cycleId: cycle.id,
    title: '源目标',
    scope: 'organization',
    status: 'active',
    metricVersion: '1.0.0',
  })
  return { owner, org, cycle, objective, service: buildService() }
}

async function latestAudit(event: string, organizationId: number) {
  return AuditLog.query()
    .where('organization_id', organizationId)
    .orderBy('id', 'desc')
    .then((rows) => rows.find((r) => (r.metadata as Record<string, unknown>)?.event === event))
}

/** 序列化整条审计记录后逐一断言敏感样本缺席。 */
function assertNoSensitive(
  assert: { notInclude: (a: string, b: string, m?: string) => void },
  row: unknown,
) {
  const json = JSON.stringify(row)
  for (const [name, sample] of Object.entries(SENSITIVE_SAMPLES)) {
    assert.notInclude(json, sample, `审计记录不得包含 ${name}`)
  }
}

test.group('OKR Cascade/Alignment Audit Events', (group) => {
  useAuthDatabase(group)

  test('cascade plan create audit omits model prompt text', async ({ assert }) => {
    const { org, objective, owner, service } = await setupOrgWithObjective('cascade-audit-create')

    await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id, title: SENSITIVE_SAMPLES.prompt } as never,
      owner,
    )

    const entry = await latestAudit(AuditEvent.OKR_CASCADE_PLAN_CREATED, org.id)
    assert.exists(entry, '创建级联草案必须写审计')
    const metadata = entry!.metadata as Record<string, unknown>
    // 低敏字段确实在
    assert.equal(metadata.sourceObjectiveId, objective.id)
    assert.isNumber(metadata.planId)
    assert.isString(metadata.revisionHash)
    assert.equal(entry!.userId, Number(owner.id))
    assert.equal(entry!.organizationId, org.id)
    // prompt 文本不得落库
    assertNoSensitive(assert, entry!.toJSON())
  })

  test('cascade plan confirm audit omits AI model output', async ({ assert }) => {
    const { org, objective, owner, service } = await setupOrgWithObjective('cascade-audit-confirm')
    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )
    const planId = created.data.id

    // 造一个**真会落库**的候选项，并把模型输出正文塞进 description：
    // 确认成功后正式 objective 里可以有它（那是用户确认过的业务数据），
    // 但审计 metadata 里绝不能有。空数组确认走的是退化路径，证不了这件事。
    const item = await OkrCascadePlanItem.create({
      planId,
      organizationId: org.id,
      candidateObjective: JSON.stringify({
        title: '子目标候选',
        description: SENSITIVE_SAMPLES.modelOutput,
        scope: 'team',
        keyResults: [],
      }),
      status: 'pending',
      coverageGap: false,
    })

    const result = await service.confirmCascadeItems(
      planId,
      { acceptedItemIds: [item.id], rejectedItemIds: [] } as never,
      owner,
    )
    const confirmedItem = await OkrCascadePlanItem.findOrFail(item.id)
    assert.equal(confirmedItem.status, 'confirmed')
    assert.equal(result.meta.acceptedCount, 1)

    const entry = await latestAudit(AuditEvent.OKR_CASCADE_PLAN_CONFIRMED, org.id)
    assert.exists(entry, '确认级联项必须写审计')
    const metadata = entry!.metadata as Record<string, unknown>
    assert.equal(metadata.planId, planId)
    assert.equal(metadata.acceptedCount, 1)
    assert.isNumber(metadata.rejectedCount)
    // 只记 warning code，不记 message 正文
    assert.isArray(metadata.warningCodes)
    assertNoSensitive(assert, entry!.toJSON())
  })

  test('cascade plan reject audit omits full notes', async ({ assert }) => {
    const { org, objective, owner, service } = await setupOrgWithObjective('cascade-audit-reject')
    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )

    await service.rejectCascadeItems(
      created.data.id,
      { rejectedItemIds: [], reason: SENSITIVE_SAMPLES.fullNote },
      owner,
    )

    const entry = await latestAudit(AuditEvent.OKR_CASCADE_PLAN_REJECTED, org.id)
    assert.exists(entry, '拒绝级联项必须写审计')
    const metadata = entry!.metadata as Record<string, unknown>
    // 只记「有没有给理由」与 hash，不记备注正文
    assert.isTrue(metadata.hasReason)
    assert.isString(metadata.reasonHash)
    assertNoSensitive(assert, entry!.toJSON())
  })

  test('relation write audit omits Authorization headers', async ({ assert }) => {
    const { org, cycle, objective, owner, service } =
      await setupOrgWithObjective('cascade-audit-rel-auth')
    const target = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '目标目标',
      scope: 'team',
      status: 'active',
      metricVersion: '1.0.0',
    })

    await service.createRelation(
      org.id,
      {
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
        reasonCode: SENSITIVE_SAMPLES.authorization,
      } as never,
      owner,
    )

    const entry = await latestAudit(AuditEvent.OKR_RELATION_CREATED, org.id)
    assert.exists(entry, '创建关系必须写审计')
    const metadata = entry!.metadata as Record<string, unknown>
    assert.equal(metadata.sourceObjectiveId, objective.id)
    assert.equal(metadata.targetObjectiveId, target.id)
    assert.equal(metadata.relationType, 'supports')
    // reasonCode 是自由文本，只允许记「有没有给」与稳定 hash，不允许记正文
    assert.isTrue(metadata.hasReasonCode)
    assert.isString(metadata.reasonCodeHash)
    assert.notProperty(metadata, 'reasonCode')
    assertNoSensitive(assert, entry!.toJSON())
  })

  test('relation write audit omits API keys and tokens', async ({ assert }) => {
    const { org, cycle, objective, owner, service } =
      await setupOrgWithObjective('cascade-audit-rel-key')
    const target = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '目标目标',
      scope: 'team',
      status: 'active',
      metricVersion: '1.0.0',
    })
    const created = await service.createRelation(
      org.id,
      {
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
      } as never,
      owner,
    )

    await service.updateRelation(
      created.data.id,
      { impactWeight: 80, reasonCode: SENSITIVE_SAMPLES.apiKey } as never,
      owner,
    )

    const entry = await latestAudit(AuditEvent.OKR_RELATION_UPDATED, org.id)
    assert.exists(entry, '更新关系必须写审计')
    const metadata = entry!.metadata as Record<string, unknown>
    // 只记变更字段名，不记新旧值
    assert.includeMembers(metadata.changedFields as string[], ['impactWeight', 'reasonCode'])
    assert.notProperty(metadata, 'reasonCodeValue')
    assertNoSensitive(assert, entry!.toJSON())
  })

  test('relation archive audit records archival without payload', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupOrgWithObjective(
      'cascade-audit-rel-archive',
    )
    const target = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '目标目标',
      scope: 'team',
      status: 'active',
      metricVersion: '1.0.0',
    })
    const created = await service.createRelation(
      org.id,
      {
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
      } as never,
      owner,
    )

    await service.archiveRelation(created.data.id, owner)

    const entry = await latestAudit(AuditEvent.OKR_RELATION_ARCHIVED, org.id)
    assert.exists(entry, '归档关系必须写审计')
    assert.equal((entry!.metadata as Record<string, unknown>).relationId, created.data.id)
    assertNoSensitive(assert, entry!.toJSON())
  })

  test('audit entries never carry another organization data', async ({ assert }) => {
    const a = await setupOrgWithObjective('cascade-audit-org-a')
    const b = await setupOrgWithObjective('cascade-audit-org-b')

    await a.service.createCascadePlan(
      a.org.id,
      { sourceObjectiveId: a.objective.id } as never,
      a.owner,
    )
    await b.service.createCascadePlan(
      b.org.id,
      { sourceObjectiveId: b.objective.id } as never,
      b.owner,
    )

    const aEntries = await AuditLog.query().where('organization_id', a.org.id)
    assert.isAbove(aEntries.length, 0)
    for (const entry of aEntries) {
      assert.equal(entry.organizationId, a.org.id)
      const json = JSON.stringify(entry.toJSON())
      // 不得夹带 B 组织的目标标识
      assert.notInclude(json, `"sourceObjectiveId":${b.objective.id}`)
    }
  })

  test('all audit events exist in AuditEvent enum', async ({ assert }) => {
    assert.isDefined(AuditEvent.OKR_CASCADE_PLAN_CREATED)
    assert.isDefined(AuditEvent.OKR_CASCADE_PLAN_CONFIRMED)
    assert.isDefined(AuditEvent.OKR_CASCADE_PLAN_REJECTED)
    assert.isDefined(AuditEvent.OKR_RELATION_CREATED)
    assert.isDefined(AuditEvent.OKR_RELATION_UPDATED)
    assert.isDefined(AuditEvent.OKR_RELATION_ARCHIVED)
    assert.isDefined(AuditEvent.OKR_HEALTH_RECOMPUTED)
    assert.isDefined(AuditEvent.OKR_MATRIX_READ)
    assert.isDefined(AuditEvent.OKR_AI_CASCADE_PREVIEW)
  })
})
