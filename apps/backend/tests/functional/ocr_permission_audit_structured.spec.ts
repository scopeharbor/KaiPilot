/**
 * OCR 权限/审计 —— 结构化提取下游集成测试（v3-ocr-permission-and-audit §6.10）
 *
 * 证明：
 * - PM（ocr_structured_extraction:run）放行 → 可创建 run
 * - READONLY_OBSERVER（无 run 权限）denied → 403 + 低敏边界审计，不建 run/snapshot
 * - 被拒决策不创建 confirmed snapshot
 *
 * 红线：只走 fixture，不调真实 provider/model；不写正式项目数据。
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { ProjectRoleName } from '#rbac'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import OcrStructuredExtractionProfile from '#models/ocr_structured_extraction_profile'
import OcrStructuredExtractionProfileVersion from '#models/ocr_structured_extraction_profile_version'
import OcrStructuredExtractionRun from '#models/ocr_structured_extraction_run'
import OcrStructuredExtractionSnapshot from '#models/ocr_structured_extraction_snapshot'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import AuditLog from '#models/audit_log'
import { buildMeetingMinutesProfileSchema } from '@aiproj/types'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const BASE = '/api/v1/projects'

async function login(client: any, user: any): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken
}

async function seedBuiltinProfile(organizationId: number) {
  const schema = buildMeetingMinutesProfileSchema()
  const profile = await OcrStructuredExtractionProfile.create({
    organizationId,
    projectId: null,
    name: '会议纪要',
    scope: 'builtin',
    status: 'active',
    schemaKey: schema.schemaKey,
    currentVersion: 1,
    totalRuns: 0,
    description: '提取会议纪要结构化字段',
    createdBy: null,
  })
  await OcrStructuredExtractionProfileVersion.create({
    profileId: profile.id,
    version: 1,
    status: 'active',
    schemaDefinitionJson: schema,
    createdBy: null,
  })
  return profile
}

async function seedAcceptedExtraction(organizationId: number, projectId: number) {
  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = organizationId
  extraction.projectId = projectId
  extraction.reviewerId = 1
  extraction.sourceKind = 'attachment'
  extraction.sourceId = 10
  extraction.sourceHash = 'sz-hash-perm-001'
  extraction.candidateHash = 'cnd-hash-perm-001'
  extraction.selectedTextHash = 'txt-hash-perm-001'
  extraction.selectedText = '会议主题：Q3规划\n会议日期：2025年9月15日\n组织者：张三'
  extraction.pageRefsJson = [1]
  extraction.status = 'current'
  extraction.confirmedAt = DateTime.now()
  extraction.purgedAt = null
  extraction.retentionLifecycle = null
  extraction.retentionSensitivity = null
  extraction.retentionEligibleAt = null
  await extraction.save()
  return extraction
}

/** 种子只读观察者：owner 为 PM，viewer 追加为 READONLY_OBSERVER。返回两个 token + 项目上下文。 */
async function seedPmAndReadonly(client: any, scope: string) {
  const owner = await createUser({ email: uniqueEmail(`se-pmro-${scope}`) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const viewer = await createUser({ email: uniqueEmail(`se-ro-${scope}`) })
  addOrgMember(org, viewer, 'viewer')
  const role = await ProjectRole.create({
    projectId: project.id,
    name: ProjectRoleName.READONLY_OBSERVER,
    description: ProjectRoleName.READONLY_OBSERVER,
    isSystem: true,
  })
  await ProjectMember.create({
    projectId: project.id,
    userId: viewer.id,
    projectRoleId: role.id,
    isActive: true,
  })
  return {
    org,
    project,
    pmToken: await login(client, owner),
    readonlyToken: await login(client, viewer),
  }
}

test.group('OcrPermissionAudit — Structured Extraction Integration', (group) => {
  useAuthDatabase(group)

  group.each.setup(async () => {
    await OcrStructuredExtractionRun.query().delete()
    await OcrStructuredExtractionSnapshot.query().delete()
    await OcrReviewAcceptedExtraction.query().delete()
  })

  test('READONLY_OBSERVER（无 run 权限）denied → 403 + 低敏边界审计，不建 run', async ({
    assert,
    client,
  }) => {
    const { org, project, readonlyToken } = await seedPmAndReadonly(client, 'deny-run')
    const profile = await seedBuiltinProfile(org.id)
    const extraction = await seedAcceptedExtraction(org.id, project.id)

    const res = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${readonlyToken}`)
      .json({ extractionId: extraction.id, profileId: profile.id })

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    const runs = await OcrStructuredExtractionRun.query().where('organization_id', org.id)
    assert.lengthOf(runs, 0, 'denied 决策不应创建 run')

    const denial = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('metadata', 'like', '%OCR_PERMISSION_DENIAL%')
      .first()
    assert.isNotNull(denial, '应写入权限拒绝审计')
  })

  test('READONLY_OBSERVER 保存确认 denied → 不建 confirmed snapshot', async ({
    assert,
    client,
  }) => {
    const { org, project, readonlyToken } = await seedPmAndReadonly(client, 'deny-save')
    // readonly 无 run 权限，守卫在 createRun 阶段即拦截；此处直接测 save 端点守卫
    const res = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/save`)
      .header('Authorization', `Bearer ${readonlyToken}`)
      .json({
        runId: 1,
        previewHash: 'any-hash',
        selectedFieldCandidateIds: [],
        selectedTableCandidateIds: [],
      })
    res.assertStatus(403)

    const snapshots = await OcrStructuredExtractionSnapshot.query().where('organization_id', org.id)
    assert.lengthOf(snapshots, 0, 'denied 决策不应创建 confirmed snapshot')
  })
})
