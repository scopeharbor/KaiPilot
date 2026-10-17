// AI 同事自然语言操作 —— 写工具 `update_task_status` 两阶段功能测试
//
// 覆盖：
// - execute 只产出 PREVIEW_REQUIRED + previewToken + 前后差异，任务表零写入（RL-01）；
// - 状态机不允许直达时给出中间路径（未开始 → 进行中 → 已完成），确认后按路径落库；
// - 预览后任务被改动 → confirm 409 SCHEDULE_STALE 且不写入；
// - 跨组织任务不可见；非法目标状态 422；元数据契约 sideEffect 'write' + task:update。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import AiColleagueActionPlannerService from '#services/ai_colleague/action_planner_service'
import { ConflictException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import type User from '#models/user'
import { createUpdateTaskStatusTool } from '#services/ai_tools/handlers/index'
import type { ToolExecutionContext } from '#services/ai_tools/handlers/index'
import { ProjectRoleName, TASK_UPDATE } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'task-status-tool-test' }
}

async function setup(label: string) {
  const owner = await createUser({ email: uniqueEmail(label) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const task = await Task.create({
    projectId: project.id,
    name: '登录页开发',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
  })
  return { owner, org, project, task }
}

test.group('AI tools: update_task_status 两阶段', (group) => {
  useAuthDatabase(group)

  test('元数据契约：写工具 + task:update', ({ assert }) => {
    const tool = createUpdateTaskStatusTool()
    assert.equal(tool.name, 'update_task_status')
    assert.equal(tool.sideEffect, 'write')
    assert.deepEqual([...tool.requiredPermissions], [TASK_UPDATE])
  })

  test('execute 只出预览与中间路径，零写入；confirm 按路径落库', async ({ assert }) => {
    const { owner, org, project, task } = await setup('status-preview')
    const tool = createUpdateTaskStatusTool()

    const preview = await tool.handler(ctxFor(owner, org.id), {
      projectId: project.id,
      taskId: task.id,
      status: 'completed',
    })
    assert.equal(preview.status, 'PREVIEW_REQUIRED')
    assert.match(preview.previewToken ?? '', /^[0-9a-f]{64}$/)
    assert.deepInclude(preview.data as object, {
      taskId: task.id,
      taskName: '登录页开发',
      from: 'not_started',
      to: 'completed',
      path: ['in_progress', 'completed'],
      pathLabels: ['进行中', '已完成'],
      noop: false,
    })
    await task.refresh()
    assert.equal(task.status, 'not_started')

    const committed = await tool.handler(ctxFor(owner, org.id), {
      projectId: project.id,
      taskId: task.id,
      status: 'completed',
      previewToken: preview.previewToken!,
    })
    assert.equal(committed.status, 'SUCCESS')
    assert.isUndefined(committed.previewToken)
    await task.refresh()
    assert.equal(task.status, 'completed')
  })

  test('预览后任务被改动 → 409 SCHEDULE_STALE，不写入', async ({ assert }) => {
    const { owner, org, project, task } = await setup('status-stale')
    const tool = createUpdateTaskStatusTool()
    const preview = await tool.handler(ctxFor(owner, org.id), {
      projectId: project.id,
      taskId: task.id,
      status: 'in_progress',
    })
    task.status = 'cancelled'
    await task.save()

    try {
      await tool.handler(ctxFor(owner, org.id), {
        projectId: project.id,
        taskId: task.id,
        status: 'in_progress',
        previewToken: preview.previewToken!,
      })
      assert.fail('应抛出 409')
    } catch (error) {
      assert.instanceOf(error, ConflictException)
      assert.equal((error as ConflictException).code, 'SCHEDULE_STALE')
    }
    await task.refresh()
    assert.equal(task.status, 'cancelled')
  })

  test('跨组织任务不可见；非法状态 422', async ({ assert }) => {
    const { project, task } = await setup('status-owner')
    const stranger = await createUser({ email: uniqueEmail('status-stranger') })
    const otherOrg = await createOrganization(stranger)
    const tool = createUpdateTaskStatusTool()

    await assert.rejects(() =>
      tool.handler(ctxFor(stranger, otherOrg.id), {
        projectId: project.id,
        taskId: task.id,
        status: 'completed',
      }),
    )
    await assert.rejects(
      () =>
        tool.handler(ctxFor(stranger, otherOrg.id), {
          projectId: project.id,
          taskId: task.id,
          status: 'done' as never,
        }),
      ValidationException as never,
    )
  })
})

test.group('AI 同事操作计划：服务端理解与校验', (group) => {
  useAuthDatabase(group)

  test('用模型理解一句话，丢弃不在本项目的任务，零写入', async ({ assert }) => {
    const { owner, org, project, task } = await setup('planner-ok')
    const planner = await app.container.make(AiColleagueActionPlannerService)
    let captured = ''
    planner.adapterResolver = (async () => ({
      provider: 'fake',
      model: 'planner',
      gateway: {
        generate: async (options: { promptSet?: { userPrompt: string } }) => {
          captured = options.promptSet?.userPrompt ?? ''
          return {
            rawText: JSON.stringify({
              isAction: true,
              reply: '好的',
              actions: [
                { action: 'set_status', taskId: task.id, status: 'completed' },
                { action: 'set_status', taskId: 999999, status: 'completed' },
                { action: 'navigate', lens: 'gantt' },
              ],
            }),
            triggeredErrors: [],
          }
        },
      },
    })) as never

    const plan = await planner.plan({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      text: '把登录页勾掉，再打开甘特图',
    })
    assert.include(captured, '登录页开发')
    assert.equal(plan.model, 'fake/planner')
    assert.deepEqual(
      plan.actions.map((action) => action.toolName),
      ['update_task_status', 'navigate_to_space'],
    )
    assert.lengthOf(plan.rejected, 1)
    await task.refresh()
    assert.equal(task.status, 'not_started')
  })

  test('其他组织的项目不可见', async ({ assert }) => {
    const { project } = await setup('planner-owner')
    const stranger = await createUser({ email: uniqueEmail('planner-stranger') })
    const otherOrg = await createOrganization(stranger)
    const planner = await app.container.make(AiColleagueActionPlannerService)
    planner.adapterResolver = (async () => {
      throw new Error('不应调用模型')
    }) as never
    await assert.rejects(() =>
      planner.plan({
        user: stranger,
        organizationId: otherOrg.id,
        projectId: project.id,
        text: '把任务勾掉',
      }),
    )
  })

  test('原生工具方式：按连接配置走 callTools，结果与 Prompt + JSON 同一套校验', async ({
    assert,
  }) => {
    const { owner, org, project, task } = await setup('planner-native')
    const planner = await app.container.make(AiColleagueActionPlannerService)
    let calledApi = ''
    let generateCalled = false
    planner.adapterResolver = (async () => ({
      provider: 'fake',
      model: 'claude',
      toolCallingMode: 'anthropic_tool_use',
      gateway: {
        callTools: async (options: { api: string; tools: { name: string }[] }) => {
          calledApi = options.api
          assert.includeMembers(
            options.tools.map((t) => t.name),
            ['set_task_status', 'reschedule_task', 'open_page', 'ask_clarification'],
          )
          return {
            text: '',
            toolCalls: [
              {
                id: 't1',
                name: 'set_task_status',
                arguments: { taskId: task.id, status: 'in_progress' },
              },
            ],
          }
        },
        generate: async () => {
          generateCalled = true
          return { rawText: '{}', triggeredErrors: [] }
        },
      },
    })) as never
    const plan = await planner.plan({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      text: '把登录页移到进行中',
    })
    assert.equal(calledApi, 'anthropic_messages')
    assert.isFalse(generateCalled)
    assert.equal(plan.toolCallingMode, 'anthropic_tool_use')
    assert.isNull(plan.fallbackReason)
    assert.deepEqual(plan.actions[0]!.parameters, {
      projectId: project.id,
      taskId: task.id,
      status: 'in_progress',
    })
  })

  test('原生方式失败 → 自动回退 Prompt + JSON，并如实给出原因', async ({ assert }) => {
    const { owner, org, project, task } = await setup('planner-fallback')
    const planner = await app.container.make(AiColleagueActionPlannerService)
    planner.adapterResolver = (async () => ({
      provider: 'fake',
      model: 'deepseek',
      toolCallingMode: 'openai_responses_tools',
      gateway: {
        callTools: async () => {
          throw Object.assign(new Error('Not Found'), { status: 404 })
        },
        generate: async () => ({
          rawText: JSON.stringify({
            isAction: true,
            actions: [{ action: 'set_status', taskId: task.id, status: 'completed' }],
          }),
          triggeredErrors: [],
        }),
      },
    })) as never
    const plan = await planner.plan({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      text: '把登录页勾掉',
    })
    assert.equal(plan.requestedToolCallingMode, 'openai_responses_tools')
    assert.equal(plan.toolCallingMode, 'prompt_json')
    assert.include(plan.fallbackReason ?? '', 'HTTP 404')
    assert.lengthOf(plan.actions, 1)
  })

  test('不在项目空间：只提供全局工具，按应用地图打开页面', async ({ assert }) => {
    const { owner, org } = await setup('planner-global')
    const planner = await app.container.make(AiColleagueActionPlannerService)
    let toolNames: string[] = []
    planner.adapterResolver = (async () => ({
      provider: 'fake',
      model: 'gpt',
      toolCallingMode: 'openai_chat_tools',
      gateway: {
        callTools: async (options: { tools: { name: string }[]; userPrompt: string }) => {
          toolNames = options.tools.map((tool) => tool.name)
          assert.include(options.userPrompt, 'AI 连接')
          return {
            text: '',
            toolCalls: [
              {
                id: 'c1',
                name: 'open_destination',
                arguments: { destinationId: 'settings:ai-connections' },
              },
              { id: 'c2', name: 'set_ui_preference', arguments: { theme: 'dark' } },
            ],
          }
        },
      },
    })) as never
    const plan = await planner.plan({
      user: owner,
      organizationId: org.id,
      projectId: null,
      text: '带我到模型配置页面，顺便切成深色',
      appDestinations: [
        {
          id: 'settings:ai-connections',
          title: 'AI 连接',
          group: '设置 · AI 与集成',
          path: '/next/settings/ai-connections',
        },
      ],
    })
    // 不在项目空间：没有 open_page / list_tasks（只作用于当前项目），其余都可用
    assert.sameMembers(toolNames, [
      'set_task_status',
      'reschedule_task',
      'show_task_detail',
      'assign_task',
      'open_task',
      'list_my_work',
      'open_destination',
      'open_project',
      'create_project',
      'delete_task',
      'create_task',
      'toggle_task_steps',
      'project_summary',
      'list_risks',
      'look_at_page',
      'sign_out',
      'search_entities',
      'set_ui_preference',
      'change_setting',
      'ask_clarification',
    ])
    assert.deepEqual(
      plan.actions.map((action) => action.toolName),
      ['open_app_page', 'set_ui_preference'],
    )
    assert.equal(plan.actions[0]!.parameters.path, '/next/settings/ai-connections')
  })
})
