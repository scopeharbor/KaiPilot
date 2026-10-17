// v3-ai-tools-orchestration-layer W2 —— `search_projects_tasks` 功能测试
//
// 覆盖（tasks.md 2.9）：
// - 关键词匹配项目与任务；
// - 租户隔离：绝不返回其他组织的数据（RL-05）；
// - 分页参数生效。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import Task from '#models/task'
import type User from '#models/user'
import SearchService from '#services/search_service'
import SearchPolicy from '#policies/search_policy'
import { createSearchProjectsTasksTool } from '#services/ai_tools/handlers/index'
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
    searchService: await app.container.make(SearchService),
    searchPolicy: await app.container.make(SearchPolicy),
  }
}

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'search-tool-test' }
}

async function datedTask(projectId: number, name: string, startDate: string, endDate: string) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: DateTime.fromISO(startDate),
    endDate: DateTime.fromISO(endDate),
    durationDays: 2,
  })
}

test.group('AI tools: search_projects_tasks', (group) => {
  useAuthDatabase(group)

  test('按关键词命中组织内项目与任务', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('search-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project.name = '支付联调项目'
    await project.save()
    await datedTask(project.id, '支付联调联调任务', '2026-07-01', '2026-07-10')
    await datedTask(project.id, '无关渲染任务', '2026-07-01', '2026-07-10')

    const tool = createSearchProjectsTasksTool(await deps())
    const result = await tool.handler(ctxFor(owner, org.id), { keyword: '支付联调', perPage: 20 })

    assert.equal(result.status, 'SUCCESS')
    assert.isTrue(result.data.items.length >= 2, '应同时命中项目与任务')
    const entityTypes = new Set(result.data.items.map((item) => item.entityType))
    assert.isTrue(entityTypes.has('project'))
    assert.isTrue(entityTypes.has('task'))
    assert.isTrue(
      result.data.items.every((item) => ['支付联调项目', '支付联调联调任务'].includes(item.title)),
    )
    assert.isTrue(result.data.items.every((item) => item.score > 0))
  })

  test('租户隔离：绝不返回其他组织的数据（RL-05）', async ({ assert }) => {
    // 组织 A：调用方可见项目 + 任务
    const userA = await createUser({ email: uniqueEmail('search-a') })
    const orgA = await createOrganization(userA)
    const { project: projectA } = await createProjectWithMember(
      orgA,
      userA,
      userA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    projectA.name = '支付联调项目A'
    projectA.code = `PA${projectA.id}`
    await projectA.save()
    const taskA = await datedTask(projectA.id, '支付联调任务A', '2026-07-01', '2026-07-10')

    // 组织 B：同关键词数据，调用方在组织 A 不可见
    const ownerB = await createUser({ email: uniqueEmail('search-b-owner') })
    const orgB = await createOrganization(ownerB)
    const { project: projectBVisible } = await createProjectWithMember(
      orgB,
      ownerB,
      ownerB,
      ProjectRoleName.PROJECT_MANAGER,
    )
    projectBVisible.name = '支付联调项目B'
    projectBVisible.code = `PBV${projectBVisible.id}`
    await projectBVisible.save()
    const taskB = await datedTask(projectBVisible.id, '支付联调任务B', '2026-07-01', '2026-07-10')

    // 组织 B 中用户 A 不是成员的项目（不可见项目不得通过任务结果泄露）
    const { project: projectBHidden } = await createProjectWithMember(
      orgB,
      ownerB,
      ownerB,
      ProjectRoleName.PROJECT_MANAGER,
    )
    projectBHidden.name = '支付联调隐藏项目B'
    projectBHidden.code = `PBH${projectBHidden.id}`
    await projectBHidden.save()
    const taskBHidden = await datedTask(
      projectBHidden.id,
      '支付联调隐藏任务B',
      '2026-07-01',
      '2026-07-10',
    )

    const tool = createSearchProjectsTasksTool(await deps())
    const result = await tool.handler(ctxFor(userA, orgA.id), { keyword: '支付联调', perPage: 50 })

    assert.equal(result.status, 'SUCCESS')
    const ids = new Set(result.data.items.map((item) => `${item.entityType}:${item.entityId}`))
    assert.isTrue(ids.has(`project:${projectA.id}`))
    assert.isTrue(ids.has(`task:${taskA.id}`))
    // 组织 B 的任何实体绝不出现
    assert.isFalse(ids.has(`project:${projectBVisible.id}`))
    assert.isFalse(ids.has(`task:${taskB.id}`))
    assert.isFalse(ids.has(`project:${projectBHidden.id}`))
    assert.isFalse(ids.has(`task:${taskBHidden.id}`))
    assert.isTrue(
      result.data.items.every(
        (item) => item.projectId !== projectBVisible.id && item.projectId !== projectBHidden.id,
      ),
    )
  })

  test('分页参数生效', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('search-page') })
    const org = await createOrganization(owner)
    // 两源（project+task）各备足命中，适配器级预取偏移后 page2 仍有数据
    const { project: projectA } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    projectA.name = '分页搜索项目A'
    projectA.code = `PA${projectA.id}`
    await projectA.save()
    const { project: projectB } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    projectB.name = '分页搜索项目B'
    projectB.code = `PB${projectB.id}`
    await projectB.save()
    await Promise.all([
      datedTask(projectA.id, '分页搜索任务A1', '2026-07-01', '2026-07-10'),
      datedTask(projectA.id, '分页搜索任务A2', '2026-07-01', '2026-07-10'),
      datedTask(projectB.id, '分页搜索任务B1', '2026-07-01', '2026-07-10'),
    ])

    const tool = createSearchProjectsTasksTool(await deps())
    const ctx = ctxFor(owner, org.id)
    // 注：SearchService 的 adapter 层先按 perPage 预取（含 offset）再统一重分页，
    // 页间取数以「project + task 两源合并池」为准。此处断言每页有界且互不重叠。
    const page1 = await tool.handler(ctx, { keyword: '分页搜索', perPage: 1, page: 1 })
    assert.equal(page1.data.items.length, 1)
    assert.equal(page1.data.meta.page, 1)
    assert.equal(page1.data.meta.perPage, 1)

    const page2 = await tool.handler(ctx, { keyword: '分页搜索', perPage: 1, page: 2 })
    assert.equal(page2.data.items.length, 1)
    assert.equal(page2.data.meta.page, 2)

    const page1Keys = page1.data.items.map((item) => `${item.entityType}:${item.entityId}`)
    const page2Keys = page2.data.items.map((item) => `${item.entityType}:${item.entityId}`)
    assert.isFalse(page1Keys.some((key) => page2Keys.includes(key)))
    assert.isTrue([...page1Keys, ...page2Keys].some((key) => key.startsWith('project:')))
    assert.isTrue([...page1Keys, ...page2Keys].some((key) => key.startsWith('task:')))
  })

  test('搜索工具元数据契约（read + project:view + task:view）', async ({ assert }) => {
    const { searchService, searchPolicy } = await deps()
    const tool = createSearchProjectsTasksTool({ searchService, searchPolicy })

    assert.equal(tool.sideEffect, 'read')
    assert.deepEqual([...tool.requiredPermissions], ['project:view', 'task:view'])
    const schema = tool.parametersJsonSchema as { properties?: Record<string, unknown> }
    assert.equal((schema.properties?.keyword as { minLength?: number })?.minLength, 1)
  })
})
