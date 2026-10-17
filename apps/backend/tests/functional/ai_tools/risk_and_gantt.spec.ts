// v3-ai-tools-orchestration-layer W2 —— `list_project_risks` 与 `get_gantt_snapshot` 功能测试
//
// 覆盖（tasks.md 2.7）：
// - 风险列表按评分下限（minScore）筛选与分页元数据；
// - 甘特快照逾期任务识别、关键路径标识与基线呈现；
// - 组织隔离（跨组织一律 404，RL-05）。
//
// 说明：权限不足 403 拦截由 W1 AiToolsPolicy + 编排层执行；本文件在 handler
// 边界断言元数据契约（risk:view / gantt:view）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import GanttBaseline from '#models/gantt_baseline'
import Risk from '#models/risk'
import Task from '#models/task'
import type User from '#models/user'
import GanttBaselineService from '#services/gantt_baseline_service'
import RiskService from '#services/risk_service'
import {
  createGetGanttSnapshotTool,
  createListProjectRisksTool,
} from '#services/ai_tools/handlers/index'
import type { ToolExecutionContext } from '#services/ai_tools/handlers/index'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function deps() {
  return {
    riskService: await app.container.make(RiskService),
    ganttBaselineService: await app.container.make(GanttBaselineService),
  }
}

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'risk-gantt-test' }
}

function seedRisk(
  organizationId: number,
  projectId: number,
  title: string,
  score: number,
  status = 'identified',
  mitigationStrategy: string | null = null,
) {
  return Risk.create({
    organizationId,
    projectId,
    title,
    description: `${title} 描述`,
    category: 'technical',
    probability: 3,
    impact: 3,
    score,
    status,
    riskLevel: score >= 15 ? 'high' : 'medium',
    priority: score >= 15 ? 'high' : 'normal',
    identifiedAt: DateTime.now(),
    createdBy: 1,
    updatedBy: 1,
    mitigationStrategy,
  })
}

async function datedTask(
  projectId: number,
  name: string,
  status: string,
  startDate: string,
  endDate: string,
  extras: { isCriticalPath?: boolean } = {},
) {
  return Task.create({
    projectId,
    name,
    status,
    priority: 'medium',
    taskType: 'task',
    startDate: DateTime.fromISO(startDate),
    endDate: DateTime.fromISO(endDate),
    durationDays: 2,
    isCriticalPath: extras.isCriticalPath ?? false,
  })
}

test.group('AI tools: list_project_risks & get_gantt_snapshot', (group) => {
  useAuthDatabase(group)

  test('list_project_risks 按评分下限筛选并返回风险要素', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('risk-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const low = await seedRisk(org.id, project.id, '低分风险', 5)
    const high = await seedRisk(org.id, project.id, '高分风险', 18, 'identified', '升级为高优跟进')

    const tool = createListProjectRisksTool(await deps())
    const ctx = ctxFor(owner, org.id)

    const all = await tool.handler(ctx, { projectId: project.id, perPage: 20 })
    assert.equal(all.status, 'SUCCESS')
    assert.equal(all.data.meta.total, 2)

    const filtered = await tool.handler(ctx, { projectId: project.id, minScore: 10, perPage: 20 })
    assert.equal(filtered.data.meta.total, 1)
    assert.equal(filtered.data.items[0].id, high.id)
    assert.equal(filtered.data.items[0].riskLevel, 'high')
    assert.equal(filtered.data.items[0].score, 18)
    assert.equal(filtered.data.items[0].mitigationStrategy, '升级为高优跟进')
    assert.isFalse(filtered.data.items.some((r) => r.id === low.id))
  })

  test('list_project_risks 跨组织 projectId 一律 404（RL-05，非空列表）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('risk-orga') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedRisk(orgA.id, project.id, '组织A风险', 8)

    const outsider = await createUser({ email: uniqueEmail('risk-orgb') })
    const orgB = await createOrganization(outsider)

    const tool = createListProjectRisksTool(await deps())
    let caught: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), { projectId: project.id })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('get_gantt_snapshot 识别逾期任务与关键路径', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('gantt-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const overdue = await datedTask(
      project.id,
      '逾期任务',
      'in_progress',
      '2026-06-01',
      '2026-06-30',
    )
    await datedTask(project.id, '已完成旧任务', 'completed', '2026-06-01', '2026-06-05')
    const future = await datedTask(
      project.id,
      '未来任务',
      'not_started',
      '2030-01-01',
      '2030-01-31',
      { isCriticalPath: true },
    )
    await GanttBaseline.create({
      projectId: project.id,
      createdBy: owner.id,
      snapshot: {
        tasks: [
          {
            id: overdue.id,
            startDate: '2026-06-01',
            endDate: '2026-06-30',
            baselineCostCents: 0,
          },
        ],
        milestones: [],
        savedAt: DateTime.utc().toISO()!,
        totalBaselineCostCents: 0,
      },
    })

    const tool = createGetGanttSnapshotTool(await deps())
    const result = await tool.handler(ctxFor(owner, org.id), { projectId: project.id })

    assert.equal(result.status, 'SUCCESS')
    assert.equal(result.data.taskCount, 3)
    // 逾期：未完成且 endDate 早于今日；已完成不计入
    assert.deepEqual(
      result.data.overdueTasks.map((t) => t.id),
      [overdue.id],
    )
    assert.equal(result.data.overdueTasks[0].name, '逾期任务')
    // 关键路径
    assert.deepEqual(result.data.criticalPathTaskIds, [future.id])
    // 基线
    assert.isNotNull(result.data.baseline)
    assert.equal(result.data.baseline?.projectId, project.id)
    assert.equal(result.data.baseline?.snapshot.tasks[0].id, overdue.id)
  })

  test('get_gantt_snapshot 无基线时返回 null，跨组织一律 404', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('gantt-nobase') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await datedTask(project.id, '普通任务', 'not_started', '2030-02-01', '2030-02-28')

    const tool = createGetGanttSnapshotTool(await deps())
    const result = await tool.handler(ctxFor(owner, org.id), { projectId: project.id })
    assert.equal(result.data.baseline, null)
    assert.equal(result.data.taskCount, 1)
    assert.deepEqual(result.data.overdueTasks, [])

    const outsider = await createUser({ email: uniqueEmail('gantt-orgb') })
    const orgB = await createOrganization(outsider)
    let caught: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), { projectId: project.id })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('风险与甘特工具元数据契约（read + 领域权限）', async ({ assert }) => {
    const { riskService, ganttBaselineService } = await deps()
    const riskTool = createListProjectRisksTool({ riskService })
    const ganttTool = createGetGanttSnapshotTool({ ganttBaselineService })

    assert.equal(riskTool.sideEffect, 'read')
    assert.deepEqual([...riskTool.requiredPermissions], ['risk:view'])
    assert.equal(ganttTool.sideEffect, 'read')
    assert.deepEqual([...ganttTool.requiredPermissions], ['gantt:view'])
    const schema = ganttTool.parametersJsonSchema as { properties?: Record<string, unknown> }
    assert.isDefined(schema.properties?.projectId)
  })
})
