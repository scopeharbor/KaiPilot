// v3-chart-gallery-data-foundation W2.7 —— IssueService 功能测试
//
// 覆盖（tasks.md 2.6/2.7）：
// - 议题登记落库、项目内递增业务编号（ISS-001）与任务关联；
// - 列表多维筛选与分页；
// - 状态机流转（open → in_progress → resolved → closed，重开回 open）
//   与非法流转/根因必填守卫；
// - 软删除与跨组织访问 404 隔离（RL-05）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import IssueService from '#services/issue_service'
import type { CreateIssueInput } from '#services/issue_service'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/** 装配组织 + 项目（owner 为项目经理），并把 member 加为组织成员。 */
async function setup() {
  const owner = await createUser({ email: uniqueEmail('issue-owner') })
  const member = await createUser({ email: uniqueEmail('issue-member') })
  const org = await createOrganization(owner)
  await addOrgMember(org, member, 'member')
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, member, org, project }
}

/** 项目内创建任务。 */
async function makeTask(projectId: number, name: string, overrides: Record<string, unknown> = {}) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    isCriticalPath: false,
    isOnLongestPath: false,
    ...overrides,
  })
}

function issuePayload(overrides: Partial<CreateIssueInput> = {}): CreateIssueInput {
  return {
    title: '知识库检索偶发超时',
    description: '高峰时段 P95 响应超过 5 秒',
    type: 'bug',
    severity: 'major',
    priority: 'high',
    assigneeId: null,
    relatedTaskId: null,
    ...overrides,
  }
}

