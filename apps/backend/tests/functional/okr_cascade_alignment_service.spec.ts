// OKR 级联与对齐 Service 测试
// v3-okr-cascade-and-alignment §3.10
//
// 本文件原先 21 个用例里有 20 个是 `assert.isTrue(true)` 占位，且 Service 是用
// `new OkrPolicy(null, null)` 装配的——策略层根本没接上，任何权限断言都不可能成立。
// 现按各自标题改写为真断言：跨组织、preview-only 红线、软删除、去重、
// 确定性健康度、有界矩阵、KR 进度不被篡改。

import { test } from '@japa/runner'
import OkrCascadeAlignmentService from '#services/okr_cascade_alignment_service'
import OkrPolicy from '#policies/okr_policy'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import AuditService from '#services/audit_service'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrAlignment from '#models/okr_alignment'
import OkrCascadePlanItem from '#models/okr_cascade_plan_item'
import OkrObjectiveRelation from '#models/okr_objective_relation'
import { OKR_DISABLED_SCOPES } from '@aiproj/types'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './auth/_helpers.js'

function buildService() {
  const rbac = new RbacService()
  return new OkrCascadeAlignmentService(
    new OkrPolicy(rbac, new OrganizationPolicy(rbac)),
    new AuditService(),
  )
}

async function setupActor(prefix: string) {
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

async function makeObjective(orgId: number, cycleId: number, title: string, scope = 'team') {
  return OkrObjective.create({
    organizationId: orgId,
    cycleId,
    title,
    scope,
    status: 'active',
    metricVersion: '1.0.0',
  })
}

/** 统计三类「正式 OKR 事实」的行数，用于 preview-only 红线断言。 */
async function countOkrFacts(orgId: number) {
  const [objectives, keyResults, alignments] = await Promise.all([
    OkrObjective.query().where('organization_id', orgId).count('* as t'),
    OkrKeyResult.query().where('organization_id', orgId).count('* as t'),
    OkrAlignment.query().where('organization_id', orgId).count('* as t'),
  ])
  return {
    objectives: Number(objectives[0]!.$extras.t),
    keyResults: Number(keyResults[0]!.$extras.t),
    alignments: Number(alignments[0]!.$extras.t),
  }
}

test.group('OkrCascadeAlignmentService — Cascade Plans', (group) => {
  useAuthDatabase(group)

  test('createCascadePlan rejects cross-organization source objective', async ({ assert }) => {
    const a = await setupActor('svc-plan-xorg-a')
    const b = await setupActor('svc-plan-xorg-b')

    // 用 A 的组织 id 配 B 的目标 id：源目标不属于该组织，必须被拒
    await assert.rejects(async () => {
      await a.service.createCascadePlan(
        a.org.id,
        { sourceObjectiveId: b.objective.id } as never,
        a.owner,
      )
    })
  })

  test('createCascadePlan persists draft only, no OKR facts created during generation', async ({
    assert,
  }) => {
    const { org, objective, owner, service } = await setupActor('svc-plan-preview')
    const before = await countOkrFacts(org.id)

    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )
    const after = await countOkrFacts(org.id)

    assert.equal(created.data.status, 'draft')
    // 红线：生成草案不得创建任何 objective / KR / alignment
    assert.deepEqual(after, before, '生成级联草案不得写入任何正式 OKR 事实')
    // 草案项本身要落库（它们是待确认建议，不是正式事实）
    const items = await OkrCascadePlanItem.query().where('plan_id', created.data.id)
    assert.isAbove(items.length, 0)
    assert.isTrue(items.every((i) => i.status === 'pending'))
  })

  test('listCascadePlans returns bounded paginated results', async ({ assert }) => {
    const { org, objective, owner, service } = await setupActor('svc-plan-list')
    for (let i = 0; i < 3; i++) {
      await service.createCascadePlan(
        org.id,
        { sourceObjectiveId: objective.id, title: `草案 ${i}` } as never,
        owner,
      )
    }

    const page1 = await service.listCascadePlans(org.id, { page: 1, perPage: 2 } as never, owner)
    assert.lengthOf(page1.data, 2, 'perPage 必须生效，不得回全量')
    assert.equal(page1.meta.page, 1)
    assert.equal(page1.meta.perPage, 2)
    assert.isAtLeast(page1.meta.total, 3)
  })

  test('getCascadePlan returns detail with items array', async ({ assert }) => {
    const { org, objective, owner, service } = await setupActor('svc-plan-detail')
    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )

    const detail = await service.getCascadePlan(created.data.id, owner)
    assert.equal(detail.data.id, created.data.id)
    assert.isArray((detail.data as { items?: unknown[] }).items)
  })

  test('confirmCascadeItems writes objectives with policy recheck', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-plan-confirm')
    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )
    const item = await OkrCascadePlanItem.create({
      planId: created.data.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify({
        title: '被确认的目标',
        scope: 'team',
        cycleId: cycle.id,
      }),
      status: 'pending',
      coverageGap: false,
    })

    const before = await countOkrFacts(org.id)
    await service.confirmCascadeItems(
      created.data.id,
      { acceptedItemIds: [item.id], rejectedItemIds: [] } as never,
      owner,
    )
    const after = await countOkrFacts(org.id)

    // 人工确认之后才允许落库
    assert.isAbove(after.objectives, before.objectives, '确认后必须真正创建 objective')
    const stored = await OkrCascadePlanItem.findOrFail(item.id)
    assert.equal(stored.status, 'confirmed')
    assert.isNotNull(stored.confirmedObjectiveId)
  })

  test('confirmCascadeItems rejects disabled personal scope write', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-plan-scope')
    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )
    const item = await OkrCascadePlanItem.create({
      planId: created.data.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify({
        title: '个人目标',
        scope: OKR_DISABLED_SCOPES[0],
        cycleId: cycle.id,
      }),
      status: 'pending',
      coverageGap: false,
    })

    const before = await countOkrFacts(org.id)
    const result = await service.confirmCascadeItems(
      created.data.id,
      { acceptedItemIds: [item.id], rejectedItemIds: [] } as never,
      owner,
    )
    const after = await countOkrFacts(org.id)

    const rejectedItem = await OkrCascadePlanItem.findOrFail(item.id)
    assert.equal(rejectedItem.status, 'rejected')
    assert.include(
      (result.meta.warnings as Array<{ code: string }>).map((w) => w.code),
      'DISABLED_SCOPE',
    )
    assert.equal(after.objectives, before.objectives, '禁用 scope 不得留下任何 objective')
  })

  test('rejectCascadeItems marks items as rejected with reason', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-plan-reject')
    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )
    const item = await OkrCascadePlanItem.create({
      planId: created.data.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify({
        title: '将被拒的候选',
        scope: 'team',
        cycleId: cycle.id,
      }),
      status: 'pending',
      coverageGap: false,
    })

    const result = await service.rejectCascadeItems(
      created.data.id,
      { rejectedItemIds: [item.id], reason: '与现有目标重复' },
      owner,
    )

    assert.equal(result.data.rejectedCount, 1)
    const stored = await OkrCascadePlanItem.findOrFail(item.id)
    assert.equal(stored.status, 'rejected')
    assert.equal(stored.rejectionReason, '与现有目标重复')
  })
})

