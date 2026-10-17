// AI 同事：「我的工作」跨项目汇总、任务编号全域搜索、编号引用（真实 SQLite）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import Task from '#models/task'
import type User from '#models/user'
import SearchService from '#services/search_service'
import SearchPolicy from '#policies/search_policy'
import EntityReferenceService from '#services/ai_colleague/entity_reference_service'
import { memberAlias } from '#services/ai_colleague/member_alias'
import { createGetMyWorkTool } from '#services/ai_tools/handlers/index'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

const TODAY = DateTime.fromISO('2026-10-10', { zone: 'Asia/Shanghai' })

async function task(projectId: number, name: string, extra: Partial<Task> = {}) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    ...extra,
  })
}

async function twoProjects(label: string) {
  const me = await createUser({ email: uniqueEmail(label) })
  const org = await createOrganization(me)
  const { project: alpha } = await createProjectWithMember(
    org,
    me,
    me,
    ProjectRoleName.PROJECT_MANAGER,
  )
  alpha.code = `ALPHA-${alpha.id}`
  await alpha.save()
  const { project: beta } = await createProjectWithMember(
    org,
    me,
    me,
    ProjectRoleName.PROJECT_MANAGER,
  )
  beta.code = null
  await beta.save()
  return { me, org, alpha, beta }
}

function ctx(user: User, organizationId: number) {
  return { user, organizationId, requestId: 'my-work-test' }
}

test.group('AI 同事：我的工作', (group) => {
  useAuthDatabase(group)

  test('跨项目只汇总我负责且未完成的任务，按紧急程度排序', async ({ assert }) => {
    const { me, org, alpha, beta } = await twoProjects('my-work')
    const other = await createUser({ email: uniqueEmail('my-work-other') })
    const overdue = await task(alpha.id, '逾期的接口', {
      assigneeId: me.id,
      endDate: DateTime.fromISO('2026-10-07'),
    })
    const dueToday = await task(beta.id, '今天交的设计', {
      assigneeId: me.id,
      status: 'in_progress',
      endDate: DateTime.fromISO('2026-10-10'),
    })
    const later = await task(beta.id, '下个月的文档', {
      assigneeId: me.id,
      endDate: DateTime.fromISO('2026-11-20'),
      priority: 'high',
    })
    await task(alpha.id, '已完成的', { assigneeId: me.id, status: 'completed' })
    await task(alpha.id, '别人的', { assigneeId: other.id })

    const tool = createGetMyWorkTool({ today: () => TODAY })
    const result = await tool.handler(ctx(me, org.id), {})
    const data = result.data
    assert.deepEqual(
      data.items.map((item) => item.id),
      [overdue.id, dueToday.id, later.id],
    )
    assert.equal(data.items[0]!.code, `ALPHA-${alpha.id}#${overdue.id}`)
    assert.equal(data.items[1]!.code, `PROJ-${beta.id}#${dueToday.id}`)
    assert.equal(data.items[0]!.dueState, 'overdue')
    assert.equal(data.items[0]!.overdueDays, 3)
    assert.equal(data.items[1]!.path, `/next/projects/${beta.id}?focusTask=${dueToday.id}`)
    assert.equal(data.summary.overdue, 1)
    assert.equal(data.summary.dueToday, 1)
    assert.lengthOf(data.summary.projects, 2)

    const today = await tool.handler(ctx(me, org.id), { filter: 'today' })
    assert.deepEqual(
      today.data.items.map((item) => item.id),
      [overdue.id, dueToday.id],
    )
  })

  test('其他组织的人看不到我的任务', async ({ assert }) => {
    const { me, alpha } = await twoProjects('my-work-iso')
    await task(alpha.id, '我的', { assigneeId: me.id })
    const stranger = await createUser({ email: uniqueEmail('my-work-stranger') })
    const otherOrg = await createOrganization(stranger)
    const tool = createGetMyWorkTool({ today: () => TODAY })
    const result = await tool.handler(ctx(stranger, otherOrg.id), {})
    assert.lengthOf(result.data.items, 0)
  })
})

