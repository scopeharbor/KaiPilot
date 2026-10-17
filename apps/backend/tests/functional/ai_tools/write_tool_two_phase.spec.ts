// v3-ai-tools-orchestration-layer W2 —— 写工具 `update_task_schedule` 两阶段功能测试
//
// 覆盖（tasks.md 2.11）：
// - execute 阶段返回 PREVIEW_REQUIRED + 合法 previewToken + Diff，tasks 表零写入（RL-01）；
// - confirm 阶段（handler 入参携带 previewToken）单事务原子生效并返回 SUCCESS；
// - 预览后篡改底表 → confirm 抛出 409 SCHEDULE_STALE 且回滚（TOCTOU）；
// - 非法 previewToken → 422；
// - 元数据契约：sideEffect 'write' + task:update。
//
// 说明：缺 ai:confirm 权限的 403 拦截由 W1 AiToolsPolicy.authorizeConfirm 门禁
// （ai:confirm + task:update）在编排层执行，handler 边界不持有会话权限事实；
// 本文件在契约层断言「无合法 previewToken 绝无落库路径」的 fail-closed 语义。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { ConflictException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type User from '#models/user'
import GanttSchedulingService from '#services/gantt_scheduling_service'
import { createUpdateTaskScheduleTool } from '#services/ai_tools/handlers/index'
import type { ToolExecutionContext } from '#services/ai_tools/handlers/index'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function ganttService() {
  return await app.container.make(GanttSchedulingService)
}

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'write-tool-test' }
}

async function datedTask(
  projectId: number,
  name: string,
  startDate: string,
  endDate: string,
  durationDays: number,
) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: DateTime.fromISO(startDate),
    endDate: DateTime.fromISO(endDate),
    durationDays,
  })
}

test.group('AI tools: update_task_schedule 两阶段', (group) => {
  useAuthDatabase(group)

  test('execute 阶段只产出 PREVIEW_REQUIRED + previewToken + Diff，零写入（RL-01）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('write-preview') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project.settings = { workdays: [1, 2, 3, 4, 5], holidays: [] }
    await project.save()
    const [a, b] = await Promise.all([
      datedTask(project.id, 'A', '2026-07-01', '2026-07-03', 3),
      datedTask(project.id, 'B', '2026-07-06', '2026-07-07', 2),
    ])
    await TaskDependency.create({ predecessorId: a.id, successorId: b.id, type: 'fs', lagDays: 0 })

    const tool = createUpdateTaskScheduleTool({ ganttSchedulingService: await ganttService() })
    const ctx = ctxFor(owner, org.id)
    const intent = {
      projectId: project.id,
      taskId: a.id,
      operation: 'move' as const,
      startDate: '2026-07-06',
      autoSchedule: true,
    }

    const result = await tool.handler(ctx, intent)
    assert.equal(result.status, 'PREVIEW_REQUIRED')
    assert.match(result.previewToken ?? '', /^[0-9a-f]{64}$/)
    assert.isArray(result.diff)
    assert.equal((result.diff as unknown[]).length, 2)
    assert.equal(result.data.committed, false)
    assert.equal(result.data.projectId, project.id)
    assert.equal(result.data.affectedTaskIds.length, 2)

    // 零写入：正式任务表 unchanged
    await a.refresh()
    await b.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-01')
    assert.equal(b.startDate?.toISODate(), '2026-07-06')
  })

  test('confirm 阶段（入参携带 previewToken）原子生效并返回 SUCCESS', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('write-commit') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project.settings = { workdays: [1, 2, 3, 4, 5], holidays: [] }
    await project.save()
    const [a, b] = await Promise.all([
      datedTask(project.id, 'A', '2026-07-01', '2026-07-03', 3),
      datedTask(project.id, 'B', '2026-07-06', '2026-07-07', 2),
    ])
    await TaskDependency.create({ predecessorId: a.id, successorId: b.id, type: 'fs', lagDays: 0 })

    const tool = createUpdateTaskScheduleTool({ ganttSchedulingService: await ganttService() })
    const ctx = ctxFor(owner, org.id)
    const intent = {
      projectId: project.id,
      taskId: a.id,
      operation: 'move' as const,
      startDate: '2026-07-06',
      autoSchedule: true,
    }

    const preview = await tool.handler(ctx, intent)
    assert.equal(preview.status, 'PREVIEW_REQUIRED')

    const confirmed = await tool.handler(ctx, { ...intent, previewToken: preview.previewToken! })
    assert.equal(confirmed.status, 'SUCCESS')
    assert.equal(confirmed.data.committed, true)
    // RL-01：确认成功不得携带 previewToken（executor fail-closed 断言）
    assert.isUndefined(confirmed.previewToken)

    await a.refresh()
    await b.refresh()
    // 根任务移动到目标日期，下游依赖任务被自动顺延
    assert.equal(a.startDate?.toISODate(), '2026-07-06')
    assert.equal(a.endDate?.toISODate(), '2026-07-08')
    assert.equal(b.startDate?.toISODate(), '2026-07-09')
  })

  test('预览后篡改底表 → confirm 409 SCHEDULE_STALE 且事务回滚', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('write-stale') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project.settings = { workdays: [1, 2, 3, 4, 5], holidays: [] }
    await project.save()
    const a = await datedTask(project.id, 'A', '2026-07-06', '2026-07-06', 1)

    const tool = createUpdateTaskScheduleTool({ ganttSchedulingService: await ganttService() })
    const ctx = ctxFor(owner, org.id)
    const intent = {
      projectId: project.id,
      taskId: a.id,
      operation: 'move' as const,
      startDate: '2026-07-07',
      autoSchedule: true,
    }

    const preview = await tool.handler(ctx, intent)
    // 模拟并发修改：预览后底表被第三方改动
    a.name = '并发修改'
    await a.save()

    let caught: unknown = null
    try {
      await tool.handler(ctx, { ...intent, previewToken: preview.previewToken! })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ConflictException)
    if (caught instanceof ConflictException) {
      assert.equal(caught.code, 'SCHEDULE_STALE')
      assert.equal(caught.status, 409)
    }

    // 事务回滚：任务日期未被写入
    await a.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-06')
  })

  test('非法 previewToken 被拒绝（422），无 token 无落库路径', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('write-token') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project.settings = { workdays: [1, 2, 3, 4, 5], holidays: [] }
    await project.save()
    const a = await datedTask(project.id, 'A', '2026-07-06', '2026-07-06', 1)

    const tool = createUpdateTaskScheduleTool({ ganttSchedulingService: await ganttService() })
    const ctx = ctxFor(owner, org.id)
    const intent = {
      projectId: project.id,
      taskId: a.id,
      operation: 'move' as const,
      startDate: '2026-07-07',
      autoSchedule: true,
    }

    let caught: unknown = null
    try {
      await tool.handler(ctx, { ...intent, previewToken: 'not-a-hash' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ValidationException)
    await a.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-06')
  })

  test('写工具元数据契约（write + task:update）', async ({ assert }) => {
    const tool = createUpdateTaskScheduleTool({ ganttSchedulingService: await ganttService() })
    assert.equal(tool.sideEffect, 'write')
    assert.deepEqual([...tool.requiredPermissions], ['task:update'])
    const schema = tool.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    assert.equal((schema.properties?.operation as { enum?: unknown[] })?.enum?.[0], 'move')
    assert.isArray(schema.required)
    assert.include(schema.required ?? [], 'taskId')
  })
})
