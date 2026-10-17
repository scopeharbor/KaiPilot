/**
 * v3-plugin-action-preview-boundary —— 插件动作统一边界 API 集成测试（task 4.2）。
 *
 * 覆盖：401 未认证 / 400 形状错误 / 403 权限不足 / 404 跨租非泄露 /
 * 409 stale 冲突 / 低敏错误 envelope / 幂等重放 API 行为。
 * 全部走本地测试库与 fixture，零外部网络。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import { seedPilotPluginFull } from '../fixtures/plugin_hook_pilot_release.js'
import PluginPilotItem from '#models/plugin_pilot_item'

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-actions`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

const PILOT_PLUGIN_ID = 'com.aiproj.pilot.actions'

/**
 * 时间锚点必须相对**测试执行时刻**取值，不能写死历史时间戳：
 * - `issueConfirmHandle` 的 preview 过期前置校验读真实 `Date.now()`；
 * - HTTP confirm 端点不注入 `nowIso`，句柄绑定的 `expiresAt` 同样按真实时钟判定。
 * 固定时间戳一旦滑到过去，seed helper 自身就抛 `handle-expired`，测试体永远走不到。
 * 整秒对齐以保持 `expiresAt` 的 `.000Z` 形态，让 digest 重算逐字节一致。
 */
function anchorIso(): string {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
}

/** 原生查询计数（Model 查询上的聚合列会被模型映射剥离，必须走 db.from）。 */
async function countPilotRows(orgId: number): Promise<number> {
  const dbModule = await import('@adonisjs/lucid/services/db')
  const Database = dbModule.default
  const rows = (await Database.from('plugin_pilot_items')
    .where('organization_id', orgId)
    .count('* as total')) as unknown as Array<{ total: number }>
  return Number(rows[0]?.total ?? 0)
}

/** 经 service 层准备一条已 preview + 已签发句柄的提案，返回上下文。 */
async function seedProposalWithHandle(orgId: number, installationId: number, actorUserId: number) {
  const { PluginActionBoundaryService } =
    await import('#services/plugin_action_boundary/boundary_service')
  const boundary = new PluginActionBoundaryService()
  const proposal = {
    schemaVersion: 'plugin-action-proposal-v1' as const,
    actionKind: 'plugin.pilot.item.create' as const,
    scope: { organizationId: orgId, projectId: null },
    inputPayload: { title: 'API 测试条目', content: '经统一边界确认写入' },
    sourceRefs: [
      {
        surface: 'server-hook' as const,
        pluginId: PILOT_PLUGIN_ID,
        pluginVersion: '1.0.0',
        installationId,
        contributionKey: 'pilot-item-create',
        contentDigest: 'aa11bb22',
        capturedAt: '2026-08-24T07:59:00.000Z',
      },
    ],
  }
  const { proposalUid } = await boundary.registerProposal({
    organizationId: orgId,
    projectId: null,
    proposal,
    proposedBy: null,
  })
  // preview 与句柄共用同一个「当下」锚点：TTL 600s 足够覆盖后续 HTTP 断言。
  const nowIso = anchorIso()
  await boundary.generatePreview({
    organizationId: orgId,
    proposalUid,
    actorUserId,
    actorPermissions: ['plugin_action:view', 'plugin_action:confirm'],
    nowIso,
  })
  const handle = await boundary.issueConfirmHandle({
    organizationId: orgId,
    proposalUid,
    actorUserId,
    actorPermissions: ['plugin_action:view', 'plugin_action:confirm'],
    nowIso,
  })
  return { boundary, proposalUid, handle }
}

