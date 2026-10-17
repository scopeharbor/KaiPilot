// AI 同事：新建任务 / 勾选执行步骤（两阶段确认）——真实 SQLite。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { ConflictException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type User from '#models/user'
import AiToolsExecutorService from '#services/ai_tools/ai_tools_executor_service'
import { createCreateTaskTool, createToggleTaskStepsTool } from '#services/ai_tools/handlers/index'
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
  return { me, org, project }
}

function ctx(user: User, organizationId: number) {
  return { user, organizationId, requestId: 'create-steps-test' }
}

async function taskWithSteps(projectId: number, steps: string[], extra: Partial<Task> = {}) {
  return Task.create({
    projectId,
    name: '接口联调',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    description: `执行步骤：\n${steps.map((step) => `- [ ] ${step}`).join('\n')}`,
    customFields: { execution: { steps, stepsDone: steps.map(() => false) } },
    ...extra,
  })
}

test.group('AI 同事：新建任务', (group) => {
  useAuthDatabase(group)

  test('预览零写入；确认后新建（带负责人、日期与可打勾的执行步骤）', async ({ assert }) => {
    const { me, org, project } = await setup('create-ok')
    const executor = await app.container.make(AiToolsExecutorService)
    const parameters = {
      projectId: project.id,
      name: '接口联调',
      startDate: '2026-11-02',
      endDate: '2026-11-04',
      priority: 'high',
      assigneeId: me.id,
      steps: ['对齐字段', '联调登录'],
    }
    const before = await Task.query().where('project_id', project.id).count('* as total')
    const preview = await executor.execute({
      toolName: 'create_task',
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'create-ok',
    })
    assert.equal(preview.meta.status, 'PREVIEW_REQUIRED')
    assert.deepInclude(preview.data as object, {
      name: '接口联调',
      priorityLabel: '高',
      steps: ['对齐字段', '联调登录'],
    })
    const afterPreview = await Task.query().where('project_id', project.id).count('* as total')
    assert.equal(
      Number(afterPreview[0]!.$extras.total),
      Number(before[0]!.$extras.total),
      '预览不写库',
    )

    const committed = await executor.confirm({
      toolName: 'create_task',
      previewToken: String(preview.previewToken),
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'create-ok',
    })
    assert.isTrue(committed.meta.committed)
    const created = await Task.query()
      .where('project_id', project.id)
      .where('name', '接口联调')
      .firstOrFail()
    assert.equal(created.assigneeId, me.id)
    assert.equal(created.startDate?.toISODate(), '2026-11-02')
    assert.equal(created.priority, 'high')
    assert.include(created.description ?? '', '- [ ] 对齐字段')
    assert.deepEqual((created.customFields?.execution as { steps?: string[] } | undefined)?.steps, [
      '对齐字段',
      '联调登录',
    ])
  })

  test('确认时参数与预览不一致 → 拒绝；结束日早于开始日 → 拒绝', async ({ assert }) => {
    const { me, org, project } = await setup('create-bad')
    const tool = createCreateTaskTool()
    const preview = await tool.handler(ctx(me, org.id), { projectId: project.id, name: '甲' })
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          projectId: project.id,
          name: '乙',
          previewToken: preview.previewToken!,
        }),
      ValidationException as never,
    )
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          projectId: project.id,
          name: '丙',
          startDate: '2026-11-05',
          endDate: '2026-11-01',
        }),
      ValidationException as never,
    )
    const count = await Task.query().where('project_id', project.id).count('* as total')
    assert.equal(Number(count[0]!.$extras.total), 0)
  })
})

