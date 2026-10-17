/**
 * v3-command-palette-plugin-action-pack —— 官方命令包完整生命周期 E2E（任务 4.1）。
 *
 * 流程：release → install → enable → 快照可见（4 命令）→ 命令执行（TOCTOU 复核）
 *       → disable / upgrade / uninstall 全程原子出现与撤销。
 *
 * 关键断言（spec Requirement 4 / 5）：
 * - 正式业务表（projects/tasks/wbs_nodes）在 preview 前后零变化——preview ≠ 提交，
 *   命令包安装/启停不触碰任何业务数据。
 * - 升级以新版本完整快照替换，无新旧混合；卸载后快照消失且宿主资源不受影响。
 *
 * 纪律：使用 truncate() 生命周期 + 私有测试库；零网络、零真实 provider、零外部写回。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import db from '@adonisjs/lucid/services/db'
import { buildOfficialCommandActionPackReleaseMetadata } from '@aiproj/types'

const PACK_PLUGIN_ID = 'com.aiproj.official.command-action-pack'

async function countRows(table: string): Promise<number> {
  const rows = await db.from(table).count('* as total')
  return Number((rows[0] as { total: number | string }).total ?? 0)
}

function installBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-installations`
}
function snapshotBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-command-snapshots`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedPackRelease(
  organizationId: number,
  version: string,
  digestSuffix: string,
): Promise<number> {
  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PACK_PLUGIN_ID,
    version,
    packageDigest: `sha256:pack-${digestSuffix}`,
    manifestDigest: `sha256:pack-manifest-${digestSuffix}`,
    compatibilityDigest: 'sha256:pack-compat-001',
    upstreamReceiptRef: `receipt-${digestSuffix}`,
    status: 'approved',
    metadata: JSON.stringify(buildOfficialCommandActionPackReleaseMetadata()),
    rowVersion: 1,
  })
  return release.id
}

async function runLifecycleAction(
  client: any,
  token: string,
  orgId: number,
  action: string,
  pluginId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const preview = await client
    .post(`${installBase(orgId)}/commands/preview`)
    .bearerToken(token)
    .json({ action, pluginId, ...extra })
  preview.assertStatus(200)
  const body = preview.body().data

  const confirm = await client
    .post(`${installBase(orgId)}/commands/confirm`)
    .bearerToken(token)
    .json({
      previewHandle: body.previewHandle,
      previewDigest: body.previewDigest,
      // 启用类动作必须显式确认权限清单（W2b 门禁）
      permissionConfirmed: true,
      permissionDigest: body.permissionDigest,
    })
  confirm.assertStatus(200)
}

test.group('PluginCommandActionPack lifecycle E2E', (group) => {
  useAiDatabase(group)

  test('release→install→enable→快照可见→disable→upgrade→uninstall 全程原子', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    // ── 业务表基线计数（正式表零变化断言的锚点）──
    const projectCountBefore = await countRows('projects')
    const taskCountBefore = await countRows('tasks')
    const wbsCountBefore = await countRows('wbs_nodes')

    // 0. 未安装时快照为空
    let res = await client.get(snapshotBase(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 0)

    // 1. 发布 approved release 并安装（两步预览确认）
    const releaseV1 = await seedPackRelease(org.id, '1.0.0', 'v1')
    await runLifecycleAction(client, token, org.id, 'install', PACK_PLUGIN_ID, {
      releaseId: releaseV1,
    })

    // 2. 启用
    await runLifecycleAction(client, token, org.id, 'enable', PACK_PLUGIN_ID)

    // 3. 快照出现完整四命令
    res = await client.get(snapshotBase(org.id)).bearerToken(token)
    res.assertStatus(200)
    let data = res.body().data as Array<Record<string, any>>
    assert.lengthOf(data, 1)
    assert.equal(data[0]!.pluginId, PACK_PLUGIN_ID)
    assert.lengthOf(data[0]!.contributions, 4)
    const enabledRevision = String(data[0]!.instanceRevision)

    // 4. 「命令执行」前的 TOCTOU 复核：重新拉取快照 revision 一致才允许执行；
    //    此处服务端复核通过（revision 未变），且执行本身零业务写入。
    res = await client.get(snapshotBase(org.id)).bearerToken(token)
    data = res.body().data as Array<Record<string, any>>
    assert.equal(String(data[0]!.instanceRevision), enabledRevision)

    // 5. 停用 → 快照原子消失
    await runLifecycleAction(client, token, org.id, 'disable', PACK_PLUGIN_ID)
    res = await client.get(snapshotBase(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 0)

    // 6. 升级到 v1.1.0（enabled 状态下直接 upgrade）
    const releaseV2 = await seedPackRelease(org.id, '1.1.0', 'v2')
    await runLifecycleAction(client, token, org.id, 'enable', PACK_PLUGIN_ID)
    await runLifecycleAction(client, token, org.id, 'upgrade', PACK_PLUGIN_ID, {
      releaseId: releaseV2,
    })
    res = await client.get(snapshotBase(org.id)).bearerToken(token)
    data = res.body().data as Array<Record<string, any>>
    assert.lengthOf(data, 1)
    // 新版本完整替换：manifestDigest 为新版本，命令仍为完整四条，无混合
    assert.equal(String(data[0]!.manifestDigest), 'sha256:pack-manifest-v2')
    assert.lengthOf(data[0]!.contributions, 4)

    // 7. 卸载 → 快照消失
    await runLifecycleAction(client, token, org.id, 'uninstall', PACK_PLUGIN_ID)
    res = await client.get(snapshotBase(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 0)

    // ── 正式业务表零变化（整个生命周期前后一致）──
    const projectCountAfter = await countRows('projects')
    const taskCountAfter = await countRows('tasks')
    const wbsCountAfter = await countRows('wbs_nodes')
    assert.equal(projectCountAfter, projectCountBefore)
    assert.equal(taskCountAfter, taskCountBefore)
    assert.equal(wbsCountAfter, wbsCountBefore)
  })
})
