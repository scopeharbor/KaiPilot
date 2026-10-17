// OKR 级联与对齐 Model 测试
// v3-okr-cascade-and-alignment §2.4
//
// 本文件原先 11 个用例全是 `assert.isTrue(true)` 占位，标题却写着
// 「organization filtering excludes other org plans」「soft-delete excludes deleted plans」
// 这类组织隔离与软删除断言——不会红，只会让人以为验过了。
// 这里按各自标题改写为真断言。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrCascadePlan from '#models/okr_cascade_plan'
import OkrCascadePlanItem from '#models/okr_cascade_plan_item'
import OkrObjectiveRelation from '#models/okr_objective_relation'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './auth/_helpers.js'

/** 建一个「组织 + 周期 + 目标」的最小可用主体。 */
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
  return { owner, org, cycle, objective }
}

async function createPlan(
  org: { id: number },
  cycle: { id: number },
  objective: { id: number },
  overrides: Partial<{ title: string; status: string; revisionHash: string }> = {},
) {
  return OkrCascadePlan.create({
    organizationId: org.id,
    sourceObjectiveId: objective.id,
    cycleId: cycle.id,
    title: overrides.title ?? '级联草案',
    status: overrides.status ?? 'draft',
    coverage: 'partial',
    metricVersion: '1.0.0',
    revisionHash: overrides.revisionHash ?? 'rev-hash-001',
  })
}

test.group('OkrCascadePlan Model', (group) => {
  useAuthDatabase(group)

  test('organization filtering excludes other org plans', async ({ assert }) => {
    const a = await setupOrgWithObjective('cascade-org-a')
    const b = await setupOrgWithObjective('cascade-org-b')
    await createPlan(a.org, a.cycle, a.objective, { title: 'A 组织草案' })
    await createPlan(b.org, b.cycle, b.objective, { title: 'B 组织草案' })

    const aPlans = await OkrCascadePlan.query().where('organization_id', a.org.id)
    assert.lengthOf(aPlans, 1)
    assert.equal(aPlans[0]!.title, 'A 组织草案')
    // 组织隔离：按 A 过滤绝不带出 B 的行
    assert.notInclude(
      aPlans.map((p) => p.organizationId),
      b.org.id,
    )
  })

  test('soft-delete excludes deleted plans from queries', async ({ assert }) => {
    const { org, cycle, objective } = await setupOrgWithObjective('cascade-soft')
    const kept = await createPlan(org, cycle, objective, { title: '保留草案' })
    const removed = await createPlan(org, cycle, objective, { title: '已删草案' })

    const { DateTime } = await import('luxon')
    removed.deletedAt = DateTime.now()
    await removed.save()

    const visible = await OkrCascadePlan.query().where('organization_id', org.id)
    assert.lengthOf(visible, 1)
    assert.equal(visible[0]!.id, kept.id)
  })

  test('status filtering works correctly', async ({ assert }) => {
    const { org, cycle, objective } = await setupOrgWithObjective('cascade-status')
    await createPlan(org, cycle, objective, { status: 'draft', revisionHash: 'rev-draft' })
    await createPlan(org, cycle, objective, { status: 'confirmed', revisionHash: 'rev-confirmed' })
    await createPlan(org, cycle, objective, { status: 'rejected', revisionHash: 'rev-rejected' })

    const confirmed = await OkrCascadePlan.query()
      .where('organization_id', org.id)
      .where('status', 'confirmed')
    assert.lengthOf(confirmed, 1)
    assert.equal(confirmed[0]!.status, 'confirmed')

    const all = await OkrCascadePlan.query().where('organization_id', org.id)
    assert.lengthOf(all, 3)
  })
})

test.group('OkrCascadePlanItem Model', (group) => {
  useAuthDatabase(group)

  test('plan items belong to correct plan', async ({ assert }) => {
    const { org, cycle, objective } = await setupOrgWithObjective('cascade-item-plan')
    const planA = await createPlan(org, cycle, objective, { revisionHash: 'rev-a' })
    const planB = await createPlan(org, cycle, objective, { revisionHash: 'rev-b' })

    await OkrCascadePlanItem.create({
      planId: planA.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify({ title: 'A 的候选目标' }),
      status: 'pending',
      coverageGap: false,
    })
    await OkrCascadePlanItem.create({
      planId: planB.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify({ title: 'B 的候选目标' }),
      status: 'pending',
      coverageGap: false,
    })

    const loaded = await OkrCascadePlan.query().where('id', planA.id).preload('items').firstOrFail()
    assert.lengthOf(loaded.items, 1)
    assert.equal(loaded.items[0]!.planId, planA.id)
  })

  test('confirmed items have confirmedObjectiveId set', async ({ assert }) => {
    const { org, cycle, objective } = await setupOrgWithObjective('cascade-item-confirm')
    const plan = await createPlan(org, cycle, objective)
    const confirmedObjective = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '已确认落库的目标',
      scope: 'team',
      status: 'active',
      metricVersion: '1.0.0',
    })

    const pending = await OkrCascadePlanItem.create({
      planId: plan.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify({ title: '待确认' }),
      status: 'pending',
      coverageGap: false,
    })
    // 未确认时不得有确认目标引用（AI 只建议、人工确认才落库）
    const storedPending = await OkrCascadePlanItem.findOrFail(pending.id)
    assert.isNull(storedPending.confirmedObjectiveId)

    pending.status = 'confirmed'
    pending.confirmedObjectiveId = confirmedObjective.id
    await pending.save()

    const storedConfirmed = await OkrCascadePlanItem.findOrFail(pending.id)
    assert.equal(storedConfirmed.status, 'confirmed')
    assert.equal(storedConfirmed.confirmedObjectiveId, confirmedObjective.id)
  })

  test('candidateObjective JSON round-trip', async ({ assert }) => {
    const { org, cycle, objective } = await setupOrgWithObjective('cascade-item-json')
    const plan = await createPlan(org, cycle, objective)
    const candidate = {
      title: '候选目标',
      keyResults: [{ title: 'KR1', targetValue: 100 }],
      assumptions: ['假设一', '假设二'],
    }

    const item = await OkrCascadePlanItem.create({
      planId: plan.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify(candidate),
      status: 'pending',
      coverageGap: true,
    })

    const stored = await OkrCascadePlanItem.findOrFail(item.id)
    assert.deepEqual(JSON.parse(stored.candidateObjective), candidate)
    assert.isTrue(Boolean(stored.coverageGap))
  })
})

