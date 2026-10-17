/**
 * v3-plugin-policy-bundles —— security gate 策略接入测试（任务 3.3 / 3.4 / 3.6）。
 *
 * 覆盖：
 * - 零 permission expansion：策略 allow 不改变既有 denied 结果（shadow 不翻转）
 * - 显式收紧：enforcement 下策略拒绝 → 终局 'policy-denied'，无 authorization
 * - 角色降级：同一请求在不同 actor 角色下策略求值不同（旧 receipt 重放失效由
 *   receipt binding 的 policyDigest stale 判据承担）
 * - 损坏 snapshot：shadow 记录 finding 不改结果；enforcement 下正式写拒绝
 * - 缓存 revision 失效：激活 revision/digest 变化反映到求值记录
 * - conformance：全部返回路径携带 shadow 记录；环形 findings 有界
 * - 类型级：receipt binding 的 policyDigest 往返与 stale 判据
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { useAiDatabase } from './ai/_helpers.js'
import { createOrganization, createUser } from '../functional/auth/_helpers.js'
import OrganizationMember from '#models/organization_member'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import {
  PluginSecurityGateService,
  readPolicyShadowFindings,
  resetPolicyShadowFindings,
} from '#services/plugin_security_gate/gate_service'
import PluginPolicyBundle from '#models/plugin_policy_bundle'
import PluginPolicyBundleActivation from '#models/plugin_policy_bundle_activation'
import {
  BUILTIN_PLUGIN_POLICY_TEMPLATES,
  validatePluginPolicyBundleDocument,
  createVerifiedPluginPolicySnapshot,
  computePluginPolicyBundleDigest,
  normalizePluginPolicyBundleDocument,
  comparePluginPolicyCopyToBaseline,
  buildGateReceiptBinding,
  verifyGateReceiptBinding,
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

/** 由内置模板构造组织副本行 + 激活行。 */
async function seedActivePolicy(orgId: number, templateId: string, version = 1) {
  const validated = await seedPolicyVersion(orgId, templateId, version)
  await PluginPolicyBundleActivation.create({
    organizationId: orgId,
    bundleId: validated.normalized!.bundleId,
    activeVersion: version,
    status: 'active',
    revision: version,
    rowVersion: version,
    activatedBy: 'tester',
    activatedAt: DateTime.now(),
  } as never)
  return validated
}

/** 仅插入新版本 bundle 行（不建激活行；供升级场景复用同一激活）。 */
async function seedPolicyVersion(orgId: number, templateId: string, version: number) {
  const template = BUILTIN_PLUGIN_POLICY_TEMPLATES.find((t) => t.templateId === templateId)!
  const raw: any = JSON.parse(JSON.stringify(template.document))
  raw.bundleId = 'org-copy.test'
  raw.version = version
  raw.sourceTemplateId = template.templateId
  raw.sourceTemplateVersion = template.templateVersion
  if (version > 1) raw.rules.push({ role: 'member', effect: 'deny', operation: 'execute' })
  const validated = validatePluginPolicyBundleDocument(raw, { knownPermissionKeys: KNOWN_PERMS })
  if (!validated.valid || !validated.normalized || !validated.digest)
    throw new Error('seed doc invalid')
  await PluginPolicyBundle.create({
    organizationId: orgId,
    bundleId: validated.normalized.bundleId,
    sourceTemplateId: template.templateId as never,
    sourceTemplateVersion: template.templateVersion,
    version,
    descriptionZh: validated.normalized.descriptionZh,
    rulesJson: validated.normalized.rules,
    documentDigest: validated.digest,
  })
  return validated
}

