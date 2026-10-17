/**
 * v3-plugin-policy-bundles —— 策略包存储层功能测试（任务 2.4）。
 *
 * 覆盖要求：
 * - 组织隔离：跨组织查询取不到 bundle/version/activation
 * - 版本唯一：(organization, bundle, version) 唯一；activation 每组织唯一
 * - 内置只读：内置模板仅存在于代码（表无内置行；CHECK 词表封闭三模板）
 * - 组织副本只能收紧：副本相对模板的收紧性由 @aiproj/types 纯函数校验，
 *   存储行 rulesJson 往返保真且 digest 与内容一致（内容寻址不可变）
 * - 并发更新：activation rowVersion CAS，stale 写零行受影响
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import {
  columnNames,
  foreignKeys,
  hasUniqueIndex,
  tableSql,
  checkEnum,
} from './db_schema/_helpers.js'
import { createOrganization, createUser } from '../unit/ai/_helpers.js'
import PluginPolicyBundle from '#models/plugin_policy_bundle'
import PluginPolicyBundleActivation from '#models/plugin_policy_bundle_activation'
import {
  BUILTIN_PLUGIN_POLICY_TEMPLATES,
  validatePluginPolicyBundleDocument,
  computePluginPolicyBundleDigest,
  comparePluginPolicyCopyToBaseline,
} from '@aiproj/types'

const KNOWN_PERMS = [
  'plugin_registry:view',
  'plugin_registry:submit',
  'plugin_registry:review',
  'plugin_registry:manage',
  'plugin_registry:rollback',
  'plugin_install:view',
  'plugin_install:manage',
]

/** 由内置模板构造一份合法的组织收紧副本文档。 */
function buildOrgCopy(templateId: string, version: number, bundleId = 'org-copy.test') {
  const template = BUILTIN_PLUGIN_POLICY_TEMPLATES.find((t) => t.templateId === templateId)!
  const doc = JSON.parse(JSON.stringify(template.document)) as Record<string, unknown>
  doc.bundleId = bundleId
  doc.version = version
  doc.sourceTemplateId = template.templateId
  doc.sourceTemplateVersion = template.templateVersion
  return validatePluginPolicyBundleDocument(doc, { knownPermissionKeys: KNOWN_PERMS })
}

