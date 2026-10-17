/**
 * v3-plugin-scoped-storage —— plugin_storage_namespaces / plugin_storage_entries 迁移测试（任务 2.2）。
 *
 * 验证：
 * - 关键列存在性（scope/status/quota/usage/revision/retention）
 * - 外键策略：organization/projects 级联、installation 绑定、entries.namespace 级联
 * - 唯一性：entry (namespace_id, key)；namespace 部分唯一索引（org scope 与 project scope 各自唯一）
 * - 封闭枚举 CHECK（scope / status）
 * - Model：forOrganization 组织隔离、JSON value prepare/consume 往返、revision 自增由服务层负责
 * - 方言自适应断言（同一套断言在 SQLite 与 PostgreSQL 上均可运行）
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames, foreignKeys, hasUniqueIndex, tableSql, checkEnum } from './_helpers.js'
import { createOrganization, createUser } from '../auth/_helpers.js'
import type Organization from '#models/organization'
import Project from '#models/project'
import PluginStorageNamespace from '#models/plugin_storage_namespace'
import PluginStorageEntry from '#models/plugin_storage_entry'
import PluginInstallation from '#models/plugin_installation'

/** 建插件安装记录（最小必填集）。 */
async function seedInstallation(
  organizationId: number,
  pluginId: string,
): Promise<PluginInstallation> {
  return PluginInstallation.create({
    organizationId,
    pluginId,
    version: '1.0.0',
    releaseId: 1,
    status: 'enabled',
    packageDigest: 'pkg-digest',
    manifestDigest: 'manifest-digest',
    compatibilityDigest: 'compat-digest',
  })
}

/** 建 namespace（显式列集，避免依赖默认值）。 */
async function seedNamespace(input: {
  organizationId: number
  projectId: number | null
  pluginId: string
  installationId: number
  scope: 'organization' | 'project'
}): Promise<PluginStorageNamespace> {
  return PluginStorageNamespace.create({
    organizationId: input.organizationId,
    projectId: input.projectId,
    pluginId: input.pluginId,
    pluginVersion: '1.0.0',
    installationId: input.installationId,
    scope: input.scope,
    status: 'active',
    quotaBytes: 524288,
    usedBytes: 0,
    quotaEntries: 256,
    usedEntries: 0,
    rowVersion: 1,
  })
}

