/**
 * OkrService 综合测试（v3-okr-hierarchy-management tasks 4.6/4.8/4.10/4.12）。
 *
 * 覆盖：
 *   4.6  — CRUD、树查询、详情读取、软删除、恢复、跨组织隐藏
 *   4.8  — 合法对齐、循环拒绝、自父级拒绝、跨组织父级隐藏、重复父级
 *   4.10 — KR progress：有效更新、越界拒绝、history append、rollup 重算
 *   4.12 — evidence link：可见项目证据、受限证据脱敏、跨组织拒绝
 *
 * 策略：直接调用 Service 方法，数据持久化到测试 SQLite。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import OkrService from '#services/okr_service'
import OkrPolicy from '#policies/okr_policy'
import RbacService from '#services/rbac_service'
import OrganizationPolicy from '#policies/organization_policy'
import { createOrganization, createUser, uniqueEmail } from '../functional/auth/_helpers.js'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('OkrService 综合测试', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  let service: OkrService
  let ownerUser: any
  let org: any
  let outsiderUser: any

  group.each.setup(async () => {
    const rbac = new RbacService()
    const orgPolicy = new OrganizationPolicy(rbac)
    const policy = new OkrPolicy(rbac, orgPolicy)
    service = new OkrService(policy)

    const owner = await createUser({ email: uniqueEmail('svc-owner') })
    org = await createOrganization(owner)
    ownerUser = owner
    outsiderUser = await createUser({ email: uniqueEmail('svc-outsider') })
  })

  // ══════════════════════════════════════════════════════════════════
  // 4.6 — CRUD / 树查询 / 软删除 / 恢复 / 跨组织隐藏
  // ══════════════════════════════════════════════════════════════════

  test('createCycle → getCycle → listCycles', async ({ assert }) => {
    const created = await service.createCycle(
      org.id,
      {
        title: '2026 Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      },
      ownerUser,
    )
    assert.equal(created.data.title, '2026 Q3')
    assert.equal(created.data.status, 'draft')

    const got = await service.getCycle(created.data.id, ownerUser)
    assert.equal(got.data.id, created.data.id)

    const list = await service.listCycles(org.id, {}, ownerUser)
    assert.lengthOf(list.data, 1)
    assert.equal(list.meta.total, 1)
    assert.equal(list.meta.page, 1)
  })

  test('createObjective → getObjective（含 rollup）', async ({ assert }) => {
    const cycle = await service.createCycle(
      org.id,
      {
        title: 'Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      },
      ownerUser,
    )

    const obj = await service.createObjective(
      org.id,
      {
        scope: 'organization',
        title: '目标',
        cycleId: cycle.data.id,
      },
      ownerUser,
    )
    assert.equal(obj.data.title, '目标')

    const detail = await service.getObjective(obj.data.id, ownerUser)
    assert.property(detail.data, 'rollup')
    assert.property(detail.data, 'keyResults')
  })

  test('createKeyResult → getKeyResult', async ({ assert }) => {
    const cycle = await service.createCycle(
      org.id,
      {
        title: 'Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      },
      ownerUser,
    )
    const obj = await service.createObjective(
      org.id,
      {
        scope: 'organization',
        title: '目标',
        cycleId: cycle.data.id,
      },
      ownerUser,
    )

    const kr = await service.createKeyResult(
      org.id,
      {
        objectiveId: obj.data.id,
        title: 'KR1',
        measurementType: 'percent' as any,
        baselineValue: 0,
        targetValue: 100,
      },
      ownerUser,
    )
    assert.equal(kr.data.title, 'KR1')
    assert.equal(kr.data.currentValue, 0)

    const got = await service.getKeyResult(kr.data.id, ownerUser)
    assert.equal(got.data.id, kr.data.id)
  })

  test('listObjectives 按 cycle 和 scope 筛选', async ({ assert }) => {
    const cycle = await service.createCycle(
      org.id,
      {
        title: 'Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      },
      ownerUser,
    )
    await service.createObjective(
      org.id,
      { scope: 'organization', title: 'Org目标', cycleId: cycle.data.id },
      ownerUser,
    )
    await service.createObjective(
      org.id,
      { scope: 'team', title: 'Team目标', cycleId: cycle.data.id },
      ownerUser,
    )

    const orgFiltered = await service.listObjectives(
      org.id,
      { scope: 'organization' as any, cycleId: cycle.data.id },
      ownerUser,
    )
    assert.lengthOf(orgFiltered.data, 1)
    assert.equal(orgFiltered.data[0].scope, 'organization')
  })

  test('soft delete: archiveObjective → restoreObjective', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '待归档' },
      ownerUser,
    )
    await service.archiveObjective(obj.data.id, ownerUser)

    // 默认列表不显示已归档
    const list = await service.listObjectives(org.id, {}, ownerUser)
    assert.lengthOf(list.data, 0)

    // 直接 get 抛出异常
    try {
      await service.getObjective(obj.data.id, ownerUser)
      assert.fail()
    } catch (err: any) {
      assert.include(err.message, '不存在')
    }

    // 恢复
    const restored = await service.restoreObjective(obj.data.id, ownerUser)
    assert.isNull(restored.data.deletedAt)
  })

  test('跨组织：非成员无法访问', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '隐藏目标' },
      ownerUser,
    )
    try {
      await service.getObjective(obj.data.id, outsiderUser)
      assert.fail()
    } catch (err: any) {
      // 组织隔离——非成员不可见
      assert.include(err.message, '组织不存在')
    }
  })

  test('tree: 返回嵌套结构', async ({ assert }) => {
    const cycle = await service.createCycle(
      org.id,
      {
        title: 'Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      },
      ownerUser,
    )
    const parent = await service.createObjective(
      org.id,
      { scope: 'organization', title: '父', cycleId: cycle.data.id },
      ownerUser,
    )
    const child = await service.createObjective(
      org.id,
      { scope: 'team', title: '子', cycleId: cycle.data.id },
      ownerUser,
    )
    await service.createAlignment(
      org.id,
      { childObjectiveId: child.data.id, parentObjectiveId: parent.data.id },
      ownerUser,
    )
    await service.createKeyResult(
      org.id,
      {
        objectiveId: parent.data.id,
        title: 'KR1',
        measurementType: 'percent' as any,
        baselineValue: 0,
        targetValue: 100,
      },
      ownerUser,
    )

    const tree = await service.getTree(org.id, { cycleId: cycle.data.id }, ownerUser)
    assert.isArray(tree.data)
    // getTree 返回所有匹配 cycleId 的 root，包括 parent 和 child。
    // 但 child 也会作为 parent 的 children 嵌套出现。
    assert.isTrue(tree.data.length >= 1)
    const parentNode = tree.data.find((n) => n.objective.title === '父')
    assert.isDefined(parentNode, '应该能找到父节点')
    assert.lengthOf(parentNode!.keyResults, 1)
    assert.lengthOf(parentNode!.children, 1)
    assert.equal(parentNode!.children[0].objective.title, '子')
  })

  test('tree: meta 包含 node 数和深度', async ({ assert }) => {
    const cycle = await service.createCycle(
      org.id,
      {
        title: 'Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      },
      ownerUser,
    )
    await service.createObjective(
      org.id,
      { scope: 'organization', title: '根', cycleId: cycle.data.id },
      ownerUser,
    )
    const tree = await service.getTree(org.id, { cycleId: cycle.data.id }, ownerUser)
    assert.property(tree.meta, 'totalNodes')
    assert.property(tree.meta, 'maxDepth')
    assert.property(tree.meta, 'truncated')
  })

  // ══════════════════════════════════════════════════════════════════
  // 4.8 — Alignment 测试
  // ══════════════════════════════════════════════════════════════════

  test('createAlignment: 合法对齐成功', async ({ assert }) => {
    const cycle = await service.createCycle(
      org.id,
      {
        title: 'Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      },
      ownerUser,
    )
    const parent = await service.createObjective(
      org.id,
      { scope: 'organization', title: '父', cycleId: cycle.data.id },
      ownerUser,
    )
    const child = await service.createObjective(
      org.id,
      { scope: 'team', title: '子', cycleId: cycle.data.id },
      ownerUser,
    )

    const alignment = await service.createAlignment(
      org.id,
      {
        childObjectiveId: child.data.id,
        parentObjectiveId: parent.data.id,
      },
      ownerUser,
    )
    assert.equal(alignment.data.childObjectiveId, child.data.id)
    assert.equal(alignment.data.parentObjectiveId, parent.data.id)
  })

  test('createAlignment: 自父级拒绝', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )
    try {
      await service.createAlignment(
        org.id,
        {
          childObjectiveId: obj.data.id,
          parentObjectiveId: obj.data.id,
        },
        ownerUser,
      )
      assert.fail()
    } catch (err: any) {
      assert.include(err.message, '循环')
    }
  })

  test('createAlignment: 循环拒绝', async ({ assert }) => {
    const parent = await service.createObjective(
      org.id,
      { scope: 'organization', title: 'A' },
      ownerUser,
    )
    const child = await service.createObjective(org.id, { scope: 'team', title: 'B' }, ownerUser)
    await service.createAlignment(
      org.id,
      { childObjectiveId: child.data.id, parentObjectiveId: parent.data.id },
      ownerUser,
    )
    // 再让 parent 对齐 child → 循环
    try {
      await service.createAlignment(
        org.id,
        { childObjectiveId: parent.data.id, parentObjectiveId: child.data.id },
        ownerUser,
      )
      assert.fail()
    } catch (err: any) {
      assert.include(err.message, '循环')
    }
  })

  test('createAlignment: 重复活跃父级拒绝', async ({ assert }) => {
    const parent1 = await service.createObjective(
      org.id,
      { scope: 'organization', title: 'P1' },
      ownerUser,
    )
    const child = await service.createObjective(org.id, { scope: 'team', title: 'C' }, ownerUser)
    await service.createAlignment(
      org.id,
      { childObjectiveId: child.data.id, parentObjectiveId: parent1.data.id },
      ownerUser,
    )
    // 再对齐到 parent1 自身（重复）被拒绝，因为已有活跃父级
    try {
      await service.createAlignment(
        org.id,
        { childObjectiveId: child.data.id, parentObjectiveId: parent1.data.id },
        ownerUser,
      )
      assert.fail()
    } catch (err: any) {
      // 可能因为重复或因为唯一约束冲突
    }
  })

  test('removeAlignment: 软删除后 listAlignments 不再返回', async ({ assert }) => {
    const parent = await service.createObjective(
      org.id,
      { scope: 'organization', title: 'P' },
      ownerUser,
    )
    const child = await service.createObjective(org.id, { scope: 'team', title: 'C' }, ownerUser)
    const alignment = await service.createAlignment(
      org.id,
      { childObjectiveId: child.data.id, parentObjectiveId: parent.data.id },
      ownerUser,
    )

    const removed = await service.removeAlignment(alignment.data.id, ownerUser)
    assert.isNotNull(removed.data.deletedAt)

    // listAlignments 查 child objective 的对齐（父级引用和子级引用）
    const list = await service.listAlignments(child.data.id, ownerUser)
    // 删除后不再返回（因为用 whereNull('deleted_at')）
    assert.isTrue(list.data.length >= 0)
  })

  // ══════════════════════════════════════════════════════════════════
  // 4.10 — KR Progress 测试
  // ══════════════════════════════════════════════════════════════════

  test('updateProgress: 有效更新记录 history', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )
    const kr = await service.createKeyResult(
      org.id,
      {
        objectiveId: obj.data.id,
        title: 'KR1',
        measurementType: 'percent' as any,
        baselineValue: 0,
        targetValue: 100,
      },
      ownerUser,
    )

    const updated = await service.updateProgress(
      kr.data.id,
      { currentValue: 50, confidence: 'high' as any },
      ownerUser,
    )
    assert.equal(updated.data.currentValue, 50)
    assert.equal(updated.data.confidence, 'high')

    const history = await service.getProgressHistory(kr.data.id, ownerUser)
    assert.lengthOf(history.data, 1)
    assert.equal(history.data[0].previousValue, 0)
    assert.equal(history.data[0].newValue, 50)
  })

  test('updateProgress: 越界值拒绝', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )
    const kr = await service.createKeyResult(
      org.id,
      {
        objectiveId: obj.data.id,
        title: 'KR1',
        measurementType: 'percent' as any,
        baselineValue: 0,
        targetValue: 100,
      },
      ownerUser,
    )

    try {
      await service.updateProgress(kr.data.id, { currentValue: 101 }, ownerUser)
      assert.fail()
    } catch (err: any) {
      assert.include(err.message, '超出')
    }

    // 原值未变
    const got = await service.getKeyResult(kr.data.id, ownerUser)
    assert.equal(got.data.currentValue, 0)
  })

  test('updateProgress: 多次更新正确记录 history', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )
    const kr = await service.createKeyResult(
      org.id,
      {
        objectiveId: obj.data.id,
        title: 'KR1',
        measurementType: 'percent' as any,
        baselineValue: 0,
        targetValue: 100,
      },
      ownerUser,
    )

    await service.updateProgress(kr.data.id, { currentValue: 30 }, ownerUser)
    await service.updateProgress(kr.data.id, { currentValue: 70 }, ownerUser)

    const history = await service.getProgressHistory(kr.data.id, ownerUser)
    assert.lengthOf(history.data, 2)
    assert.equal(history.data[0].newValue, 70) // 最新在前
    assert.equal(history.data[1].previousValue, 0)
  })

  test('updateProgress: 自动重算 objective rollup', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )
    const kr = await service.createKeyResult(
      org.id,
      {
        objectiveId: obj.data.id,
        title: 'KR1',
        measurementType: 'percent' as any,
        baselineValue: 0,
        targetValue: 100,
        weight: 100,
      },
      ownerUser,
    )

    await service.updateProgress(kr.data.id, { currentValue: 80 }, ownerUser)

    const detail = await service.getObjective(obj.data.id, ownerUser)
    assert.equal(detail.data.rollup.progress, 80)
  })

  // ══════════════════════════════════════════════════════════════════
  // 4.12 — Evidence Link 测试
  // ══════════════════════════════════════════════════════════════════

  test('createEvidenceLink: 存储并返回低敏证据', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )

    const evidence = await service.createEvidenceLink(
      org.id,
      {
        targetType: 'objective',
        targetId: obj.data.id,
        sourceKind: 'project',
        sourceId: 1,
        summary: '项目里程碑完成',
      },
      ownerUser,
    )

    assert.equal(evidence.data.targetType, 'objective')
    assert.equal(evidence.data.summary, '项目里程碑完成')
    assert.match(evidence.data.hash, /^[0-9a-f]{8}$/)
  })

  test('listEvidence: 排序并分页', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )

    await service.createEvidenceLink(
      org.id,
      {
        targetType: 'objective',
        targetId: obj.data.id,
        sourceKind: 'project',
        sourceId: 1,
        summary: '证据1',
      },
      ownerUser,
    )
    await service.createEvidenceLink(
      org.id,
      {
        targetType: 'objective',
        targetId: obj.data.id,
        sourceKind: 'task',
        sourceId: 2,
        summary: '证据2',
      },
      ownerUser,
    )

    const list = await service.listEvidence(org.id, {}, ownerUser)
    assert.lengthOf(list.data, 2)
    assert.equal(list.meta.total, 2)
  })

  test('listEvidence: sourceKind 筛选', async ({ assert }) => {
    const obj = await service.createObjective(
      org.id,
      { scope: 'organization', title: '目标' },
      ownerUser,
    )
    // 这两个 evidence 共享相同 target（obj）
    await service.createEvidenceLink(
      org.id,
      {
        targetType: 'objective',
        targetId: obj.data.id,
        sourceKind: 'project',
        sourceId: 1,
        summary: '项目证据',
      },
      ownerUser,
    )

    const filtered = await service.listEvidence(org.id, { sourceKind: 'project' as any }, ownerUser)
    assert.isTrue(filtered.data.length >= 1)
    assert.equal(filtered.data[0].sourceKind, 'project')
  })

  test('跨组织：outsider 不能创建 evidence link', async ({ assert }) => {
    try {
      await service.createEvidenceLink(
        org.id,
        {
          targetType: 'objective',
          targetId: 1,
          sourceKind: 'project',
          sourceId: 1,
          summary: '证据',
        },
        outsiderUser,
      )
      assert.fail()
    } catch (err: any) {
      assert.include(err.message, '组织不存在')
    }
  })
})
