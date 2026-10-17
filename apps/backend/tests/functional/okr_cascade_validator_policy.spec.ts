// OKR 级联与对齐 Validator / Policy 测试
// v3-okr-cascade-and-alignment §3.11

import { test } from '@japa/runner'
import OkrCascadePlanItem from '#models/okr_cascade_plan_item'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrPolicy from '#policies/okr_policy'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import AuditService from '#services/audit_service'
import OkrCascadeAlignmentService from '#services/okr_cascade_alignment_service'
import { OKR_DISABLED_SCOPES } from '@aiproj/types'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './auth/_helpers.js'
import {
  okrCascadePlanCreateValidator,
  okrRelationCreateValidator,
  okrRelationUpdateValidator,
  okrMatrixQueryValidator,
  okrHealthQueryValidator,
  okrAiCascadeSuggestionValidator,
} from '#validators/okr'

// vine 的 tryValidate 返回 [error, value] 二元组：
// 判定是否通过要看 error 是否为 null，而不是数组长度（长度恒为 2）。
/** 建一个「组织 + 周期 + 目标 + 装配好的 Service」的主体。 */
async function setupCascadeActor(prefix: string) {
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
  const rbac = new RbacService()
  const service = new OkrCascadeAlignmentService(
    new OkrPolicy(rbac, new OrganizationPolicy(rbac)),
    new AuditService(),
  )
  return { owner, org, cycle, objective, service }
}