test.group('全域搜索：项目编号 / 任务编号', (group) => {
  useAuthDatabase(group)

  test('任务编号（#号 / 项目编号#号）精确命中，项目编号不符不算', async ({ assert }) => {
    const { me, org, alpha } = await twoProjects('search-code')
    const target = await task(alpha.id, '支付回调', { assigneeId: me.id })
    await task(alpha.id, '另一个任务')
    const search = await app.container.make(SearchService)
    const policy = await app.container.make(SearchPolicy)
    const allowed = await policy.getAllowedProjectIds(me, org.id)

    const byHash = await search.search({ keyword: `#${target.id}` }, org.id, me.id, allowed)
    assert.equal(byHash.data[0]?.entityType, 'task')
    assert.equal(byHash.data[0]?.entityId, target.id)
    assert.equal(byHash.data[0]?.metadata?.code, `ALPHA-${alpha.id}#${target.id}`)

    const byFull = await search.search(
      { keyword: `ALPHA-${alpha.id}#${target.id}`, entityTypes: ['task'] },
      org.id,
      me.id,
      allowed,
    )
    assert.deepEqual(
      byFull.data.map((item) => item.entityId),
      [target.id],
    )

    const wrongProject = await search.search(
      { keyword: `OTHER-1#${target.id}`, entityTypes: ['task'] },
      org.id,
      me.id,
      allowed,
    )
    assert.lengthOf(wrongProject.data, 0)
  })

  test('项目编号命中；没设编号的项目用 PROJ-{ID} 也能搜到', async ({ assert }) => {
    const { me, org, alpha, beta } = await twoProjects('search-project-code')
    const search = await app.container.make(SearchService)
    const policy = await app.container.make(SearchPolicy)
    const allowed = await policy.getAllowedProjectIds(me, org.id)
    const byCode = await search.search(
      { keyword: `ALPHA-${alpha.id}`, entityTypes: ['project'] },
      org.id,
      me.id,
      allowed,
    )
    assert.equal(byCode.data[0]?.entityId, alpha.id)
    assert.equal(byCode.data[0]?.metadata?.code, `ALPHA-${alpha.id}`)
    const byFallback = await search.search(
      { keyword: `PROJ-${beta.id}`, entityTypes: ['project'] },
      org.id,
      me.id,
      allowed,
    )
    assert.equal(byFallback.data[0]?.entityId, beta.id)
  })
})

test.group('编号引用：让 AI 看得到提到的任务与项目', (group) => {
  useAuthDatabase(group)

  test('提到的任务编号、选中任务、项目编号都查得到；未授权项目查不到', async ({ assert }) => {
    const { me, org, alpha, beta } = await twoProjects('refs')
    const mentioned = await task(alpha.id, '登录页', {
      assigneeId: me.id,
      description: '做登录页',
      endDate: DateTime.fromISO('2026-10-12'),
    })
    const selected = await task(beta.id, '注册页')
    const service = new EntityReferenceService()
    const refs = await service.resolve({
      text: `看看 ALPHA-${alpha.id}#${mentioned.id} 和项目 ALPHA-${alpha.id}`,
      organizationId: org.id,
      allowedProjectIds: [alpha.id, beta.id],
      selectedTaskIds: [selected.id],
    })
    assert.deepEqual(
      refs.tasks.map((item) => item.code).sort(),
      [`ALPHA-${alpha.id}#${mentioned.id}`, `PROJ-${beta.id}#${selected.id}`].sort(),
    )
    const detail = refs.tasks.find((item) => item.id === mentioned.id)!
    assert.equal(detail.project.name, alpha.name)
    assert.equal(detail.assignee, memberAlias(org.id, me.id))
    assert.equal(detail.statusLabel, '未开始')
    assert.equal(refs.projects[0]?.code, `ALPHA-${alpha.id}`)
    assert.equal(refs.projects[0]?.taskTotal, 1)

    const denied = await service.resolve({
      text: `#${mentioned.id}`,
      organizationId: org.id,
      allowedProjectIds: [beta.id],
    })
    assert.lengthOf(denied.tasks, 0)
  })
})
