import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { ProjectRoleName } from '#rbac'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const PLUGIN_ID = 'com.aiproj.official.ocr-profile-pack'
const PROFILE_REF = `plugin:${PLUGIN_ID}/project_charter`

interface OcrProfileListItem {
  profileRef: string
  pluginVersion?: string
  profileSource: string
  reviewSnapshot: { groups: unknown[] }
}

function installBase(organizationId: number) {
  return `/api/v1/organizations/${organizationId}/plugin-installations`
}

function ocrBase(projectId: number) {
  return `/api/v1/projects/${projectId}/ocr/structured-extraction`
}

async function login(client: any, user: { email: string }) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  response.assertStatus(200)
  return response.body().data.accessToken as string
}

function profilePayload(version: string) {
  return {
    schemaVersion: '1.0',
    profiles: [
      {
        profileKey: 'project_charter',
        name: `项目章程抽取 ${version}`,
        version,
        description: '只声明提取字段与宿主审查组件',
        fields: [
          { key: 'project_name', label: '项目名称', type: 'string', required: true },
          { key: 'target_date', label: '目标日期', type: 'date' },
        ],
        entities: [
          {
            key: 'risk_links',
            label: '风险关联',
            entityType: 'risk',
            matchFields: ['project_name'],
          },
        ],
        review: {
          groups: [
            {
              key: 'basics',
              label: '基本信息',
              component: 'field-list',
              fieldKeys: ['project_name', 'target_date'],
            },
          ],
        },
      },
    ],
  }
}

async function seedRelease(organizationId: number, version: string) {
  const metadata = {
    name: 'Aiproj Official OCR Profile Pack',
    version,
    contributions: [
      {
        contributionKey: 'official-ocr-profiles',
        seamKey: 'ocr-profile.content-bundle',
        seamVersion: '1.0.0',
        payload: profilePayload(version),
      },
    ],
    permissions: [
      {
        permissionKey: 'com.aiproj.ocr.profile.view',
        seamKey: 'ocr-profile.content-bundle',
        sideEffect: 'read-only',
        network: 'none',
        purpose: 'Read declarative OCR profiles',
      },
    ],
    compatibilityMatrix: {
      pluginVersion: version,
      hostRange: '>=3.0.0 <4.0.0',
      manifestSchemaVersion: '1.0',
      permissionModelVersion: '1.0',
      channel: 'stable',
      requiredSeams: [{ seamKey: 'ocr-profile.content-bundle', seamVersion: '1.0.0' }],
    },
  }
  return PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PLUGIN_ID,
    version,
    packageDigest: `sha256:ocr-profile-package-${version}`,
    manifestDigest: `sha256:ocr-profile-manifest-${version}`,
    compatibilityDigest: `sha256:ocr-profile-compat-${version}`,
    upstreamReceiptRef: `fixture:ocr-profile-pack-${version}`,
    status: 'approved',
    metadata: JSON.stringify(metadata),
    rowVersion: 1,
  })
}

async function runCommand(
  client: any,
  token: string,
  organizationId: number,
  payload: Record<string, unknown>,
) {
  const previewResponse = await client
    .post(`${installBase(organizationId)}/commands/preview`)
    .bearerToken(token)
    .json(payload)
  previewResponse.assertStatus(200)
  const preview = previewResponse.body().data
  const confirmResponse = await client
    .post(`${installBase(organizationId)}/commands/confirm`)
    .bearerToken(token)
    .json({
      previewHandle: preview.previewHandle,
      previewDigest: preview.previewDigest,
      ...(payload.action === 'enable'
        ? { permissionConfirmed: true, permissionDigest: preview.permissionDigest }
        : {}),
    })
  confirmResponse.assertStatus(200)
  return confirmResponse.body().data
}

