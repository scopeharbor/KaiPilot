/**
 * v3-ai-tools-orchestration-layer —— 全链路端到端 Japa 集成测试（tasks W3 3.1）。
 *
 * 模拟真实调用闭环（HTTP 全栈，auth + 编排层 + handler + 领域服务 + 审计落库）：
 * 1. GET /api/v1/ai/tools 拉取工具清单；
 * 2. POST execute `get_project_summary` 取项目摘要；
 * 3. POST execute `get_task_detail` 查任务详情（依赖计数）；
 * 4. POST execute `update_task_schedule` 发起排程变更预览（PREVIEW_REQUIRED，零写入）；
 * 5. POST /api/v1/ai/tools/confirm 携带 previewToken 确认提交（单事务生效）；
 * 6. 再次 get_task_detail 断言新日期生效；
 * 7. 核对 audit_logs 全链路审计记录（事件/action/parametersHash/无明文）。
 */
import AuditLog from '#models/audit_log'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
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

test.group('AI tools 全链路 E2E', (group) => {
  useAuthDatabase(group)

  test('清单→摘要→详情→排程预览→确认→生效→审计全链路', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('e2e-owner') })
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
      datedTask(project.id, 'E2E 任务A', '2026-07-01', '2026-07-03', 3),
      datedTask(project.id, 'E2E 任务B', '2026-07-06', '2026-07-07', 2),
    ])
    await TaskDependency.create({ predecessorId: a.id, successorId: b.id, type: 'fs', lagDays: 0 })
    const token = await login(client, owner)
    const auth = { Authorization: `Bearer ${token}` }

    // 1. 工具清单
    const listing = await client.get('/api/v1/ai/tools').header('Authorization', `Bearer ${token}`)
    listing.assertStatus(200)
    const toolNames = (listing.body().data as Array<{ name: string }>).map((t) => t.name)
    for (const name of ['get_project_summary', 'get_task_detail', 'update_task_schedule']) {
      assert.include(toolNames, name)
    }

    // 2. 项目摘要
    const summary = await client
      .post('/api/v1/ai/tools/execute')
      .headers(auth)
      .json({ toolName: 'get_project_summary', parameters: { projectId: project.id } })
    summary.assertStatus(200)
    assert.equal(summary.body().data.id, project.id)
    assert.equal(summary.body().data.taskCount, 2)
    assert.equal(summary.body().meta.status, 'SUCCESS')

    // 3. 任务详情（依赖计数）
    const detailBefore = await client
      .post('/api/v1/ai/tools/execute')
      .headers(auth)
      .json({ toolName: 'get_task_detail', parameters: { projectId: project.id, taskId: a.id } })
    detailBefore.assertStatus(200)
    assert.equal(detailBefore.body().data.id, a.id)
    assert.equal(detailBefore.body().data.dependencyCount, 1)
    assert.equal(detailBefore.body().data.startDate, '2026-07-01')

    // 4. 排程变更预览：PREVIEW_REQUIRED + previewToken + diff，正式表零写入（RL-01）
    const intent = {
      projectId: project.id,
      taskId: a.id,
      operation: 'move',
      startDate: '2026-07-06',
      autoSchedule: true,
    }
    const preview = await client
      .post('/api/v1/ai/tools/execute')
      .headers(auth)
      .json({ toolName: 'update_task_schedule', parameters: intent })
    preview.assertStatus(200)
    const previewBody = preview.body()
    assert.equal(previewBody.meta.status, 'PREVIEW_REQUIRED')
    assert.match(previewBody.meta.previewToken, /^[0-9a-f]{64}$/)
    assert.isArray(previewBody.meta.diff)
    assert.isAbove(previewBody.meta.diff.length, 0)
    assert.isFalse(previewBody.data.committed)
    await a.refresh()
    await b.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-01')
    assert.equal(b.startDate?.toISODate(), '2026-07-06')

    // 5. 人工确认提交：单事务原子生效
    const confirmed = await client.post('/api/v1/ai/tools/confirm').headers(auth).json({
      toolName: 'update_task_schedule',
      previewToken: previewBody.meta.previewToken,
      parameters: intent,
    })
    confirmed.assertStatus(200)
    assert.equal(confirmed.body().meta.committed, true)
    await a.refresh()
    await b.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-06')
    assert.equal(b.startDate?.toISODate(), '2026-07-09')

    // 6. 详情复查：新日期生效
    const detailAfter = await client
      .post('/api/v1/ai/tools/execute')
      .headers(auth)
      .json({ toolName: 'get_task_detail', parameters: { projectId: project.id, taskId: a.id } })
    detailAfter.assertStatus(200)
    assert.equal(detailAfter.body().data.startDate, '2026-07-06')

    // 7. 全链路审计核对（RL-12：只存哈希/状态/耗时/错误码，无明文）
    const audits = await AuditLog.query()
      .where('entity_type', 'ai_tool')
      .where('user_id', owner.id)
      .where('organization_id', org.id)
      .orderBy('id', 'asc')
    assert.isAtLeast(audits.length, 5)
    const events = audits.map((row) => (row.metadata as Record<string, unknown>)['event'])
    assert.includeMembers(events as string[], [
      'AI_TOOL_EXECUTED',
      'AI_TOOL_EXECUTED',
      'AI_TOOL_EXECUTED',
      'AI_TOOL_EXECUTED',
      'AI_TOOL_CONFIRMED',
    ])
    const actions = audits.map((row) => row.action)
    assert.include(actions, 'ai_generate')
    assert.include(actions, 'apply')
    const statuses = audits.map((row) => (row.metadata as Record<string, unknown>)['status'])
    assert.include(statuses, 'SUCCESS')
    assert.include(statuses, 'PREVIEW_GENERATED')
    assert.include(statuses, 'CONFIRMED')
    for (const row of audits) {
      const metadata = row.metadata as Record<string, unknown>
      assert.match(metadata['parametersHash'] as string, /^[0-9a-f]{64}$/)
      assert.isNumber(metadata['durationMs'])
      assert.isFalse(
        JSON.stringify(metadata).includes('E2E 任务A'),
        '审计 metadata 严禁出现业务明文',
      )
      assert.isFalse(JSON.stringify(metadata).includes('2026-07-06'))
    }
  })
})
