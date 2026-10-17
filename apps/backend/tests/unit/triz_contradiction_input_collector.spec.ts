import Task from '#models/task'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Risk from '#models/risk'
import Milestone from '#models/milestone'
import ContradictionInputCollector from '#services/triz_contradiction/input_collector'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

async function setup() {
  const owner = await createUser({ email: uniqueEmail('tcd-collect') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project, collector: new ContradictionInputCollector() }
}

test.group('ContradictionInputCollector', (group) => {
  useAuthDatabase(group)

  test('正常收集任务/资源/风险/里程碑聚合与规则版本', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()

    // 4 个任务，2 个逾期（关键路径），1 个正常
    const past = DateTime.now().minus({ days: 5 })
    const overdueTask1 = await Task.create({
      projectId: project.id,
      name: '逾期关键任务1',
      status: 'in_progress',
      priority: 'high',
      taskType: 'task',
      endDate: past,
      isCriticalPath: true,
    })
    await Task.create({
      projectId: project.id,
      name: '逾期关键任务2',
      status: 'in_progress',
      priority: 'high',
      taskType: 'task',
      endDate: past,
      isCriticalPath: true,
    })
    await Task.create({
      projectId: project.id,
      name: '正常任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    // 资源 + 过载分配（resource_allocations.task_id 有 FK，必须真实任务）
    const resource = await Resource.create({
      projectId: project.id,
      name: '工程师A',
      resourceType: 'human',
      role: 'member',
      dailyCapacityHours: 8,
    })
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId: overdueTask1.id,
      allocationType: 'assigned',
      allocationPercent: 90,
    })
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId: overdueTask1.id,
      allocationType: 'assigned',
      allocationPercent: 80,
    })

    // 高分风险（score=12 >= 10 → high）
    await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '高风险',
      description: '高风险描述',
      category: 'technical',
      probability: 3,
      impact: 4,
      score: 12,
      status: 'identified',
      riskLevel: 'high',
      priority: 'high',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
    })

    await Milestone.create({
      projectId: project.id,
      name: '里程碑1',
      status: 'planned',
    })

    const snap = await collector.collect(org.id, project.id)

    assert.equal(snap.taskTotal, 3)
    assert.equal(snap.overdueTaskCount, 2)
    assert.equal(snap.criticalPathTaskCount, 2)
    assert.isAbove(snap.criticalPathDensity, 0)
    // 过载：sum=170 > 100 → overload=1，utilization=min(170,100)/100=1
    assert.equal(snap.resourceOverloadCount, 1)
    assert.isNotNull(snap.resourceUtilization)
    assert.equal(snap.highRiskCount, 1)
    assert.isAtLeast(snap.activeRiskCount, 1)
    assert.isAtLeast(snap.milestoneTotal, 1)
    assert.equal(snap.ruleVersion, '1.0.0')
    assert.isArray(snap.warnings)
  })

  test('空项目优雅返回零值快照', async ({ assert }) => {
    const { org, project, collector } = await setup()
    const snap = await collector.collect(org.id, project.id)

    assert.equal(snap.taskTotal, 0)
    assert.equal(snap.overdueTaskCount, 0)
    assert.equal(snap.criticalPathDensity, 0)
    assert.isNull(snap.resourceUtilization)
    assert.equal(snap.resourceOverloadCount, 0)
    assert.equal(snap.highRiskCount, 0)
    // scopeItemCount 可能含 wbs_nodes 计数，但任务为 0 时不报错
    assert.isAtLeast(snap.scopeItemCount, 0)
  })

  test('跨项目隔离：另一项目的任务/资源不计入', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    const { project: otherProject } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // 另一项目的任务与风险
    await Task.create({
      projectId: otherProject.id,
      name: '其它项目任务',
      status: 'in_progress',
      priority: 'high',
      taskType: 'task',
      endDate: DateTime.now().minus({ days: 3 }),
      isCriticalPath: true,
    })
    await Risk.create({
      organizationId: org.id,
      projectId: otherProject.id,
      title: '其它项目风险',
      description: '描述',
      category: 'technical',
      probability: 4,
      impact: 4,
      score: 16,
      status: 'identified',
      riskLevel: 'critical',
      priority: 'high',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
    })

    const snap = await collector.collect(org.id, project.id)
    assert.equal(snap.taskTotal, 0, '不得读取其它项目任务')
    assert.equal(snap.highRiskCount, 0, '不得读取其它项目风险')
  })

  test('输出携带 organizationId/projectId 双隔离字段', async ({ assert }) => {
    const { org, project, collector } = await setup()
    const snap = await collector.collect(org.id, project.id)
    assert.equal(snap.organizationId, Number(org.id))
    assert.equal(snap.projectId, Number(project.id))
  })
})