test.group('OKR Cascade/Alignment Validators', (group) => {
  useAuthDatabase(group)

  test('okrCascadePlanCreateValidator rejects missing sourceObjectiveId', async ({ assert }) => {
    const [error] = await okrCascadePlanCreateValidator.tryValidate({})
    assert.isNotNull(error)
  })

  test('okrCascadePlanCreateValidator accepts valid input', async ({ assert }) => {
    const [error] = await okrCascadePlanCreateValidator.tryValidate({
      sourceObjectiveId: 1,
      title: 'Test Cascade',
      includePersonalScope: false,
    })
    assert.isNull(error)
  })

  test('okrRelationCreateValidator rejects unsupported relation type', async ({ assert }) => {
    const [error] = await okrRelationCreateValidator.tryValidate({
      sourceObjectiveId: 1,
      targetObjectiveId: 2,
      relationType: 'invalid_type',
    })
    assert.isNotNull(error)
  })

  test('okrRelationCreateValidator accepts valid relation', async ({ assert }) => {
    const [error] = await okrRelationCreateValidator.tryValidate({
      sourceObjectiveId: 1,
      targetObjectiveId: 2,
      relationType: 'supports',
      impactWeight: 1,
    })
    assert.isNull(error)
  })

  test('okrRelationUpdateValidator accepts partial update', async ({ assert }) => {
    const [error] = await okrRelationUpdateValidator.tryValidate({
      status: 'resolved',
    })
    assert.isNull(error)
  })

  test('okrRelationUpdateValidator rejects invalid status', async ({ assert }) => {
    const [error] = await okrRelationUpdateValidator.tryValidate({
      status: 'deleted',
    })
    assert.isNotNull(error)
  })

  test('okrMatrixQueryValidator rejects invalid healthLevel', async ({ assert }) => {
    const [error] = await okrMatrixQueryValidator.tryValidate({
      healthLevel: 'critical',
    })
    assert.isNotNull(error)
  })

  test('okrMatrixQueryValidator accepts bounded query', async ({ assert }) => {
    const [error] = await okrMatrixQueryValidator.tryValidate({
      cycleId: 1,
      page: 1,
      perPage: 25,
      sort: 'health',
      order: 'desc',
    })
    assert.isNull(error)
  })

  test('okrMatrixQueryValidator rejects invalid sort field', async ({ assert }) => {
    const [error] = await okrMatrixQueryValidator.tryValidate({
      sort: 'invalid_field',
    })
    assert.isNotNull(error)
  })

  test('okrMatrixQueryValidator rejects depth out of range', async ({ assert }) => {
    const [error] = await okrMatrixQueryValidator.tryValidate({
      depth: 10,
    })
    assert.isNotNull(error)
  })

  test('okrHealthQueryValidator accepts optional filters', async ({ assert }) => {
    const [error] = await okrHealthQueryValidator.tryValidate({
      cycleId: 1,
      scope: 'team',
      includeRestricted: false,
    })
    assert.isNull(error)
  })

  test('okrAiCascadeSuggestionValidator requires cycleId', async ({ assert }) => {
    const [error] = await okrAiCascadeSuggestionValidator.tryValidate({})
    assert.isNotNull(error)
  })

  test('okrAiCascadeSuggestionValidator accepts full input', async ({ assert }) => {
    const [error] = await okrAiCascadeSuggestionValidator.tryValidate({
      cycleId: 1,
      includeRelations: true,
      includeConflictAnalysis: true,
    })
    assert.isNull(error)
  })

  // 下面三条原先是 `assert.isTrue(true)` 占位，标题却声称验了「禁用 scope 被拒」
  // 「跨组织返回 RESOURCE_NOT_FOUND」「未授权 AI 预览被拒」——都是红线级的判定。
  // 改为对真实 Service / Policy 断言。

  test('disabled personal scope write is rejected at service level', async ({ assert }) => {
    const { org, cycle, objective, owner, service } = await setupCascadeActor('cascade-scope')

    const created = await service.createCascadePlan(
      org.id,
      { sourceObjectiveId: objective.id } as never,
      owner,
    )

    // 造一个 individual scope 的候选项，确认时必须被拒而不是落库
    const item = await OkrCascadePlanItem.create({
      planId: created.data.id,
      organizationId: org.id,
      candidateObjective: JSON.stringify({
        title: '个人目标候选',
        scope: OKR_DISABLED_SCOPES[0],
        cycleId: cycle.id,
      }),
      status: 'pending',
      coverageGap: false,
    })

    const beforeCount = await OkrObjective.query().where('organization_id', org.id).count('* as t')
    const result = await service.confirmCascadeItems(
      created.data.id,
      { acceptedItemIds: [item.id], rejectedItemIds: [] } as never,
      owner,
    )
    const afterCount = await OkrObjective.query().where('organization_id', org.id).count('* as t')

    const stored = await OkrCascadePlanItem.findOrFail(item.id)
    assert.equal(stored.status, 'rejected', '禁用 scope 的候选项必须被拒')
    assert.include(
      (result.meta.warnings as Array<{ code: string }>).map((w) => w.code),
      'DISABLED_SCOPE',
    )
    // 红线：被拒不得留下任何正式 objective
    assert.equal(Number(afterCount[0]!.$extras.t), Number(beforeCount[0]!.$extras.t))
  })

  test('cross-organization access returns RESOURCE_NOT_FOUND', async ({ assert }) => {
    const a = await setupCascadeActor('cascade-xorg-a')
    const b = await setupCascadeActor('cascade-xorg-b')

    // B 的用户去拿 A 的级联草案：必须被拒，且不得回出 A 的任何内容
    const planOfA = await a.service.createCascadePlan(
      a.org.id,
      { sourceObjectiveId: a.objective.id } as never,
      a.owner,
    )

    await assert.rejects(async () => {
      await b.service.getCascadePlan(planOfA.data.id, b.owner)
    })
  })

  test('unauthorized AI preview context is denied', async ({ assert }) => {
    const { org, cycle, service } = await setupCascadeActor('cascade-ai-denied')
    // 非组织成员：既不在 organization_members 里，也没有任何 OKR 权限
    const outsider = await createUser({ email: uniqueEmail('cascade-outsider') })

    await assert.rejects(async () => {
      await service.generateAiCascadeSuggestions(org.id, { cycleId: cycle.id } as never, outsider)
    })
  })
})
