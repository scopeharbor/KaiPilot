/**
 * v3-plugin-fixture-market-seed —— PluginFixtureSeedService 功能测试。
 *
 * 覆盖要求：
 * - profile guard 双层之 service 层：绕过 CLI 直接调用、production/unknown fail closed、
 *   非生产环境缺显式启用拒绝、production 数据库 zero-diff（tasks 2.3/2.4）
 * - 真实 lifecycle：审批门 → release 登记 → 可选两步安装；无任何旁路伪造；
 *   审计只来自正式 install 服务（tasks 3.1/3.2）
 * - 幂等 reseed、部分 invalid 逐项失败、零网络（fetch spy 恒 0）（tasks 3.2）
 * - 跨组织隔离、用户修改后 conflict、重启后 reseed 与 stale ref（tasks 3.4）
 * - reset 只处理 provenance + digest 匹配的 seed-owned 资源；优先 uninstall→withdraw；
 *   组织自建 release 不受影响（tasks 3.5/3.6）
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createOrganization, createUser } from './ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import PluginFixtureSeedRecord from '#models/plugin_fixture_seed_record'
import PluginPrivateRegistryEntry from '#models/plugin_private_registry_entry'
import AuditLog from '#models/audit_log'
import AuditService from '#services/audit_service'
import PluginInstallService from '#services/plugin_install_service'
import { PluginFixtureSeedService } from '#services/plugin_fixture_seed_service'
import { FIXTURE_SEED_CATALOG_V1 } from '@aiproj/types/plugin-fixture-market-seed-fixtures'
import type { FixtureSeedCatalogV1 } from '@aiproj/types/plugin-fixture-market-seed'

const RUNTIME_OK = { environment: 'development', explicitEnable: true }

function buildService(): PluginFixtureSeedService {
  return new PluginFixtureSeedService(new PluginInstallService(new AuditService()))
}

function cloneCatalogWith(
  mutate: (items: FixtureSeedCatalogV1['items']) => FixtureSeedCatalogV1['items'],
): FixtureSeedCatalogV1 {
  return { ...FIXTURE_SEED_CATALOG_V1, items: mutate(FIXTURE_SEED_CATALOG_V1.items) }
}

async function counts() {
  const [releases, installations, records] = await Promise.all([
    PluginPrivateRegistryRelease.query().count('* as total'),
    PluginInstallation.query().count('* as total'),
    PluginFixtureSeedRecord.query().count('* as total'),
  ])
  return {
    releases: Number(releases[0]?.$extras.total ?? 0),
    installations: Number(installations[0]?.$extras.total ?? 0),
    records: Number(records[0]?.$extras.total ?? 0),
  }
}

test.group('PluginFixtureSeedService', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('production 绕过 CLI 直接调用 fail closed 且数据库 zero-diff', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()
    const before = await counts()

    const report = await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: { environment: 'production', explicitEnable: true },
    })

    assert.equal(report.status, 'blocking')
    assert.equal(report.guardAllowed, false)
    assert.equal(report.guardCode, 'seed-profile-not-allowed')
    assert.lengthOf(report.items, 0)
    assert.equal(report.networkCalls, 0)
    const after = await counts()
    assert.deepEqual(after, before)
  })

  test('未知环境 fail closed；非生产环境缺显式启用同样拒绝（默认关闭）', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()
    const before = await counts()

    const unknownEnv = await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: { environment: 'staging', explicitEnable: true },
    })
    assert.equal(unknownEnv.guardCode, 'seed-profile-not-allowed')

    const noFlag = await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: { environment: 'development', explicitEnable: false },
    })
    assert.equal(noFlag.guardCode, 'seed-explicit-enable-missing')

    const after = await counts()
    assert.deepEqual(after, before)
  })

  test('smoke seed 创建 approved release 与最小 state；重复执行幂等不重复', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const first = await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
    })
    assert.equal(first.status, 'passed')
    assert.equal(first.counts.ok, 2)

    const releases = await PluginPrivateRegistryRelease.query()
      .where('organization_id', org.id)
      .where('status', 'approved')
    assert.lengthOf(releases, 2)
    for (const release of releases) {
      assert.isTrue(release.upstreamReceiptRef.startsWith('fixture-seed:'))
      const item = FIXTURE_SEED_CATALOG_V1.items.find(
        (i) => i.pluginIdentity === release.pluginIdentity,
      )
      assert.isOk(item)
      assert.equal(release.packageDigest, item!.expectedPackageDigest)
      assert.equal(release.manifestDigest, item!.expectedManifestDigest)
    }
    const records = await PluginFixtureSeedRecord.query().where('organization_id', org.id)
    assert.lengthOf(records, 2)
    for (const record of records) {
      assert.isNotNull(record.releaseId)
      assert.isNull(record.installationId)
    }

    // 未请求安装时绝不出现安装记录（无旁路直装）
    assert.lengthOf(await PluginInstallation.query().where('organization_id', org.id), 0)

    const second = await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
    })
    assert.equal(second.status, 'passed')
    assert.equal(second.counts.alreadyPresent, 2)
    assert.equal(second.counts.ok, 0)
    assert.lengthOf(await PluginPrivateRegistryRelease.query().where('organization_id', org.id), 2)
  })

  test('全链路零网络（fetch spy 计数 0）且安装走正式两步流并产生低敏审计', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    let networkCalls = 0
    const globalAny = globalThis as unknown as { fetch?: unknown }
    const previousFetch = globalAny.fetch
    globalAny.fetch = async () => {
      networkCalls += 1
      throw new Error('network forbidden')
    }
    try {
      const report = await service.seedToOrganization({
        organizationId: org.id,
        actorId: user.id,
        profile: 'smoke',
        runtime: RUNTIME_OK,
        install: true,
      })
      assert.equal(report.status, 'passed')
      assert.equal(networkCalls, 0)
      assert.equal(report.networkCalls, 0)
    } finally {
      globalAny.fetch = previousFetch
    }

    const installations = await PluginInstallation.query().where('organization_id', org.id)
    assert.lengthOf(installations, 2)
    // 安装必须经正式 confirm 流程落审计（而非 seed 伪造 receipt）
    const audits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'plugin_installation')
    assert.isAtLeast(audits.length, 2)
    const metaStr = JSON.stringify(audits.map((a) => a.metadata))
    assert.notInclude(metaStr.toLowerCase(), 'token')
    assert.notInclude(metaStr.toLowerCase(), 'secret')
    // state 记录回填 installation ref
    const records = await PluginFixtureSeedRecord.query().where('organization_id', org.id)
    assert.isTrue(records.every((r) => r.installationId !== null))
  })

  test('部分 invalid catalog 逐项失败：被拒条目零残留，其余正常入库', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const broken = cloneCatalogWith((items) =>
      items.map((item) =>
        item.itemId === 'local-dev-demo'
          ? {
              ...item,
              compatibility: {
                hostContractVersion: '1.0',
                requiredSeams: [{ seamKey: 'ghost.unknown-seam', seamVersion: '9.9.9' }],
              },
            }
          : item,
      ),
    )

    const report = await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
      catalog: broken,
    })

    assert.equal(report.status, 'blocking')
    assert.equal(report.counts.failed, 1)
    assert.equal(report.counts.ok, 1)
    const failedItem = report.items.find((i) => i.itemId === 'local-dev-demo')
    assert.equal(failedItem?.detailCode, 'seed-item-approval-rejected')

    const identityReleases = await PluginPrivateRegistryRelease.query().where(
      'organization_id',
      org.id,
    )
    const identities = identityReleases.map((r) => r.pluginIdentity)
    assert.notInclude(identities, 'com.aiproj.example.local-dev-demo')
    assert.include(identities, 'com.aiproj.canary-query')
    assert.lengthOf(await PluginFixtureSeedRecord.query().where('organization_id', org.id), 1)
  })

  test('跨组织隔离：state 与 release 均组织作用域，他组织不可见', async ({ assert }) => {
    const userA = await createUser()
    const orgA = await createOrganization(userA)
    const userB = await createUser()
    const orgB = await createOrganization(userB)
    const service = buildService()

    await service.seedToOrganization({
      organizationId: orgA.id,
      actorId: userA.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
    })

    const bReleases = await PluginPrivateRegistryRelease.query().where('organization_id', orgB.id)
    assert.lengthOf(bReleases, 0)
    const bRecords = await PluginFixtureSeedRecord.query().where('organization_id', orgB.id)
    assert.lengthOf(bRecords, 0)

    // 组织 B 自己 seed 得到独立副本（互不影响）
    const reportB = await service.seedToOrganization({
      organizationId: orgB.id,
      actorId: userB.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
    })
    assert.equal(reportB.status, 'passed')
    assert.equal(reportB.counts.alreadyPresent, 0)
  })

  test('reset 只处理 seed-owned：自建 release 不动、用户修改 conflict 跳过、withdraw 可恢复语义', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
    })
    // 安装一个 seed 插件以验证 uninstall 优先
    await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
      install: true,
    })
    // 组织自建 release（非 seed provenance）
    const selfBuilt = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: 'com.example.org-custom',
      version: '2.0.0',
      packageDigest: 'sha256:self-built-package',
      manifestDigest: 'sha256:self-built-manifest',
      compatibilityDigest: 'sha256:self-built-compat',
      upstreamReceiptRef: 'user-manual-upload-1',
      status: 'approved',
      metadata: JSON.stringify({ name: 'Org Custom' }),
      rowVersion: 1,
    })
    // 用户修改一个 seed release 的包摘要（漂移）
    const seeded = await PluginPrivateRegistryRelease.query()
      .where('organization_id', org.id)
      .where('plugin_identity', 'com.aiproj.canary-query')
      .first()
    seeded!.packageDigest = 'sha256:user-modified-package'
    await seeded!.save()

    const preview = await service.resetPreviewFromOrganization({
      organizationId: org.id,
      actorId: user.id,
      runtime: RUNTIME_OK,
    })
    const planById = new Map(preview.items.map((i) => [i.itemId, i]))
    assert.equal(planById.get('canary-query')?.detailCode, 'seed-reset-conflict-user-modified')
    assert.equal(planById.get('canary-query')?.outcome, 'skipped')
    assert.equal(planById.get('local-dev-demo')?.action, 'withdraw')
    assert.equal(planById.get('local-dev-demo')?.outcome, 'ok')
    assert.notInclude(
      preview.items.map((i) => i.itemId),
      'com.example.org-custom',
    )

    const confirmed = await service.resetConfirmFromOrganization({
      organizationId: org.id,
      actorId: user.id,
      runtime: RUNTIME_OK,
    })
    assert.equal(confirmed.status, 'passed')

    // 自建 release 完好
    const selfAfter = await PluginPrivateRegistryRelease.findOrFail(selfBuilt.id)
    assert.equal(selfAfter.status, 'approved')
    // 用户修改过的 seed release 不被触碰（conflict skip）
    const tamperedAfter = await PluginPrivateRegistryRelease.findOrFail(seeded!.id)
    assert.equal(tamperedAfter.status, 'approved')
    // 干净 seed release 被 withdraw（行保留，可 restore-request 恢复）
    const withdrawn = await PluginPrivateRegistryRelease.query()
      .where('organization_id', org.id)
      .where('plugin_identity', 'com.aiproj.example.local-dev-demo')
      .first()
    assert.equal(withdrawn!.status, 'withdrawn')
    // seed 安装：干净项被卸载（uninstalled，不删宿主资源）；conflict 项保持原状
    const demoInstallation = await PluginInstallation.query()
      .where('organization_id', org.id)
      .where('plugin_id', 'com.aiproj.example.local-dev-demo')
      .first()
    assert.equal(demoInstallation!.status, 'uninstalled')
    const conflictInstallation = await PluginInstallation.query()
      .where('organization_id', org.id)
      .where('plugin_id', 'com.aiproj.canary-query')
      .first()
    assert.notEqual(conflictInstallation!.status, 'uninstalled')
    // state refs：干净项清空；conflict 跳过项保留原引用
    const demoRecord = await PluginFixtureSeedRecord.query()
      .where('organization_id', org.id)
      .where('item_id', 'local-dev-demo')
      .first()
    assert.isNull(demoRecord!.releaseId)
    assert.isNull(demoRecord!.installationId)
    const conflictRecord = await PluginFixtureSeedRecord.query()
      .where('organization_id', org.id)
      .where('item_id', 'canary-query')
      .first()
    assert.isNotNull(conflictRecord!.releaseId)

    // 目录卡片：seed 创建的卡被回收；非本 release 指向的卡不动
    const demoCard = await PluginPrivateRegistryEntry.query()
      .where('organization_id', org.id)
      .where('plugin_identity', 'com.aiproj.example.local-dev-demo')
      .first()
    assert.isNull(demoCard)
  })

  test('重启后 reseed 复活新版本引用；stale ref 在 reset 中标记并可重建', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
    })
    const firstReleases = await PluginPrivateRegistryRelease.query().where(
      'organization_id',
      org.id,
    )
    const firstIds = firstReleases.map((r) => r.id)

    // 模拟外部清库（stale ref）：删除 release 行但保留 state
    for (const id of firstIds) {
      const row = await PluginPrivateRegistryRelease.findOrFail(id)
      await row.delete()
    }

    const stalePreview = await service.resetPreviewFromOrganization({
      organizationId: org.id,
      actorId: user.id,
      runtime: RUNTIME_OK,
    })
    assert.isTrue(stalePreview.items.every((i) => i.detailCode === 'seed-state-stale-ref'))

    // reseed：重新创建并刷新 state 引用（幂等键复用同一行）
    const reseed = await service.seedToOrganization({
      organizationId: org.id,
      actorId: user.id,
      profile: 'smoke',
      runtime: RUNTIME_OK,
    })
    assert.equal(reseed.status, 'passed')
    assert.equal(reseed.counts.ok, 2)
    const secondReleases = await PluginPrivateRegistryRelease.query().where(
      'organization_id',
      org.id,
    )
    const secondIds = secondReleases.map((r) => r.id)
    assert.lengthOf(secondIds, 2)
    const refreshedRecords = await PluginFixtureSeedRecord.query().where('organization_id', org.id)
    assert.lengthOf(refreshedRecords, 2)
    assert.isTrue(
      refreshedRecords.every((r) => r.releaseId !== null && secondIds.includes(r.releaseId)),
    )
  })
})
