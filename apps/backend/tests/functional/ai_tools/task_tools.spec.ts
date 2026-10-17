// v3-ai-tools-orchestration-layer W2 —— `list_project_tasks` 与 `get_task_detail` 功能测试
//
// 覆盖（tasks.md 2.5）：
// - 按状态/优先级过滤与分页元数据；
// - 单任务详情加载与依赖计数；
// - 跨项目/跨组织一律 404（RL-05）。
//
// 说明：缺 task:view 的 403 拦截由 W1 AiToolsPolicy + 编排层执行；本文件在
// handler 边界断言元数据契约（requiredPermissions 含 task:view）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type User from '#models/user'
import TaskService from '#services/task_service'
import {
  createGetTaskDetailTool,
  createListProjectTasksTool,
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
    taskService: await app.container.make(TaskService),
  }
}

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'task-tools-test' }
}

async function datedTask(
  projectId: number,
  name: string,
  status: string,
  priority: string,
  startDate: string,
  endDate: string,
  assigneeId: number | null = null,
) {
  return Task.create({
    projectId,
    name,
    status,
    priority,
    taskType: 'task',
    assigneeId,
    startDate: DateTime.fromISO(startDate),
    endDate: DateTime.fromISO(endDate),
    durationDays: 3,
  })
}

test.group('AI tools: list_project_tasks & get_task_detail', (group) => {
  useAuthDatabase(group)

  test('list_project_tasks 按状态/优先级过滤并返回分页元数据', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('tasklist-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const a = await datedTask(
      project.id,
      '任务A',
      'in_progress',
      'high',
      '2026-07-01',
      '2026-07-03',
    )
    await datedTask(project.id, '任务B', 'not_started', 'low', '2026-07-06', '2026-07-08')
    const c = await datedTask(
      project.id,
      '任务C',
      'in_progress',
      'medium',
      '2026-07-09',
      '2026-07-11',
    )

    const tool = createListProjectTasksTool(await deps())
    const ctx = ctxFor(owner, org.id)

    const byStatus = await tool.handler(ctx, {
      projectId: project.id,
      status: 'in_progress',
      perPage: 20,
    })
    assert.equal(byStatus.status, 'SUCCESS')
    assert.equal(byStatus.data.items.length, 2)
    assert.equal(byStatus.data.meta.total, 2)
    assert.isTrue(byStatus.data.items.every((t) => t.status === 'in_progress'))

    const byPriority = await tool.handler(ctx, {
      projectId: project.id,
      priority: 'high',
      page: 1,
      perPage: 10,
    })
    assert.equal(byPriority.data.meta.total, 1)
    assert.equal(byPriority.data.items[0].id, a.id)

    const paged = await tool.handler(ctx, { projectId: project.id, page: 1, perPage: 2 })
    assert.equal(paged.data.items.length, 2)
    assert.equal(paged.data.meta.page, 1)
    assert.equal(paged.data.meta.perPage, 2)
    assert.equal(paged.data.meta.totalPages, 2)
    const page2 = await tool.handler(ctx, { projectId: project.id, page: 2, perPage: 2 })
    assert.equal(page2.data.items.length, 1)
    assert.equal(page2.data.items[0].id, c.id)

    // spec 分页表述别名 pageSize 与 perPage 等价
    const alias = await tool.handler(ctx, { projectId: project.id, page: 1, pageSize: 1 })
    assert.equal(alias.data.meta.perPage, 1)
    assert.equal(alias.data.items.length, 1)
  })

  test('get_task_detail 返回详情与依赖计数', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('taskdetail-owner') })
    const assignee = await createUser({ email: uniqueEmail('taskdetail-assignee') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const a = await datedTask(
      project.id,
      '前置任务',
      'in_progress',
      'high',
      '2026-07-01',
      '2026-07-03',
      assignee.id,
    )
    const b = await datedTask(
      project.id,
      '后续任务',
      'not_started',
      'medium',
      '2026-07-06',
      '2026-07-08',
    )
    await TaskDependency.create({ predecessorId: a.id, successorId: b.id, type: 'fs', lagDays: 0 })

    const tool = createGetTaskDetailTool(await deps())
    const ctx = ctxFor(owner, org.id)

    const detail = await tool.handler(ctx, { projectId: project.id, taskId: b.id })
    assert.equal(detail.status, 'SUCCESS')
    assert.equal(detail.data.id, b.id)
    assert.equal(detail.data.status, 'not_started')
    assert.equal(detail.data.startDate, '2026-07-06')
    assert.equal(detail.data.endDate, '2026-07-08')
    assert.equal(detail.data.durationDays, 3)
    assert.equal(detail.data.dependencyCount, 1)

    const withAssignee = await tool.handler(ctx, { projectId: project.id, taskId: a.id })
    assert.equal(withAssignee.data.dependencyCount, 1)
    assert.equal(withAssignee.data.assignee?.id, assignee.id)
    assert.isNotNull(withAssignee.data.assignee?.fullName)
  })

  test('任务工具对跨项目/跨组织资源一律 404（RL-05）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('task-orga') })
    const orgA = await createOrganization(ownerA)
    const { project: projectA } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const taskA = await datedTask(
      projectA.id,
      '组织A任务',
      'not_started',
      'medium',
      '2026-07-01',
      '2026-07-03',
    )

    const ownerB = await createUser({ email: uniqueEmail('task-orgb') })
    const orgB = await createOrganization(ownerB)
    const { project: projectB } = await createProjectWithMember(
      orgB,
      ownerB,
      ownerB,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const sharedDeps = await deps()
    const listTool = createListProjectTasksTool(sharedDeps)
    const detailTool = createGetTaskDetailTool(sharedDeps)
    const ctxB = ctxFor(ownerB, orgB.id)

    // 跨组织 projectId → 404
    let caught: unknown = null
    try {
      await listTool.handler(ctxB, { projectId: projectA.id })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
    // 同组织项目 + 跨组织 taskId → 404
    caught = null
    try {
      await detailTool.handler(ctxB, { projectId: projectB.id, taskId: taskA.id })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
    // 不存在 taskId → 404
    caught = null
    try {
      await detailTool.handler(ctxFor(ownerA, orgA.id), { projectId: projectA.id, taskId: 999999 })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('任务工具入参收窄与元数据契约', async ({ assert }) => {
    const { taskService } = await deps()
    const listTool = createListProjectTasksTool({ taskService })
    const detailTool = createGetTaskDetailTool({ taskService })

    assert.equal(listTool.sideEffect, 'read')
    assert.deepEqual([...listTool.requiredPermissions], ['task:view'])
    assert.deepEqual([...detailTool.requiredPermissions], ['task:view'])
    const schema = listTool.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    assert.isArray((schema.properties?.status as { enum?: unknown[] })?.enum)

    // 非法 projectId 抛 422（防御性收窄；handler 在触碰任何服务前即拦截）
    const ctx: ToolExecutionContext = { user: null as never, organizationId: 1, requestId: null }
    let caught: unknown = null
    try {
      await listTool.handler(ctx, { projectId: -1 })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ValidationException)
  })
})