async function seedAcceptedExtraction(
  organizationId: number,
  projectId: number,
  reviewerId: number,
) {
  return OcrReviewAcceptedExtraction.create({
    organizationId,
    projectId,
    reviewerId,
    sourceKind: 'attachment',
    sourceId: 501,
    sourceHash: `sha256:ocr-source-${organizationId}-${projectId}`,
    candidateHash: `sha256:ocr-candidate-${organizationId}-${projectId}`,
    selectedTextHash: `sha256:ocr-text-${organizationId}-${projectId}`,
    selectedText: '项目名称：开项插件验证\n目标日期：2026年9月30日',
    pageRefsJson: [1],
    status: 'current',
    confirmedAt: DateTime.now(),
    purgedAt: null,
    retentionLifecycle: null,
    retentionSensitivity: null,
    retentionEligibleAt: null,
  })
}

test.group('OCR profile plugin pack E2E', (group) => {
  useAuthDatabase(group)

  test('two-tenant install/select/extract/review/disable/upgrade/rollback/uninstall keeps history', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('ocr-plugin-a') })
    const ownerB = await createUser({ email: uniqueEmail('ocr-plugin-b') })
    const organizationA = await createOrganization(ownerA)
    const organizationB = await createOrganization(ownerB)
    const { project: projectA } = await createProjectWithMember(
      organizationA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const { project: projectB } = await createProjectWithMember(
      organizationB,
      ownerB,
      ownerB,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tokenA = await login(client, ownerA)
    const tokenB = await login(client, ownerB)
    const releaseV1 = await seedRelease(organizationA.id, '1.0.0')
    const releaseV2 = await seedRelease(organizationA.id, '2.0.0')

    await runCommand(client, tokenA, organizationA.id, {
      action: 'install',
      pluginId: PLUGIN_ID,
      releaseId: releaseV1.id,
    })
    await runCommand(client, tokenA, organizationA.id, { action: 'enable', pluginId: PLUGIN_ID })

    const profilesA = await client.get(`${ocrBase(projectA.id)}/profiles`).bearerToken(tokenA)
    profilesA.assertStatus(200)
    const pluginProfile = (profilesA.body().data as OcrProfileListItem[]).find(
      (item) => item.profileRef === PROFILE_REF,
    )
    if (!pluginProfile) {
      throw new Error('organization A should resolve the enabled plugin profile')
    }
    assert.equal(pluginProfile.profileSource, 'plugin')
    assert.equal(pluginProfile.pluginVersion, '1.0.0')
    assert.lengthOf(pluginProfile.reviewSnapshot.groups, 1)

    const profilesB = await client.get(`${ocrBase(projectB.id)}/profiles`).bearerToken(tokenB)
    profilesB.assertStatus(200)
    assert.notInclude(
      (profilesB.body().data as OcrProfileListItem[]).map((item) => item.profileRef),
      PROFILE_REF,
    )

    const extractionA = await seedAcceptedExtraction(organizationA.id, projectA.id, ownerA.id)
    const createRun = await client
      .post(`${ocrBase(projectA.id)}/runs`)
      .bearerToken(tokenA)
      .json({ extractionId: extractionA.id, profileRef: PROFILE_REF })
    createRun.assertStatus(201)
    const runId = createRun.body().data.runId as number
    assert.equal(createRun.body().data.profileRef, PROFILE_REF)
    assert.equal(createRun.body().data.pluginVersion, '1.0.0')
    assert.isString(createRun.body().data.profilePayloadDigest)

    const runDetail = await client.get(`${ocrBase(projectA.id)}/runs/${runId}`).bearerToken(tokenA)
    runDetail.assertStatus(200)
    const fieldIds = runDetail.body().data.fieldCandidates.map((item: any) => item.candidateId)
    const tableIds = runDetail.body().data.tableCandidates.map((item: any) => item.candidateId)
    assert.isAtLeast(fieldIds.length, 1)

    const preview = await client
      .post(`${ocrBase(projectA.id)}/preview`)
      .bearerToken(tokenA)
      .json({
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
        reviewNote: 'OCR 插件 profile 人工审查',
      })
    preview.assertStatus(200)
    assert.isTrue(preview.body().data.requiresExplicitConfirmation)

    const save = await client
      .post(`${ocrBase(projectA.id)}/save`)
      .bearerToken(tokenA)
      .json({
        previewHash: preview.body().data.previewHash,
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
        reviewNote: '确认保存 OCR 插件 profile 快照',
      })
    save.assertStatus(201)
    const snapshotId = save.body().data.snapshotId as number
    assert.equal(save.body().data.profileRef, PROFILE_REF)
    assert.equal(save.body().data.profileSource, 'plugin')

    await runCommand(client, tokenA, organizationA.id, { action: 'disable', pluginId: PLUGIN_ID })
    const afterDisable = await client.get(`${ocrBase(projectA.id)}/profiles`).bearerToken(tokenA)
    afterDisable.assertStatus(200)
    assert.notInclude(
      (afterDisable.body().data as OcrProfileListItem[]).map((item) => item.profileRef),
      PROFILE_REF,
    )
    const historyAfterDisable = await client
      .get(`${ocrBase(projectA.id)}/runs/${runId}`)
      .bearerToken(tokenA)
    historyAfterDisable.assertStatus(200)
    assert.equal(historyAfterDisable.body().data.pluginVersion, '1.0.0')

    await runCommand(client, tokenA, organizationA.id, {
      action: 'upgrade',
      pluginId: PLUGIN_ID,
      releaseId: releaseV2.id,
    })
    await runCommand(client, tokenA, organizationA.id, { action: 'enable', pluginId: PLUGIN_ID })
    const afterUpgrade = await client.get(`${ocrBase(projectA.id)}/profiles`).bearerToken(tokenA)
    afterUpgrade.assertStatus(200)
    assert.equal(
      (afterUpgrade.body().data as OcrProfileListItem[]).find(
        (item) => item.profileRef === PROFILE_REF,
      )?.pluginVersion,
      '2.0.0',
    )

    await runCommand(client, tokenA, organizationA.id, {
      action: 'upgrade',
      pluginId: PLUGIN_ID,
      releaseId: releaseV1.id,
    })
    const installedProfile = await PluginInstallation.query()
      .where('organization_id', organizationA.id)
      .where('plugin_id', PLUGIN_ID)
      .firstOrFail()
    assert.equal(installedProfile.version, '1.0.0')

    await runCommand(client, tokenA, organizationA.id, { action: 'uninstall', pluginId: PLUGIN_ID })
    const afterUninstall = await client.get(`${ocrBase(projectA.id)}/profiles`).bearerToken(tokenA)
    afterUninstall.assertStatus(200)
    assert.notInclude(
      (afterUninstall.body().data as OcrProfileListItem[]).map((item) => item.profileRef),
      PROFILE_REF,
    )
    const historicalRun = await client
      .get(`${ocrBase(projectA.id)}/runs/${runId}`)
      .bearerToken(tokenA)
    historicalRun.assertStatus(200)
    assert.equal(historicalRun.body().data.pluginVersion, '1.0.0')
    const historicalSnapshot = await client
      .get(`${ocrBase(projectA.id)}/snapshots/${snapshotId}`)
      .bearerToken(tokenA)
    historicalSnapshot.assertStatus(200)
    assert.equal(historicalSnapshot.body().data.profileRef, PROFILE_REF)
    assert.equal(historicalSnapshot.body().data.pluginVersion, '1.0.0')

    const extractionB = await seedAcceptedExtraction(organizationB.id, projectB.id, ownerB.id)
    const crossTenantCreate = await client
      .post(`${ocrBase(projectB.id)}/runs`)
      .bearerToken(tokenB)
      .json({ extractionId: extractionB.id, profileRef: PROFILE_REF })
    assert.isTrue([400, 404].includes(crossTenantCreate.response.status))
  })
})