test.group('PluginActions API', (group) => {
  useAiDatabase(group)

  test('未认证访问详情被拒且不返回数据', async ({ client, assert }) => {
    const res = await client.get(`${base(1)}/pact-some-uid`)
    assert.oneOf(res.status(), [401, 403])
    assert.notProperty(res.body(), 'data')
  })

  test('owner 可完成 preview→confirm 全链路并返回 receipt', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const seeded = await seedPilotPluginFull(org.id, {
      pluginId: PILOT_PLUGIN_ID,
      version: '1.0.0',
      installationStatus: 'enabled',
    })

    const { proposalUid, handle } = await seedProposalWithHandle(
      org.id,
      seeded.installationId,
      user.id,
    )
    const token = await login(client, user.email)

    const detail = await client.get(`${base(org.id)}/${proposalUid}`).bearerToken(token)
    detail.assertStatus(200)
    assert.equal(detail.body().data.proposalUid, proposalUid)
    assert.isNotNull(detail.body().data.preview)

    const confirmRes = await client
      .post(`${base(org.id)}/${proposalUid}/confirm`)
      .bearerToken(token)
      .json({ handle: handle.handle })
    confirmRes.assertStatus(200)
    assert.equal(confirmRes.body().data.status, 'applied')
    assert.isAbove(confirmRes.body().data.receipt.auditLogId, 0)

    const rows = await countPilotRows(org.id)
    assert.equal(rows, 1)
  })

  test('重复确认同句柄 → 幂等重放同一 receipt 且不重复写入', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const seeded = await seedPilotPluginFull(org.id, {
      pluginId: PILOT_PLUGIN_ID,
      version: '1.0.0',
      installationStatus: 'enabled',
    })
    const { proposalUid, handle } = await seedProposalWithHandle(
      org.id,
      seeded.installationId,
      user.id,
    )
    const token = await login(client, user.email)

    const first = await client
      .post(`${base(org.id)}/${proposalUid}/confirm`)
      .bearerToken(token)
      .json({ handle: handle.handle })
    first.assertStatus(200)
    assert.equal(first.body().data.status, 'applied')

    const replay = await client
      .post(`${base(org.id)}/${proposalUid}/confirm`)
      .bearerToken(token)
      .json({ handle: handle.handle })
    replay.assertStatus(200)
    assert.equal(replay.body().data.status, 'idempotent_replay')
    assert.deepEqual(replay.body().data.receipt, first.body().data.receipt)

    const rows = await countPilotRows(org.id)
    assert.equal(rows, 1)
  })

  test('缺少确认句柄 → 400 VALIDATION_ERROR', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const seeded = await seedPilotPluginFull(org.id, {
      pluginId: PILOT_PLUGIN_ID,
      version: '1.0.0',
      installationStatus: 'enabled',
    })
    const { proposalUid } = await seedProposalWithHandle(org.id, seeded.installationId, user.id)
    const token = await login(client, user.email)

    const res = await client
      .post(`${base(org.id)}/${proposalUid}/confirm`)
      .bearerToken(token)
      .json({})
    res.assertStatus(400)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
  })

  test('member 无 confirm 权限 → 403 且不泄露提案内容', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const seeded = await seedPilotPluginFull(org.id, {
      pluginId: PILOT_PLUGIN_ID,
      version: '1.0.0',
      installationStatus: 'enabled',
    })
    const { proposalUid, handle } = await seedProposalWithHandle(
      org.id,
      seeded.installationId,
      user.id,
    )

    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const memberToken = await login(client, member.email)

    const res = await client
      .post(`${base(org.id)}/${proposalUid}/confirm`)
      .bearerToken(memberToken)
      .json({ handle: handle.handle })
    res.assertStatus(403)
    assert.equal(res.body().error.code, 'PERMISSION_DENIED')
    assert.notProperty(res.body(), 'data')

    // member 可查看（view 权限）
    const view = await client.get(`${base(org.id)}/${proposalUid}`).bearerToken(memberToken)
    view.assertStatus(200)
  })

  test('跨组织访问 → 404 非泄露（先于权限判断隐藏存在性）', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const seeded = await seedPilotPluginFull(org.id, {
      pluginId: PILOT_PLUGIN_ID,
      version: '1.0.0',
      installationStatus: 'enabled',
    })
    const { proposalUid } = await seedProposalWithHandle(org.id, seeded.installationId, user.id)

    const outsider = await createUser()
    const otherOrg = await createOrganization(outsider)
    const outsiderToken = await login(client, outsider.email)

    const res = await client.get(`${base(otherOrg.id)}/${proposalUid}`).bearerToken(outsiderToken)
    res.assertStatus(404)
    assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
    assert.equal(res.body().error.message, '无法找到该提案')
  })

  test('未知 proposal uid → 404 非泄露', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(`${base(org.id)}/pact-nonexistent`).bearerToken(token)
    res.assertStatus(404)
    assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('preview 后目标并发变化 → confirm 409 preview-stale', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const seeded = await seedPilotPluginFull(org.id, {
      pluginId: PILOT_PLUGIN_ID,
      version: '1.0.0',
      installationStatus: 'enabled',
    })
    const { proposalUid, handle } = await seedProposalWithHandle(
      org.id,
      seeded.installationId,
      user.id,
    )

    // 并发追加 pilot 条目使 revision 前移
    await PluginPilotItem.create({
      organizationId: org.id,
      projectId: null,
      title: '并发',
      content: 'mover',
      createdBy: null,
    })

    const token = await login(client, user.email)
    const res = await client
      .post(`${base(org.id)}/${proposalUid}/confirm`)
      .bearerToken(token)
      .json({ handle: handle.handle })
    res.assertStatus(409)
    assert.equal(res.body().error.details.reasonCode, 'preview-stale')

    const rows = await countPilotRows(org.id)
    assert.equal(rows, 1) // 仅并发那条
  })

  test('decision 端点 reject 后正式表零写、非法 decision → 400', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const seeded = await seedPilotPluginFull(org.id, {
      pluginId: PILOT_PLUGIN_ID,
      version: '1.0.0',
      installationStatus: 'enabled',
    })
    const { proposalUid } = await seedProposalWithHandle(org.id, seeded.installationId, user.id)
    const token = await login(client, user.email)

    const bad = await client
      .post(`${base(org.id)}/${proposalUid}/decision`)
      .bearerToken(token)
      .json({ decision: 'auto-accept-everything' })
    bad.assertStatus(400)
    assert.equal(bad.body().error.code, 'VALIDATION_ERROR')

    const reject = await client
      .post(`${base(org.id)}/${proposalUid}/decision`)
      .bearerToken(token)
      .json({ decision: 'reject' })
    reject.assertStatus(200)
    assert.equal(reject.body().data.status, 'rejected')

    const rows = await countPilotRows(org.id)
    assert.equal(rows, 0)
  })
})
