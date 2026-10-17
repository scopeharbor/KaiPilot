// AI 同事：指派任务（改负责人两阶段）+ 成员代号 + 重复动作合并（真实 SQLite）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ConflictException, ValidationException } from '#exceptions/api_exception'
import ProjectMember from '#models/project_member'
import Task from '#models/task'
import type User from '#models/user'
import AiColleagueActionPlannerService from '#services/ai_colleague/action_planner_service'
import { createUpdateTaskAssigneeTool } from '#services/ai_tools/handlers/index'
import { memberAlias } from '#services/ai_colleague/member_alias'
import AiToolsExecutorService from '#services/ai_tools/ai_tools_executor_service'
import { aiToolsExecuteValidator } from '#validators/ai_tools_validator'
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
  const { project, role } = await createProjectWithMember(
    org,
    me,
    me,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const xiaoming = await createUser({ email: uniqueEmail(`${label}-xm`), fullName: '王小明' })
  await ProjectMember.create({
    projectId: project.id,
    userId: xiaoming.id,
    projectRoleId: role.id,
    isActive: true,
  })
  const outsider = await createUser({ email: uniqueEmail(`${label}-out`), fullName: '外人甲' })
  const task = await Task.create({
    projectId: project.id,
    name: '登录页开发',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
  })
  return { me, org, project, xiaoming, outsider, task }
}

function ctx(user: User, organizationId: number) {
  return { user, organizationId, requestId: 'assign-test' }
}

test.group('AI 同事：改负责人', (group) => {
  useAuthDatabase(group)

  test('预览零写入、带真实姓名给界面；确认后落库', async ({ assert }) => {
    const { me, org, project, xiaoming, task } = await setup('assign-ok')
    const tool = createUpdateTaskAssigneeTool()
    const preview = await tool.handler(ctx(me, org.id), {
      projectId: project.id,
      taskId: task.id,
      assigneeId: xiaoming.id,
    })
    assert.equal(preview.status, 'PREVIEW_REQUIRED')
    assert.deepInclude(preview.data as object, { taskName: '登录页开发', from: null, noop: false })
    assert.deepEqual((preview.data as { to: unknown }).to, {
      id: xiaoming.id,
      name: '王小明',
      alias: memberAlias(org.id, xiaoming.id),
    })
    await task.refresh()
    assert.isNull(task.assigneeId)

    const committed = await tool.handler(ctx(me, org.id), {
      projectId: project.id,
      taskId: task.id,
      assigneeId: xiaoming.id,
      previewToken: preview.previewToken!,
    })
    assert.equal(committed.status, 'SUCCESS')
    await task.refresh()
    assert.equal(Number(task.assigneeId), xiaoming.id)
  })

  test('非项目成员 → 422；预览后被改 → 409', async ({ assert }) => {
    const { me, org, project, xiaoming, outsider, task } = await setup('assign-bad')
    const tool = createUpdateTaskAssigneeTool()
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          projectId: project.id,
          taskId: task.id,
          assigneeId: outsider.id,
        }),
      ValidationException as never,
    )
    const preview = await tool.handler(ctx(me, org.id), {
      projectId: project.id,
      taskId: task.id,
      assigneeId: xiaoming.id,
    })
    task.assigneeId = me.id
    await task.save()
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          projectId: project.id,
          taskId: task.id,
          assigneeId: xiaoming.id,
          previewToken: preview.previewToken!,
        }),
      ConflictException as never,
    )
  })
})

test.group('AI 同事：取消指派（HTTP 全链路）', (group) => {
  useAuthDatabase(group)

  test('assigneeId: null 经 execute → confirm 落库为未指派（此前信封校验把 null 当缺失 422）', async ({
    assert,
  }) => {
    const { me, org, project, xiaoming, task } = await setup('unassign-http')
    task.assigneeId = xiaoming.id
    await task.save()
    const executor = await app.container.make(AiToolsExecutorService)
    const parameters = { projectId: project.id, taskId: task.id, assigneeId: null }
    const envelope = await aiToolsExecuteValidator.validate({
      toolName: 'update_task_assignee',
      parameters,
    })
    const preview = await executor.execute({
      toolName: envelope.toolName,
      parameters: envelope.parameters,
      user: me,
      organizationId: org.id,
      requestId: 'unassign-http',
    })
    assert.equal(preview.meta.status, 'PREVIEW_REQUIRED')
    const committed = await executor.confirm({
      toolName: 'update_task_assignee',
      previewToken: String(preview.previewToken),
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'unassign-http',
    })
    assert.isTrue(committed.meta.committed)
    await task.refresh()
    assert.isNull(task.assigneeId)
  })
})

test.group('AI 同事：指派的自然语言理解', (group) => {
  useAuthDatabase(group)

  test('模型只看到成员代号；界面拿到真实姓名；重复动作合并', async ({ assert }) => {
    const { me, org, project, xiaoming, task } = await setup('assign-plan')
    const planner = await app.container.make(AiColleagueActionPlannerService)
    let prompt = ''
    planner.adapterResolver = (async () => ({
      provider: 'fake',
      model: 'm',
      gateway: {
        generate: async (options: { promptSet?: { userPrompt: string } }) => {
          prompt = options.promptSet?.userPrompt ?? ''
          return {
            rawText: JSON.stringify({
              isAction: true,
              reply: `好的，交给${memberAlias(org.id, xiaoming.id)}`,
              actions: [
                { action: 'set_status', taskId: task.id, status: 'completed' },
                { action: 'set_status', taskId: task.id, status: 'completed' },
                { action: 'assign', taskId: task.id, member: memberAlias(org.id, xiaoming.id) },
              ],
            }),
            triggeredErrors: [],
          }
        },
      },
    })) as never
    const plan = await planner.plan({
      user: me,
      organizationId: org.id,
      projectId: project.id,
      text: '登录页打勾移到完成，然后指派给王小明',
    })
    // 模型看不到姓名
    assert.notInclude(prompt, '王小明')
    assert.notInclude(prompt, '赵经理')
    assert.include(prompt, `指派给${memberAlias(org.id, xiaoming.id)}`)
    assert.include(prompt, `"me":"${memberAlias(org.id, me.id)}"`)
    // 代号里看不出用户 ID
    assert.notInclude(prompt, `成员#${xiaoming.id}`)
    // 打勾 + 移到完成 合并成一条
    assert.deepEqual(
      plan.actions.map((action) => action.toolName),
      ['update_task_status', 'update_task_assignee'],
    )
    assert.deepEqual(plan.actions[1]!.parameters, {
      projectId: project.id,
      taskId: task.id,
      assigneeId: xiaoming.id,
    })
    // 给界面的文字是真实姓名
    assert.include(plan.actions[1]!.summary, '王小明')
    assert.equal(plan.reply, '好的，交给王小明')
  })
})
