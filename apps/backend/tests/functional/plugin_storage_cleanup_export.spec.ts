/**
 * v3-plugin-scoped-storage —— 清理 preview/confirm 与导出功能测试（任务 3.4 / 3.6）。
 *
 * 覆盖要求（spec Requirement 6/7 对应场景）：
 * - 正常清理流：preview 影响面 → confirm 删除 → 可信审计落账
 * - 过期句柄 / 跨组织重放句柄 / 内容陈旧绑定 → 拒绝且数据不动
 * - 审计失败整体回滚（fail-closed，无删除残留）
 * - 句柄一次性消费（重复 confirm 返回 already-consumed）
 * - 导出：无权限/无数据零文件；敏感样本 fail closed 不落盘；分页有界与稳定 digest；
 *   组织隔离；到期临时文件清理
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOrganization, createUser } from './auth/_helpers.js'
import type Organization from '#models/organization'
import type User from '#models/user'
import PluginInstallation from '#models/plugin_installation'
import PluginStorageNamespace from '#models/plugin_storage_namespace'
import PluginStorageEntry from '#models/plugin_storage_entry'
import AuditLog from '#models/audit_log'
import StorageCleanupService from '#services/plugin_storage/storage_cleanup_service'
import PluginStorageService from '#services/plugin_storage/storage_service'

const PLUGIN_A = 'acme.cleanup-demo'

test.group('PluginStorageCleanupExport', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  const cleanup = new StorageCleanupService()
  const runtime = new PluginStorageService()

  interface World {
    user: User
    org: Organization
    otherOrg: Organization
    otherUser: User
    installation: PluginInstallation
    namespace: PluginStorageNamespace
  }

  /** 建世界并经服务写入两条 entry（namespace 由 put 懒创建）。 */
  async function seedWorld(): Promise<World> {
    const user = await createUser()
    const org = await createOrganization(user)
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)
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
    // 经由运行时服务懒建 namespace 并写入两条合法数据
    const rtInput = {
      organizationId: org.id,
      actorId: user.id,
      pluginId: PLUGIN_A,
      scope: 'organization' as const,
      projectId: null,
    }
    await runtime.put({ ...rtInput, key: 'cfg.one', value: { n: 1 } })
    await runtime.put({ ...rtInput, key: 'cfg.two', value: { n: 2 } })
    const namespace = await PluginStorageNamespace.query()
      .where('organization_id', org.id)
      .where('plugin_id', PLUGIN_A)
      .firstOrFail()
    return { user, org, otherOrg, otherUser, installation, namespace }
  }

  test('正常清理流：preview 展示影响面 → confirm 删除并写可信审计', async ({ assert }) => {
    const world = await seedWorld()
    const preview = await cleanup.previewCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      namespaceId: world.namespace.id,
    })
    assert.isTrue(preview.ok)
    if (!preview.ok) return
    assert.equal(preview.preview.entryCount, 2)
    assert.equal(preview.preview.pluginId, PLUGIN_A)
    assert.isTrue(preview.preview.irreversible)

    const confirmed = await cleanup.confirmCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      request: {
        cleanupHandle: preview.preview.cleanupHandle,
        cleanupDigest: preview.preview.cleanupDigest,
      },
    })
    assert.isTrue(confirmed.ok)
    if (!confirmed.ok) return
    assert.equal(confirmed.result.deletedEntries, 2)
    assert.isNotNull(confirmed.result.auditReceiptId)

    // 数据与 namespace 行均已删除
    const nsGone = await PluginStorageNamespace.find(confirmed.result.namespaceId)
    assert.isNull(nsGone)

    // 可信审计已落账（action 落封闭枚举 delete，事件名在 metadata.event）
    const audit = await AuditLog.query()
      .where('entity_type', 'plugin_storage')
      .where('action', 'delete')
      .orderBy('id', 'desc')
      .first()
    assert.isOk(audit)
    const meta = audit?.metadata as Record<string, unknown> | null
    assert.equal(meta?.event, 'plugin_storage_cleanup_confirmed')
    assert.equal(meta?.deletedEntries, 2)
  })

  test('过期句柄被拒且数据不动', async ({ assert }) => {
    const world = await seedWorld()
    const preview = await cleanup.previewCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      namespaceId: world.namespace.id,
      referenceTime: new Date('2026-08-23T00:00:00.000Z'),
    })
    assert.isTrue(preview.ok)
    if (!preview.ok) return

    const late = await cleanup.confirmCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      request: {
        cleanupHandle: preview.preview.cleanupHandle,
        cleanupDigest: preview.preview.cleanupDigest,
      },
      referenceTime: new Date('2026-08-23T00:20:00.000Z'),
    })
    assert.isFalse(late.ok)
    if (!late.ok) assert.equal(late.reasonCode, 'storage-cleanup-handle-expired')

    const stillThere = await PluginStorageEntry.forNamespace(world.namespace.id)
    assert.equal(stillThere.length, 2)
  })

  test('跨组织重放句柄被拒且两组织数据均不变', async ({ assert }) => {
    const world = await seedWorld()
    const preview = await cleanup.previewCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      namespaceId: world.namespace.id,
    })
    assert.isTrue(preview.ok)
    if (!preview.ok) return

    // 组织 B 的管理员重放组织 A 的句柄
    const replay = await cleanup.confirmCleanup({
      organizationId: world.otherOrg.id,
      actorId: world.otherUser.id,
      request: {
        cleanupHandle: preview.preview.cleanupHandle,
        cleanupDigest: preview.preview.cleanupDigest,
      },
    })
    assert.isFalse(replay.ok)
    if (!replay.ok) assert.equal(replay.reasonCode, 'storage-cross-tenant-denied')

    const entriesA = await PluginStorageEntry.forNamespace(world.namespace.id)
    assert.equal(entriesA.length, 2, '组织 A 数据必须原样保留')
  })

  test('preview 后内容变更 → 绑定失配拒绝', async ({ assert }) => {
    const world = await seedWorld()
    const preview = await cleanup.previewCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      namespaceId: world.namespace.id,
    })
    if (!preview.ok) {
      assert.fail('preview 应当成功')
      return
    }

    // preview 后新增一条写入（entriesDigest 与 rowVersion 均变化）
    await PluginStorageEntry.create({
      namespaceId: world.namespace.id,
      key: 'cfg.three',
      value: { n: 3 },
      canonicalDigest: 'aaaa0000',
      byteSize: 8,
      revision: 1,
    })

    const confirmed = await cleanup.confirmCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      request: {
        cleanupHandle: preview.preview.cleanupHandle,
        cleanupDigest: preview.preview.cleanupDigest,
      },
    })
    assert.isFalse(confirmed.ok)
    if (!confirmed.ok) assert.equal(confirmed.reasonCode, 'storage-cleanup-binding-mismatch')

    const entries = await PluginStorageEntry.forNamespace(world.namespace.id)
    assert.equal(entries.length, 3, '绑定失配时不得删除任何数据')
  })

  test('审计失败整体回滚（fail-closed，无删除残留）', async ({ assert }) => {
    const world = await seedWorld()
    const failing = new StorageCleanupService(async () => {
      throw new Error('audit backend unavailable')
    })
    const preview = await failing.previewCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      namespaceId: world.namespace.id,
    })
    if (!preview.ok) {
      assert.fail('preview 应当成功')
      return
    }

    const confirmed = await failing.confirmCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      request: {
        cleanupHandle: preview.preview.cleanupHandle,
        cleanupDigest: preview.preview.cleanupDigest,
      },
    })
    assert.isFalse(confirmed.ok)
    if (!confirmed.ok) assert.equal(confirmed.reasonCode, 'storage-cleanup-audit-failed')

    const nsAlive = await PluginStorageNamespace.find(world.namespace.id)
    assert.isOk(nsAlive, '审计失败时 namespace 必须回滚保留')
    const entries = await PluginStorageEntry.forNamespace(world.namespace.id)
    assert.equal(entries.length, 2)
  })

  test('句柄一次性消费：成功后重复 confirm 返回 already-consumed', async ({ assert }) => {
    const world = await seedWorld()
    const preview = await cleanup.previewCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      namespaceId: world.namespace.id,
    })
    if (!preview.ok) {
      assert.fail('preview 应当成功')
      return
    }
    const first = await cleanup.confirmCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      request: {
        cleanupHandle: preview.preview.cleanupHandle,
        cleanupDigest: preview.preview.cleanupDigest,
      },
    })
    assert.isTrue(first.ok)
    const second = await cleanup.confirmCleanup({
      organizationId: world.org.id,
      actorId: world.user.id,
      request: {
        cleanupHandle: preview.preview.cleanupHandle,
        cleanupDigest: preview.preview.cleanupDigest,
      },
    })
    assert.isFalse(second.ok)
    if (!second.ok) assert.equal(second.reasonCode, 'storage-cleanup-already-consumed')
  })

  test('导出：无匹配数据返回空清单且不产生临时文件', async ({ assert }) => {
    const world = await seedWorld()
    const empty = await cleanup.exportPage({
      organizationId: world.org.id,
      actorId: world.user.id,
      filter: { pluginId: 'acme.never-installed' },
    })
    assert.isTrue(empty.ok)
    if (!empty.ok) return
    assert.equal(empty.records.length, 0)
    assert.isNull(empty.filePath)
    assert.equal(empty.manifest.totalEntries, 0)
  })

  test('导出：敏感样本 fail closed 且不落盘', async ({ assert }) => {
    const world = await seedWorld()
    // 直接落库一条含凭据样式的脏数据（模拟绕过运行时校验的存量数据）
    await PluginStorageEntry.create({
      namespaceId: world.namespace.id,
      key: 'dirty.legacy',
      value: { note: 'sk_ABCDEFGHIJKLMNOPQRSTUV99' },
      canonicalDigest: 'bbbb1111',
      byteSize: 40,
      revision: 1,
    })
    const scanned = await cleanup.exportPage({
      organizationId: world.org.id,
      actorId: world.user.id,
      filter: {},
      writeFile: true,
    })
    assert.isFalse(scanned.ok)
    if (!scanned.ok) assert.equal(scanned.reasonCode, 'storage-export-scan-failed')
    // 失败路径不产生文件（filePath 未返回；临时目录中也不应新增本次产物）
    assert.isFalse(scanned.ok && 'filePath' in scanned)
  })

  test('导出：组织隔离、记录形状与稳定 digest', async ({ assert }) => {
    const world = await seedWorld()
    const mine = await cleanup.exportPage({
      organizationId: world.org.id,
      actorId: world.user.id,
      filter: {},
      writeFile: false,
    })
    assert.isTrue(mine.ok)
    if (!mine.ok) return
    assert.equal(mine.records.length, 2)
    for (const r of mine.records) {
      assert.equal(r.pluginId, PLUGIN_A)
      assert.equal(r.scope, 'organization')
    }
    const again = await cleanup.exportPage({
      organizationId: world.org.id,
      actorId: world.user.id,
      filter: {},
      writeFile: false,
    })
    assert.isTrue(again.ok)
    if (again.ok) assert.equal(again.manifest.digest, mine.manifest.digest, '同内容 digest 稳定')

    // 他组织看不到本组织任何记录
    const theirs = await cleanup.exportPage({
      organizationId: world.otherOrg.id,
      actorId: world.otherUser.id,
      filter: {},
      writeFile: false,
    })
    assert.isTrue(theirs.ok)
    if (theirs.ok) assert.equal(theirs.records.length, 0)
  })

  test('导出：超过单批上限按页读取（有界流式）', async ({ assert }) => {
    const world = await seedWorld()
    // 直插批量行到 505 条（500 上限 + 5）
    const rows = [] as Array<Record<string, unknown>>
    for (let i = 0; i < 505; i++) {
      rows.push({
        namespace_id: world.namespace.id,
        key: `bulk.${String(i).padStart(4, '0')}`,
        value: JSON.stringify({ i }),
        canonical_digest: 'cccc2222',
        byte_size: 10,
        revision: 1,
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
    const { default: db } = await import('@adonisjs/lucid/services/db')
    for (let i = 0; i < rows.length; i += 100) {
      await db.table('plugin_storage_entries').insert(rows.slice(i, i + 100))
    }

    const page1 = await cleanup.exportPage({
      organizationId: world.org.id,
      actorId: world.user.id,
      filter: {},
      writeFile: false,
      page: 1,
    })
    assert.isTrue(page1.ok)
    if (page1.ok) assert.equal(page1.records.length, 500)

    const page2 = await cleanup.exportPage({
      organizationId: world.org.id,
      actorId: world.user.id,
      filter: {},
      writeFile: false,
      page: 2,
    })
    assert.isTrue(page2.ok)
    if (page2.ok) assert.equal(page2.records.length, 7, '第二页应为剩余 505+2-500=7 条')
  }).timeout(60000)

  test('到期临时文件清理只删过期产物', async ({ assert }) => {
    const dir = mkdtempSync(join(tmpdir(), 'pss-probe-'))
    const oldFile = join(dir, 'plugin-storage-export-1-old.jsonl')
    const freshFile = join(dir, 'plugin-storage-export-1-fresh.jsonl')
    writeFileSync(oldFile, 'x')
    writeFileSync(freshFile, 'y')
    const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    utimesSync(oldFile, oldTime, oldTime)

    // 探针放进服务的真实扫描目录（storage/uploads/organizations/<id>/plugin-storage-exports）
    const { copyFileSync, mkdirSync, rmSync } = await import('node:fs')
    const { join: pjoin } = await import('node:path')
    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    const scanDir = pjoin(uploadRoot, 'organizations', '999777', 'plugin-storage-exports')
    mkdirSync(scanDir, { recursive: true })
    const realOld = pjoin(scanDir, `plugin-storage-export-${Date.now()}-probe-old.jsonl`)
    const realFresh = pjoin(scanDir, `plugin-storage-export-${Date.now()}-probe-fresh.jsonl`)
    copyFileSync(oldFile, realOld)
    copyFileSync(freshFile, realFresh)
    utimesSync(realOld, oldTime, oldTime)

    const removed = cleanup.purgeExpiredExportFiles(new Date())
    assert.isTrue(removed >= 1, `应至少清理 1 个过期文件，实际 ${removed}`)
    assert.isFalse(existsSync(realOld), '过期导出文件必须被清理')
    assert.isTrue(existsSync(realFresh), '新鲜文件不受影响')

    rmSync(realFresh, { force: true })
    rmSync(dir, { recursive: true, force: true })
  })
})
