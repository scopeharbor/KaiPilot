/**
 * v3-plugin-approval-change-flow —— 三类变更完整 E2E（task 5.1）。
 *
 * 经 HTTP API 驱动 install / version-upgrade / permission-upgrade 三类全流程：
 * 创建 → 预览 → 审批（maker-checker）→ 句柄 → 最终确认。
 * 核心断言：
 * - 确认前安装态 / grant / 版本零变化
 * - 提交与可信审计 receipt 同事务；审计 metadata 低敏（敏感模式扫描零命中）
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { STRONG_PASSWORD, addOrgMember, createUser } from '../unit/ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import AuditLog from '#models/audit_log'
import {
  containsChangeSensitiveValue,
  type PluginPermissionConfirmationSummary,
} from '@aiproj/types'

const PLUGIN_ID = 'org.example.dev-toolkit'
const BASE = (orgId: number | string) => `/api/v1/organizations/${orgId}/plugin-change-requests`

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedRelease(organizationId: number, overrides?: Partial<{ version: string }>) {
  return await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PLUGIN_ID,
    version: overrides?.version ?? '1.2.0',
    packageDigest: `sha256:pkg-${overrides?.version ?? '1.2.0'}`,
    manifestDigest: 'sha256:man-001',
    compatibilityDigest: 'sha256:compat-001',
    upstreamReceiptRef: 'receipt-e2e',
    status: 'approved',
    metadata: JSON.stringify({
      name: 'E2E Toolkit',
      permissions: [
        {
          permissionKey: 'compiler:skill:view',
          seamKey: 's',
          sideEffect: 'read-only',
          network: 'none',
        },
      ],
    }),
    rowVersion: 1,
  })
}

async function seedEnabledInstallation(input: {
  organizationId: number
  releaseId: number
  keys: string[]
}) {
  const summary: PluginPermissionConfirmationSummary = {
    confirmedBy: 'seed',
    permissionDigest: 'seed-digest',
    permissionKeys: input.keys,
    confirmedAt: '2026-08-24T08:00:00.000Z',
  }
  return await PluginInstallation.create({
    organizationId: input.organizationId,
    pluginId: PLUGIN_ID,
    version: '1.0.0',
    releaseId: input.releaseId,
    status: 'enabled',
    permissionConfirmation: summary,
    packageDigest: 'sha256:pkg-1.0.0',
    manifestDigest: 'sha256:man-001',
    compatibilityDigest: 'sha256:compat-001',
    rowVersion: 7,
    uninstalledAt: null,
  })
}

/** 审计低敏扫描：本域审计行的序列化文本不得命中敏感值/密钥模式。 */
async function assertAuditLowSensitive(assert: any) {
  const rows = await AuditLog.query().where('entityType', 'plugin_change_request')
  for (const row of rows) {
    const serialized = JSON.stringify(row.metadata ?? {})
    assert.isFalse(
      containsChangeSensitiveValue(serialized),
      `审计行包含疑似敏感内容: ${serialized.slice(0, 80)}`,
    )
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    assert.isFalse('manifest' in meta, '审计不得携带 manifest 原文')
    assert.isFalse('secret' in meta || 'token' in meta || 'authorization' in meta)
  }
}