test.group('plugin policy bundles 存储', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('关键列存在与 CHECK/FK/唯一键约束', async ({ assert }) => {
    const cols = await columnNames('plugin_policy_bundles')
    for (const c of [
      'organization_id',
      'bundle_id',
      'source_template_id',
      'source_template_version',
      'version',
      'description_zh',
      'rules_json',
      'document_digest',
      'created_at',
    ]) {
      assert.include(cols, c, `bundles 应含字段 ${c}`)
    }
    const acols = await columnNames('plugin_policy_bundle_activations')
    for (const c of [
      'organization_id',
      'bundle_id',
      'active_version',
      'status',
      'revision',
      'row_version',
      'activated_by',
      'activated_at',
    ]) {
      assert.include(acols, c, `activations 应含字段 ${c}`)
    }
    const fks = await foreignKeys('plugin_policy_bundles')
    assert.isOk(
      fks.find(
        (f) =>
          f.from === 'organization_id' && f.table === 'organizations' && f.on_delete === 'CASCADE',
      ),
      'bundles.organization_id 应级联删除',
    )
    assert.isTrue(
      await hasUniqueIndex('plugin_policy_bundles', ['organization_id', 'bundle_id', 'version']),
      '应存在 (organization_id, bundle_id, version) 唯一键',
    )
    assert.isTrue(
      await hasUniqueIndex('plugin_policy_bundle_activations', ['organization_id']),
      '激活表应存在每组织唯一约束',
    )
    const sql = await tableSql('plugin_policy_bundles')
    assert.isTrue(
      checkEnum(sql, 'source_template_id', ['admin-managed']),
      '模板 id 应有 CHECK 封闭',
    )
    const asql = await tableSql('plugin_policy_bundle_activations')
    assert.isTrue(checkEnum(asql, 'status', ['active']), 'status 应有 CHECK 封闭')
  })

  test('组织隔离：跨组织读取不到副本与激活行', async ({ assert }) => {
    const user = await createUser()
    const orgA = await createOrganization(user)
    const copyRes = buildOrgCopy('member-readonly', 1)
    assert.isTrue(copyRes.valid)
    await PluginPolicyBundle.create({
      organizationId: orgA.id,
      bundleId: copyRes.normalized!.bundleId,
      sourceTemplateId: 'member-readonly',
      sourceTemplateVersion: 1,
      version: copyRes.normalized!.version,
      descriptionZh: copyRes.normalized!.descriptionZh,
      rulesJson: copyRes.normalized!.rules,
      documentDigest: copyRes.digest!,
    })
    await PluginPolicyBundleActivation.create({
      organizationId: orgA.id,
      bundleId: copyRes.normalized!.bundleId,
      activeVersion: 1,
      status: 'active',
      revision: 1,
      rowVersion: 1,
      activatedBy: `user:${user.id}`,
      activatedAt: DateTime.now(),
    })

    // 另一组织完全看不到
    const orgB = await createOrganization(user)
    assert.isNull(await PluginPolicyBundle.findVersion(orgB.id, copyRes.normalized!.bundleId, 1))
    assert.isNull(await PluginPolicyBundleActivation.findForOrganization(orgB.id))
    // 本组织可见
    assert.isNotNull(await PluginPolicyBundle.findVersion(orgA.id, copyRes.normalized!.bundleId, 1))
    const act = await PluginPolicyBundleActivation.findForOrganization(orgA.id)
    assert.equal(act?.bundleId, copyRes.normalized!.bundleId)
  })

  test('版本唯一：同 (org,bundle,version) 二次写入抛错；新版本可行', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const copyRes = buildOrgCopy('pm-enabled', 1)
    const base = {
      organizationId: org.id,
      bundleId: copyRes.normalized!.bundleId,
      sourceTemplateId: 'pm-enabled' as const,
      sourceTemplateVersion: 1,
      descriptionZh: copyRes.normalized!.descriptionZh,
      rulesJson: copyRes.normalized!.rules,
      documentDigest: copyRes.digest!,
    }
    await PluginPolicyBundle.create({ ...base, version: 1 })
    let dupFailed = false
    try {
      await PluginPolicyBundle.create({ ...base, version: 1 })
    } catch {
      dupFailed = true
    }
    assert.isTrue(dupFailed, '重复版本应被唯一键拒绝')
    // 新版本号可写（digest 不同）
    const tightened = JSON.parse(JSON.stringify(copyRes.normalized!))
    tightened.version = 2
    tightened.rules = tightened.rules.map((r: any) =>
      r.role === 'member' && r.operation === 'ui-slot' ? { ...r, effect: 'deny' } : r,
    )
    await PluginPolicyBundle.create({
      ...base,
      version: 2,
      rulesJson: tightened.rules,
      documentDigest: computePluginPolicyBundleDigest(tightened),
    })
    assert.isNotNull(await PluginPolicyBundle.findVersion(org.id, base.bundleId, 2))
  })

  test('激活每组织唯一：第二行同组织写入抛错', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const mk = (bundleId: string) => ({
      organizationId: org.id,
      bundleId,
      activeVersion: 1,
      status: 'active' as const,
      revision: 1,
      rowVersion: 1,
      activatedBy: 'tester',
      activatedAt: DateTime.now(),
    })
    await PluginPolicyBundleActivation.create(mk('org-copy.a'))
    let failed = false
    try {
      await PluginPolicyBundleActivation.create(mk('org-copy.b'))
    } catch {
      failed = true
    }
    assert.isTrue(failed, '同组织第二个激活行应被唯一约束拒绝')
  })

  test('内置只读：表内无内置行；模板仅存在于代码且为只读基线', async ({ assert }) => {
    const builtinRows = await PluginPolicyBundle.query().whereLike('bundle_id', 'builtin.%')
    assert.equal(builtinRows.length, 0)
    assert.equal(BUILTIN_PLUGIN_POLICY_TEMPLATES.length, 3)
    for (const t of BUILTIN_PLUGIN_POLICY_TEMPLATES) {
      assert.isTrue(validatePluginPolicyBundleDocument(t.document).valid)
    }
  })

  test('组织副本只能收紧 + 内容寻址 digest 保真往返', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const templateDoc = JSON.parse(
      JSON.stringify(
        BUILTIN_PLUGIN_POLICY_TEMPLATES.find((t) => t.templateId === 'admin-managed')!.document,
      ),
    )
    // 收紧副本：成员 ui-slot allow → deny
    const copy: any = validatePluginPolicyBundleDocument(templateDoc).normalized!
    copy.bundleId = 'org-copy.admin-managed'
    copy.sourceTemplateId = 'admin-managed'
    copy.sourceTemplateVersion = 1
    copy.rules = copy.rules.map((r: any) =>
      r.role === 'member' && r.operation === 'ui-slot' ? { ...r, effect: 'deny' } : r,
    )
    const copyCheck = validatePluginPolicyBundleDocument(copy, {
      knownPermissionKeys: KNOWN_PERMS,
      baselineDocument: templateDoc,
    })
    assert.isTrue(copyCheck.valid, '合法收紧应通过校验')
    assert.deepEqual(
      comparePluginPolicyCopyToBaseline(
        copyCheck.normalized!,
        validatePluginPolicyBundleDocument(templateDoc).normalized!,
      ),
      [],
    )

    const digest = computePluginPolicyBundleDigest(copyCheck.normalized!)
    const row = await PluginPolicyBundle.create({
      organizationId: org.id,
      bundleId: copy.bundleId,
      sourceTemplateId: 'admin-managed',
      sourceTemplateVersion: 1,
      version: 1,
      descriptionZh: copy.descriptionZh,
      rulesJson: copy.rules,
      documentDigest: digest,
    })
    // 往返保真：读回的 rules 重算 digest 与存储 digest 一致（内容寻址、不可变语义）
    const reloaded = await PluginPolicyBundle.findOrFail(row.id)
    const roundTripped = {
      schemaVersion: '1.0' as const,
      bundleId: reloaded.bundleId,
      version: reloaded.version,
      sourceTemplateId: reloaded.sourceTemplateId,
      sourceTemplateVersion: reloaded.sourceTemplateVersion,
      descriptionZh: reloaded.descriptionZh,
      rules: reloaded.rulesJson,
    }
    assert.equal(computePluginPolicyBundleDigest(roundTripped as never), reloaded.documentDigest)

    // 放宽副本：把 PM 的 manage deny 翻成 allow → 校验拒绝
    const loosened: any = JSON.parse(JSON.stringify(copyCheck.normalized!))
    loosened.rules = loosened.rules.map((r: any) =>
      r.role === 'project_manager' && r.permissionKey === 'plugin_install:manage'
        ? { ...r, effect: 'allow' }
        : r,
    )
    const loosenCheck = validatePluginPolicyBundleDocument(loosened, {
      knownPermissionKeys: KNOWN_PERMS,
      baselineDocument: templateDoc,
    })
    assert.isFalse(loosenCheck.valid, '放宽 allow 相对模板必须被拒')
  })

  test('并发更新：rowVersion CAS 生效，stale 写零行受影响', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    await PluginPolicyBundleActivation.create({
      organizationId: org.id,
      bundleId: 'org-copy.pm-enabled',
      activeVersion: 1,
      status: 'active',
      revision: 1,
      rowVersion: 1,
      activatedBy: 'tester',
      activatedAt: DateTime.now(),
    })
    const act = (await PluginPolicyBundleActivation.findForOrganization(org.id))!

    // CAS 成功路径：where row_version=1 → bump 到 2 且 revision+1
    const updated = await PluginPolicyBundleActivation.query()
      .where('id', act.id)
      .where('row_version', act.rowVersion)
      .update({
        active_version: 2,
        revision: act.revision + 1,
        row_version: act.rowVersion + 1,
        activated_by: 'tester-2',
      })
    assert.equal(updated, 1)
    await act.refresh()
    assert.equal(act.rowVersion, 2)
    assert.equal(act.activeVersion, 2)

    // stale 路径：仍用旧 row_version=1 → 零行受影响
    const stale = await PluginPolicyBundleActivation.query()
      .where('id', act.id)
      .where('row_version', 1)
      .update({ status: 'disabled' })
    assert.equal(stale, 0)
    await act.refresh()
    assert.equal(act.status, 'active')
  })
})