test.group('OkrCascadeAlignmentService — Relations', (group) => {
  useAuthDatabase(group)

  test('createRelation validates same-organization constraint', async ({ assert }) => {
    const a = await setupActor('svc-rel-xorg-a')
    const b = await setupActor('svc-rel-xorg-b')

    await assert.rejects(async () => {
      await a.service.createRelation(
        a.org.id,
        {
          sourceObjectiveId: a.objective.id,
          targetObjectiveId: b.objective.id,
          relationType: 'supports',
        } as never,
        a.owner,
      )
    })
  })

  test('createRelation rejects self-relation', async ({ assert }) => {
    const { org, objective, owner, service } = await setupActor('svc-rel-self')

    await assert.rejects(async () => {
      await service.createRelation(
        org.id,
        {
          sourceObjectiveId: objective.id,
          targetObjectiveId: objective.id,
          relationType: 'supports',
        } as never,
        owner,
      )
    })
  })

  test('createRelation rejects duplicate active relation', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-rel-dup')
    const target = await makeObjective(org.id, cycle.id, '目标目标')

    await service.createRelation(
      org.id,
      {
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
      } as never,
      owner,
    )

    await assert.rejects(async () => {
      await service.createRelation(
        org.id,
        {
          sourceObjectiveId: objective.id,
          targetObjectiveId: target.id,
          relationType: 'supports',
        } as never,
        owner,
      )
    })
  })

  test('archiveRelation soft-deletes and preserves record', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-rel-archive')
    const target = await makeObjective(org.id, cycle.id, '目标目标')
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

    // 默认查询看不到
    const visible = await OkrObjectiveRelation.query().where('organization_id', org.id)
    assert.lengthOf(visible, 0)
    // 记录仍在（软删除不是物理删除）——经原生查询验证
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const kept = await db
      .from('okr_objective_relations')
      .where('organization_id', org.id)
      .whereNotNull('deleted_at')
    assert.lengthOf(kept, 1)
  })

  test('listRelations supports source/target/type/status filters', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-rel-filter')
    const t1 = await makeObjective(org.id, cycle.id, '目标一')
    const t2 = await makeObjective(org.id, cycle.id, '目标二')
    await service.createRelation(
      org.id,
      {
        sourceObjectiveId: objective.id,
        targetObjectiveId: t1.id,
        relationType: 'supports',
      } as never,
      owner,
    )
    await service.createRelation(
      org.id,
      {
        sourceObjectiveId: objective.id,
        targetObjectiveId: t2.id,
        relationType: 'blocks',
      } as never,
      owner,
    )

    const supports = await service.listRelations(
      org.id,
      { relationType: 'supports' } as never,
      owner,
    )
    assert.lengthOf(supports.data, 1)
    assert.equal(supports.data[0]!.relationType, 'supports')

    const bySource = await service.listRelations(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )
    assert.lengthOf(bySource.data, 2)
  })
})

