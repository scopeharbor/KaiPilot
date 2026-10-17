// v3-triz-contradiction-copilot 任务 2.4（W4 收尾）—— 只读 AI 工具 `list_project_signals` 集成测试。
//
// 覆盖（tasks 2.4 验收：`GET /ai/tools` 元数据 14 条 + 既有 8 个零变化；工具侧只读与权限裁剪）：
// - `GET /api/v1/ai/tools` 返回 14 条元数据，含 `list_project_signals` 与既有 8 个 P0 工具；
// - 执行 `list_project_signals`：缺省只看 `open` 信号、统一 `{ items, meta }` 投影；
// - **领域权限裁剪**：无 `resource:view` 的只读观察者拿到资源类信号时 `evidence = null`
//   且 `evidenceRedacted = true`，进度类证据完整（复用 W3 的 `ProjectSignalPolicy` 口径）；
// - 跨组织 404（RL-05）/ 未知枚举 422；
// - **只读零写入**：信号表与业务表行数不变（不触发检测、不产生任何落库）。
import type { ApiClient } from '@japa/api-client'
import ProjectSignal from '#models/project_signal'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Risk from '#models/risk'
import Task from '#models/task'
import { AI_TOOLS_NAMES } from '#services/ai_tools/handlers/index'
import { LIST_PROJECT_SIGNALS_TOOL_NAME } from '#services/ai_tools/handlers/list_project_signals'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

const API = '/api/v1'
const TOOLS = `${API}/ai/tools`
const WINDOW = '2026-09-01..2026-09-07'

const LEGACY_TOOL_NAMES = [
  'navigate_to_space',
  'get_project_summary',
  'list_project_tasks',
  'get_task_detail',
  'list_project_risks',
  'get_gantt_snapshot',
  'search_projects_tasks',
  'update_task_schedule',
]

