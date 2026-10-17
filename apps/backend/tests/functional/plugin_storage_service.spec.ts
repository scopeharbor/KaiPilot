/**
 * v3-plugin-scoped-storage —— PluginStorageService 功能测试（任务 2.4 / 2.6 / 3.2）。
 *
 * 覆盖要求：
 * - 跨租/跨项目/跨插件统一非泄露拒绝（404 形状，错误不含 key 名）
 * - disabled/uninstalled 生命周期拒读写；卸载不删除数据；重新启用恢复
 * - stale revision CAS 冲突；create-only 语义
 * - 有界分页 envelope
 * - 单项大小 / 条目数 / 总量三层配额边界与超限原子拒绝（计数不变）
 * - 并发写同 key 同 revision 恰好一个成功
 * - usage reconcile probe 漂移检测与修复
 * - 顺序写入性能冒烟
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createOrganization, createUser } from './auth/_helpers.js'
import type Organization from '#models/organization'
import Project from '#models/project'
import type User from '#models/user'
import PluginInstallation from '#models/plugin_installation'
import PluginStorageNamespace from '#models/plugin_storage_namespace'
import PluginStorageEntry from '#models/plugin_storage_entry'
import PluginStorageService from '#services/plugin_storage/storage_service'

const PLUGIN_A = 'acme.storage-demo'
const PLUGIN_B = 'acme.other-storage'

test.group('PluginStorageService', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  const service = new PluginStorageService()

  interface World {
    user: User
    org: Organization
    otherOrg: Organization
    otherUser: User
    projectA: Project
    projectB: Project
    installation: PluginInstallation
  }

  async function seedWorld(): Promise<World> {
    const user = await createUser()
    const org = await createOrganization(user)
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)
    const projectA = await Project.create({
      organizationId: org.id,
      name: 'PA',
      code: `PA-${org.id}-${Date.now()}`,
      createdBy: user.id,
    })
    const projectB = await Project.create({
      organizationId: org.id,
      name: 'PB',
      code: `PB-${org.id}-${Date.now()}`,
      createdBy: user.id,
    })
    const installation = await PluginInstallation.create({
      organizationId: org.id,
      pluginId: PLUGIN_A,
      version: '1.0.0',
      releaseId: 1,
      status: 'enabled',
      packageDigest: 'pkg',
      manifestDigest: 'manifest',
      compatibilityDigest: 'compat',
    })
    return { user, org, otherOrg, otherUser, projectA, projectB, installation }
  }

  function rt(
    world: World,
    overrides?: Partial<{
      organizationId: number
      actorId: number
      pluginId: string
      scope: 'organization' | 'project'
      projectId: number | null
    }>,
  ) {
    return {
      organizationId: overrides?.organizationId ?? world.org.id,
      actorId: overrides?.actorId ?? world.user.id,
      pluginId: overrides?.pluginId ?? PLUGIN_A,
      scope: overrides?.scope ?? ('organization' as const),
      projectId: overrides?.projectId ?? null,
    }
  }

  test('跨组织/跨插件统一非泄露拒绝（404 形状，不含 key 名）', async ({ assert }) => {
    const world = await seedWorld()
    await service.put({ ...rt(world), key: 'secret-board.view', value: { a: 1 } })

    // 其他组织（无安装记录）
    const crossOrg = await service.get({
      ...rt(world, { organizationId: world.otherOrg.id, actorId: world.otherUser.id }),
      key: 'secret-board.view',
    })
    assert.isFalse(crossOrg.ok)
    if (!crossOrg.ok) {
      assert.equal(crossOrg.httpStatus, 404)
      assert.equal(crossOrg.reasonCode, 'storage-install-not-enabled')
      assert.notInclude(crossOrg.reasonCode, 'secret-board')
    }

    // 本组织但不同插件（安装存在、namespace 不存在）
    await PluginInstallation.create({
      organizationId: world.org.id,
      pluginId: PLUGIN_B,
      version: '1.0.0',
      releaseId: 1,
      status: 'enabled',
      packageDigest: 'pkg',
      manifestDigest: 'manifest',
      compatibilityDigest: 'compat',
    })
    const crossPlugin = await service.get({
      ...rt(world, { pluginId: PLUGIN_B }),
      key: 'secret-board.view',
    })
    assert.isFalse(crossPlugin.ok)
    if (!crossPlugin.ok) assert.equal(crossPlugin.httpStatus, 404)
  })

  test('跨项目隔离：project scope 寻址由服务端组合，客户端换 projectId 即不可见', async ({
    assert,
  }) => {
    const world = await seedWorld()
    await service.put({
      ...rt(world, { scope: 'project', projectId: world.projectA.id }),
      key: 'board.state',
      value: { lane: 'todo' },
    })

    const okRead = await service.get({
      ...rt(world, { scope: 'project', projectId: world.projectA.id }),
      key: 'board.state',
    })
    assert.isTrue(okRead.ok)

    const crossProject = await service.get({
      ...rt(world, { scope: 'project', projectId: world.projectB.id }),
      key: 'board.state',
    })
    assert.isFalse(crossProject.ok)
    if (!crossProject.ok) assert.equal(crossProject.httpStatus, 404)

    // 不同项目写入会落到各自 namespace，互不串扰
    await service.put({
      ...rt(world, { scope: 'project', projectId: world.projectB.id }),
      key: 'board.state',
      value: { lane: 'doing' },
    })
    const b = await service.get({
      ...rt(world, { scope: 'project', projectId: world.projectB.id }),
      key: 'board.state',
    })
    assert.isTrue(b.ok)
    if (b.ok) assert.deepEqual(b.entry.value, { lane: 'doing' })
  })

  test('stale revision 冲突与 create-only 语义', async ({ assert }) => {
    const world = await seedWorld()
    const created = await service.put({ ...rt(world), key: 'cfg.main', value: { v: 1 } })
    assert.isTrue(created.ok)
    if (created.ok) assert.equal(created.entry.revision, 1)

    // 正确 revision 覆盖成功
    const updated = await service.put({
      ...rt(world),
      key: 'cfg.main',
      value: { v: 2 },
      expectedRevision: 1,
    })
    assert.isTrue(updated.ok)
    if (updated.ok) assert.equal(updated.entry.revision, 2)

    // 过期 revision → conflict
    const stale = await service.put({
      ...rt(world),
      key: 'cfg.main',
      value: { v: 3 },
      expectedRevision: 1,
    })
    assert.isFalse(stale.ok)
    if (!stale.ok) {
      assert.equal(stale.reasonCode, 'storage-revision-conflict')
      assert.equal(stale.httpStatus, 409)
    }

    // 缺省 expectedRevision = 仅新建；已存在即冲突
    const createOnly = await service.put({ ...rt(world), key: 'cfg.main', value: { v: 4 } })
    assert.isFalse(createOnly.ok)
    if (!createOnly.ok) assert.equal(createOnly.reasonCode, 'storage-revision-conflict')
  })

  test('有界分页 envelope', async ({ assert }) => {
    const world = await seedWorld()
    for (let i = 0; i < 7; i++) {
      const r = await service.put({ ...rt(world), key: `item-${i}`, value: { i } })
      assert.isTrue(r.ok)
    }
    const page2 = await service.list({ ...rt(world), page: 2, perPage: 3 })
    assert.isTrue(page2.ok)
    if (page2.ok) {
      assert.equal(page2.result.data.length, 3)
      assert.equal(page2.result.meta.total, 7)
      assert.equal(page2.result.meta.page, 2)
      assert.equal(page2.result.meta.totalPages, 3)
    }
    const badPage = await service.list({ ...rt(world), page: 0 })
    assert.isFalse(badPage.ok)
    if (!badPage.ok) assert.equal(badPage.httpStatus, 400)
  })

  test('单项超限 413；条目数与总量配额原子拒绝且计数不变', async ({ assert }) => {
    const world = await seedWorld()
    // 单项过大
    const big = await service.put({
      ...rt(world),
      key: 'big.blob',
      value: { blob: 'x'.repeat(64 * 1024) },
    })
    assert.isFalse(big.ok)
    if (!big.ok) {
      assert.equal(big.reasonCode, 'storage-value-too-large')
      assert.equal(big.httpStatus, 413)
    }

    // 条目数上限：把配额压到 1 后第二条新 key 应被拒
    const first = await service.put({ ...rt(world), key: 'k.first', value: { n: 1 } })
    assert.isTrue(first.ok)
    const ns = await PluginStorageNamespace.query()
      .where('organization_id', world.org.id)
      .where('plugin_id', PLUGIN_A)
      .firstOrFail()
    ns.quotaEntries = 1
    await ns.save()
    const second = await service.put({ ...rt(world), key: 'k.second', value: { n: 2 } })
    assert.isFalse(second.ok)
    if (!second.ok) assert.equal(second.reasonCode, 'storage-entry-limit-reached')

    // 总量原子拒绝：压缩字节配额后，写入新 key 的正向 delta 应整体失败，计数保持一致
    ns.quotaBytes = 10
    await ns.save()
    const overBytes = await service.put({ ...rt(world), key: 'k.overflow', value: { n: 123456 } })
    assert.isFalse(overBytes.ok)
    if (!overBytes.ok) assert.equal(overBytes.reasonCode, 'storage-quota-exceeded')
    const overflowRow = await PluginStorageEntry.query()
      .where('namespace_id', ns.id)
      .where('key', 'k.overflow')
      .first()
    assert.isNull(overflowRow, '被拒绝的写入不得落库')
    const after = await PluginStorageEntry.query()
      .where('namespace_id', ns.id)
      .where('key', 'k.first')
      .firstOrFail()
    assert.deepEqual(after.value, { n: 1 }, '被拒绝的写入不得改变既有数据')
    const nsAfter = await PluginStorageNamespace.findOrFail(ns.id)
    assert.equal(nsAfter.usedBytes, after.byteSize)
    assert.equal(nsAfter.usedEntries, 1)
  })

  test('并发写同 key：CAS 保证恰好一个胜出（SQLite 串行化写者，按交错语义验证）', async ({
    assert,
  }) => {
    const world = await seedWorld()
    await service.put({ ...rt(world), key: 'race.cfg', value: { gen: 0 } })
    // SQLite 下写者是串行的，真正的并行争用无法在本机稳定复现；
    // 这里以同一 expectedRevision 的两次交错提交验证 CAS 不变量：恰好一次成功。
    const first = await service.put({
      ...rt(world),
      key: 'race.cfg',
      value: { gen: 1 },
      expectedRevision: 1,
    })
    const second = await service.put({
      ...rt(world),
      key: 'race.cfg',
      value: { gen: 2 },
      expectedRevision: 1,
    })
    const outcomes = [first.ok, second.ok]
    assert.equal(outcomes.filter(Boolean).length, 1, 'CAS 下双写只能成功一个')
    const finalRow = await PluginStorageEntry.query().where('key', 'race.cfg').firstOrFail()
    assert.equal(finalRow.revision, 2)
  })

  test('usage reconcile probe：漂移检测与修复', async ({ assert }) => {
    const world = await seedWorld()
    await service.put({ ...rt(world), key: 'rec.a', value: { x: 'y'.repeat(100) } })
    const ns = await PluginStorageNamespace.query()
      .where('organization_id', world.org.id)
      .where('plugin_id', PLUGIN_A)
      .firstOrFail()
    ns.usedBytes += 999
    await ns.save()

    const probe = await service.reconcileUsage(ns.id, false)
    assert.isTrue(probe.drift)
    assert.isFalse(probe.fixed)

    const repaired = await service.reconcileUsage(ns.id, true)
    assert.isTrue(repaired.drift)
    assert.isTrue(repaired.fixed)
    assert.equal(repaired.storedBytes, repaired.actualBytes)
    assert.equal(repaired.storedEntries, repaired.actualEntries)
  })

  test('顺序写入性能冒烟（50 次 put < 15s）', async ({ assert }) => {
    const world = await seedWorld()
    const started = Date.now()
    for (let i = 0; i < 50; i++) {
      const r = await service.put({
        ...rt(world),
        key: `perf.${i}`,
        value: { i, pad: 'p'.repeat(32) },
      })
      assert.isTrue(r.ok)
    }
    const elapsed = Date.now() - started
    assert.isTrue(elapsed < 15000, `50 次写入耗时 ${elapsed}ms，超出预算`)
  }).timeout(30000)

  test('停用拒读写但不删除数据；namespace 状态门独立生效', async ({ assert }) => {
    const world = await seedWorld()
    await service.put({ ...rt(world), key: 'keep.data', value: { survive: true } })

    // 安装态停用（enabled -> installed）
    world.installation.status = 'installed'
    await world.installation.save()
    await service.syncLifecycleForInstallation({
      installationId: world.installation.id,
      organizationId: world.org.id,
      pluginId: PLUGIN_A,
      installStatus: 'installed',
    })
    const deniedWrite = await service.put({ ...rt(world), key: 'keep.data', value: { x: 2 } })
    assert.isFalse(deniedWrite.ok)
    if (!deniedWrite.ok) assert.equal(deniedWrite.reasonCode, 'storage-install-not-enabled')

    // 安装态恢复 enabled 但 namespace 处于 read-only（宿主侧状态门）
    world.installation.status = 'enabled'
    await world.installation.save()
    const ns = await PluginStorageNamespace.query()
      .where('organization_id', world.org.id)
      .where('plugin_id', PLUGIN_A)
      .firstOrFail()
    ns.status = 'read-only'
    await ns.save()
    const readOnlyGet = await service.get({ ...rt(world), key: 'keep.data' })
    assert.isFalse(readOnlyGet.ok)
    if (!readOnlyGet.ok) assert.equal(readOnlyGet.reasonCode, 'storage-namespace-read-only')
    const readOnlyPut = await service.put({
      ...rt(world),
      key: 'keep.data',
      value: { x: 3 },
      expectedRevision: 1,
    })
    assert.isFalse(readOnlyPut.ok)
    if (!readOnlyPut.ok) assert.equal(readOnlyPut.reasonCode, 'storage-namespace-read-only')

    // 数据仍在（停用绝不删除）
    const persisted = await PluginStorageEntry.query().where('key', 'keep.data').first()
    assert.isOk(persisted)
    assert.deepEqual(persisted?.value, { survive: true })
  })

  test('卸载进入 orphaned 并设保留期；数据保留；重新启用恢复 active（升级语义复用同一 namespace）', async ({
    assert,
  }) => {
    const world = await seedWorld()
    await service.put({ ...rt(world), key: 'orphan.test', value: { keep: 'yes' } })
    const nsBefore = await PluginStorageNamespace.query()
      .where('organization_id', world.org.id)
      .where('plugin_id', PLUGIN_A)
      .firstOrFail()

    // 卸载：namespace → orphaned + retention_until；runtime 全拒；数据保留
    await service.syncLifecycleForInstallation({
      installationId: world.installation.id,
      organizationId: world.org.id,
      pluginId: PLUGIN_A,
      installStatus: 'uninstalled',
    })
    const nsOrphaned = await PluginStorageNamespace.findOrFail(nsBefore.id)
    assert.equal(nsOrphaned.status, 'orphaned')
    assert.isNotNull(nsOrphaned.orphanedAt)
    assert.isNotNull(nsOrphaned.retentionUntil)
    const deniedDuringOrphan = await service.get({ ...rt(world), key: 'orphan.test' })
    assert.isFalse(deniedDuringOrphan.ok)
    if (!deniedDuringOrphan.ok)
      assert.equal(deniedDuringOrphan.reasonCode, 'storage-namespace-orphaned')
    const stillThere = await PluginStorageEntry.query().where('key', 'orphan.test').first()
    assert.isOk(stillThere, '卸载不得静默删除数据')

    // 重新启用（升级重装）：恢复 active，清空保留期字段，namespace 行复用
    await service.syncLifecycleForInstallation({
      installationId: world.installation.id,
      organizationId: world.org.id,
      pluginId: PLUGIN_A,
      installStatus: 'enabled',
    })
    const nsReactivated = await PluginStorageNamespace.findOrFail(nsBefore.id)
    assert.equal(nsReactivated.id, nsBefore.id, '启用复用同一 namespace')
    assert.equal(nsReactivated.status, 'active')
    assert.isNull(nsReactivated.orphanedAt)
    assert.isNull(nsReactivated.retentionUntil)
    const readableAgain = await service.get({ ...rt(world), key: 'orphan.test' })
    assert.isTrue(readableAgain.ok)
  })
})
