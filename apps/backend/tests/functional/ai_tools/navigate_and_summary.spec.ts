// v3-ai-tools-orchestration-layer W2 —— `navigate_to_space` 与 `get_project_summary` 功能测试
//
// 覆盖（tasks.md 2.3）：
// - navigate_to_space 返回标准空间坐标与路由路径，数据库零写入；
// - get_project_summary 正确计算任务总数/完成数/进度百分比；
// - 跨组织访问一律 404（RL-05），不泄露资源存在性。
//
// 说明：permission 门禁（403）在 W1 AiToolsPolicy + 编排层执行；本文件在
// handler 边界断言元数据契约（requiredPermissions/sideEffect）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import Task from '#models/task'
import type User from '#models/user'
import { AiToolsRegistry } from '#services/ai_tools/registry'
import ProjectService from '#services/project_service'
import TaskService from '#services/task_service'
import {
  AI_TOOLS_NAMES,
  createGetProjectSummaryTool,
  createNavigateToSpaceTool,
} from '#services/ai_tools/handlers/index'
import type { ToolExecutionContext } from '#services/ai_tools/handlers/index'
import { ProjectRoleName } from '#rbac'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken as string
}

async function deps() {
  return {
    projectService: await app.container.make(ProjectService),
    taskService: await app.container.make(TaskService),
  }
}

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'navigate-summary-test' }
}

async function datedTask(
  projectId: number,
  name: string,
  startDate: string,
  endDate: string,
  status: string,
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
  })
}

