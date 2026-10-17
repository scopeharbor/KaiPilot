import User from '#models/user'
import Project from '#models/project'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrAlignment from '#models/okr_alignment'
import OkrEvidenceLink from '#models/okr_evidence_link'
import OkrProgressHistory from '#models/okr_progress_history'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('OKR Models 关系与隔离', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('OkrCycle 创建并预加载 objectives', async ({ assert }) => {
    const user = await User.create({
      fullName: 'OKR 测试用户',
      email: 'okr-test@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await user.related('ownedOrganizations').create({
      name: 'OKR 测试组织',
      slug: 'okr-test-org',
      planTier: 'free',
    })

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
      title: '提升产品体验',
      scope: 'organization',
      status: 'active',
      metricVersion: '1.0.0',
    })

    const loaded = await OkrCycle.query().where('id', cycle.id).preload('objectives').firstOrFail()

    assert.equal(loaded.title, '2026 Q3')
    assert.equal(loaded.status, 'active')
    assert.lengthOf(loaded.objectives, 1)
    assert.equal(loaded.objectives[0].id, objective.id)
    assert.equal(loaded.objectives[0].title, '提升产品体验')
  })

  test('OkrObjective 预加载 cycle / keyResults / alignments / evidence', async ({ assert }) => {
    const user = await User.create({
      fullName: '关系测试',
      email: 'rel-test@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await user.related('ownedOrganizations').create({
      name: '关系测试组织',
      slug: 'rel-test-org',
      planTier: 'free',
    })
    const cycle = await OkrCycle.create({
      organizationId: org.id,
      title: 'Q3',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })
    const obj = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '父目标',
      scope: 'organization',
      status: 'active',
      metricVersion: '1.0.0',
    })
    const child = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '子目标',
      scope: 'team',
      status: 'active',
      metricVersion: '1.0.0',
    })

    await OkrKeyResult.create({
      organizationId: org.id,
      objectiveId: obj.id,
      title: 'KR1',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 50,
      status: 'active',
      weight: 100,
    })
    await OkrAlignment.create({
      organizationId: org.id,
      childObjectiveId: child.id,
      parentObjectiveId: obj.id,
    })
    await OkrEvidenceLink.create({
      organizationId: org.id,
      targetType: 'objective',
      targetId: obj.id,
      sourceKind: 'project',
      sourceId: 1,
      summary: '项目证据',
      hash: 'abc12345',
      lastSeenAt: DateTime.now(),
    })

    const loaded = await OkrObjective.query()
      .where('id', obj.id)
      .preload('cycle')
      .preload('keyResults')
      .preload('childAlignments')
      .preload('evidenceLinks')
      .firstOrFail()

    assert.equal(loaded.cycle.title, 'Q3')
    assert.lengthOf(loaded.keyResults, 1)
    assert.equal(loaded.keyResults[0].title, 'KR1')
    assert.lengthOf(loaded.childAlignments, 0) // obj 是父级，childAlignment 引用 child 的 FK
    assert.lengthOf(loaded.evidenceLinks, 1)
    assert.equal(loaded.evidenceLinks[0].summary, '项目证据')
  })

  test('OkrKeyResult 预加载 objective / progressHistory', async ({ assert }) => {
    const user = await User.create({
      fullName: 'KR 关系测试',
      email: 'kr-rel@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await user.related('ownedOrganizations').create({
      name: 'KR 测试组织',
      slug: 'kr-test-org',
      planTier: 'free',
    })
    const cycle = await OkrCycle.create({
      organizationId: org.id,
      title: 'Q3',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })
    const obj = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '目标',
      scope: 'organization',
      status: 'active',
      metricVersion: '1.0.0',
    })
    const kr = await OkrKeyResult.create({
      organizationId: org.id,
      objectiveId: obj.id,
      title: 'KR',
      measurementType: 'number',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 30,
      status: 'active',
      weight: 100,
    })
    await OkrProgressHistory.create({
      organizationId: org.id,
      keyResultId: kr.id,
      previousValue: 0,
      newValue: 30,
      source: 'manual',
      confidence: 'medium',
      recordedBy: user.id,
      recordedAt: DateTime.now(),
    })

    const loaded = await OkrKeyResult.query()
      .where('id', kr.id)
      .preload('objective')
      .preload('progressHistory')
      .firstOrFail()

    assert.equal(loaded.objective.title, '目标')
    assert.lengthOf(loaded.progressHistory, 1)
    assert.equal(loaded.progressHistory[0].newValue, 30)
  })

  test('软删除默认排除', async ({ assert }) => {
    const user = await User.create({
      fullName: '软删除测试',
      email: 'soft-del@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await user.related('ownedOrganizations').create({
      name: '软删除测试',
      slug: 'soft-del-org',
      planTier: 'free',
    })
    const cycle = await OkrCycle.create({
      organizationId: org.id,
      title: 'Q3',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })
    const obj1 = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '活跃目标',
      scope: 'organization',
      status: 'active',
      metricVersion: '1.0.0',
    })
    const obj2 = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '已删除目标',
      scope: 'team',
      status: 'active',
      metricVersion: '1.0.0',
    })
    obj2.deletedAt = DateTime.now()
    await obj2.save()

    const active = await OkrObjective.query().where('organization_id', org.id)
    assert.lengthOf(active, 1)
    assert.equal(active[0].id, obj1.id)
    assert.equal(active[0].title, '活跃目标')

    // 想查已软删的必须走 queryOnlyTrashed()：@beforeFetch 钩子会无条件补 whereNull('deleted_at')，
    // 原先的 .whereNotNull('deleted_at') 与它相与，结果恒为空——那条断言从来验不到东西。
    const trashed = await OkrObjective.queryOnlyTrashed().where('organization_id', org.id)
    assert.lengthOf(trashed, 1)
    assert.equal(trashed[0].id, obj2.id)
  })

  test('组织隔离：只返回指定组织的 OKR 数据', async ({ assert }) => {
    const user = await User.create({
      fullName: '组织隔离测试',
      email: 'org-iso@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org1 = await user.related('ownedOrganizations').create({
      name: '组织 A',
      slug: 'org-a',
      planTier: 'free',
    })
    const org2 = await user.related('ownedOrganizations').create({
      name: '组织 B',
      slug: 'org-b',
      planTier: 'free',
    })

    const cycle1 = await OkrCycle.create({
      organizationId: org1.id,
      title: 'A-Q3',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })
    const cycle2 = await OkrCycle.create({
      organizationId: org2.id,
      title: 'B-Q3',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })

    const org1Cycles = await OkrCycle.query().where('organization_id', org1.id)
    assert.lengthOf(org1Cycles, 1)
    assert.equal(org1Cycles[0].id, cycle1.id)
    assert.equal(org1Cycles[0].title, 'A-Q3')

    const org2Cycles = await OkrCycle.query().where('organization_id', org2.id)
    assert.lengthOf(org2Cycles, 1)
    assert.equal(org2Cycles[0].id, cycle2.id)
    assert.equal(org2Cycles[0].title, 'B-Q3')
  })

  test('fixture seeding：创建完整 OKR 层级', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Fixtures 测试',
      email: 'fixture@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await user.related('ownedOrganizations').create({
      name: 'Fixtures 组织',
      slug: 'fixture-org',
      planTier: 'free',
    })

    // projectId 原先硬编码为 1，但每个用例都 truncate 过、projects 表是空的，
    // okr_objectives.project_id 的外键于是必然失败。改为建一个真实项目再引用它。
    const project = await Project.create({
      organizationId: org.id,
      name: 'Fixtures 项目',
      status: 'active',
      createdBy: user.id,
    })

    // 从 types fixture 导入逻辑（手写等效）
    const cycle = await OkrCycle.create({
      organizationId: org.id,
      title: '2026 Q3',
      description: 'Q3 OKR 周期',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })

    const obj1 = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '组织级目标',
      scope: 'organization',
      status: 'active',
      weight: 1,
      metricVersion: '1.0.0',
    })
    const obj2 = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '团队目标',
      scope: 'team',
      status: 'active',
      weight: 1,
      metricVersion: '1.0.0',
    })
    const obj3 = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: '项目目标',
      scope: 'project',
      status: 'active',
      projectId: project.id,
      weight: 1,
      metricVersion: '1.0.0',
    })

    await OkrKeyResult.create({
      organizationId: org.id,
      objectiveId: obj1.id,
      title: 'KR1',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 80,
      weight: 60,
      status: 'active',
    })
    await OkrKeyResult.create({
      organizationId: org.id,
      objectiveId: obj1.id,
      title: 'KR2',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 40,
      weight: 40,
      status: 'active',
    })
    await OkrKeyResult.create({
      organizationId: org.id,
      objectiveId: obj2.id,
      title: 'KR3',
      measurementType: 'number',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 50,
      weight: 100,
      status: 'active',
    })

    await OkrAlignment.create({
      organizationId: org.id,
      childObjectiveId: obj2.id,
      parentObjectiveId: obj1.id,
    })
    await OkrAlignment.create({
      organizationId: org.id,
      childObjectiveId: obj3.id,
      parentObjectiveId: obj2.id,
    })

    await OkrEvidenceLink.create({
      organizationId: org.id,
      targetType: 'objective',
      targetId: obj1.id,
      sourceKind: 'project',
      sourceId: 1,
      summary: '项目里程碑完成',
      hash: 'abc12345',
      lastSeenAt: DateTime.now(),
    })

    const objectives = await OkrObjective.query().where('organization_id', org.id)
    assert.lengthOf(objectives, 3)

    const krs = await OkrKeyResult.query().where('organization_id', org.id)
    assert.lengthOf(krs, 3)

    const alignments = await OkrAlignment.query().where('organization_id', org.id)
    assert.lengthOf(alignments, 2)

    const evidence = await OkrEvidenceLink.query().where('organization_id', org.id)
    assert.lengthOf(evidence, 1)
  })
})
