import { test } from '@japa/runner'
import CompilerSkill from '#models/compiler_skill'
import PluginInstallation from '#models/plugin_installation'
import PluginServerHookService from '#services/plugin_server_hook_service'
import PluginServerHookInvocationService, {
  clearDegradationCounters,
  getDegradationCountSnapshot,
  registerServerHookCallback,
  unregisterServerHookCallback,
} from '#services/plugin_server_hook_invocation_service'
import PluginSkillAdapterService from '#services/plugin_skill_adapter_service'
import RbacPolicy from '#policies/rbac_policy'
import RbacService from '#services/rbac_service'
import AuditService from '#services/audit_service'
import {
  CANARY_ADVISORY_FIXTURE_RESULT,
  CANARY_ADVISORY_PLUGIN_ID,
  CANARY_QUERY_RELEASE_METADATA,
  CANARY_QUERY_FIXTURE_RESULT,
  CANARY_QUERY_PLUGIN_ID,
  type PluginServerHookQueryRequest,
} from '@aiproj/types'
import { seedCanaryRelease } from '../fixtures/first_party_plugin_canary_releases.js'
import {
  STRONG_PASSWORD,
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

async function command(
  client: any,
  token: string,
  organizationId: number,
  payload: Record<string, unknown>,
) {
  const previewResponse = await client
    .post(`${base(organizationId)}/commands/preview`)
    .bearerToken(token)
    .json(payload)
  previewResponse.assertStatus(200)
  const preview = previewResponse.body().data
  const confirmResponse = await client
    .post(`${base(organizationId)}/commands/confirm`)
    .bearerToken(token)
    .json({
      previewHandle: preview.previewHandle,
      previewDigest: preview.previewDigest,
      ...(payload.action === 'enable'
        ? { permissionConfirmed: true, permissionDigest: preview.permissionDigest }
        : {}),
    })
  confirmResponse.assertStatus(200)
  return { preview, installation: confirmResponse.body().data }
}

test.group('First-party plugin canary pack E2E', (group) => {
  useAiDatabase(group)
  group.teardown(() => unregisterServerHookCallback('canary-query-summary-callback'))

  test('two-tenant lifecycle: install/enable/execute/disable/upgrade/rollback/uninstall', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser()
    const ownerB = await createUser()
    const organizationA = await createOrganization(ownerA)
    const organizationB = await createOrganization(ownerB)
    const tokenA = await login(client, ownerA.email)
    const tokenB = await login(client, ownerB.email)
    const queryV1 = await seedCanaryRelease(organizationA.id, 'query', '1.0.0')
    const queryV11 = await seedCanaryRelease(organizationA.id, 'query', '1.1.0')
    const advisory = await seedCanaryRelease(organizationA.id, 'advisory', '1.0.0')

    const installQuery = await command(client, tokenA, organizationA.id, {
      action: 'install',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      releaseId: queryV1.id,
    })
    assert.equal(installQuery.installation.status, 'installed')
    assert.isString(installQuery.preview.compatibilityDigest)
    const consumedPreviewReplay = await client
      .post(`${base(organizationA.id)}/commands/confirm`)
      .bearerToken(tokenA)
      .json({
        previewHandle: installQuery.preview.previewHandle,
        previewDigest: installQuery.preview.previewDigest,
      })
    consumedPreviewReplay.assertStatus(400)
    consumedPreviewReplay.assertBodyContains({ error: { code: 'plugin-install-preview-expired' } })
    await command(client, tokenA, organizationA.id, {
      action: 'enable',
      pluginId: CANARY_QUERY_PLUGIN_ID,
    })

    const installAdvisory = await command(client, tokenA, organizationA.id, {
      action: 'install',
      pluginId: CANARY_ADVISORY_PLUGIN_ID,
      releaseId: advisory.id,
    })
    assert.equal(installAdvisory.installation.status, 'installed')
    await command(client, tokenA, organizationA.id, {
      action: 'enable',
      pluginId: CANARY_ADVISORY_PLUGIN_ID,
    })

    // Query execution uses the production hook resolver/invocation path.
    registerServerHookCallback(
      'canary-query-summary-callback',
      async () => CANARY_QUERY_FIXTURE_RESULT,
    )
    const resolved = await new PluginServerHookService().resolvePluginServerHookContributions(
      organizationA.id,
    )
    assert.include(resolved.effectiveContributionKeys, 'canary-query-summary')
    const request: PluginServerHookQueryRequest = {
      seamKey: 'server-query.readonly-provider',
      contributionKey: 'canary-query-summary',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      pluginVersion: '1.0.0',
      context: {
        organizationId: organizationA.id,
        userId: ownerA.id,
        userRoles: ['admin'],
        requestedPermissions: ['project:view'],
        scope: 'organization',
      },
      payload: {},
    }
    const invocation = new PluginServerHookInvocationService(
      new RbacPolicy(new RbacService()),
      new AuditService(),
    )
    const result = await invocation.invokeQueryCallback(
      request,
      'canary-e2e-run',
      'canary-query-summary-callback',
    )
    assert.equal(result.result?.data.projectCount, 3)
    assert.deepEqual(result.result, CANARY_QUERY_FIXTURE_RESULT)
    assert.equal(CANARY_QUERY_FIXTURE_RESULT.providerCalls, 0)
    assert.isFalse(CANARY_QUERY_FIXTURE_RESULT.draftPersisted)
    const repeated = await invocation.invokeQueryCallback(
      request,
      'canary-e2e-run-repeat',
      'canary-query-summary-callback',
    )
    assert.deepEqual(repeated.result?.data, result.result?.data)

    const quotaFirst = await invocation.invokeQueryCallback(
      request,
      'canary-e2e-quota',
      'canary-query-summary-callback',
      1,
    )
    const quotaDenied = await invocation.invokeQueryCallback(
      request,
      'canary-e2e-quota',
      'canary-query-summary-callback',
      1,
    )
    assert.isDefined(quotaFirst.result)
    assert.equal(quotaDenied.error, 'Server hook call quota exceeded')
    assert.deepEqual(getDegradationCountSnapshot('canary-e2e-quota'), {
      totalAttempts: 2,
      successes: 1,
      failures: 1,
      timeouts: 0,
      skipped: 1,
    })
    clearDegradationCounters('canary-e2e-quota')

    // Advisory references an existing active host Skill and does not copy it.
    await CompilerSkill.create({
      organizationId: organizationA.id,
      skillKey: 'skill-sw-dev',
      name: 'SW Development',
      version: '1.0.0',
      description: 'Host-owned skill',
      status: 'active',
      category: { primary: 'domain' },
      tags: ['canary'],
      activation: {},
      knowledge: {},
      basePriority: 10,
      createdBy: ownerA.id,
      updatedBy: ownerA.id,
    })
    const skillResolution = await new PluginSkillAdapterService().resolvePluginSkillContributions(
      organizationA.id,
      CANARY_ADVISORY_PLUGIN_ID,
    )
    assert.deepEqual(skillResolution.effectiveSkillKeys, ['skill-sw-dev'])
    assert.isTrue(skillResolution.skillBundles[0]!.isEffective)
    assert.isTrue(CANARY_ADVISORY_FIXTURE_RESULT.advisory)
    assert.isTrue(CANARY_ADVISORY_FIXTURE_RESULT.bounded)
    assert.equal(CANARY_ADVISORY_FIXTURE_RESULT.providerCalls, 0)
    assert.isFalse(CANARY_ADVISORY_FIXTURE_RESULT.draftPersisted)
    assert.include(CANARY_ADVISORY_FIXTURE_RESULT.draft.summary, '人工确认')

    // Cross-tenant preview handle replay is indistinguishable from an absent handle.
    const foreignPreview = await client
      .post(`${base(organizationA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'disable', pluginId: CANARY_QUERY_PLUGIN_ID })
    foreignPreview.assertStatus(200)
    const replay = await client
      .post(`${base(organizationB.id)}/commands/confirm`)
      .bearerToken(tokenB)
      .json({
        previewHandle: foreignPreview.body().data.previewHandle,
        previewDigest: foreignPreview.body().data.previewDigest,
      })
    replay.assertStatus(400)
    replay.assertBodyContains({ error: { code: 'plugin-install-preview-expired' } })

    await command(client, tokenA, organizationA.id, {
      action: 'disable',
      pluginId: CANARY_QUERY_PLUGIN_ID,
    })
    const contribsAfterDisable =
      await new PluginServerHookService().resolvePluginServerHookContributions(organizationA.id)
    assert.notInclude(contribsAfterDisable.effectiveContributionKeys, 'canary-query-summary')
    await command(client, tokenA, organizationA.id, {
      action: 'enable',
      pluginId: CANARY_QUERY_PLUGIN_ID,
    })
    await command(client, tokenA, organizationA.id, {
      action: 'upgrade',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      releaseId: queryV11.id,
    })
    const installedAfterUpgrade = await PluginInstallation.query()
      .where('organization_id', organizationA.id)
      .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
      .firstOrFail()
    assert.equal(installedAfterUpgrade.version, '1.1.0')
    await command(client, tokenA, organizationA.id, {
      action: 'upgrade',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      releaseId: queryV1.id,
    })
    const installedAfterRollback = await PluginInstallation.query()
      .where('organization_id', organizationA.id)
      .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
      .firstOrFail()
    assert.equal(installedAfterRollback.version, '1.0.0')
    await command(client, tokenA, organizationA.id, {
      action: 'uninstall',
      pluginId: CANARY_QUERY_PLUGIN_ID,
    })
    const contribsAfterRepeat =
      await new PluginServerHookService().resolvePluginServerHookContributions(organizationA.id)
    assert.notInclude(contribsAfterRepeat.effectiveContributionKeys, 'canary-query-summary')
    const repeatedUninstall = await client
      .post(`${base(organizationA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'uninstall', pluginId: CANARY_QUERY_PLUGIN_ID })
    repeatedUninstall.assertStatus(400)
    assert.lengthOf(
      await PluginInstallation.query()
        .where('organization_id', organizationA.id)
        .where('plugin_id', CANARY_QUERY_PLUGIN_ID),
      1,
    )
  })

  test('corrupt/digest/permission/compatibility/timeout negatives fail closed without residue', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const organization = await createOrganization(owner)
    const token = await login(client, owner.email)
    const corrupt = await seedCanaryRelease(organization.id, 'query', '1.0.0', {
      metadata: {
        ...CANARY_QUERY_RELEASE_METADATA,
        name: 'corrupt',
        compatibilityMatrix: {
          pluginVersion: '1.0.0',
          hostRange: '>=3.0.0 <4.0.0',
          manifestSchemaVersion: '1.0',
          permissionModelVersion: '1.0',
          channel: 'stable',
          requiredSeams: [{ seamKey: 'server-query.readonly-provider', seamVersion: '1.0.0' }],
        },
        contributions: [
          {
            contributionKey: 'bad',
            seamKey: 'server-query.readonly-provider',
            seamVersion: '1.0.0',
            payload: {
              callbackHandle: '../escape',
              requiredPermissions: ['project:view'],
              networkAccess: 'https://evil.example',
            },
          },
        ],
      },
    })
    const corruptResponse = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: corrupt.id })
    corruptResponse.assertStatus(400)

    const digestRelease = await seedCanaryRelease(organization.id, 'query', '1.0.1')
    const digestMismatch = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'install',
        pluginId: CANARY_QUERY_PLUGIN_ID,
        releaseId: digestRelease.id,
        expectedDigest: 'sha256:tampered-package',
      })
    digestMismatch.assertStatus(400)
    digestMismatch.assertBodyContains({ error: { code: 'plugin-install-digest-mismatch' } })

    const incompatible = await seedCanaryRelease(organization.id, 'query', '2.0.0', {
      status: 'draft',
      metadata: {
        ...CANARY_QUERY_FIXTURE_RESULT,
        name: 'bad compatibility',
        compatibilityMatrix: {
          pluginVersion: '2.0.0',
          hostRange: '>=4.0.0 <5.0.0',
          manifestSchemaVersion: '1.0',
          permissionModelVersion: '1.0',
          channel: 'stable',
          requiredSeams: [],
        },
        contributions: [],
      },
    })
    // Defense-in-depth fixture: simulate a tampered/legacy row that bypassed
    // the approval gate; install preview must still reject it.
    incompatible.status = 'approved'
    await incompatible.save()
    const incompatibleResponse = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: incompatible.id })
    incompatibleResponse.assertStatus(400)
    incompatibleResponse.assertBodyContains({
      error: { code: 'plugin-install-source-incompatible' },
    })

    assert.lengthOf(await PluginInstallation.query().where('organization_id', organization.id), 0)

    // Permission elevation on an enabled plugin needs a fresh, digest-bound
    // confirmation and leaves the old version untouched when omitted.
    const baseRelease = await seedCanaryRelease(organization.id, 'query', '1.0.2')
    let duplicateRejected = false
    try {
      await seedCanaryRelease(organization.id, 'query', '1.0.2')
    } catch {
      duplicateRejected = true
    }
    assert.isTrue(duplicateRejected, '同组织相同 plugin/version 的重复 release 必须拒绝')
    await command(client, token, organization.id, {
      action: 'install',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      releaseId: baseRelease.id,
    })
    await command(client, token, organization.id, {
      action: 'enable',
      pluginId: CANARY_QUERY_PLUGIN_ID,
    })
    const elevatedMetadata = {
      ...CANARY_QUERY_RELEASE_METADATA,
      version: '1.1.0',
      permissions: [
        ...CANARY_QUERY_RELEASE_METADATA.permissions,
        {
          permissionKey: 'aiproj.project-export',
          seamKey: 'server-query.readonly-provider',
          sideEffect: 'read-only',
          network: 'none',
          purpose: 'Canary permission-elevation fixture',
        },
      ],
      compatibilityMatrix: {
        pluginVersion: '1.1.0',
        hostRange: '>=3.0.0 <4.0.0',
        manifestSchemaVersion: '1.0',
        permissionModelVersion: '1.0',
        channel: 'stable',
        requiredSeams: CANARY_QUERY_RELEASE_METADATA.contributions.map((item) => ({
          seamKey: item.seamKey,
          seamVersion: item.seamVersion,
        })),
      },
    }
    const elevatedRelease = await seedCanaryRelease(organization.id, 'query', '1.1.0', {
      metadata: elevatedMetadata,
    })
    const elevationPreviewResponse = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'upgrade', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: elevatedRelease.id })
    elevationPreviewResponse.assertStatus(200)
    const elevationPreview = elevationPreviewResponse.body().data
    const elevationDenied = await client
      .post(`${base(organization.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: elevationPreview.previewHandle,
        previewDigest: elevationPreview.previewDigest,
      })
    elevationDenied.assertStatus(400)
    elevationDenied.assertBodyContains({ error: { code: 'plugin-install-permission-unconfirmed' } })
    const installedAfterElevation = await PluginInstallation.query()
      .where('organization_id', organization.id)
      .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
      .firstOrFail()
    assert.equal(installedAfterElevation.version, '1.0.2')
    const elevationConfirmed = await client
      .post(`${base(organization.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: elevationPreview.previewHandle,
        previewDigest: elevationPreview.previewDigest,
        permissionConfirmed: true,
        permissionDigest: elevationPreview.permissionDigest,
      })
    elevationConfirmed.assertStatus(200)
    assert.equal(elevationConfirmed.body().data.version, '1.1.0')

    // Downgrade/rollback uses the same upgrade gate. An incompatible target
    // must fail closed and preserve the currently enabled version/authorization.
    const failedRollback = await client
      .post(`${base(organization.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'upgrade', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: incompatible.id })
    failedRollback.assertStatus(400)
    failedRollback.assertBodyContains({ error: { code: 'plugin-install-source-incompatible' } })
    const afterFailedRollback = await PluginInstallation.query()
      .where('organization_id', organization.id)
      .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
    assert.lengthOf(afterFailedRollback, 1)
    assert.equal(afterFailedRollback[0]!.version, '1.1.0')
    assert.equal(afterFailedRollback[0]!.status, 'enabled')

    registerServerHookCallback('canary-timeout', async () => {
      throw new Error('fixture timeout')
    })
    const invocation = new PluginServerHookInvocationService(
      new RbacPolicy(new RbacService()),
      new AuditService(),
    )
    const request: PluginServerHookQueryRequest = {
      seamKey: 'server-query.readonly-provider',
      contributionKey: 'timeout',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      pluginVersion: '1.0.0',
      context: {
        organizationId: organization.id,
        userId: owner.id,
        userRoles: ['admin'],
        requestedPermissions: [],
        scope: 'organization',
      },
      payload: {},
    }
    const failed = await invocation.invokeQueryCallback(
      request,
      'canary-timeout-run',
      'canary-timeout',
    )
    assert.isDefined(failed.error)
    assert.equal(getDegradationCountSnapshot('canary-timeout-run')?.failures, 1)
    clearDegradationCounters('canary-timeout-run')
    unregisterServerHookCallback('canary-timeout')
  })
})