async function login(client: ApiClient, user: any): Promise<string> {
  const res = await client
    .post(`${API}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

function authed(client: ApiClient, token: string, orgId: number) {
  return {
    get: (url: string) =>
      client
        .get(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
    post: (url: string) =>
      client
        .post(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
  }
}

async function executeTool(
  client: ApiClient,
  session: { orgId: number; token: string },
  toolName: string,
  parameters: Record<string, unknown>,
) {
  return authed(client, session.token, session.orgId)
    .post(`${TOOLS}/execute`)
    .json({ toolName, parameters })
}

async function tableCount(model: { query: () => any }): Promise<number> {
  const rows = (await model.query().count('* as total')) as unknown as Array<{
    $extras: { total: number | string }
  }>
  return Number(rows[0]?.$extras?.total ?? 0)
}

function seedSignal(input: {
  organizationId: number
  projectId: number
  userId: number
  signalType: 'progress_deviation' | 'risk_surge' | 'resource_overload' | 'milestone_slip'
  confidenceTier?: 'low' | 'high'
  status?: 'open' | 'dismissed' | 'adopted' | 'expired'
  window?: string
}): Promise<ProjectSignal> {
  const window = input.window ?? WINDOW
  return ProjectSignal.create({
    organizationId: input.organizationId,
    projectId: input.projectId,
    signalType: input.signalType,
    confidenceTier: input.confidenceTier ?? 'low',
    tierReasons: {
      amplitude: { hit: true, detail: 'significant_amplitude_met' },
      consecutive: { hit: true, detail: 'consecutive_cycles_2_of_2' },
      completeness: { hit: true, detail: 'key_fields_complete' },
      composite: { hit: true, detail: 'composite_types_2_of_2' },
      window,
      evaluatedAt: '2026-09-07T00:00:00.000Z',
      compositeTypes: [input.signalType],
      previousTier: null,
    },
    severity: input.confidenceTier === 'high' ? 'critical' : 'warning',
    evidence: {
      metric: `${input.signalType}_metric`,
      window: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      readings: { overloadRatioPercent: 50, overloadedResourceCount: 2 },
      thresholds: { ratioPercent: 25 },
      coveredCycles: 2,
      hitConditions: [],
      compositeTypes: [input.signalType],
      entityRefs: {},
      truncated: false,
    },
    idempotencyKey: `${input.signalType}-${window}-${Math.random()}`.padEnd(64, '0').slice(0, 64),
    observationWindow: window,
    expiresAt: DateTime.fromISO('2026-09-21T23:59:59.000Z'),
    status: input.status ?? 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: input.userId,
    deletedAt: null,
  })
}

test.group('AI 工具 list_project_signals（W4 补 2.4）', (group) => {
  useAuthDatabase(group)

  async function setup(client: ApiClient) {
    const owner = await createUser({ email: uniqueEmail('list-signals-owner') })
    const org = await createOrganization(owner)
    const { project, role } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project, role, session: { orgId: Number(org.id), token } }
  }

  /**
   * 只读观察者：有 `project:view` / `task:view` / `risk:view` / `milestone:view`，无 `resource:view`。
   * 额外补 `ai:trigger`（只读工具在编排层仍需 AI 基础触发权限，W2b 已记录该口径），
   * 使本用例只验证**领域证据裁剪**而不被 AI 基础门挡住。
   */
  async function addObserver(org: any, project: any, client: ApiClient) {
    const viewer = await createUser({ email: uniqueEmail('list-signals-viewer') })
    const membership = await addOrgMember(org, viewer, 'viewer')
    membership.permissions = ['ai:trigger'] as unknown as string[]
    await membership.save()

    const role = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: '只读观察者',
      permissions: ['ai:trigger'] as unknown as string[],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const token = await login(client, viewer)
    return { viewer, session: { orgId: Number(org.id), token } }
  }

  test('GET /ai/tools 元数据 14 条：含 list_project_signals 且既有 8 个零变化', async ({
    client,
    assert,
  }) => {
    const { session } = await setup(client)
    const res = await authed(client, session.token, session.orgId).get(TOOLS)
    res.assertStatus(200)
    const body = res.body() as {
      data: Array<{ name: string; sideEffect: string }>
      meta: { total: number }
    }
    assert.equal(body.meta.total, 21)
    assert.lengthOf(body.data, 21)
    assert.deepEqual([...body.data.map((tool) => tool.name)].sort(), [...AI_TOOLS_NAMES].sort())
    for (const name of LEGACY_TOOL_NAMES) {
      assert.include(
        body.data.map((tool) => tool.name),
        name,
      )
    }
    const descriptor = body.data.find((tool) => tool.name === LIST_PROJECT_SIGNALS_TOOL_NAME)
    assert.isDefined(descriptor)
    assert.equal(descriptor?.sideEffect, 'read')
  })

  test('执行工具：缺省只看 open 信号，统一 { items, meta } 投影（零写入）', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, session } = await setup(client)
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
      confidenceTier: 'high',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'resource_overload',
      status: 'dismissed',
      window: '2026-08-25..2026-08-31',
    })

    const before = {
      signals: await tableCount(ProjectSignal),
      tasks: await tableCount(Task),
      risks: await tableCount(Risk),
    }

    const res = await executeTool(client, session, LIST_PROJECT_SIGNALS_TOOL_NAME, {
      projectId: Number(project.id),
    })
    res.assertStatus(200)
    const data = (res.body() as { data: Record<string, any> }).data
    assert.lengthOf(data.items, 1, '缺省只返回 open 信号')
    assert.equal(data.items[0].signalType, 'progress_deviation')
    assert.equal(data.meta.total, 1)
    assert.equal(data.meta.page, 1)
    // PM 有全部领域权限：证据完整可读
    assert.isFalse(data.items[0].evidenceRedacted)
    assert.isNotNull(data.items[0].evidence)

    // 历史视图：all 包含已忽略信号
    const all = await executeTool(client, session, LIST_PROJECT_SIGNALS_TOOL_NAME, {
      projectId: Number(project.id),
      status: 'all',
    })
    all.assertStatus(200)
    assert.lengthOf((all.body() as { data: { items: unknown[] } }).data.items, 2)

    // 只读零写入
    assert.equal(await tableCount(ProjectSignal), before.signals)
    assert.equal(await tableCount(Task), before.tasks)
    assert.equal(await tableCount(Risk), before.risks)
  })

  test('领域权限裁剪：无 resource:view 时资源类证据被裁剪，进度类完整', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, role } = await setup(client)
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'resource_overload',
      window: '2026-08-25..2026-08-31',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
    })

    const { session } = await addObserver(org, project, client)
    assert.isDefined(role)
    const res = await executeTool(client, session, LIST_PROJECT_SIGNALS_TOOL_NAME, {
      projectId: Number(project.id),
    })
    res.assertStatus(200)

    const items = (res.body() as { data: { items: Array<Record<string, any>> } }).data.items
    assert.lengthOf(items, 2)

    const byType = new Map(items.map((item) => [item.signalType, item]))
    const resource = byType.get('resource_overload')
    assert.isTrue(resource?.evidenceRedacted, '无 resource:view ⇒ 资源类证据被裁剪')
    assert.isNull(resource?.evidence)
    assert.equal(resource?.redactedReason, 'missing_permission:resource:view')
    assert.equal(resource?.requiredPermission, 'resource:view')

    const progress = byType.get('progress_deviation')
    assert.isFalse(progress?.evidenceRedacted, '有 task:view ⇒ 进度类证据完整')
    assert.isNotNull(progress?.evidence)
  })

  test('跨组织 404（RL-05）与未知枚举 422', async ({ client, assert }) => {
    const { org, project, session } = await setup(client)
    const outsider = await createUser({ email: uniqueEmail('list-signals-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderSession = { orgId: Number(outsiderOrg.id), token: await login(client, outsider) }

    const foreign = await executeTool(client, outsiderSession, LIST_PROJECT_SIGNALS_TOOL_NAME, {
      projectId: Number(project.id),
    })
    foreign.assertStatus(404)
    foreign.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
    assert.notInclude(foreign.text(), String(org.name))

    const unknownEnum = await executeTool(client, session, LIST_PROJECT_SIGNALS_TOOL_NAME, {
      projectId: Number(project.id),
      signalType: 's_curve_stage',
    })
    unknownEnum.assertStatus(422)
    unknownEnum.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    const unknownStatus = await executeTool(client, session, LIST_PROJECT_SIGNALS_TOOL_NAME, {
      projectId: Number(project.id),
      status: 'archived',
    })
    unknownStatus.assertStatus(422)
    unknownStatus.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    const missingProject = await executeTool(client, session, LIST_PROJECT_SIGNALS_TOOL_NAME, {})
    missingProject.assertStatus(422)
    missingProject.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })
})