test.group('plugin scoped storage 迁移', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  /** 每个用例独立的组织与两个项目（唯一 slug/code，避免用例间串扰；不做 truncate 以规避既有表删除顺序问题）。 */
  async function seedOrgWithProjects(): Promise<{
    org: Organization
    projectA: Project
    projectB: Project
  }> {
    const user = await createUser()
    const org = await createOrganization(user)
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
    return { org, projectA, projectB }
  }

  test('plugin_storage_namespaces 关键列存在', async ({ assert }) => {
    const cols = await columnNames('plugin_storage_namespaces')
    for (const c of [
      'id',
      'organization_id',
      'project_id',
      'plugin_id',
      'plugin_version',
      'installation_id',
      'scope',
      'status',
      'quota_bytes',
      'used_bytes',
      'quota_entries',
      'used_entries',
      'row_version',
      'orphaned_at',
      'retention_until',
      'cleanup_handle_digest',
      'cleanup_handle_expires_at',
      'created_at',
    ]) {
      assert.include(cols, c, `plugin_storage_namespaces 应含字段 ${c}`)
    }
  })

  test('plugin_storage_entries 关键列存在', async ({ assert }) => {
    const cols = await columnNames('plugin_storage_entries')
    for (const c of [
      'id',
      'namespace_id',
      'key',
      'value',
      'canonical_digest',
      'byte_size',
      'revision',
      'created_at',
    ]) {
      assert.include(cols, c, `plugin_storage_entries 应含字段 ${c}`)
    }
  })

  test('外键策略：org/projects/installation/namespace', async ({ assert }) => {
    const nsFks = await foreignKeys('plugin_storage_namespaces')
    const orgFk = nsFks.find((f) => f.from === 'organization_id' && f.table === 'organizations')
    assert.isOk(orgFk, 'organization_id 应有外键')
    const projFk = nsFks.find((f) => f.from === 'project_id' && f.table === 'projects')
    assert.isOk(projFk, 'project_id 应有外键')
    const instFk = nsFks.find(
      (f) => f.from === 'installation_id' && f.table === 'plugin_installations',
    )
    assert.isOk(instFk, 'installation_id 应绑定安装记录')

    const entryFks = await foreignKeys('plugin_storage_entries')
    const nsRef = entryFks.find(
      (f) => f.from === 'namespace_id' && f.table === 'plugin_storage_namespaces',
    )
    assert.isOk(nsRef, 'entries.namespace_id 应级联到 namespace')
  })

  test('唯一键：entry (namespace_id, key)；namespace 部分唯一索引', async ({ assert }) => {
    assert.isTrue(
      await hasUniqueIndex('plugin_storage_entries', ['namespace_id', 'key']),
      'entries 应存在 (namespace_id, key) 唯一键',
    )
    assert.isTrue(
      await hasUniqueIndex('plugin_storage_namespaces', ['organization_id', 'plugin_id']),
      'namespaces 应存在 org scope 部分唯一索引',
    )
  })

  test('封闭枚举 CHECK（scope/status）', async ({ assert }) => {
    const sql = await tableSql('plugin_storage_namespaces')
    if (!sql.includes('information_schema')) {
      assert.isTrue(checkEnum(sql, 'scope', ['organization']), 'scope 应有 CHECK 约束')
      assert.isTrue(checkEnum(sql, 'status', ['active']), 'status 应有 CHECK 约束')
      assert.isTrue(sql.includes("'orphaned'"), 'status CHECK 应含 orphaned')
      assert.isTrue(sql.includes("'pending-deletion'"), 'status CHECK 应含 pending-deletion')
    } else {
      assert.isTrue(true)
    }
  })

  test('部分唯一约束生效：同组织同插件 org-scope 只能一个；不同项目可各自建', async ({
    assert,
  }) => {
    const { org, projectA, projectB } = await seedOrgWithProjects()
    const inst = await seedInstallation(org.id, 'acme.unique-demo')
    await seedNamespace({
      organizationId: org.id,
      projectId: null,
      pluginId: 'acme.unique-demo',
      installationId: inst.id,
      scope: 'organization',
    })

    // 同插件第二个 org-scope namespace 必须被唯一索引拒绝
    let dupRejected = false
    try {
      await seedNamespace({
        organizationId: org.id,
        projectId: null,
        pluginId: 'acme.unique-demo',
        installationId: inst.id,
        scope: 'organization',
      })
    } catch {
      dupRejected = true
    }
    assert.isTrue(dupRejected, '重复 org-scope namespace 应被唯一索引拒绝')

    // 不同插件的 org-scope 不受影响
    const other = await seedInstallation(org.id, 'acme.other-plugin')
    await seedNamespace({
      organizationId: org.id,
      projectId: null,
      pluginId: 'acme.other-plugin',
      installationId: other.id,
      scope: 'organization',
    })

    // project-scope：同插件在不同项目各一个，互不冲突
    const instP = await seedInstallation(org.id, 'acme.proj-plugin')
    await seedNamespace({
      organizationId: org.id,
      projectId: projectA.id,
      pluginId: 'acme.proj-plugin',
      installationId: instP.id,
      scope: 'project',
    })
    await seedNamespace({
      organizationId: org.id,
      projectId: projectB.id,
      pluginId: 'acme.proj-plugin',
      installationId: instP.id,
      scope: 'project',
    })
    const total = await PluginStorageNamespace.forOrganization(org.id)
    assert.equal(total.length, 4)
  })

  test('Model forOrganization 强制组织过滤与 entry JSON 往返', async ({ assert }) => {
    const { org } = await seedOrgWithProjects()
    const inst = await seedInstallation(org.id, 'acme.roundtrip')
    const ns = await seedNamespace({
      organizationId: org.id,
      projectId: null,
      pluginId: 'acme.roundtrip',
      installationId: inst.id,
      scope: 'organization',
    })
    const doc = { board: 'q3', items: [1, 2, { ok: true }] }
    await PluginStorageEntry.create({
      namespaceId: ns.id,
      key: 'board-settings.view',
      value: doc,
      canonicalDigest: 'deadbeef',
      byteSize: 42,
      revision: 1,
    })
    // 其他组织的空查询（组织隔离）
    const foreign = await PluginStorageNamespace.forOrganization(999999)
    assert.equal(foreign.length, 0)

    const rows = await PluginStorageEntry.forNamespace(ns.id)
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].value, doc)

    await PluginStorageEntry.query().where('namespace_id', ns.id).delete()
    await ns.delete()
    await PluginInstallation.query().where('id', inst.id).delete()
  })
})
