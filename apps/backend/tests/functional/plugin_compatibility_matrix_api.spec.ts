import { test } from '@japa/runner'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'

function base(organizationId: number) {
  return `/api/v1/organizations/${organizationId}/plugin-installations`
}

async function login(client: any, email: string) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email, password: STRONG_PASSWORD })
  response.assertStatus(200)
  return response.body().data.accessToken as string
}

async function release(
  organizationId: number,
  version: string,
  hostRange: string,
  channel: 'stable' | 'prerelease' = 'stable',
) {
  return PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: 'com.aiproj.compat-fixture',
    version,
    packageDigest: `sha256:package-${version}`,
    manifestDigest: `sha256:manifest-${version}`,
    compatibilityDigest: `sha256:legacy-${version}`,
    upstreamReceiptRef: `fixture:compat-${version}`,
    status: 'approved',
    metadata: JSON.stringify({
      name: 'Compatibility Fixture',
      compatibilityMatrix: {
        pluginVersion: version,
        hostRange,
        manifestSchemaVersion: '1.0',
        permissionModelVersion: '1.0',
        channel,
        requiredSeams: [],
      },
      contributions: [],
      permissions: [],
    }),
    rowVersion: 1,
  })
}

test.group('Plugin compatibility matrix lifecycle binding', (group) => {
  useAiDatabase(group)

  test('stable compatible release binds digest through install/enable/upgrade/rollback', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const organization = await createOrganization(owner)
    const token = await login(client, owner.email)
    const v1 = await release(organization.id, '1.0.0', '>=3.0.0 <4.0.0')
    const v11 = await release(organization.id, '1.1.0', '>=3.0.0 <4.0.0')

    const installPreview = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: 'com.aiproj.compat-fixture', releaseId: v1.id })
    installPreview.assertStatus(200)
    assert.isString(installPreview.body().data.compatibilityDigest)
    assert.deepEqual(installPreview.body().data.compatibilityReasonCodes, [])
    const installConfirm = await client
      .post(`${base(organization.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: installPreview.body().data.previewHandle,
        previewDigest: installPreview.body().data.previewDigest,
      })
    installConfirm.assertStatus(200)

    const enablePreview = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'enable', pluginId: 'com.aiproj.compat-fixture' })
    enablePreview.assertStatus(200)
    const enableConfirm = await client
      .post(`${base(organization.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: enablePreview.body().data.previewHandle,
        previewDigest: enablePreview.body().data.previewDigest,
        permissionConfirmed: true,
        permissionDigest: enablePreview.body().data.permissionDigest,
      })
    enableConfirm.assertStatus(200)

    for (const target of [v11, v1]) {
      const preview = await client
        .post(`${base(organization.id)}/commands/preview`)
        .bearerToken(token)
        .json({ action: 'upgrade', pluginId: 'com.aiproj.compat-fixture', releaseId: target.id })
      preview.assertStatus(200)
      const confirm = await client
        .post(`${base(organization.id)}/commands/confirm`)
        .bearerToken(token)
        .json({
          previewHandle: preview.body().data.previewHandle,
          previewDigest: preview.body().data.previewDigest,
        })
      confirm.assertStatus(200)
    }
    const installed = await PluginInstallation.query()
      .where('organization_id', organization.id)
      .firstOrFail()
    assert.equal(installed.version, '1.0.0')
  })

  test('old host/new plugin, prerelease stable resolution and stale compatibility fail closed', async ({
    client,
  }) => {
    const owner = await createUser()
    const organization = await createOrganization(owner)
    const token = await login(client, owner.email)
    const future = await release(organization.id, '4.0.0', '>=4.0.0 <5.0.0')
    const futureResponse = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: 'com.aiproj.compat-fixture', releaseId: future.id })
    futureResponse.assertStatus(400)
    futureResponse.assertBodyContains({ error: { code: 'plugin-install-source-incompatible' } })

    const prerelease = await release(organization.id, '1.0.0-beta.1', '>=3.0.0 <4.0.0', 'stable')
    const prereleaseResponse = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: 'com.aiproj.compat-fixture', releaseId: prerelease.id })
    prereleaseResponse.assertStatus(400)

    const valid = await release(organization.id, '1.0.0', '>=3.0.0 <4.0.0')
    const preview = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: 'com.aiproj.compat-fixture', releaseId: valid.id })
    preview.assertStatus(200)
    valid.metadata = JSON.stringify({
      name: 'changed',
      compatibilityMatrix: {
        pluginVersion: '1.0.0',
        hostRange: '>=4.0.0 <5.0.0',
        manifestSchemaVersion: '1.0',
        permissionModelVersion: '1.0',
        channel: 'stable',
        requiredSeams: [],
      },
      contributions: [],
      permissions: [],
    })
    await valid.save()
    const confirm = await client
      .post(`${base(organization.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: preview.body().data.previewHandle,
        previewDigest: preview.body().data.previewDigest,
      })
    confirm.assertStatus(400)
  })

  test('cross-tenant release and preview handle are non-disclosing', async ({ client }) => {
    const ownerA = await createUser()
    const ownerB = await createUser()
    const organizationA = await createOrganization(ownerA)
    const organizationB = await createOrganization(ownerB)
    const tokenA = await login(client, ownerA.email)
    const tokenB = await login(client, ownerB.email)
    const releaseA = await release(organizationA.id, '1.0.0', '>=3.0.0 <4.0.0')
    const previewA = await client
      .post(`${base(organizationA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'install', pluginId: 'com.aiproj.compat-fixture', releaseId: releaseA.id })
    previewA.assertStatus(200)
    const foreignRelease = await client
      .post(`${base(organizationB.id)}/commands/preview`)
      .bearerToken(tokenB)
      .json({ action: 'install', pluginId: 'com.aiproj.compat-fixture', releaseId: releaseA.id })
    foreignRelease.assertStatus(404)
    const foreignConfirm = await client
      .post(`${base(organizationB.id)}/commands/confirm`)
      .bearerToken(tokenB)
      .json({
        previewHandle: previewA.body().data.previewHandle,
        previewDigest: previewA.body().data.previewDigest,
      })
    foreignConfirm.assertStatus(400)
    foreignConfirm.assertBodyContains({ error: { code: 'plugin-install-preview-expired' } })
  })

  test('release approval preview rejects missing declarations and preserves review authorization', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const organization = await createOrganization(owner)
    const ownerToken = await login(client, owner.email)
    const compatible = await release(organization.id, '1.2.0', '>=3.0.0 <4.0.0')
    compatible.status = 'pending_review'
    await compatible.save()

    const acceptedPreview = await client
      .post(`/api/v1/organizations/${organization.id}/plugin-registry/commands/preview`)
      .bearerToken(ownerToken)
      .json({ action: 'approve', targetReleaseId: compatible.id })
    acceptedPreview.assertStatus(200)
    assert.isString(acceptedPreview.body().data.compatibilityDigest)
    assert.deepEqual(acceptedPreview.body().data.compatibilityReasonCodes, [])

    const undeclared = await release(organization.id, '1.2.1', '>=3.0.0 <4.0.0')
    undeclared.status = 'pending_review'
    undeclared.metadata = JSON.stringify({ name: 'Missing matrix' })
    await undeclared.save()
    const rejectedPreview = await client
      .post(`/api/v1/organizations/${organization.id}/plugin-registry/commands/preview`)
      .bearerToken(ownerToken)
      .json({ action: 'approve', targetReleaseId: undeclared.id })
    rejectedPreview.assertStatus(400)
    rejectedPreview.assertBodyContains({
      error: {
        code: 'registry-release-incompatible',
        details: { reasonCodes: ['input-unknown'] },
      },
    })

    const viewer = await createUser()
    await addOrgMember(organization, viewer, 'viewer')
    const viewerToken = await login(client, viewer.email)
    const unauthorized = await client
      .post(`/api/v1/organizations/${organization.id}/plugin-registry/commands/preview`)
      .bearerToken(viewerToken)
      .json({ action: 'approve', targetReleaseId: compatible.id })
    unauthorized.assertStatus(403)
  })
})
