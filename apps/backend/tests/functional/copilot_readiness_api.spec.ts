/**
 * v3-copilot-productized-operating-entry —— readiness 端点功能测试（任务 3.6 / 3.7）。
 *
 * 覆盖：
 * - 200：ready / degraded / unavailable 三态与统一 `{ data }` envelope
 * - 401：未认证；403：账户被禁用；422：projectId 非法；503：租户识别链路不可用
 * - 组织隔离：跨组织 projectId 与他人会话零泄露
 * - 零副作用：provider 调用 0、公网 fetch 0、会话/消息/审计表行数零变化
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import Project from '#models/project'
import CopilotSession from '#models/copilot_session'
import CopilotMessage from '#models/copilot_message'
import AuditLog from '#models/audit_log'
import TenantResolutionService from '#services/tenant_resolution_service'
import { parseCopilotEntryReadinessSnapshot } from '@aiproj/types'

const READINESS_URL = '/api/v1/copilot/readiness'

/** 统计与本端点相关的业务表行数（只读断言用）。 */
async function countRows(): Promise<{ sessions: number; messages: number; audits: number }> {
  const sessionRows = await CopilotSession.query().count('* as total')
  const messageRows = await CopilotMessage.query().count('* as total')
  const auditRows = await AuditLog.query().count('* as total')
  return {
    sessions: Number(sessionRows[0]?.$extras.total ?? 0),
    messages: Number(messageRows[0]?.$extras.total ?? 0),
    audits: Number(auditRows[0]?.$extras.total ?? 0),
  }
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

test.group('CopilotReadiness —— 入口就绪端点', (group) => {
  useAiDatabase(group)

  let fetchCalls = 0
  const originalFetch = globalThis.fetch

  group.setup(() => {
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls += 1
      throw new Error(`readiness 端点不得发起公网调用：${String(args[0])}`)
    }) as typeof globalThis.fetch
  })

  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  group.each.setup(() => {
    fetchCalls = 0
  })

  test('组织成员获得 200 ready 快照，且解析通过严格契约', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)

    const snapshot = res.body().data
    assert.equal(snapshot.state, 'ready')
    assert.deepEqual(snapshot.scope, { kind: 'organization', organizationId: org.id })
    assert.deepEqual(snapshot.reasons, [{ code: 'entry_ready', retryable: false }])
    assert.isTrue(parseCopilotEntryReadinessSnapshot(snapshot).ok, '响应必须通过严格解析')
    assert.equal(fetchCalls, 0, '零公网调用')
  })

  test('已授权项目 scope 命名当前项目并保持 200', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const project = await Project.create({
      organizationId: org.id,
      name: '灯塔迁移项目',
      code: `P${Date.now()}`,
      createdBy: owner.id,
    })
    const token = await login(client, owner.email)

    const res = await client.get(READINESS_URL).qs({ projectId: project.id }).bearerToken(token)
    res.assertStatus(200)

    const snapshot = res.body().data
    assert.equal(snapshot.scope.kind, 'project')
    assert.equal(snapshot.scope.projectId, project.id)
    assert.equal(snapshot.scope.label, '灯塔迁移项目')
    assert.isTrue(parseCopilotEntryReadinessSnapshot(snapshot).ok)
  })

  test('跨组织 projectId ⇒ unavailable 且零泄露', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const stranger = await createUser()
    const otherOrg = await createOrganization(stranger)
    const foreignProject = await Project.create({
      organizationId: otherOrg.id,
      name: '他组织的机密项目',
      code: `P${Date.now()}X`,
      createdBy: stranger.id,
    })
    const token = await login(client, owner.email)

    const res = await client
      .get(READINESS_URL)
      .qs({ projectId: foreignProject.id })
      .bearerToken(token)
    res.assertStatus(200)

    const snapshot = res.body().data
    assert.equal(snapshot.state, 'unavailable')
    assert.deepEqual(snapshot.reasons, [{ code: 'project_scope_denied', retryable: false }])
    assert.deepEqual(snapshot.scope, { kind: 'organization', organizationId: org.id })

    // 零泄露：不回显被拒项目的名称，也不在任何字段里出现其标识键。
    const serialized = JSON.stringify(res.body())
    assert.notInclude(serialized, '他组织的机密项目')
    assert.notInclude(serialized, 'projectId')
    assert.isUndefined(snapshot.scope.projectId)
    assert.isUndefined(snapshot.scope.label)
    assert.notEqual(snapshot.scope.organizationId, otherOrg.id)
    assert.isAbove(foreignProject.id, 0)
  })

  test('不存在的 projectId ⇒ 与无权项目同一响应（不区分存在性）', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client.get(READINESS_URL).qs({ projectId: 999999 }).bearerToken(token)
    res.assertStatus(200)
    assert.deepEqual(res.body().data.reasons, [{ code: 'project_scope_denied', retryable: false }])
  })

  test('无 Copilot 权限的 viewer ⇒ unavailable + copilot_permission_denied', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)

    const snapshot = res.body().data
    assert.equal(snapshot.state, 'unavailable')
    assert.deepEqual(snapshot.reasons, [{ code: 'copilot_permission_denied', retryable: false }])
    assert.deepEqual(snapshot.allowedActions, ['retry-readiness'])
    assert.isEmpty(snapshot.quickStarts)
    assert.isNull(snapshot.recentSession)
  })

  test('无组织上下文的已认证用户 ⇒ unavailable + organization_context_missing', async ({
    client,
    assert,
  }) => {
    const orphan = await createUser()
    const token = await login(client, orphan.email)

    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)
    assert.deepEqual(res.body().data.reasons, [
      { code: 'organization_context_missing', retryable: false },
    ])
  })

  test('未认证 ⇒ 401', async ({ client }) => {
    const res = await client.get(READINESS_URL)
    res.assertStatus(401)
  })

  test('账户被禁用 ⇒ 403 且不返回快照', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    owner.isActive = false
    await owner.save()

    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(403)
    assert.equal(res.body().error.code, 'ACCOUNT_INACTIVE')
    assert.isUndefined(res.body().data)
  })

  test('非法 projectId ⇒ 422 VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    for (const bad of ['abc', '-1', '0', '1.5']) {
      const res = await client.get(READINESS_URL).qs({ projectId: bad }).bearerToken(token)
      res.assertStatus(422)
      assert.equal(res.body().error.code, 'VALIDATION_ERROR')
    }
  })

  test('未知 query 字段被忽略，不改变行为', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client
      .get(READINESS_URL)
      .qs({ organizationId: 99999, includeExclusions: 'true' })
      .bearerToken(token)
    res.assertStatus(200)
    assert.equal(res.body().data.scope.organizationId, org.id)
    assert.notInclude(JSON.stringify(res.body()), 'exclusion')
  })

  test('租户识别链路不可用 ⇒ 503 且非泄露', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const proto = TenantResolutionService.prototype as unknown as Record<string, unknown>
    const original = proto.resolveFromTrustedState
    proto.resolveFromTrustedState = async () => {
      throw new Error('select * from organization_members failed at /var/db/aiproj.sqlite')
    }
    try {
      const res = await client.get(READINESS_URL).bearerToken(token)
      res.assertStatus(503)
      assert.equal(res.body().error.code, 'TENANT_RESOLUTION_UNAVAILABLE')
      assert.notInclude(JSON.stringify(res.body()), 'organization_members')
      assert.notInclude(JSON.stringify(res.body()), 'aiproj.sqlite')
    } finally {
      proto.resolveFromTrustedState = original
    }
  })

  test('readiness 是纯读：会话/消息/审计表行数零变化', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const project = await Project.create({
      organizationId: org.id,
      name: '只读校验项目',
      code: `P${Date.now()}R`,
      createdBy: owner.id,
    })
    const token = await login(client, owner.email)

    const before = await countRows()

    for (let i = 0; i < 3; i++) {
      const res = await client.get(READINESS_URL).qs({ projectId: project.id }).bearerToken(token)
      res.assertStatus(200)
    }

    const after = await countRows()

    assert.deepEqual(after, before, 'readiness 端点不得产生任何写入')
    assert.equal(fetchCalls, 0, 'readiness 端点不得发起公网/provider 调用')
  })

  test('他人会话不进入最近会话摘要', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const teammate = await createUser()
    await addOrgMember(org, teammate, 'member')

    await CopilotSession.create({
      organizationId: org.id,
      sessionId: `csess_other_${Date.now()}`,
      scope: 'global',
      attribution: {},
      status: 'active',
      title: '队友的私密会话',
      archived: false,
      idempotencyKey: `ik_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      actorId: teammate.id,
    })

    const token = await login(client, owner.email)
    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)

    assert.isNull(res.body().data.recentSession)
    assert.notInclude(JSON.stringify(res.body()), '队友的私密会话')
  })

  test('本人会话进入最近会话摘要并开放 continue-session', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)

    await CopilotSession.create({
      organizationId: org.id,
      sessionId: `csess_mine_${Date.now()}`,
      scope: 'global',
      attribution: {},
      status: 'active',
      title: '我的排期讨论',
      archived: false,
      idempotencyKey: `ik_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      actorId: owner.id,
    })

    const token = await login(client, owner.email)
    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)

    const snapshot = res.body().data
    assert.equal(snapshot.recentSession?.titleSummary, '我的排期讨论')
    assert.include(snapshot.allowedActions, 'continue-session')
    assert.isTrue(parseCopilotEntryReadinessSnapshot(snapshot).ok)
  })

  test('归档会话不进入最近会话摘要', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)

    await CopilotSession.create({
      organizationId: org.id,
      sessionId: `csess_archived_${Date.now()}`,
      scope: 'global',
      attribution: {},
      status: 'active',
      title: '已归档会话',
      archived: true,
      idempotencyKey: `ik_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      actorId: owner.id,
    })

    const token = await login(client, owner.email)
    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)
    assert.isNull(res.body().data.recentSession)
    assert.notInclude(JSON.stringify(res.body()), '已归档会话')
  })
})