test.group('OkrObjectiveRelation Model', (group) => {
  useAuthDatabase(group)

  async function twoObjectives(prefix: string) {
    const base = await setupOrgWithObjective(prefix)
    const target = await OkrObjective.create({
      organizationId: base.org.id,
      cycleId: base.cycle.id,
      title: '目标目标',
      scope: 'team',
      status: 'active',
      metricVersion: '1.0.0',
    })
    return { ...base, target }
  }

  test('relation dedupe prevents duplicate active pairs', async ({ assert }) => {
    const { org, objective, target } = await twoObjectives('relation-dedupe')
    await OkrObjectiveRelation.create({
      organizationId: org.id,
      sourceObjectiveId: objective.id,
      targetObjectiveId: target.id,
      relationType: 'supports',
      status: 'active',
      impactWeight: 50,
    })

    // (source, target, relation_type) 上有 UNIQUE 约束，重复对必须被拒
    await assert.rejects(async () => {
      await OkrObjectiveRelation.create({
        organizationId: org.id,
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
        status: 'active',
        impactWeight: 80,
      })
    })
  })

  test('soft-delete with archived status preserves record', async ({ assert }) => {
    const { org, objective, target } = await twoObjectives('relation-archive')
    const relation = await OkrObjectiveRelation.create({
      organizationId: org.id,
      sourceObjectiveId: objective.id,
      targetObjectiveId: target.id,
      relationType: 'supports',
      status: 'active',
      impactWeight: 50,
    })

    const { DateTime } = await import('luxon')
    relation.status = 'archived'
    relation.deletedAt = DateTime.now()
    await relation.save()

    // 默认查询看不到
    const visible = await OkrObjectiveRelation.query().where('organization_id', org.id)
    assert.lengthOf(visible, 0)

    // 但记录仍在库里（软删除保留证据，不是物理删除）。
    // 这里必须走原生查询：OkrObjectiveRelation 的 @beforeFetch 无条件补 whereNull('deleted_at')，
    // 且该模型没有 OkrObjective 那样的 queryOnlyTrashed() 逃生口，经模型查不到已软删的行。
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const kept = await db
      .from('okr_objective_relations')
      .where('organization_id', org.id)
      .whereNotNull('deleted_at')
    assert.lengthOf(kept, 1)
    assert.equal(Number(kept[0]!.id), relation.id)
    assert.equal(kept[0]!.status, 'archived')
  })

  test('organization filtering scopes relations', async ({ assert }) => {
    const a = await twoObjectives('relation-org-a')
    const b = await twoObjectives('relation-org-b')
    await OkrObjectiveRelation.create({
      organizationId: a.org.id,
      sourceObjectiveId: a.objective.id,
      targetObjectiveId: a.target.id,
      relationType: 'supports',
      status: 'active',
      impactWeight: 50,
    })
    await OkrObjectiveRelation.create({
      organizationId: b.org.id,
      sourceObjectiveId: b.objective.id,
      targetObjectiveId: b.target.id,
      relationType: 'supports',
      status: 'active',
      impactWeight: 50,
    })

    const aRelations = await OkrObjectiveRelation.query().where('organization_id', a.org.id)
    assert.lengthOf(aRelations, 1)
    assert.equal(aRelations[0]!.organizationId, a.org.id)
  })

  test('source and target references point to existing objectives', async ({ assert }) => {
    const { org, objective, target } = await twoObjectives('relation-fk')
    const relation = await OkrObjectiveRelation.create({
      organizationId: org.id,
      sourceObjectiveId: objective.id,
      targetObjectiveId: target.id,
      relationType: 'supports',
      status: 'active',
      impactWeight: 50,
    })

    const loaded = await OkrObjectiveRelation.query()
      .where('id', relation.id)
      .preload('sourceObjective')
      .preload('targetObjective')
      .firstOrFail()
    assert.equal(loaded.sourceObjective.id, objective.id)
    assert.equal(loaded.targetObjective.id, target.id)

    // 指向不存在的目标必须被外键拒绝
    await assert.rejects(async () => {
      await OkrObjectiveRelation.create({
        organizationId: org.id,
        sourceObjectiveId: objective.id,
        targetObjectiveId: 999999,
        relationType: 'blocks',
        status: 'active',
        impactWeight: 10,
      })
    })
  })

  test('rollback-safe migration: down drops all tables', async ({ assert }) => {
    // 静态守卫：三个建表迁移各自的 down() 必须真的 dropTable，
    // 否则回滚后表残留、下一次 migration:run 会撞 already exists。
    const migrationsDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../database/migrations',
    )
    const files = [
      '1826000000006_create_okr_cascade_plans_table.ts',
      '1826000000007_create_okr_cascade_plan_items_table.ts',
      '1826000000008_create_okr_objective_relations_table.ts',
    ]
    for (const file of files) {
      const src = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      assert.include(src, 'async down()', `${file} 必须定义 down()`)
      assert.include(src, 'dropTable', `${file} 的 down() 必须 dropTable`)
    }
  })
})