async function seedEnabledInstall(orgId: number, pluginId: string, ownerId: number) {
  const release = await PluginPrivateRegistryRelease.create({
    organizationId: orgId,
    pluginIdentity: pluginId,
    version: '1.0.0',
    status: 'approved',
    packageDigest: 'p1',
    manifestDigest: 'm1',
    compatibilityDigest: 'c1',
    upstreamReceiptRef: `seed:${pluginId}`,
    metadata: JSON.stringify({ contributions: [] }),
    rowVersion: 1,
  } as never)
  await PluginInstallation.create({
    organizationId: orgId,
    pluginId,
    version: '1.0.0',
    releaseId: release.id,
    status: 'enabled',
    packageDigest: 'p1',
    manifestDigest: 'm1',
    compatibilityDigest: 'c1',
    permissionConfirmation: {
      confirmedBy: ownerId,
      confirmedAt: new Date().toISOString(),
      permissionDigest: 'p1',
    } as never,
    rowVersion: 1,
  })
}

function baseRequest(pluginId: string, idem: string) {
  return {
    pluginId,
    seamKey: 'skill-adapter.skill-bundle',
    operation: 'execute' as const,
    requestedPermissions: [],
    scopeKind: 'organization' as const,
    idempotencyKey: idem,
    referenceTime: new Date().toISOString(),
  }
}