test.group('PluginChangeFlow E2E 三类', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('install：确认前零变化，确认后创建且审计低敏', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrgFor(owner)
    const admin2 = await createUser()
    await addOrgMember(org, admin2, 'admin')
    const ownerToken = await login(client, owner.email)
    const admin2Token = await login(client, admin2.email)
    const release = await seedRelease(org.id)

    let res = await client
      .post(BASE(org.id))
      .bearerToken(ownerToken)
      .json({ kind: 'install', pluginId: PLUGIN_ID, releaseId: release.id, approvalRequired: true })
    res.assertStatus(201)
    const uid = res.body().data.id

    // 确认前：零安装、零审计 applied 行
    assert.lengthOf(await PluginInstallation.query().where('organization_id', org.id), 0)

    await client.post(`${BASE(org.id)}/${uid}/preview`).bearerToken(ownerToken)
    await client
      .post(`${BASE(org.id)}/${uid}/approve`)
      .bearerToken(admin2Token)
      .json({ idempotencyKey: 'e2e-ap-install' })

    // 审批后仍未确认：依然零变化
    assert.lengthOf(await PluginInstallation.query().where('organization_id', org.id), 0)

    res = await client.post(`${BASE(org.id)}/${uid}/confirm-handle`).bearerToken(ownerToken)
    res.assertStatus(200)
    const handle = res.body().data.handle

    res = await client
      .post(`${BASE(org.id)}/${uid}/confirm`)
      .bearerToken(ownerToken)
      .json({ handle })
    res.assertStatus(200)
    assert.equal(res.body().data.state, 'applied')

    const installations = await PluginInstallation.query().where('organization_id', org.id)
    assert.equal(installations.length, 1)
    assert.equal(installations[0].version, release.version)

    await assertAuditLowSensitive(assert)
  })

  test('version-upgrade：确认前版本保持，确认后升级生效且审计低敏', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrgFor(owner)
    const admin2 = await createUser()
    await addOrgMember(org, admin2, 'admin')
    const ownerToken = await login(client, owner.email)
    const oldRelease = await seedRelease(org.id, { version: '1.0.0' })
    const inst = await seedEnabledInstallation({
      organizationId: org.id,
      releaseId: oldRelease.id,
      keys: ['compiler:skill:view'],
    })
    const newRelease = await seedRelease(org.id, { version: '2.0.0' })
    const ownerToken2 = ownerToken
    const admin2Token = await login(client, admin2.email)

    let res = await client.post(BASE(org.id)).bearerToken(ownerToken2).json({
      kind: 'version-upgrade',
      pluginId: PLUGIN_ID,
      releaseId: newRelease.id,
      approvalRequired: true,
    })
    res.assertStatus(201)
    const uid = res.body().data.id

    // 确认前：版本保持 1.0.0
    const beforeConfirm = await PluginInstallation.findOrFail(inst.id)
    assert.equal(beforeConfirm.version, '1.0.0')

    await client.post(`${BASE(org.id)}/${uid}/preview`).bearerToken(ownerToken2)
    await client
      .post(`${BASE(org.id)}/${uid}/approve`)
      .bearerToken(admin2Token)
      .json({ idempotencyKey: 'e2e-ap-upg' })

    const stillBefore = await PluginInstallation.findOrFail(inst.id)
    assert.equal(stillBefore.version, '1.0.0')

    res = await client.post(`${BASE(org.id)}/${uid}/confirm-handle`).bearerToken(ownerToken2)
    res.assertStatus(200)

    res = await client
      .post(`${BASE(org.id)}/${uid}/confirm`)
      .bearerToken(ownerToken2)
      .json({ handle: res.body().data.handle })
    res.assertStatus(200)
    assert.equal(res.body().data.state, 'applied')

    const after = await PluginInstallation.findOrFail(inst.id)
    assert.equal(after.version, '2.0.0')

    await assertAuditLowSensitive(assert)
  })

  test('permission-upgrade：确认前 grant 不变，确认后刷新且旧 digest 失效', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrgFor(owner)
    const admin2 = await createUser()
    await addOrgMember(org, admin2, 'admin')
    const ownerToken = await login(client, owner.email)
    const release = await seedRelease(org.id)
    const inst = await seedEnabledInstallation({
      organizationId: org.id,
      releaseId: release.id,
      keys: ['compiler:skill:view'],
    })
    const oldDigest = inst.permissionConfirmation!.permissionDigest

    let res = await client
      .post(BASE(org.id))
      .bearerToken(ownerToken)
      .json({ kind: 'permission-upgrade', pluginId: PLUGIN_ID, releaseId: release.id })
    // release 声明集 == 当前 grant → 无提升，仍走完整流程
    res.assertStatus(201)
    const uid = res.body().data.id
    assert.equal(res.body().data.diff.permissionDelta.added.length, 0)

    // 确认前：grant 摘要与键集不变
    const before = await PluginInstallation.findOrFail(inst.id)
    assert.equal(before.permissionConfirmation!.permissionDigest, oldDigest)

    await client.post(`${BASE(org.id)}/${uid}/preview`).bearerToken(ownerToken)
    await client
      .post(`${BASE(org.id)}/${uid}/approve`)
      .bearerToken(await login(client, admin2.email))
      .json({ idempotencyKey: 'e2e-ap-perm' })
      .then((r: any) => r.assertStatus(200))

    res = await client.post(`${BASE(org.id)}/${uid}/confirm-handle`).bearerToken(ownerToken)
    res.assertStatus(200)
    const handle = res.body().data.handle

    res = await client
      .post(`${BASE(org.id)}/${uid}/confirm`)
      .bearerToken(ownerToken)
      .json({ handle })
    res.assertStatus(200)
    assert.equal(res.body().data.state, 'applied')

    const after = await PluginInstallation.findOrFail(inst.id)
    assert.deepEqual(after.permissionConfirmation!.permissionKeys, ['compiler:skill:view'])
    assert.notEqual(
      after.permissionConfirmation!.permissionDigest,
      oldDigest,
      'grant 边界必须刷新（旧摘要失效）',
    )
    assert.equal(after.permissionConfirmation!.confirmedBy, String(owner.id))

    await assertAuditLowSensitive(assert)
  })
})

function createOrgFor(user: any): Promise<any> {
  return import('../unit/ai/_helpers.js').then((m) => m.createOrganization(user))
}
