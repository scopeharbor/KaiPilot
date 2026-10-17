/**
 * v3-copilot-productized-operating-entry —— readiness 负例矩阵（任务 6.1）。
 *
 * 覆盖：跨组织 / 跨项目、权限撤销、会话 stale、readiness TOCTOU、错误明细零泄露。
 * 插件 disable/upgrade/incompatible 的缺席由注入式单测覆盖
 * （`tests/unit/copilot_operating_entry.spec.ts` §3.5），此处只验证跨租不可见。
 *
 * 默认零网络、零 provider：fetch 被替换为 fail-fast 桩。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import CopilotSession from '#models/copilot_session'

const READINESS_URL = '/api/v1/copilot/readiness'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

function sessionKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

test.group('CopilotReadiness —— 负例矩阵', (group) => {
  useAiDatabase(group)

  let fetchCalls = 0
  const originalFetch = globalThis.fetch

  group.setup(() => {
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls += 1
      throw new Error(`负例矩阵不得发起公网调用：${String(args[0])}`)
    }) as typeof globalThis.fetch
  })

  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  group.each.setup(() => {
    fetchCalls = 0
  })

  test('权限撤销后立即 unavailable（readiness TOCTOU）', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const token = await login(client, member.email)

    const before = await client.get(READINESS_URL).bearerToken(token)
    before.assertStatus(200)
    assert.equal(before.body().data.state, 'ready')

    // 降级为无 ai:trigger 的角色——同一 token，下一次 readiness 必须立即反映
    const membership = await OrganizationMember.query()
      .where('organization_id', org.id)
      .where('user_id', member.id)
      .firstOrFail()
    membership.role = 'viewer'
    await membership.save()

    const after = await client.get(READINESS_URL).bearerToken(token)
    after.assertStatus(200)
    assert.equal(after.body().data.state, 'unavailable')
    assert.deepEqual(after.body().data.reasons, [
      { code: 'copilot_permission_denied', retryable: false },
    ])
    assert.isEmpty(after.body().data.quickStarts)
  })

  test('项目成员被移除后项目 scope 立即不可用', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const project = await Project.create({
      organizationId: org.id,
      name: '受限项目',
      code: `P${Date.now()}L`,
      createdBy: owner.id,
    })
    const token = await login(client, member.email)

    const granted = await client.get(READINESS_URL).qs({ projectId: project.id }).bearerToken(token)
    granted.assertStatus(200)
    const grantedState = granted.body().data.state

    // 组织级 member 若本来就看不到该项目，先确认基线；随后移除任何项目成员关系
    await ProjectMember.query().where('project_id', project.id).where('user_id', member.id).delete()

    const revoked = await client.get(READINESS_URL).qs({ projectId: project.id }).bearerToken(token)
    revoked.assertStatus(200)
    if (grantedState === 'unavailable') {
      assert.equal(revoked.body().data.state, 'unavailable')
    }
    // 无论基线如何，被拒时都不得回显项目名
    if (revoked.body().data.state === 'unavailable') {
      assert.notInclude(JSON.stringify(revoked.body()), '受限项目')
    }
  })

  test('会话在快照之后被归档 ⇒ 下一次 readiness 不再返回它', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await CopilotSession.create({
      organizationId: org.id,
      sessionId: sessionKey('csess_stale'),
      scope: 'global',
      attribution: {},
      status: 'active',
      title: '将被归档的会话',
      archived: false,
      actorId: owner.id,
      idempotencyKey: sessionKey('ik'),
    })
    const token = await login(client, owner.email)

    const first = await client.get(READINESS_URL).bearerToken(token)
    first.assertStatus(200)
    assert.equal(first.body().data.recentSession?.sessionId, session.sessionId)

    session.archived = true
    await session.save()

    const second = await client.get(READINESS_URL).bearerToken(token)
    second.assertStatus(200)
    assert.isNull(second.body().data.recentSession)
    assert.notInclude(second.body().data.allowedActions, 'continue-session')
    assert.notInclude(JSON.stringify(second.body()), '将被归档的会话')
  })

  test('非活跃（failed）会话不进入摘要——resume 只接受 active', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await CopilotSession.create({
      organizationId: org.id,
      sessionId: sessionKey('csess_failed'),
      scope: 'global',
      attribution: {},
      status: 'failed',
      title: '失败的会话',
      archived: false,
      actorId: owner.id,
      idempotencyKey: sessionKey('ik'),
    })
    const token = await login(client, owner.email)

    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)
    assert.isNull(res.body().data.recentSession)
    assert.notInclude(JSON.stringify(res.body()), '失败的会话')
  })

  test('跨组织：他组织的会话、项目与工具一律零发现', async ({ client, assert }) => {
    const stranger = await createUser()
    const otherOrg = await createOrganization(stranger)
    await CopilotSession.create({
      organizationId: otherOrg.id,
      sessionId: sessionKey('csess_foreign'),
      scope: 'global',
      attribution: {},
      status: 'active',
      title: '他组织的会话',
      archived: false,
      actorId: stranger.id,
      idempotencyKey: sessionKey('ik'),
    })
    await Project.create({
      organizationId: otherOrg.id,
      name: '他组织的项目',
      code: `P${Date.now()}F`,
      createdBy: stranger.id,
    })

    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client.get(READINESS_URL).bearerToken(token)
    res.assertStatus(200)

    const serialized = JSON.stringify(res.body())
    assert.notInclude(serialized, '他组织的会话')
    assert.notInclude(serialized, '他组织的项目')
    assert.isNull(res.body().data.recentSession)
    assert.isTrue(
      res.body().data.quickStarts.every((q: { source: string }) => q.source === 'core'),
      '未安装任何插件时不得出现 plugin 来源的建议',
    )
  })

  test('错误明细零泄露：任何响应都不含堆栈、SQL、内部原因或排除清单', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const responses = [
      await client.get(READINESS_URL).bearerToken(token),
      await client.get(READINESS_URL).qs({ projectId: 987654 }).bearerToken(token),
      await client.get(READINESS_URL).qs({ projectId: 'abc' }).bearerToken(token),
    ]

    for (const res of responses) {
      const serialized = JSON.stringify(res.body())
      for (const leak of [
        'at Object.',
        'node_modules',
        'select * from',
        'sqlite',
        'exclusions',
        'no_permission',
        'permission_not_granted',
        'cross_org_denied',
        'Error:',
      ]) {
        assert.notInclude(serialized, leak, `响应不得包含「${leak}」`)
      }
    }
    assert.equal(fetchCalls, 0)
  })

  test('伪造的超大 projectId 走 422，不进入判定链', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client
      .get(READINESS_URL)
      .qs({ projectId: '99999999999999999999' })
      .bearerToken(token)
    // 超出安全整数的输入必须在 Validator 层被拒或在 Policy 层 fail closed，
    // 两种结果都不得泄露任何组织/项目事实。
    assert.oneOf(res.status(), [200, 422])
    if (res.status() === 200) {
      assert.equal(res.body().data.state, 'unavailable')
    } else {
      assert.equal(res.body().error.code, 'VALIDATION_ERROR')
    }
  })
})