test.group('AI tools: navigate_to_space & get_project_summary', (group) => {
  useAuthDatabase(group)

  test('navigate_to_space 返回正确坐标与路由且零写入', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('nav-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)
    const before = await Task.query().count('* as total')

    const result = await tool.handler(ctx, { projectId: project.id, lens: 'gantt' })
    assert.equal(result.status, 'SUCCESS')
    assert.deepEqual(result.data, {
      projectId: project.id,
      lens: 'gantt',
      depth: 'workbench',
      targetId: null,
      path: `/projects/${project.id}/gantt`,
    })

    const withTarget = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'wbs',
      targetId: 42,
    })
    assert.equal(withTarget.data.path, `/projects/${project.id}/wbs/42`)
    assert.equal(withTarget.data.targetId, 42)

    const after = await Task.query().count('* as total')
    assert.equal(Number(after[0]?.$extras?.total ?? 0), Number(before[0]?.$extras?.total ?? 0))
  })

  test('navigate_to_space lens=charts 直达图表馆目录与具体图表深层路由（v3-ui-next-chart-gallery）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-charts') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 无 chart 参数：直达项目级图表馆目录（新轨深层路由）
    const directory = await tool.handler(ctx, { projectId: project.id, lens: 'charts' })
    assert.equal(directory.status, 'SUCCESS')
    assert.deepEqual(directory.data, {
      projectId: project.id,
      lens: 'charts',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/charts`,
    })

    // chart 参数：直达具体图表镜头
    const fishbone = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'charts',
      chart: 'fishbone',
    })
    assert.equal(fishbone.data.path, `/next/projects/${project.id}/charts/fishbone`)

    const resourceLoad = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'charts',
      chart: 'resource-load',
    })
    assert.equal(resourceLoad.data.path, `/next/projects/${project.id}/charts/resource-load`)

    // 非 charts 镜头不受 chart 参数影响（沿用旧轨路径拼装）
    const gantt = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'gantt',
      chart: 'fishbone',
    })
    assert.equal(gantt.data.path, `/projects/${project.id}/gantt`)
  })

  test('navigate_to_space 图表馆镜头白名单与 chart 参数 schema 契约', async ({ assert }) => {
    const { projectService } = await deps()
    const tool = createNavigateToSpaceTool({ projectService })
    const schema = tool.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    const lensEnum = (schema.properties?.lens as { enum?: string[] })?.enum
    assert.isArray(lensEnum)
    assert.isTrue(lensEnum?.includes('charts'))
    assert.isTrue(lensEnum?.includes('kanban'))
    const chartEnum = (schema.properties?.chart as { enum?: string[] })?.enum
    assert.isArray(chartEnum)
    assert.isTrue(chartEnum?.includes('fishbone'))
    assert.isTrue(chartEnum?.includes('resource-load'))
    assert.isTrue(chartEnum?.includes('kanban'))
  })

  test('navigate_to_space lens=reports 收录白名单并返回规范路径（v3-ui-next-reports-domain）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-reports') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 无附加参数：直达报表中心主页（规范路径）
    const plain = await tool.handler(ctx, { projectId: project.id, lens: 'reports' })
    assert.equal(plain.status, 'SUCCESS')
    assert.deepEqual(plain.data, {
      projectId: project.id,
      lens: 'reports',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/reports`,
    })

    // 周报意图深链：tab + template 拼装查询串（前端 rule_nav_periodic_weekly 契约）
    const weekly = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'reports',
      tab: 'periodic',
      template: 'weekly-ai-summary',
    })
    assert.equal(
      weekly.data.path,
      `/next/projects/${project.id}/reports?tab=periodic&template=weekly-ai-summary`,
    )

    const monthly = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'reports',
      tab: 'periodic',
      template: 'monthly-ai-summary',
    })
    assert.equal(
      monthly.data.path,
      `/next/projects/${project.id}/reports?tab=periodic&template=monthly-ai-summary`,
    )

    // 非法 tab 防御：handler 丢弃越界值，合法 template 保留（不整串拒绝）
    const dirty = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'reports',
      tab: 'hacked',
      template: 'weekly-ai-summary',
    })
    assert.equal(dirty.data.path, `/next/projects/${project.id}/reports?template=weekly-ai-summary`)
    const dirtyBoth = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'reports',
      tab: 'hacked',
      template: 'hack',
    })
    assert.equal(dirtyBoth.data.path, `/next/projects/${project.id}/reports`)

    // 非 reports 镜头不受 tab 参数影响（沿用旧轨路径拼装）
    const gantt = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'gantt',
      tab: 'periodic',
    })
    assert.equal(gantt.data.path, `/projects/${project.id}/gantt`)
  })

  test('navigate_to_space lens=risks/change_requests 收录白名单并返回新轨治理功能域深层路由（v3-ui-next-risk-change-domains）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-domains') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 风险管理：新轨深层路由 /next/projects/:id/risks（不属于 LensSwitcher 排程镜头）
    const risks = await tool.handler(ctx, { projectId: project.id, lens: 'risks' })
    assert.equal(risks.status, 'SUCCESS')
    assert.deepEqual(risks.data, {
      projectId: project.id,
      lens: 'risks',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/risks`,
    })

    // 变更请求：新轨深层路由 /next/projects/:id/change-requests
    const changeRequests = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'change_requests',
    })
    assert.equal(changeRequests.status, 'SUCCESS')
    assert.deepEqual(changeRequests.data, {
      projectId: project.id,
      lens: 'change_requests',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/change-requests`,
    })

    // 治理功能域忽略 targetId / chart 等镜头专属参数（路径恒为功能域主页）
    const withTarget = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'risks',
      targetId: 42,
      chart: 'fishbone',
    })
    assert.equal(withTarget.data.path, `/next/projects/${project.id}/risks`)
    assert.equal(withTarget.data.targetId, 42)
  })

  test('navigate_to_space lens=resources/members/files 收录白名单并返回新轨协同功能域深层路由（v3-ui-next-resource-team-domains）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-team-domains') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 资源工作台：新轨深层路由 /next/projects/:id/resources
    const resources = await tool.handler(ctx, { projectId: project.id, lens: 'resources' })
    assert.equal(resources.status, 'SUCCESS')
    assert.deepEqual(resources.data, {
      projectId: project.id,
      lens: 'resources',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/resources`,
    })

    // 成员团队：新轨深层路由 /next/projects/:id/members
    const members = await tool.handler(ctx, { projectId: project.id, lens: 'members' })
    assert.equal(members.status, 'SUCCESS')
    assert.deepEqual(members.data, {
      projectId: project.id,
      lens: 'members',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/members`,
    })

    // 项目文件库：新轨深层路由 /next/projects/:id/files
    const files = await tool.handler(ctx, { projectId: project.id, lens: 'files' })
    assert.equal(files.status, 'SUCCESS')
    assert.deepEqual(files.data, {
      projectId: project.id,
      lens: 'files',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/files`,
    })

    // 协同功能域忽略 targetId / chart 等镜头专属参数（路径恒为功能域主页）
    const withTarget = await tool.handler(ctx, {
      projectId: project.id,
      lens: 'members',
      targetId: 42,
      chart: 'fishbone',
    })
    assert.equal(withTarget.data.path, `/next/projects/${project.id}/members`)
    assert.equal(withTarget.data.targetId, 42)

    // 非协同镜头不受影响（沿用旧轨路径拼装）
    const gantt = await tool.handler(ctx, { projectId: project.id, lens: 'gantt' })
    assert.equal(gantt.data.path, `/projects/${project.id}/gantt`)
  })

  test('navigate_to_space 报表中心镜头 schema 契约（lens 白名单 + tab/template enum）', async ({
    assert,
  }) => {
    const { projectService } = await deps()
    const tool = createNavigateToSpaceTool({ projectService })
    const schema = tool.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    const lensEnum = (schema.properties?.lens as { enum?: string[] })?.enum
    assert.isArray(lensEnum)
    assert.isTrue(lensEnum?.includes('reports'))
    assert.isTrue(lensEnum?.includes('charts'))
    assert.isTrue(lensEnum?.includes('kanban'))
    // v3-ui-next-risk-change-domains：两治理功能域镜头收录进白名单
    assert.isTrue(lensEnum?.includes('risks'))
    assert.isTrue(lensEnum?.includes('change_requests'))
    // v3-ui-next-resource-team-domains：协同管理三功能域镜头收录进白名单
    assert.isTrue(lensEnum?.includes('resources'))
    assert.isTrue(lensEnum?.includes('members'))
    assert.isTrue(lensEnum?.includes('files'))
    const tabEnum = (schema.properties?.tab as { enum?: string[] })?.enum
    assert.isArray(tabEnum)
    assert.isTrue(tabEnum?.includes('periodic'))
    assert.isTrue(tabEnum?.includes('versions'))
    const templateEnum = (schema.properties?.template as { enum?: string[] })?.enum
    assert.isArray(templateEnum)
    assert.isTrue(templateEnum?.includes('weekly-ai-summary'))
    assert.isTrue(templateEnum?.includes('monthly-ai-summary'))
    assert.deepEqual(schema.required, ['lens'])
  })

  test('navigate_to_space 对跨组织项目一律 404（RL-05）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('nav-orga') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('nav-orgb') })
    const orgB = await createOrganization(outsider)

    const tool = createNavigateToSpaceTool(await deps())
    let caught: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), { projectId: project.id, lens: 'kanban' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('get_project_summary 正确计算任务总数与完成率', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('summary-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await datedTask(project.id, '已完成任务', '2026-07-01', '2026-07-03', 'completed')
    await datedTask(project.id, '进行中任务', '2026-07-06', '2026-07-10', 'in_progress')
    project.progressPercent = 35
    project.startDate = DateTime.fromISO('2026-07-01')
    project.endDate = DateTime.fromISO('2026-07-31')
    await project.save()

    const tool = createGetProjectSummaryTool(await deps())
    const result = await tool.handler(ctxFor(owner, org.id), { projectId: project.id })

    assert.equal(result.status, 'SUCCESS')
    assert.equal(result.data.id, project.id)
    assert.equal(result.data.name, project.name)
    assert.equal(result.data.taskCount, 2)
    assert.equal(result.data.completedTaskCount, 1)
    assert.equal(result.data.progressPercent, 35)
    assert.equal(result.data.memberCount, 1)
    assert.equal(result.data.startDate, '2026-07-01')
    assert.equal(result.data.endDate, '2026-07-31')
  })

  test('get_project_summary 对跨组织项目一律 404（RL-05）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('summary-orga') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('summary-orgb') })
    const orgB = await createOrganization(outsider)

    const tool = createGetProjectSummaryTool(await deps())
    let caught: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), { projectId: project.id })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('导航与摘要工具元数据契约（navigate/read + project:view）', async ({ assert }) => {
    const { projectService, taskService } = await deps()
    const navigate = createNavigateToSpaceTool({ projectService })
    const summary = createGetProjectSummaryTool({ projectService, taskService })

    assert.equal(navigate.sideEffect, 'navigate')
    assert.equal(summary.sideEffect, 'read')
    assert.deepEqual([...navigate.requiredPermissions], ['project:view'])
    assert.deepEqual([...summary.requiredPermissions], ['project:view'])
    assert.isTrue(typeof navigate.description === 'string' && navigate.description.length > 0)
    const schema = navigate.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    assert.isDefined(schema.properties?.projectId)
    assert.isArray((schema.properties?.lens as { enum?: unknown[] })?.enum)
  })

  test('handlers/index 静态装配：在册工具与白名单一致且注册表已 seal（RL-14 接线自证）', async ({
    assert,
  }) => {
    // 本 spec import handlers/index 已触发模块级 register + seal
    const registry = AiToolsRegistry.getInstance()
    const metadata = registry.getAllMetadata()
    const names = metadata.map((tool) => tool.name).sort()
    // 校验口径：与静态白名单逐条一致（W2b 之后为 13 = 既有 8 + TRIZ 5），
    // 用白名单比对而非硬编码条数，后续波次新增工具时此处无需再改。
    assert.deepEqual(names, [...AI_TOOLS_NAMES].sort())
    for (const legacy of [
      'get_gantt_snapshot',
      'get_project_summary',
      'get_task_detail',
      'list_project_risks',
      'list_project_tasks',
      'navigate_to_space',
      'search_projects_tasks',
      'update_task_schedule',
    ]) {
      assert.include(names, legacy, `既有工具「${legacy}」仍在册且行为不变`)
    }
    assert.isTrue(registry.isSealed())
    const writeTool = metadata.find((tool) => tool.name === 'update_task_schedule')
    assert.equal(writeTool?.sideEffect, 'write')
    const navigateTool = metadata.find((tool) => tool.name === 'navigate_to_space')
    assert.equal(navigateTool?.sideEffect, 'navigate')
  })

  test('经 execute 端点调用 navigate_to_space { lens: "help" }（无 projectId）成功返回 /next/help（M-1 回归）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('schema-gate-help-owner') })
    const org = await createOrganization(owner)
    await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'navigate_to_space',
        parameters: { lens: 'help' },
      })

    response.assertStatus(200)
    const body = response.body()
    assert.equal(body.meta?.status, 'SUCCESS')
    assert.equal(body.data?.path, '/next/help')
    assert.isNull(body.data?.projectId)
    assert.equal(body.data?.lens, 'help')
  })

  test('经 execute 端点调用 navigate_to_space { lens: "gantt" }（无 projectId）触发 422 VALIDATION_ERROR（M-1 回归）', async ({
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('schema-gate-gantt-owner') })
    const org = await createOrganization(owner)
    await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'navigate_to_space',
        parameters: { lens: 'gantt' },
      })

    response.assertStatus(422)
    response.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })
})
