/**
 * v3-ai-tools-orchestration-layer —— 核心产品红线对抗自动化断言（tasks W3 3.2）。
 *
 * RL-01（AI 只建议不执行）：写工具 execute 仅产出 PREVIEW_REQUIRED，业务表零写入；
 *          伪造 previewToken 提交 → 409 SCHEDULE_STALE 且事务回滚，绝无落库路径。
 * RL-05（组织隔离防探测）：7 个 projectId 类工具对跨组织/不存在 projectId 一律 404
 *          RESOURCE_NOT_FOUND（严禁 403 泄露存在性）；search_projects_tasks 组织内
 *          检索绝不返回他组织数据。
 * RL-12（禁存全文）：全量扫描 ai_tool 审计行——parametersHash 合法 SHA-256、
 *          metadata 键限定集合、绝无入参明文/prompt 标记。
 * RL-14（确定性防注入）：未注册/注入工具名 404；额外字段/类型攻击 422；
 *          在册清单严格等于静态白名单。
 */
import AuditLog from '#models/audit_log'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type User from '#models/user'
import { AI_TOOLS_NAMES } from '#services/ai_tools/handlers/index'
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

/** 7 个带 projectId 参数的 P0 工具（search_projects_tasks 无 projectId，单独断言）。 */
const PROJECT_ID_TOOLS: ReadonlyArray<{ name: string; parameters: Record<string, unknown> }> = [
  { name: 'navigate_to_space', parameters: { projectId: 1, lens: 'kanban' } },
  { name: 'get_project_summary', parameters: { projectId: 1 } },
  { name: 'list_project_tasks', parameters: { projectId: 1 } },
  { name: 'get_task_detail', parameters: { projectId: 1, taskId: 1 } },
  { name: 'list_project_risks', parameters: { projectId: 1 } },
  { name: 'get_gantt_snapshot', parameters: { projectId: 1 } },
  {
    name: 'update_task_schedule',
    parameters: { projectId: 1, taskId: 1, operation: 'move', startDate: '2026-07-07' },
  },
]

