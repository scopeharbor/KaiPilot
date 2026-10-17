import { test } from '@japa/runner'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import OcrProfilePluginResolver from '#services/ai_ocr/ocr_profile_plugin_resolver'
import { createOrganization, createUser, useAiDatabase } from './ai/_helpers.js'
import {
  PLUGIN_SEAM_OCR_PROFILE,
  computeOcrProfilePackDigest,
  mergeOcrProfileProjections,
  projectOcrReviewUi,
  type OcrProfilePluginPackPayload,
} from '@aiproj/types'

const payload: OcrProfilePluginPackPayload = {
  schemaVersion: '1.0',
  profiles: [
    {
      profileKey: 'project_charter',
      name: '项目章程抽取',
      version: '1.0.0',
      fields: [{ key: 'project_name', label: '项目名称', type: 'string', required: true }],
      entities: [
        { key: 'risk_links', label: '风险', entityType: 'risk', matchFields: ['project_name'] },
      ],
      review: {
        groups: [
          {
            key: 'basics',
            label: '基本信息',
            component: 'field-list',
            fieldKeys: ['project_name'],
          },
        ],
      },
    },
  ],
}

async function seed(organizationId: number, version = '1.0.0') {
  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: 'com.aiproj.official.ocr-profile-pack',
    version,
    packageDigest: `sha256:ocr-package-${version}`,
    manifestDigest: `sha256:ocr-manifest-${version}`,
    compatibilityDigest: `sha256:ocr-compat-${version}`,
    upstreamReceiptRef: `fixture:ocr-${version}`,
    status: 'approved',
    metadata: JSON.stringify({
      name: 'Official OCR Profile Pack',
      contributions: [
        {
          contributionKey: 'official-ocr-profiles',
          seamKey: PLUGIN_SEAM_OCR_PROFILE,
          seamVersion: '1.0.0',
          payload,
        },
      ],
      permissions: [
        {
          permissionKey: 'document:view',
          seamKey: PLUGIN_SEAM_OCR_PROFILE,
          sideEffect: 'read-only',
          network: 'none',
        },
      ],
    }),
    rowVersion: 1,
  })
  const installation = await PluginInstallation.create({
    organizationId,
    pluginId: 'com.aiproj.official.ocr-profile-pack',
    version,
    releaseId: release.id,
    status: 'enabled',
    permissionConfirmation: {
      confirmedBy: 'fixture',
      permissionDigest: 'sha256:permissions',
      permissionKeys: ['document:view'],
      confirmedAt: '2026-08-21T00:00:00.000Z',
    },
    packageDigest: release.packageDigest,
    manifestDigest: release.manifestDigest,
    compatibilityDigest: release.compatibilityDigest,
    rowVersion: 1,
    uninstalledAt: null,
  })
  return { release, installation }
}

test.group('OCR profile plugin resolver', (group) => {
  useAiDatabase(group)

  test('enabled contribution resolves with immutable provenance and allowlisted UI', async ({
    assert,
  }) => {
    const owner = await createUser()
    const organization = await createOrganization(owner)
    await seed(organization.id)

    const resolver = new OcrProfilePluginResolver()
    const profiles = await resolver.listEnabledPluginProfiles(organization.id)
    assert.lengthOf(profiles, 1)
    assert.equal(
      profiles[0]!.profileRef,
      'plugin:com.aiproj.official.ocr-profile-pack/project_charter',
    )
    assert.equal(profiles[0]!.pluginRef?.payloadDigest, computeOcrProfilePackDigest(payload))
    assert.lengthOf(projectOcrReviewUi(profiles[0]!), 1)
  })

  test('organization isolation, disable/upgrade/rollback/uninstall visibility and history snapshot', async ({
    assert,
  }) => {
    const ownerA = await createUser()
    const ownerB = await createUser()
    const organizationA = await createOrganization(ownerA)
    const organizationB = await createOrganization(ownerB)
    const { installation } = await seed(organizationA.id)
    const resolver = new OcrProfilePluginResolver()

    const original = await resolver.listEnabledPluginProfiles(organizationA.id)
    assert.lengthOf(original, 1)
    assert.lengthOf(await resolver.listEnabledPluginProfiles(organizationB.id), 0)

    installation.status = 'installed'
    await installation.save()
    assert.lengthOf(await resolver.listEnabledPluginProfiles(organizationA.id), 0)
    assert.equal(
      original[0]!.pluginRef?.payloadDigest,
      computeOcrProfilePackDigest(payload),
      '历史 snapshot 不依赖当前安装态',
    )

    installation.status = 'enabled'
    installation.version = '1.1.0'
    await installation.save()
    assert.lengthOf(await resolver.listEnabledPluginProfiles(organizationA.id), 1)

    installation.version = '1.0.0'
    await installation.save()
    const enabledProfiles = await resolver.listEnabledPluginProfiles(organizationA.id)
    assert.equal(enabledProfiles[0]!.pluginRef?.pluginVersion, '1.0.0')

    installation.status = 'uninstalled'
    await installation.save()
    assert.lengthOf(await resolver.listEnabledPluginProfiles(organizationA.id), 0)
  })

  test('three-source merge is deterministic and organization source wins only identical refs', ({
    assert,
  }) => {
    const base = {
      profileRef: 'builtin:meeting',
      source: 'builtin' as const,
      name: 'builtin',
      version: '1',
      schemaSnapshot: { fields: [], entities: [] },
      reviewSnapshot: { groups: [] },
    }
    const organization = { ...base, source: 'organization' as const, name: 'organization' }
    const merged = mergeOcrProfileProjections([base], [], [organization])
    assert.equal(merged[0]!.name, 'organization')
  })
})