test.group('AI 同事：勾选执行步骤', (group) => {
  useAuthDatabase(group)

  test('第一次打勾转进行中、进度按比例；取消打勾回退进度', async ({ assert }) => {
    const { me, org, project } = await setup('steps-ok')
    const task = await taskWithSteps(project.id, ['一', '二', '三', '四'])
    const tool = createToggleTaskStepsTool()
    const params = { projectId: project.id, taskId: task.id, steps: [1, 2], done: true }
    const preview = await tool.handler(ctx(me, org.id), params)
    assert.equal(preview.status, 'PREVIEW_REQUIRED')
    assert.deepInclude(preview.data as object, {
      doneCount: 2,
      totalCount: 4,
      progressAfter: 50,
      statusTo: 'in_progress',
    })
    const untouched = await Task.findOrFail(task.id)
    assert.equal(untouched.status, 'not_started', '预览不写库')

    await tool.handler(ctx(me, org.id), { ...params, previewToken: preview.previewToken! })
    const ticked = await Task.findOrFail(task.id)
    assert.equal(ticked.status, 'in_progress')
    assert.equal(ticked.progressPercent, 50)
    assert.include(ticked.description ?? '', '- [x] 一')

    const undo = { projectId: project.id, taskId: task.id, steps: [2], done: false }
    const undoPreview = await tool.handler(ctx(me, org.id), undo)
    await tool.handler(ctx(me, org.id), { ...undo, previewToken: undoPreview.previewToken! })
    const unticked = await Task.findOrFail(task.id)
    assert.equal(unticked.progressPercent, 25)
    assert.equal(unticked.status, 'in_progress')
  })

  test('全部勾上转已完成，并按依赖往前拉后续任务（经执行器全链路）', async ({ assert }) => {
    const { me, org, project } = await setup('steps-cascade')
    const today = DateTime.now().startOf('day')
    const plannedEnd = today.plus({ days: 10 })
    const predecessor = await taskWithSteps(project.id, ['一', '二'], {
      status: 'in_progress',
      startDate: today,
      endDate: plannedEnd,
      durationDays: 10,
    } as Partial<Task>)
    const plannedStart = today.plus({ days: 15 })
    const successor = await Task.create({
      projectId: project.id,
      name: '后续',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: plannedStart,
      endDate: plannedStart.plus({ days: 4 }),
      durationDays: 4,
    })
    await TaskDependency.create({
      predecessorId: predecessor.id,
      successorId: successor.id,
      type: 'fs',
      lagDays: 0,
    })
    const executor = await app.container.make(AiToolsExecutorService)
    const parameters = { projectId: project.id, taskId: predecessor.id, all: true, done: true }
    const preview = await executor.execute({
      toolName: 'toggle_task_steps',
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'steps-cascade',
    })
    assert.deepInclude(preview.data as object, { statusTo: 'completed', progressAfter: 100 })
    const committed = await executor.confirm({
      toolName: 'toggle_task_steps',
      previewToken: String(preview.previewToken),
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'steps-cascade',
    })
    assert.isTrue(committed.meta.committed)
    const done = await Task.findOrFail(predecessor.id)
    assert.equal(done.status, 'completed')
    // 提前完成：后续任务被往前拉（与界面改状态同一条联动路径）
    const fresh = await Task.findOrFail(successor.id)
    assert.isTrue(fresh.startDate!.toISODate()! < plannedStart.toISODate()!)
  })

  test('没有步骤 / 序号越界 → 拒绝；预览后被改 → 409', async ({ assert }) => {
    const { me, org, project } = await setup('steps-bad')
    const tool = createToggleTaskStepsTool()
    const bare = await Task.create({
      projectId: project.id,
      name: '无步骤',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          projectId: project.id,
          taskId: bare.id,
          steps: [1],
          done: true,
        }),
      ValidationException as never,
    )
    const task = await taskWithSteps(project.id, ['一', '二'])
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          projectId: project.id,
          taskId: task.id,
          steps: [5],
          done: true,
        }),
      ValidationException as never,
    )
    const params = { projectId: project.id, taskId: task.id, steps: [1], done: true }
    const preview = await tool.handler(ctx(me, org.id), params)
    await db.from('tasks').where('id', task.id).update({ updated_at: '2030-01-01 00:00:00' })
    await assert.rejects(
      () => tool.handler(ctx(me, org.id), { ...params, previewToken: preview.previewToken! }),
      ConflictException as never,
    )
  })

  test('操作理解：新建落在当前项目、负责人代号与父任务校验；勾选只认清单里的任务与步骤', ({
    assert,
  }) => {
    const tasks = [
      {
        id: 551,
        name: '接口联调',
        status: 'not_started',
        startDate: null,
        endDate: null,
        projectId: 7,
        code: 'PROJ-7#551',
        steps: [
          { n: 1, text: '一', done: false },
          { n: 2, text: '二', done: false },
        ],
      },
    ]
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'create_task', name: '写测试', parentTaskId: 551, steps: ['列用例', ''] },
          { action: 'create_task', name: '越权', projectId: 99 },
          { action: 'toggle_steps', taskId: 551, steps: [2, 9], done: true },
          { action: 'toggle_steps', taskId: 551, done: 'yes' },
          { action: 'toggle_steps', taskId: 999, all: true, done: false },
        ],
      },
      { projectId: 7, tasks, projects: [] },
    )
    assert.deepEqual(
      plan.actions.map((action) => [action.toolName, action.parameters]),
      [
        ['create_task', { projectId: 7, name: '写测试', parentTaskId: 551, steps: ['列用例'] }],
        ['toggle_task_steps', { projectId: 7, taskId: 551, done: true, steps: [2] }],
      ],
    )
    assert.lengthOf(plan.rejected, 3)
  })
})