test.group('AI tools 产品红线对抗', (group) => {
  useAuthDatabase(group)

  test('RL-01：写工具 execute 仅预览零写入；伪造 token confirm 409 且回滚', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('rl01-owner') })
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
      datedTask(project.id, 'RL01-任务A', '2026-07-01', '2026-07-03', 3),
      datedTask(project.id, 'RL01-任务B', '2026-07-06', '2026-07-07', 2),
    ])
    await TaskDependency.create({ predecessorId: a.id, successorId: b.id, type: 'fs', lagDays: 0 })
    const token = await login(client, owner)

    // 阶段一：execute 仅预览——正式任务表零写入
    const preview = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'update_task_schedule',
        parameters: {
          projectId: project.id,
          taskId: a.id,
          operation: 'move',
          startDate: '2026-07-06',
          autoSchedule: true,
        },
      })
    preview.assertStatus(200)
    assert.equal(preview.body().meta.status, 'PREVIEW_REQUIRED')
    assert.match(preview.body().meta.previewToken, /^[0-9a-f]{64}$/)
    await a.refresh()
    await b.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-01')
    assert.equal(b.startDate?.toISODate(), '2026-07-06')

    // 阶段二：伪造 previewToken 提交 → 409 SCHEDULE_STALE，事务整体回滚
    const forged = await client
      .post('/api/v1/ai/tools/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'update_task_schedule',
        previewToken: 'f'.repeat(64),
        parameters: {
          projectId: project.id,
          taskId: a.id,
          operation: 'move',
          startDate: '2026-07-06',
          autoSchedule: true,
        },
      })
    forged.assertStatus(409)
    forged.assertBodyContains({ error: { code: 'SCHEDULE_STALE' } })
    await a.refresh()
    await b.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-01')
    assert.equal(b.startDate?.toISODate(), '2026-07-06')
  })

  test('RL-05：7 个 projectId 工具跨组织/不存在 projectId 一律 404，不泄露存在性', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('rl05-orga') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('rl05-orgb') })
    await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)
    const ownerAToken = await login(client, ownerA)

    for (const tool of PROJECT_ID_TOOLS) {
      // 跨组织 projectId（资源在 orgA，调用者属 orgB）
      const crossOrg = await client
        .post('/api/v1/ai/tools/execute')
        .header('Authorization', `Bearer ${outsiderToken}`)
        .json({ toolName: tool.name, parameters: { ...tool.parameters, projectId: project.id } })
      crossOrg.assertStatus(404)
      assert.equal(crossOrg.body().error.code, 'RESOURCE_NOT_FOUND')
      assert.isFalse(
        (crossOrg.body().error.message as string).includes(project.name),
        '404 响应严禁泄露跨组织实体存在性',
      )
      // 本组织内但不存在的 projectId（同样 404，不泄露区分）
      const missing = await client
        .post('/api/v1/ai/tools/execute')
        .header('Authorization', `Bearer ${ownerAToken}`)
        .json({ toolName: tool.name, parameters: { ...tool.parameters, projectId: 999_999_999 } })
      missing.assertStatus(404)
      assert.equal(missing.body().error.code, 'RESOURCE_NOT_FOUND')
    }

    // search_projects_tasks：无 projectId 参数，改断言组织级隔离
    const secretName = `RL05 绝密项目 ${Date.now()}`
    const { project: secretProject } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    secretProject.name = secretName
    await secretProject.save()
    const search = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${outsiderToken}`)
      .json({ toolName: 'search_projects_tasks', parameters: { keyword: '绝密项目' } })
    search.assertStatus(200)
    const items = search.body().data.items as Array<{ name: string }>
    assert.isFalse(
      items.some((item) => item.name === secretName),
      '搜索严禁返回他组织项目',
    )
  })

  test('RL-12：审计全表扫描——只存哈希/状态/耗时/错误码，绝无明文全文', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('rl12-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const task = await datedTask(project.id, 'RL12 任务', '2026-07-01', '2026-07-03', 3)
    const token = await login(client, owner)

    const payloadMarkers = {
      keyword: 'RL12_MARKER_9f3a2c_keyword',
      startDate: '2026-08-15',
      taskName: 'RL12 绝密任务名',
    }
    // 三种状态各留痕一次：SUCCESS、PREVIEW_GENERATED、REJECTED（未知工具被拦截）
    await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'search_projects_tasks',
        parameters: { keyword: payloadMarkers.keyword },
      })
    const preview = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'update_task_schedule',
        parameters: {
          projectId: project.id,
          taskId: task.id,
          operation: 'move',
          startDate: payloadMarkers.startDate,
        },
      })
    preview.assertStatus(200)
    const rejected = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'unknown_tool_rl12',
        parameters: { keyword: payloadMarkers.keyword },
      })
    rejected.assertStatus(404)

    const audits = await AuditLog.query()
      .where('entity_type', 'ai_tool')
      .where('user_id', owner.id)
      .where('organization_id', org.id)
      .orderBy('id', 'asc')
    assert.isAtLeast(audits.length, 3)
    const allowedKeys = new Set([
      'toolName',
      'parametersHash',
      'status',
      'durationMs',
      'errorCode',
      'event',
      'truncated',
    ])
    const statuses = audits.map((row) => (row.metadata as Record<string, unknown>)['status'])
    assert.include(statuses, 'SUCCESS')
    assert.include(statuses, 'PREVIEW_GENERATED')
    assert.include(statuses, 'REJECTED')
    const deniedRow = audits.find(
      (row) => (row.metadata as Record<string, unknown>)['toolName'] === 'unknown_tool_rl12',
    )
    assert.isDefined(deniedRow)
    assert.equal(
      (deniedRow!.metadata as Record<string, unknown>)['errorCode'],
      'RESOURCE_NOT_FOUND',
    )
    for (const row of audits) {
      const metadata = row.metadata as Record<string, unknown>
      for (const key of Object.keys(metadata)) {
        assert.isTrue(allowedKeys.has(key), `审计 metadata 出现未列明键：${key}`)
      }
      assert.match(metadata['parametersHash'] as string, /^[0-9a-f]{64}$/)
      assert.isNumber(metadata['durationMs'])
      const serialized = JSON.stringify(metadata)
      assert.isFalse(serialized.includes(payloadMarkers.keyword), 'RL-12：入参明文严禁落库')
      assert.isFalse(serialized.includes(payloadMarkers.startDate), 'RL-12：日期明文严禁落库')
      assert.isFalse(serialized.includes(payloadMarkers.taskName), 'RL-12：业务数据严禁落库')
    }
  })

  test('RL-14：动态注入/未注册工具与恶意入参被严格阻断', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('rl14-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 未注册/注入工具名：execute 与 confirm 一律 404
    const injectionNames = [
      'evil_require_child_process',
      "eval('process.exit')",
      'ai_tools_framework_probe',
    ]
    for (const toolName of injectionNames) {
      const execute = await client
        .post('/api/v1/ai/tools/execute')
        .header('Authorization', `Bearer ${token}`)
        .json({ toolName, parameters: {} })
      execute.assertStatus(404)
      execute.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
      const confirm = await client
        .post('/api/v1/ai/tools/confirm')
        .header('Authorization', `Bearer ${token}`)
        .json({
          toolName,
          previewToken: 'a'.repeat(64),
          parameters: {},
        })
      confirm.assertStatus(404)
    }

    // 恶意/多余参数：
    // a) 原型污染键 `__proto__`：VineJS record 构造输出对象时通过赋值落入原型链、
    //    不产生自有键——入参被净化为仅声明字段（无全局污染、无崩溃、审计不落污染键）。
    //    （我们自己的 Schema 校验只认自有键，天然免疫继承键。）
    const prototypePollution = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'get_project_summary',
        parameters: JSON.parse(`{"projectId": ${project.id}, "__proto__": {"polluted": true}}`),
      })
    prototypePollution.assertStatus(200)
    assert.isFalse(
      JSON.stringify(prototypePollution.body()).includes('polluted'),
      '原型污染键不得出现在响应中',
    )
    const auditAfterPollution = await AuditLog.query()
      .where('entity_type', 'ai_tool')
      .where('user_id', owner.id)
      .orderBy('id', 'desc')
      .first()
    assert.isFalse(
      JSON.stringify(auditAfterPollution!.metadata).includes('polluted'),
      '原型污染键不得进入审计 metadata（RL-12）',
    )
    // b) 未声明额外字段：严格 422（additionalProperties: false）
    const extraField = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'get_project_summary',
        parameters: { projectId: project.id, evil: 'injected <script>' },
      })
    extraField.assertStatus(422)
    extraField.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    // c) 类型注入（字符串携带 SQL 片段）：工具 Schema 类型校验拒绝（422）
    const sqlInjection = await client
      .post('/api/v1/ai/tools/execute')
      .header('Authorization', `Bearer ${token}`)
      .json({
        toolName: 'get_project_summary',
        parameters: { projectId: '1; DROP TABLE tasks; --' },
      })
    sqlInjection.assertStatus(422)

    // 在册清单严格等于静态白名单（无任何动态注入残留）
    const listing = await client.get('/api/v1/ai/tools').header('Authorization', `Bearer ${token}`)
    listing.assertStatus(200)
    const names = (listing.body().data as Array<{ name: string }>).map((t) => t.name).sort()
    assert.deepEqual(names, [...AI_TOOLS_NAMES].sort())
  })
})