test.group('security gate × policy bundles（shadow / enforcement）', (group) => {
  group.each.setup(async () => {
    await useAiDatabase(group)
    resetPolicyShadowFindings()
  })
  group.each.teardown(() => {
    delete process.env.PLUGIN_POLICY_ENFORCEMENT
  })

  test('零扩大：active 策略下 shadow 记录求值但不改变既有结果', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedEnabledInstall(org.id, 'acme.gated', owner.id)
    await seedActivePolicy(org.id, 'member-readonly')

    const service = new PluginSecurityGateService()
    const r = await service.authorize({
      request: baseRequest('acme.gated', 'idem-shadow-1'),
      organizationId: org.id,
      actorId: owner.id,
      trx: null as never,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    // curated catalog 无 host-ready seam → 既有 gate 在 seam 处 denied；策略不得翻转为 allowed
    assert.equal(r.decision.outcome, 'denied')
    assert.isOk(r.shadow)
    assert.equal(r.shadow!.state, 'ok')
    // owner(org_admin) 在 member-readonly 模板中允许 execute，但既有 gate 结论仍为 denied
    // —— 策略只能收紧、绝不放大：shadow 记录 divergence 而不改变结果
    assert.isTrue(r.shadow!.policyAllowed)
    assert.equal(r.shadow!.diverged, true)
    assert.equal(r.shadow!.revision, 1)
    assert.isTrue(typeof r.shadow!.policyDigest === 'string' && r.shadow!.policyDigest.length > 0)
  })

  test('角色降级语义：owner 与 member 角色对同一请求的策略结论不同', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await OrganizationMember.create({
      organizationId: org.id,
      userId: member.id,
      role: 'member',
    } as never)
    await seedEnabledInstall(org.id, 'acme.roles', owner.id)
    await seedActivePolicy(org.id, 'pm-enabled')

    const service = new PluginSecurityGateService()
    const req = baseRequest('acme.roles', 'idem-roles')
    const asOwner = await service.authorize({
      request: { ...req, idempotencyKey: 'i-owner' },
      organizationId: org.id,
      actorId: owner.id,
      trx: null as never,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    const asMember = await service.authorize({
      request: { ...req, idempotencyKey: 'i-member' },
      organizationId: org.id,
      actorId: member.id,
      trx: null as never,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    // pm-enabled：PM/admin 允许 execute；成员无 allow → 默认拒绝
    assert.equal(asOwner.shadow?.policyAllowed, true)
    assert.equal(asMember.shadow?.policyAllowed, false)
    // 两者最终 outcome 均为既有 denied（seam），策略未扩大任何一方
    assert.equal(asOwner.decision.outcome, 'denied')
    assert.equal(asMember.decision.outcome, 'denied')
    assert.notEqual(asOwner.shadow!.policyDigest, '')
  })

  test('enforcement：成员 execute 被终局 policy-denied 且无 authorization', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await OrganizationMember.create({
      organizationId: org.id,
      userId: member.id,
      role: 'member',
    } as never)
    await seedEnabledInstall(org.id, 'acme.enf', owner.id)
    await seedActivePolicy(org.id, 'pm-enabled')
    process.env.PLUGIN_POLICY_ENFORCEMENT = 'on'

    const service = new PluginSecurityGateService()
    let downstream = 0
    const res = await service.authorizeAndRun(
      {
        request: baseRequest('acme.enf', 'idem-enf'),
        organizationId: org.id,
        actorId: member.id,
        trx: null as never,
        seamCatalog: {},
        permissionVocabulary: {},
      },
      async () => {
        downstream++
        return 'x'
      },
    )
    assert.equal(res.decision.outcome, 'denied')
    assert.equal(res.decision.reasonCode, 'policy-denied')
    assert.equal(downstream, 0, 'enforcement 拒绝后零下游调用')
  })

  test('损坏 snapshot：shadow 记录 finding 不改结果；enforcement 下 execute 拒绝', async ({
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedEnabledInstall(org.id, 'acme.corrupt', owner.id)
    const seeded = await seedActivePolicy(org.id, 'member-readonly')
    // 内容寻址破坏：直接改库内规则
    const row = await PluginPolicyBundle.query().where('organization_id', org.id).first()
    await row!
      .merge({ rulesJson: [{ role: 'member', effect: 'allow', operation: 'execute' }] })
      .save()
    void seeded

    const service = new PluginSecurityGateService()
    const shadowRun = await service.authorize({
      request: baseRequest('acme.corrupt', 'idem-corrupt-s'),
      organizationId: org.id,
      actorId: owner.id,
      trx: null as never,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    assert.equal(shadowRun.shadow?.state, 'corrupt')
    assert.equal(shadowRun.decision.outcome, 'denied', 'shadow 不改结果')
    assert.equal(
      readPolicyShadowFindings().some((f) => f.state === 'corrupt'),
      true,
    )

    process.env.PLUGIN_POLICY_ENFORCEMENT = 'on'
    const enfRun = await service.authorizeAndRun(
      {
        request: baseRequest('acme.corrupt', 'idem-corrupt-e'),
        organizationId: org.id,
        actorId: owner.id,
        trx: null as never,
        seamCatalog: {},
        permissionVocabulary: {},
      },
      async () => 'ran',
    )
    assert.equal(enfRun.decision.reasonCode, 'policy-denied', '损坏快照下正式写 fail closed')
  })

  test('缓存 revision 失效：升级版本后 policyDigest/revision 更新', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedEnabledInstall(org.id, 'acme.rev', owner.id)
    await seedActivePolicy(org.id, 'member-readonly', 1)

    const service = new PluginSecurityGateService()
    const r1 = await service.authorize({
      request: baseRequest('acme.rev', 'idem-rev-1'),
      organizationId: org.id,
      actorId: owner.id,
      trx: null as never,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    const d1 = r1.shadow!.policyDigest

    // 升级到 v2（新增收紧规则）并切换激活（复用同一激活行，revision 递增）
    await seedPolicyVersion(org.id, 'member-readonly', 2)
    const act = await PluginPolicyBundleActivation.query().where('organization_id', org.id).first()
    await act!.merge({ activeVersion: 2, revision: act!.revision + 1 }).save()

    const r2 = await service.authorize({
      request: baseRequest('acme.rev', 'idem-rev-2'),
      organizationId: org.id,
      actorId: owner.id,
      trx: null as never,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    assert.equal(r2.shadow!.state, 'ok')
    assert.notEqual(r2.shadow!.revision, r1.shadow!.revision)
    assert.notEqual(r2.shadow!.policyDigest, d1, '内容变化必须带来 digest 变化（缓存失效判据）')
  })

  test('conformance 基线：findings 有界且低敏；副本收紧纯函数可用作门禁', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedEnabledInstall(org.id, 'acme.conf', owner.id)
    await seedActivePolicy(org.id, 'admin-managed')
    const service = new PluginSecurityGateService()
    for (let i = 0; i < 60; i++) {
      await service.authorize({
        request: baseRequest('acme.conf', `idem-conf-${i}`),
        organizationId: org.id,
        actorId: owner.id,
        trx: null as never,
        seamCatalog: {},
        permissionVocabulary: {},
      })
    }
    const findings = readPolicyShadowFindings()
    assert.isTrue(findings.length <= 50, '环形缓冲上限 50')
    for (const f of findings) {
      const s = JSON.stringify(f).toLowerCase()
      for (const banned of ['token', 'secret', 'password', 'authorization']) {
        assert.isFalse(s.includes(banned), `finding 不得含 ${banned}`)
      }
    }
    // 组织副本收紧性：放宽必被拒（作为后续 copy API 的共享门禁基线）
    const base = BUILTIN_PLUGIN_POLICY_TEMPLATES[2].document
    const loosened: any = JSON.parse(JSON.stringify(base))
    loosened.rules = loosened.rules.map((r: any) =>
      r.role === 'project_manager' && r.permissionKey === 'plugin_install:manage'
        ? { ...r, effect: 'allow' }
        : r,
    )
    const hits = comparePluginPolicyCopyToBaseline(
      normalizePluginPolicyBundleDocument(loosened),
      normalizePluginPolicyBundleDocument(base),
    )
    assert.isTrue(hits.some((h) => h.code === 'policy-template-expansion'))
  })

  test('类型级：receipt policyDigest 往返一致；digest 变化 → stale-binding（旧 receipt 重放失效）', async ({
    assert,
  }) => {
    const common = {
      organizationScope: 'org:1',
      pluginId: 'acme.r',
      seamKey: 'skill-adapter.skill-bundle',
      operation: 'execute' as const,
      manifestDigest: 'm',
      permissionDigest: 'p',
      scopeGrantDigest: 'g',
      requestedPermissions: [] as string[],
      decisionId: 'd1',
      idempotencyKey: 'i1',
      createdAt: '2026-08-24T00:00:00.000Z',
      ttlSeconds: 900,
    }
    const receipt = buildGateReceiptBinding({ ...common, policyDigest: 'aaaa1111' })
    assert.equal(receipt.policyDigest, 'aaaa1111')
    const ok = verifyGateReceiptBinding(receipt, {
      ...common,
      policyDigest: 'aaaa1111',
      referenceTime: '2026-08-24T00:05:00.000Z',
    })
    assert.isTrue(ok.valid)
    const replay = verifyGateReceiptBinding(receipt, {
      ...common,
      policyDigest: 'bbbb2222',
      referenceTime: '2026-08-24T00:05:00.000Z',
    })
    assert.isFalse(replay.valid)
    assert.equal(replay.reasonCode, 'stale-binding')
    // 向后兼容：不含 policyDigest 的 receipt 重算仍一致
    const legacy = buildGateReceiptBinding({ ...common })
    const legacyOk = verifyGateReceiptBinding(legacy, {
      ...common,
      referenceTime: '2026-08-24T00:05:00.000Z',
    })
    assert.isTrue(legacyOk.valid)
    void computePluginPolicyBundleDigest
  })

  test('snapshot 构造一致性：createVerifiedPluginPolicySnapshot 的 digest 与校验器一致', async ({
    assert,
  }) => {
    const t = BUILTIN_PLUGIN_POLICY_TEMPLATES[0]
    const v = validatePluginPolicyBundleDocument(JSON.parse(JSON.stringify(t.document)), {
      knownPermissionKeys: KNOWN_PERMS,
    })
    const snap = createVerifiedPluginPolicySnapshot({
      document: v.normalized!,
      revision: 1,
      activatedAt: '2026-08-24T00:00:00.000Z',
      organizationScope: 'org:9',
    })
    assert.equal(snap.digest, v.digest!)
  })
})
