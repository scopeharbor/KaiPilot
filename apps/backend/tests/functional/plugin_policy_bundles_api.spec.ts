/**
 * v3-plugin-policy-bundles —— 管理 API 集成测试（任务 4.1 后端部分）。
 *
 * 覆盖：
 * - 认证：未认证 401
 * - 授权：member 只读（写 403）；owner 全通；跨组织 404 非泄露
 * - 列表 envelope：{data:{templates,orgCopies,activation},meta}
 * - copy → 201 返回 requestUid/summary；非法模板 400；重复复制 409
 * - activation：enable/disable 202；未知版本 404
 * - impact 摘要有界低敏且动作语义正确
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  addOrgMember,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginPolicyBundle from '#models/plugin_policy_bundle'
import PluginPolicyBundleActivation from '#models/plugin_policy_bundle_activation'
import { DateTime } from 'luxon'
import { validatePluginPolicyBundleDocument, BUILTIN_PLUGIN_POLICY_TEMPLATES } from '@aiproj/types'

const KNOWN_PERMS = [
  'plugin_registry:view',
  'plugin_registry:submit',
  'plugin_registry:review',
  'plugin_registry:manage',
  'plugin_registry:rollback',
  'plugin_install:view',
  'plugin_install:manage',
]

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-policy-bundles`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedCopy(orgId: number, templateId = 'pm-enabled') {
  const template = BUILTIN_PLUGIN_POLICY_TEMPLATES.find((t) => t.templateId === templateId)!
  const raw: any = JSON.parse(JSON.stringify(template.document))
  raw.bundleId = `org-copy.${templateId}`
  raw.version = 1
  raw.sourceTemplateId = templateId
  raw.sourceTemplateVersion = template.templateVersion
  const v = validatePluginPolicyBundleDocument(raw, { knownPermissionKeys: KNOWN_PERMS })
  if (!v.valid || !v.normalized || !v.digest) throw new Error('seed invalid')
  await PluginPolicyBundle.create({
    organizationId: orgId,
    bundleId: v.normalized!.bundleId,
    sourceTemplateId: templateId as never,
    sourceTemplateVersion: template.templateVersion,
    version: 1,
    descriptionZh: v.normalized!.descriptionZh,
    rulesJson: v.normalized!.rules,
    documentDigest: v.digest!,
  })
  await PluginPolicyBundleActivation.create({
    organizationId: orgId,
    bundleId: v.normalized!.bundleId,
    activeVersion: 1,
    status: 'active',
    revision: 1,
    rowVersion: 1,
    activatedBy: 'seed',
    activatedAt: DateTime.now(),
  } as never)
  return v.normalized!
}

test.group('PluginPolicyBundles API', (group) => {
  useAiDatabase(group)

  test('未认证 401 / member 只读 / owner 可写', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const memberToken = await login(client, member.email)

    // 未认证
    const anon = await client.get(base(org.id))
    anon.assertStatus(401)

    // member 可读
    const listRes = await client
      .get(base(org.id))
      .headers({ Authorization: `Bearer ${memberToken}` })
    listRes.assertStatus(200)
    assertHasEnvelope(listRes.body())

    // member 写 → 403
    const postRes = await client
      .post(`${base(org.id)}/copy`)
      .headers({ Authorization: `Bearer ${memberToken}` })
      .json({ templateId: 'admin-managed' })
    postRes.assertStatus(403)
    assert.equal(postRes.body().error.code, 'PERMISSION_DENIED')

    // owner 写 → 走到业务层（重复或成功均可，但不得 403）
    const ownerToken = await login(client, owner.email)
    const ownerPost = await client
      .post(`${base(org.id)}/copy`)
      .headers({ Authorization: `Bearer ${ownerToken}` })
      .json({ templateId: 'member-readonly' })
    assert.notEqual(ownerPost.status(), 403)
  })

  test('copy 成功返回 requestUid 与有界摘要；重复复制 409', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client
      .post(`${base(org.id)}/copy`)
      .headers({ Authorization: `Bearer ${token}` })
      .json({ templateId: 'member-readonly' })
    res.assertStatus(201)
    const body = res.body().data
    assert.isTrue(typeof body.requestUid === 'string' && body.requestUid.startsWith('chg-'))
    assert.equal(body.summary.bounded, true)
    assert.includeMembers(body.summary.permissionKeysAffected, ['plugin_install:manage'])

    const dup = await client
      .post(`${base(org.id)}/copy`)
      .headers({ Authorization: `Bearer ${token}` })
      .json({ templateId: 'member-readonly' })
    dup.assertStatus(409)
    assert.equal(dup.body().error.code, 'policy-copy-exists')

    const badTpl = await client
      .post(`${base(org.id)}/copy`)
      .headers({ Authorization: `Bearer ${token}` })
      .json({ templateId: 'no-such-template' })
    badTpl.assertStatus(400)
  })

  test('activation 变更与 impact 摘要', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const doc = await seedCopy(org.id)
    const token = await login(client, owner.email)

    const dis = await client
      .post(`${base(org.id)}/${doc.bundleId}/activation`)
      .headers({ Authorization: `Bearer ${token}` })
      .json({ action: 'disable', version: 1 })
    dis.assertStatus(202)
    assert.equal(dis.body().data.summary.action, 'disable')

    const reqUid = dis.body().data.requestUid
    const impact = await client
      .get(`${base(org.id)}/changes/${reqUid}/impact`)
      .headers({ Authorization: `Bearer ${token}` })
    impact.assertStatus(200)
    const s = JSON.stringify(impact.body())
    for (const banned of ['token', 'secret', 'password']) {
      assert.isFalse(s.toLowerCase().includes(banned))
    }
    assert.equal(impact.body().data.state, 'pending-approval')

    const missingVer = await client
      .post(`${base(org.id)}/${doc.bundleId}/activation`)
      .headers({ Authorization: `Bearer ${token}` })
      .json({ action: 'enable', version: 99 })
    missingVer.assertStatus(404)
  })

  test('跨组织不可见（404 非泄露）与详情版本历史', async ({ client, assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    await seedCopy(orgA.id)
    const ownerB = await createUser()
    await createOrganization(ownerB)
    const tokenB = await login(client, ownerB.email)

    const cross = await client
      .get(`${base(orgA.id)}/org-copy.pm-enabled`)
      .headers({ Authorization: `Bearer ${tokenB}` })
    cross.assertStatus(404)
    assert.isFalse(JSON.stringify(cross.body()).includes('rules'))

    const ownToken = await login(client, ownerA.email)
    const show = await client
      .get(`${base(orgA.id)}/org-copy.pm-enabled`)
      .headers({ Authorization: `Bearer ${ownToken}` })
    show.assertStatus(200)
    assert.equal(show.body().data.length, 1)
  })

  test('列表含内置三模板中文说明与激活摘要', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedCopy(org.id)
    const token = await login(client, owner.email)
    const res = await client.get(base(org.id)).headers({ Authorization: `Bearer ${token}` })
    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.templates.length, 3)
    assert.isTrue(data.templates.every((t: any) => (t.titleZh ?? '').length > 0))
    assert.equal(data.activation.status, 'active')
    assert.equal(data.orgCopies.length, 1)
  })
})

function assertHasEnvelope(body: any): void {
  if (!body?.data || !body?.meta)
    throw new Error(`expected {data,meta}, got ${JSON.stringify(body).slice(0, 120)}`)
}