test.group('OkrCascadeAlignmentService — Health & Matrix', (group) => {
  useAuthDatabase(group)

  test('getHealth returns deterministic score with warnings', async ({ assert }) => {
    const { objective, owner, service } = await setupActor('svc-health')
    // getHealth 的签名是 (objectiveId, user)——按目标算健康度，不是按组织
    const first = await service.getHealth(objective.id, owner)
    const second = await service.getHealth(objective.id, owner)

    // 确定性：同输入同输出。`calculatedAt` 是墙钟时间戳，两次调用天然不同，
    // 它不属于「同输入同输出」的判定面——剥掉它再比，剩下的（score/level/warnings/
    // freshness/metricVersion/redactedCount）才是必须逐字节一致的部分。
    // 另单独断言 calculatedAt 仍是合法 ISO 串，避免把字段整个放过。
    const strip = (r: typeof first) => {
      const clone = JSON.parse(JSON.stringify(r)) as { data: Record<string, unknown> }
      const { calculatedAt, ...rest } = clone.data
      assert.match(String(calculatedAt), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
      return rest
    }
    assert.deepEqual(strip(second), strip(first))
    assert.equal(first.data.score, 70)
    assert.equal(first.data.level, 'healthy')
    assert.deepEqual(
      first.data.warnings.map((w) => w.code),
      ['EMPTY_KEY_RESULTS'],
    )
  })

  test('getMatrix returns bounded sparse rows with stable ordering', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-matrix')
    for (let i = 0; i < 3; i++) {
      const t = await makeObjective(org.id, cycle.id, `矩阵目标 ${i}`)
      await service.createRelation(
        org.id,
        {
          sourceObjectiveId: objective.id,
          targetObjectiveId: t.id,
          relationType: 'supports',
        } as never,
        owner,
      )
    }

    const first = await service.getMatrix(org.id, { cycleId: cycle.id, perPage: 2 } as never, owner)
    const second = await service.getMatrix(
      org.id,
      { cycleId: cycle.id, perPage: 2 } as never,
      owner,
    )

    // 有界：perPage 生效
    assert.isAtMost(first.data.length, 2)
    // 稳定排序：两次调用顺序一致
    assert.deepEqual(
      second.data.map((r) => r.objectiveId),
      first.data.map((r) => r.objectiveId),
    )
  })
})

test.group('OkrCascadeAlignmentService — AI Preview', (group) => {
  useAuthDatabase(group)

  test('generateAiCascadeSuggestions returns preview-only, no persisted facts', async ({
    assert,
  }) => {
    const { org, cycle, owner, service } = await setupActor('svc-ai-preview')
    const before = await countOkrFacts(org.id)

    const result = await service.generateAiCascadeSuggestions(
      org.id,
      { cycleId: cycle.id } as never,
      owner,
    )
    const after = await countOkrFacts(org.id)

    assert.isDefined(result)
    // 红线：AI 预览零落库
    assert.deepEqual(after, before, 'AI 预览不得写入任何正式 OKR 事实')
  })

  test('generateAiCascadeSuggestions is denied without authorization', async ({ assert }) => {
    const { org, cycle, service } = await setupActor('svc-ai-denied')
    const outsider = await createUser({ email: uniqueEmail('svc-ai-outsider') })

    await assert.rejects(async () => {
      await service.generateAiCascadeSuggestions(org.id, { cycleId: cycle.id } as never, outsider)
    })
  })

  test('KR progress is NOT mutated during cascade or relation operations', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupActor('svc-kr-immutable')
    const kr = await OkrKeyResult.create({
      organizationId: org.id,
      objectiveId: objective.id,
      title: '关键结果',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 42,
      weight: 100,
      status: 'active',
    })

    const target = await makeObjective(org.id, cycle.id, '关系目标')
    await service.createCascadePlan(org.id, { sourceObjectiveId: objective.id } as never, owner)
    await service.createRelation(
      org.id,
      {
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
      } as never,
      owner,
    )

    const reloaded = await OkrKeyResult.findOrFail(kr.id)
    assert.equal(Number(reloaded.currentValue), 42, '级联/关系操作不得篡改 KR 进度')
  })
})