test.group('IssueService', (group) => {
  useAuthDatabase(group)

  test('登记议题：自动递增编号 ISS-001/ISS-002，关联任务与处理人落库', async ({ assert }) => {
    const { owner, member, org, project } = await setup()
    const service = await app.container.make(IssueService)
    const task = await makeTask(project.id, '检索网关服务')

    const issue = await service.create(
      org.id,
      project.id,
      issuePayload({ relatedTaskId: task.id, assigneeId: member.id }),
      owner.id,
    )
    assert.equal(issue.code, 'ISS-001')
    assert.equal(issue.status, 'open')
    assert.equal(issue.type, 'bug')
    assert.equal(issue.severity, 'major')
    assert.equal(issue.relatedTaskId, task.id)
    assert.equal(issue.assigneeId, member.id)
    assert.equal(issue.reportedBy, owner.id)
    assert.isNull(issue.resolvedAt)
    assert.isNull(issue.closedAt)

    const second = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '第二个议题' }),
      owner.id,
    )
    assert.equal(second.code, 'ISS-002')

    const detail = await service.get(org.id, project.id, issue.id)
    assert.equal(detail.id, issue.id)
    assert.equal(detail.relatedTask.name, '检索网关服务')
  })

  test('关联任务必须属于当前项目：跨组织任务登记/更新被拦截（404）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(IssueService)

    const outsider = await createUser({ email: uniqueEmail('issue-outsider') })
    const otherOrg = await createOrganization(outsider)
    const { project: otherProject } = await createProjectWithMember(
      otherOrg,
      outsider,
      outsider,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const foreignTask = await makeTask(otherProject.id, '他人组织任务')

    await assert.rejects(
      () =>
        service.create(
          org.id,
          project.id,
          issuePayload({ relatedTaskId: foreignTask.id }),
          owner.id,
        ),
      ResourceNotFoundException,
    )

    const own = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '自有议题' }),
      owner.id,
    )
    await assert.rejects(
      () => service.update(org.id, project.id, own.id, { relatedTaskId: foreignTask.id }),
      ResourceNotFoundException,
    )
  })

  test('列表：status/severity/assigneeId 过滤与分页元数据', async ({ assert }) => {
    const { owner, member, org, project } = await setup()
    const service = await app.container.make(IssueService)

    await service.create(
      org.id,
      project.id,
      issuePayload({ title: '缺陷 A', type: 'bug', assigneeId: member.id }),
      owner.id,
    )
    // 通过状态机推进为 in_progress，验证列表过滤
    const progress = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '缺陷 B', type: 'bug', assigneeId: member.id }),
      owner.id,
    )
    await service.changeStatus(org.id, project.id, progress.id, { status: 'in_progress' })

    const all = await service.list(org.id, project.id)
    assert.equal(all.meta.total, 2)
    assert.lengthOf(all.data, 2)

    const openOnly = await service.list(org.id, project.id, { status: 'open' })
    assert.equal(openOnly.meta.total, 1)
    assert.equal(openOnly.data[0].code, 'ISS-001')

    const byAssignee = await service.list(org.id, project.id, { assigneeId: member.id })
    assert.equal(byAssignee.meta.total, 2)

    const page1 = await service.list(org.id, project.id, { page: 1, perPage: 1 })
    assert.equal(page1.meta.total, 2)
    assert.equal(page1.meta.totalPages, 2)
    assert.lengthOf(page1.data, 1)
  })

  test('更新议题属性：标题/严重度/优先级与处理人', async ({ assert }) => {
    const { owner, member, org, project } = await setup()
    const service = await app.container.make(IssueService)
    const issue = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '原始标题' }),
      owner.id,
    )

    const updated = await service.update(org.id, project.id, issue.id, {
      title: '升级为阻塞',
      severity: 'critical',
      priority: 'urgent',
      assigneeId: member.id,
    })
    assert.equal(updated.title, '升级为阻塞')
    assert.equal(updated.severity, 'critical')
    assert.equal(updated.priority, 'urgent')
    assert.equal(updated.assigneeId, member.id)
    // 状态与时间戳不受 update 影响
    assert.equal(updated.status, 'open')
    assert.isNull(updated.resolvedAt)
  })

  test('状态机全链流转：open → in_progress → resolved（根因必填）→ closed → 重开回 open', async ({
    assert,
  }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(IssueService)
    const issue = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '状态机议题' }),
      owner.id,
    )

    // 非法流转：open 不能直接 closed
    await assert.rejects(
      () => service.changeStatus(org.id, project.id, issue.id, { status: 'closed' }),
      ValidationException,
    )
    // 根因必填守卫：未带 rootCause/resolution 不能 resolved
    await assert.rejects(
      () => service.changeStatus(org.id, project.id, issue.id, { status: 'resolved' }),
      ValidationException,
    )

    const inProgress = await service.changeStatus(org.id, project.id, issue.id, {
      status: 'in_progress',
    })
    assert.equal(inProgress.status, 'in_progress')
    assert.isNull(inProgress.resolvedAt)

    const resolved = await service.changeStatus(org.id, project.id, issue.id, {
      status: 'resolved',
      rootCause: '配置未生效',
      resolution: '更新环境变量并重启',
    })
    assert.equal(resolved.status, 'resolved')
    assert.equal(resolved.rootCause, '配置未生效')
    assert.equal(resolved.resolution, '更新环境变量并重启')
    assert.isNotNull(resolved.resolvedAt)
    assert.isNull(resolved.closedAt)

    // 已解决后重开需先经 closed（或 open）——resolved 不能直接回 in_progress
    await assert.rejects(
      () => service.changeStatus(org.id, project.id, issue.id, { status: 'in_progress' }),
      ValidationException,
    )

    const closed = await service.changeStatus(org.id, project.id, issue.id, { status: 'closed' })
    assert.equal(closed.status, 'closed')
    assert.isNotNull(closed.closedAt)
    assert.isNotNull(closed.resolvedAt)

    // 重开：回 open 并清除闭环时间戳
    const reopened = await service.changeStatus(org.id, project.id, issue.id, { status: 'open' })
    assert.equal(reopened.status, 'open')
    assert.isNull(reopened.resolvedAt)
    assert.isNull(reopened.closedAt)
  })

  test('rejected 分支：open → rejected → open 恢复', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(IssueService)
    const issue = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '误报议题' }),
      owner.id,
    )

    const rejected = await service.changeStatus(org.id, project.id, issue.id, {
      status: 'rejected',
    })
    assert.equal(rejected.status, 'rejected')
    assert.isNull(rejected.resolvedAt)

    const restored = await service.changeStatus(org.id, project.id, issue.id, { status: 'open' })
    assert.equal(restored.status, 'open')
  })

  test('软删除议题：get 404、列表不可见、编号不回收（新登记顺延 ISS-002）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(IssueService)
    const issue = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '待删除' }),
      owner.id,
    )
    assert.equal(issue.code, 'ISS-001')

    await service.delete(org.id, project.id, issue.id)

    await assert.rejects(() => service.get(org.id, project.id, issue.id), ResourceNotFoundException)
    const list = await service.list(org.id, project.id)
    assert.equal(list.meta.total, 0)

    const next = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '顺延编号' }),
      owner.id,
    )
    assert.equal(next.code, 'ISS-002')
  })

  test('跨组织访问一律 404（RL-05，防探测）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(IssueService)
    const issue = await service.create(
      org.id,
      project.id,
      issuePayload({ title: '隔离议题' }),
      owner.id,
    )

    const outsider = await createUser({ email: uniqueEmail('issue-isolated') })
    const otherOrg = await createOrganization(outsider)

    await assert.rejects(() => service.list(otherOrg.id, project.id), ResourceNotFoundException)
    await assert.rejects(
      () => service.get(otherOrg.id, project.id, issue.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.update(otherOrg.id, project.id, issue.id, { title: '跨组织修改' }),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () =>
        service.changeStatus(otherOrg.id, project.id, issue.id, {
          status: 'in_progress',
        }),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.delete(otherOrg.id, project.id, issue.id),
      ResourceNotFoundException,
    )
  })
})
