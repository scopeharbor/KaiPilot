// AI 同事：删除任务（移入回收站，两阶段确认）——真实 SQLite。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { ConflictException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import type User from '#models/user'
import AiToolsExecutorService from '#services/ai_tools/ai_tools_executor_service'
import { createDeleteTaskTool } from '#services/ai_tools/handlers/index'
import { normalizePlannedActions } from '#services/ai_colleague/action_planner_service'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function setup(label: string) {
  const me = await createUser({ email: uniqueEmail(label), fullName: '赵经理' })
  const org = await createOrganization(me)
  const { project } = await createProjectWithMember(org, me, me, ProjectRoleName.PROJECT_MANAGER)
  const task = await Task.create({
    projectId: project.id,
    name: '123',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
  })
  return { me, org, project, task }
}

function ctx(user: User, organizationId: number) {
  return { user, organizationId, requestId: 'delete-test' }
}

async function isDeleted(taskId: number): Promise<boolean> {
  const row = await Task.queryWithTrashed().where('id', taskId).first()
  return Boolean(row?.deleted_at ?? (row as unknown as { deletedAt?: unknown })?.deletedAt)
}

test.group('AI 同事：删除任务', (group) => {
  useAuthDatabase(group)

  test('预览零写入、带影响说明；确认后移入回收站（经执行器全链路）', async ({ assert }) => {
    const { me, org, project, task } = await setup('delete-ok')
    const executor = await app.container.make(AiToolsExecutorService)
    const parameters = { projectId: project.id, taskId: task.id }
    const preview = await executor.execute({
      toolName: 'delete_task',
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'delete-ok',
    })
    assert.equal(preview.meta.status, 'PREVIEW_REQUIRED')
    assert.deepInclude(preview.data as object, {
      taskName: '123',
      restoreWindowDays: 30,
      successorCount: 0,
    })
    assert.isFalse(await isDeleted(task.id))

    const committed = await executor.confirm({
      toolName: 'delete_task',
      previewToken: String(preview.previewToken),
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'delete-ok',
    })
    assert.isTrue(committed.meta.committed)
    assert.isTrue(await isDeleted(task.id))
  })

  test('有子任务时预览即拒绝；预览后任务被改 → 409', async ({ assert }) => {
    const { me, org, project, task } = await setup('delete-bad')
    await Task.create({
      projectId: project.id,
      parentTaskId: task.id,
      name: '子任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const tool = createDeleteTaskTool()
    await assert.rejects(
      () => tool.handler(ctx(me, org.id), { projectId: project.id, taskId: task.id }),
      ValidationException as never,
    )

    const lone = await Task.create({
      projectId: project.id,
      name: '独立任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const preview = await tool.handler(ctx(me, org.id), { projectId: project.id, taskId: lone.id })
    // 模拟预览后被别人改过（直接改 updated_at：SQLite 时间戳只到秒，save 会覆盖成同一秒）
    await db
      .from('tasks')
      .where('id', lone.id)
      .update({ name: '独立任务（改名）', updated_at: '2030-01-01 00:00:00' })
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          projectId: project.id,
          taskId: lone.id,
          previewToken: preview.previewToken!,
        }),
      ConflictException as never,
    )
    assert.isFalse(await isDeleted(lone.id))
  })

  test('操作理解：只认任务清单里的任务，按任务所属项目删除', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'delete_task', taskId: 551 },
          { action: 'delete_task', taskId: 999 },
        ],
      },
      {
        projectId: null,
        tasks: [
          {
            id: 551,
            name: '123',
            status: 'not_started',
            startDate: null,
            endDate: null,
            projectId: 7,
            code: 'PROJ-7#551',
          },
        ],
      },
    )
    assert.deepEqual(
      plan.actions.map((action) => [action.toolName, action.parameters]),
      [['delete_task', { projectId: 7, taskId: 551 }]],
    )
    assert.include(plan.actions[0]!.summary, '回收站')
    assert.lengthOf(plan.rejected, 1)
  })
})
