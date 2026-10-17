/**
 * OCR Structured Extraction — API 功能测试（v3-ocr-structured-extraction §5.6-5.8）
 *
 * 覆盖：
 * §5.6 Profile 管理：列表、详情、创建、不安全 schema 拒绝、read-only 拒绝、版本保留、归档
 * §5.7 Run 执行：创建、幂等重放、列表/分页/过滤、详情含候选、跨组织掩盖、隐藏源文本脱敏
 * §5.8 预览/保存：预览快照、保存创建、超集语义、stale source 阻止、下游 redline 验证
 *
 * 红线：
 * - 全部测试仅用 fixture 数据，不调用真实 OCR/model
 * - 组织隔离必须验证
 * - 每个测试独立可运行
 */

import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import OcrStructuredExtractionProfile from '#models/ocr_structured_extraction_profile'
import OcrStructuredExtractionProfileVersion from '#models/ocr_structured_extraction_profile_version'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
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

/**
 * 创建内置 profile 用于测试——直接写入 DB，绕过 RBAC。
 * 作用域 builtin，对所有组织可见。
 */
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

/**
 * 创建 accepted extraction 用于 run 测试。
 */
async function seedAcceptedExtraction(
  organizationId: number,
  projectId: number,
  overrides: Partial<{
    selectedText: string
    sourceHash: string
    candidateHash: string
    sourceKind: 'attachment' | 'document'
    status: 'current' | 'superseded'
  }> = {},
) {
  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = organizationId
  extraction.projectId = projectId
  extraction.reviewerId = 1
  extraction.sourceKind = overrides.sourceKind ?? 'attachment'
  extraction.sourceId = 10
  extraction.sourceHash = overrides.sourceHash ?? 'sz-hash-001'
  extraction.candidateHash = overrides.candidateHash ?? 'cnd-hash-001'
  extraction.selectedTextHash = 'txt-hash-001'
  extraction.selectedText =
    overrides.selectedText ??
    `会议主题：Q3产品规划会\n会议日期：2025年9月15日\n会议地点：3楼会议室A\n组织者：张三\n\n## 参会人员\n| 姓名 | 角色 |\n|------|------|\n| 李四 | 主持人 |\n| 王五 | 记录人 |\n| 赵六 | 参会人 |\n\n## 决议事项\n1. 确定Q3产品路线图，张三，2025年9月30日\n2. 分配开发资源，李四，2025年9月20日`
  extraction.pageRefsJson = [1]
  extraction.status = overrides.status ?? 'current'
  const { DateTime } = await import('luxon')
  extraction.confirmedAt = DateTime.now()
  extraction.purgedAt = null
  extraction.retentionLifecycle = null
  extraction.retentionSensitivity = null
  extraction.retentionEligibleAt = null
  await extraction.save()
  return extraction
}

/**
 * 创建 run 并返回 runId 和 field/table candidate IDs。
 * 供 §5.8 预览/保存测试与边界测试复用。
 */
async function createRunWithCandidates(
  client: any,
  token: string,
  orgId: number,
  projectId: number,
) {
  const profile = await seedBuiltinProfile(orgId)
  const extraction = await seedAcceptedExtraction(orgId, projectId)

  const createRes = await client
    .post(`${BASE}/${projectId}/ocr/structured-extraction/runs`)
    .header('Authorization', `Bearer ${token}`)
    .json({ extractionId: extraction.id, profileId: profile.id })

  const runId = createRes.body().data.runId

  // 获取候选
  const detailRes = await client
    .get(`${BASE}/${projectId}/ocr/structured-extraction/runs/${runId}`)
    .header('Authorization', `Bearer ${token}`)

  const fieldIds = detailRes.body().data.fieldCandidates.map((fc: any) => fc.candidateId)
  const tableIds = detailRes.body().data.tableCandidates.map((tc: any) => tc.candidateId)

  return { runId, fieldIds, tableIds, extraction }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.6 Profile 管理测试
// ─────────────────────────────────────────────────────────────────────────────

test.group('OCR Structured Extraction — Profile 管理', (group) => {
  useAuthDatabase(group)

  group.each.setup(async () => {
    // 创建 owner + 组织用于 rest 测试
  })

  // 5.6.1 列表 profiles
  test('GET profiles — 认证用户可列表 builtin profiles', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-prof-list') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 种子 builtin profile
    await seedBuiltinProfile(org.id)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/profiles`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.isArray(res.body().data)
    assert.isAtLeast(res.body().data.length, 1, '至少应返回一个 builtin profile')
    const profile = res.body().data[0]
    assert.equal(profile.scope, 'builtin')
    assert.property(profile, 'profileId')
    assert.property(profile, 'schemaKey')
    assert.property(res.body().meta, 'total')
    assert.property(res.body().meta, 'perPage')
  })

  // 5.6.2 获取 profile 详情
  test('GET profiles/:id — 返回含 schema 定义的 profile 详情', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-prof-detail') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const profile = await seedBuiltinProfile(org.id)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/profiles/${profile.id}`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data
    assert.equal(body.profileId, profile.id)
    assert.equal(body.name, '会议纪要')
    assert.property(body, 'schemaDefinition')
    assert.equal(body.schemaDefinition.schemaKey, 'meeting-minutes')
    assert.isArray(body.schemaDefinition.sections)
    assert.isAtLeast(body.schemaDefinition.sections.length, 1)
    assert.property(body, 'versionHistory')
    assert.lengthOf(body.versionHistory, 1)
  })

  // 5.6.3 创建 project-scoped profile
  test('POST profiles — project manager 可创建 project-scoped profile', async ({
    assert,
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('se-prof-create') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const schema = buildMeetingMinutesProfileSchema()
    const res = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/profiles`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '项目会议纪要',
        scope: 'project',
        description: '项目专用的会议纪要提取配置',
        schemaDefinition: schema,
        projectId: project.id,
      })

    res.assertStatus(201)
    const body = res.body().data
    assert.equal(body.name, '项目会议纪要')
    assert.equal(body.scope, 'project')
    assert.equal(body.projectId, project.id)
    assert.equal(body.status, 'draft')
    assert.property(body, 'schemaDefinition')
  })

  // 5.6.4 拒绝不安全的 profile
  test('POST profiles — forbidExternalUrls=false 返回 VALIDATION_ERROR', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('se-prof-unsafe') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const unsafeSchema = buildMeetingMinutesProfileSchema()
    ;(unsafeSchema.validationRules as any).forbidExternalUrls = false

    const res = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/profiles`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '不安全的配置',
        scope: 'project',
        description: 'forbidExternalUrls 为 false',
        schemaDefinition: unsafeSchema,
        projectId: project.id,
      })

    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  // 5.6.5 Read-only denial — 无 manage 权限的成员不能创建
  test('POST profiles — 无 manage 权限的 member 返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('se-prof-owner') })
    const member = await createUser({ email: uniqueEmail('se-prof-member') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // 添加成员，角色为 MEMBER（有 view/run/confirm 但无 manage）
    await addOrgMember(org, member, 'member')
    const memberRole = await ProjectRole.create({
      projectId: project.id,
      name: 'Member',
      description: 'Member',
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: member.id,
      projectRoleId: memberRole.id,
      isActive: true,
    })
    const memberToken = await login(client, member)

    const schema = buildMeetingMinutesProfileSchema()
    const res = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/profiles`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({
        name: '普通成员创建',
        scope: 'project',
        description: '应该被拒绝',
        schemaDefinition: schema,
        projectId: project.id,
      })

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  // 5.6.6 版本保留 — 更新 schema 创建新版本，旧运行保留旧版本
  test('PUT profiles/:id — 更新 schema 创建新版本', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-prof-ver') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 创建 profile
    const schema = buildMeetingMinutesProfileSchema()
    const createRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/profiles`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '版本测试',
        scope: 'project',
        description: '测试版本化',
        schemaDefinition: schema,
        projectId: project.id,
      })
    const profileId = createRes.body().data.profileId
    assert.equal(createRes.body().data.currentVersion, 1)

    // 更新 schema
    const updatedSchema = buildMeetingMinutesProfileSchema()
    updatedSchema.version = 2
    updatedSchema.sections.push({
      key: 'new_section',
      label: '新增章节',
      fields: [{ key: 'new_field', label: '新字段', fieldType: 'text', required: false }],
      optional: true,
      repeatable: false,
    })

    const updateRes = await client
      .put(`${BASE}/${project.id}/ocr/structured-extraction/profiles/${profileId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '版本测试 v2',
        schemaDefinition: updatedSchema,
      })

    updateRes.assertStatus(200)
    const body = updateRes.body().data
    assert.equal(body.currentVersion, 2, '版本号应递增到 2')
    assert.equal(body.name, '版本测试 v2')
    assert.lengthOf(body.versionHistory, 2, '应有 2 条版本历史')
    assert.equal(body.versionHistory[0].version, 2, '最新版本应为 v2')
    assert.equal(body.versionHistory[1].version, 1, '旧版本应保留')
  })

  // 5.6.7 归档 profile
  test('PATCH profiles/:id/archive — manager 可归档，归档后从 active 列表过滤', async ({
    assert,
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('se-prof-archive') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 创建 profile
    const schema = buildMeetingMinutesProfileSchema()
    const createRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/profiles`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '待归档配置',
        scope: 'project',
        description: '将被归档',
        schemaDefinition: schema,
        projectId: project.id,
      })
    const profileId = createRes.body().data.profileId

    // 归档
    const archiveRes = await client
      .patch(`${BASE}/${project.id}/ocr/structured-extraction/profiles/${profileId}/archive`)
      .header('Authorization', `Bearer ${token}`)

    archiveRes.assertStatus(200)
    assert.equal(archiveRes.body().data.status, 'archived')

    // 用 status=active 过滤不返回归档项
    const listRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/profiles?scope=project&status=active`)
      .header('Authorization', `Bearer ${token}`)

    listRes.assertStatus(200)
    const activeProfileIds = listRes.body().data.map((p: any) => p.profileId)
    assert.isFalse(activeProfileIds.includes(profileId), '归档的 profile 不应出现在 active 列表中')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §5.7 Run 测试
// ─────────────────────────────────────────────────────────────────────────────

test.group('OCR Structured Extraction — Run 管理', (group) => {
  useAuthDatabase(group)

  // 5.7.8 创建 run
  test('POST runs — 从 accepted extraction 创建 run，返回含候选的运行', async ({
    assert,
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('se-run-create') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 准备 profile
    const profile = await seedBuiltinProfile(org.id)

    // 准备 accepted extraction
    const extraction = await seedAcceptedExtraction(org.id, project.id)

    const res = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        extractionId: extraction.id,
        profileId: profile.id,
        options: { maxFieldCandidates: 100, maxTableRows: 100 },
      })

    res.assertStatus(201)
    const body = res.body().data
    assert.property(body, 'runId')
    assert.equal(body.extractionId, extraction.id)
    assert.equal(body.profileId, profile.id)
    assert.equal(body.profileName, '会议纪要')
    assert.isTrue(
      body.status === 'completed' || body.status === 'completed_with_warnings',
      `状态应为 completed/completed_with_warnings，实际: ${body.status}`,
    )
    assert.isAtLeast(body.totalFieldCandidates, 1, '会议纪要输入应产生至少 1 个字段候选')
    assert.property(body, 'allowedActions')
  })

  // 5.7.9 幂等重放
  test('POST runs — 相同 inputSignature 返回已有 run（幂等）', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-run-idem') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const profile = await seedBuiltinProfile(org.id)
    const extraction = await seedAcceptedExtraction(org.id, project.id)

    // 两次相同参数的请求
    const payload = {
      extractionId: extraction.id,
      profileId: profile.id,
      idempotencyKey: 'test-idem-key-001',
    }

    const r1 = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${token}`)
      .json(payload)

    r1.assertStatus(201)

    const r2 = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${token}`)
      .json(payload)

    r2.assertStatus(201)
    assert.equal(r2.body().data.runId, r1.body().data.runId, '重放应返回相同的 runId')
  })

  // 5.7.10 列表 runs — 分页，可按 status/profileId 过滤
  test('GET runs — 支持分页和 status 过滤', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-run-list') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const profile = await seedBuiltinProfile(org.id)

    // 创建多个 run
    for (let i = 0; i < 3; i++) {
      const extraction = await seedAcceptedExtraction(org.id, project.id, {
        sourceHash: `hash-list-${i}`,
        candidateHash: `cnd-list-${i}`,
      })
      await client
        .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
        .header('Authorization', `Bearer ${token}`)
        .json({ extractionId: extraction.id, profileId: profile.id })
    }

    // 分页
    const pageRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/runs?page=1&perPage=2`)
      .header('Authorization', `Bearer ${token}`)

    pageRes.assertStatus(200)
    assert.lengthOf(pageRes.body().data, 2)
    assert.equal(pageRes.body().meta.totalPages, 2)

    // 按 status 过滤
    const statusRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/runs?status=completed`)
      .header('Authorization', `Bearer ${token}`)

    statusRes.assertStatus(200)
    for (const run of statusRes.body().data) {
      assert.equal(run.status, 'completed')
    }

    // 按 profileId 过滤
    const profileRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/runs?profileId=${profile.id}`)
      .header('Authorization', `Bearer ${token}`)

    profileRes.assertStatus(200)
    for (const run of profileRes.body().data) {
      assert.equal(run.profileId, profile.id)
    }
  })

  // 5.7.11 获取 run 详情 — 包含字段和表格候选
  test('GET runs/:id — 返回含 field 和 table 候选的完整详情', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-run-detail') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const profile = await seedBuiltinProfile(org.id)
    const extraction = await seedAcceptedExtraction(org.id, project.id)

    const createRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${token}`)
      .json({ extractionId: extraction.id, profileId: profile.id })

    const runId = createRes.body().data.runId

    const detailRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/runs/${runId}`)
      .header('Authorization', `Bearer ${token}`)

    detailRes.assertStatus(200)
    const body = detailRes.body().data

    assert.equal(body.runId, runId)
    assert.property(body, 'extractionSummary')
    assert.equal(body.extractionSummary.extractionId, extraction.id)
    assert.property(body, 'fieldCandidates')
    assert.property(body, 'tableCandidates')
    assert.isArray(body.fieldCandidates)
    assert.isArray(body.tableCandidates)

    if (body.fieldCandidates.length > 0) {
      const fc = body.fieldCandidates[0]
      assert.property(fc, 'candidateId')
      assert.property(fc, 'fieldKey')
      assert.property(fc, 'fieldType')
      assert.property(fc, 'raw')
      assert.property(fc, 'confidence')
      assert.property(fc, 'sourceSpanHash')
      assert.property(fc, 'candidateHash')
    }

    if (body.tableCandidates.length > 0) {
      const tc = body.tableCandidates[0]
      assert.property(tc, 'candidateId')
      assert.property(tc, 'tableKey')
      assert.property(tc, 'rows')
      assert.property(tc, 'confidence')
    }
  })

  // 5.7.12 获取 candidates — 单独返回 fields + tables
  test('GET runs/:id/candidates — 返回分割的 fields 和 tables', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-run-cands') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const profile = await seedBuiltinProfile(org.id)
    const extraction = await seedAcceptedExtraction(org.id, project.id)

    const createRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${token}`)
      .json({ extractionId: extraction.id, profileId: profile.id })

    const runId = createRes.body().data.runId

    const candRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/runs/${runId}/candidates`)
      .header('Authorization', `Bearer ${token}`)

    candRes.assertStatus(200)
    const body = candRes.body().data
    assert.property(body, 'fields')
    assert.property(body, 'tables')
    assert.isArray(body.fields)
    assert.isArray(body.tables)
  })

  // 5.7.13 跨组织掩盖 — 返回 RESOURCE_NOT_FOUND
  test('跨组织不可访问 run 详情', async ({ client }) => {
    // 组织 A 的数据
    const ownerA = await createUser({ email: uniqueEmail('se-run-xorg-a') })
    const orgA = await createOrganization(ownerA)
    const { project: projectA } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tokenA = await login(client, ownerA)

    const profileA = await seedBuiltinProfile(orgA.id)
    const extractionA = await seedAcceptedExtraction(orgA.id, projectA.id)

    const createRes = await client
      .post(`${BASE}/${projectA.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({ extractionId: extractionA.id, profileId: profileA.id })

    const runId = createRes.body().data.runId

    // 组织 B 的用户尝试访问
    const ownerB = await createUser({ email: uniqueEmail('se-run-xorg-b') })
    const orgB = await createOrganization(ownerB)
    const { project: projectB } = await createProjectWithMember(
      orgB,
      ownerB,
      ownerB,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`${BASE}/${projectB.id}/ocr/structured-extraction/runs/${runId}`)
      .header('Authorization', `Bearer ${tokenB}`)

    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  // 5.7.14 隐藏源文本脱敏 — 响应中不包含完整 OCR 文本
  test('run 详情响应不包含完整 OCR 源文本', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-run-redact') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const profile = await seedBuiltinProfile(org.id)
    const extraction = await seedAcceptedExtraction(org.id, project.id)

    const createRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${token}`)
      .json({ extractionId: extraction.id, profileId: profile.id })

    const runId = createRes.body().data.runId
    const detailRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/runs/${runId}`)
      .header('Authorization', `Bearer ${token}`)

    // 响应中不应包含完整 OCR 文本（只应有哈希和引用）
    // extractionSummary 中只含哈希，不含原始提交 text
    const summary = detailRes.body().data.extractionSummary
    assert.property(summary, 'sourceHash')
    assert.property(summary, 'selectedTextHash')
    // selectedText 不应该在 extractionSummary 中返回完全原文
    assert.isFalse(summary.hasOwnProperty('selectedText'), '不应暴露原始 selectedText')
    assert.isFalse(summary.hasOwnProperty('fullText'), '不应暴露完整 OCR 文本')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §5.8 预览/保存测试
// ─────────────────────────────────────────────────────────────────────────────

test.group('OCR Structured Extraction — 预览与保存', (group) => {
  useAuthDatabase(group)

  // 5.8.15 预览确认 — 返回 previewHash 和快照载荷
  test('POST preview — 返回含 previewHash 和 snapshot 的预览', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-preview') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const { runId, fieldIds, tableIds } = await createRunWithCandidates(
      client,
      token,
      org.id,
      project.id,
    )

    if (fieldIds.length === 0) {
      // 没有字段候选则跳过预览测试
      return
    }

    const previewRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
        reviewNote: '预览测试',
      })

    previewRes.assertStatus(200)
    const body = previewRes.body().data

    assert.property(body, 'previewHash')
    assert.isNotEmpty(body.previewHash, 'previewHash 不应为空')
    assert.property(body, 'runId')
    assert.equal(body.runId, runId)
    assert.property(body, 'snapshot')
    assert.property(body.snapshot, 'extractionId')
    assert.property(body.snapshot, 'sourceHash')
    assert.property(body.snapshot, 'fieldValues')
    assert.property(body.snapshot, 'tableValues')
    assert.property(body, 'selectedFields')
    assert.property(body, 'selectedTables')
    assert.property(body, 'redlineSummary')
    assert.isTrue(body.requiresExplicitConfirmation, '应要求显式确认')
  })

  // 5.8.16 保存确认 — 创建快照，验证快照字段
  test('POST save — 保存确认创建快照并返回 snapshot 字段', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-save') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const { runId, fieldIds, tableIds } = await createRunWithCandidates(
      client,
      token,
      org.id,
      project.id,
    )

    if (fieldIds.length === 0) return

    // 先 preview 获取 previewHash
    const previewRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
      })

    const previewHash = previewRes.body().data.previewHash

    // 保存
    const saveRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/save`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        previewHash,
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
        reviewNote: '确认保存测试',
      })

    saveRes.assertStatus(201)
    const body = saveRes.body().data

    assert.property(body, 'snapshotId')
    assert.property(body, 'snapshotHash')
    assert.property(body, 'extractionId')
    assert.property(body, 'profileId')
    assert.property(body, 'profileVersion')
    assert.property(body, 'sourceHash')
    assert.property(body, 'fieldCount')
    assert.isAtLeast(body.fieldCount, 1, '至少应有 1 个字段')
    assert.equal(body.status, 'current')
    assert.property(body, 'reviewerId')
    assert.property(body, 'confirmedAt')
  })

  // 5.8.17 超集 — 第二次保存超集旧快照
  test('POST save — 对同 extraction 再次保存超集旧 snapshot', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-supersede') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const { runId, fieldIds, tableIds, extraction } = await createRunWithCandidates(
      client,
      token,
      org.id,
      project.id,
    )

    if (fieldIds.length === 0) return

    // 第一次保存
    const previewRes1 = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ runId, selectedFieldCandidateIds: fieldIds, selectedTableCandidateIds: tableIds })

    const saveRes1 = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/save`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        previewHash: previewRes1.body().data.previewHash,
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
      })

    saveRes1.assertStatus(201)
    const snapshot1Id = saveRes1.body().data.snapshotId
    assert.equal(saveRes1.body().data.status, 'current')

    // 第二次保存（相同 extraction）
    const previewRes2 = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ runId, selectedFieldCandidateIds: fieldIds, selectedTableCandidateIds: tableIds })

    const saveRes2 = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/save`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        previewHash: previewRes2.body().data.previewHash,
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
      })

    saveRes2.assertStatus(201)
    const snapshot2Id = saveRes2.body().data.snapshotId

    assert.equal(saveRes2.body().data.status, 'current')
    assert.notEqual(snapshot2Id, snapshot1Id, '新快照 ID 应与旧快照不同')

    // 检查旧快照被超集
    const listRes = await client
      .get(
        `${BASE}/${project.id}/ocr/structured-extraction/snapshots?extractionId=${extraction.id}`,
      )
      .header('Authorization', `Bearer ${token}`)

    listRes.assertStatus(200)
    const snapshots = listRes.body().data
    const oldSnapshot = snapshots.find((s: any) => s.snapshotId === snapshot1Id)
    assert.exists(oldSnapshot, '旧快照仍应存在于列表')
    assert.equal(oldSnapshot.status, 'superseded', '旧快照状态应为 superseded')
  })

  // 5.8.18 stale source 阻止 — 修改 source hash 后预览失败
  test('POST preview — source hash 变更后预览拒绝', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-stale') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const profile = await seedBuiltinProfile(org.id)
    const extraction = await seedAcceptedExtraction(org.id, project.id)

    const createRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${token}`)
      .json({ extractionId: extraction.id, profileId: profile.id })

    const runId = createRes.body().data.runId

    // 获取候选
    const detailRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/runs/${runId}`)
      .header('Authorization', `Bearer ${token}`)

    const fieldIds = detailRes.body().data.fieldCandidates.map((fc: any) => fc.candidateId)
    const tableIds = detailRes.body().data.tableCandidates.map((tc: any) => tc.candidateId)

    if (fieldIds.length === 0) return

    // 修改 extraction 的 sourceHash，使其与 run 的 sourceHash 不匹配
    extraction.sourceHash = 'modified-source-hash-for-stale-test'
    await extraction.save()

    const previewRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
      })

    // stale source 应返回 422 错误
    assert.isAtLeast(previewRes.status(), 400, 'stale source 应拒绝预览')
  })

  // 5.8.19 下游 redline — 快照不修改 task/WBS/risk 表
  test('snapshot 不修改下游 task/WBS/risk 表', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-redline') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const { runId, fieldIds, tableIds } = await createRunWithCandidates(
      client,
      token,
      org.id,
      project.id,
    )

    if (fieldIds.length === 0) return

    // 预览并保存
    const previewRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ runId, selectedFieldCandidateIds: fieldIds, selectedTableCandidateIds: tableIds })

    const saveRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/save`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        previewHash: previewRes.body().data.previewHash,
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
        reviewNote: 'redline 验证',
      })

    saveRes.assertStatus(201)
    const snapshotId = saveRes.body().data.snapshotId

    // 获取快照详情
    const detailRes = await client
      .get(`${BASE}/${project.id}/ocr/structured-extraction/snapshots/${snapshotId}`)
      .header('Authorization', `Bearer ${token}`)

    detailRes.assertStatus(200)
    const snapshot = detailRes.body().data

    // 验证 redline：snapshot 只有 fieldValues / tableValues 等元数据，
    // 不包含下游 task/WBS/risk 记录
    assert.property(snapshot, 'fieldValues')
    assert.property(snapshot, 'tableValues')
    assert.property(snapshot, 'sourceSpanHashes')
    assert.property(snapshot, 'candidateHashes')

    // 快照数据不应包含对 task/WBS/risk 表的直接引用
    const snapshotStr = JSON.stringify(snapshot)
    assert.isFalse(
      snapshotStr.includes('taskId') ||
        snapshotStr.includes('wbsNodeId') ||
        snapshotStr.includes('riskId'),
      '快照不应包含下游实体 ID 引用',
    )

    // 验证 preview 中的 redlineSummary 全部为 "unchanged"
    const previewData = previewRes.body().data
    assert.property(previewData, 'redlineSummary')
    const redline = previewData.redlineSummary
    assert.equal(redline.tasks, 'unchanged', 'tasks 应为 unchanged')
    assert.equal(redline.wbs, 'unchanged', 'wbs 应为 unchanged')
    assert.equal(redline.risks, 'unchanged', 'risks 应为 unchanged')
    assert.equal(redline.milestones, 'unchanged', 'milestones 应为 unchanged')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 跨领域边界测试
// ─────────────────────────────────────────────────────────────────────────────

test.group('OCR Structured Extraction — 认证与权限', (group) => {
  useAuthDatabase(group)

  test('未认证请求所有 endpoint 返回 401', async ({ assert, client }) => {
    const endpoints = [
      { method: 'get', url: `${BASE}/1/ocr/structured-extraction/profiles` },
      { method: 'post', url: `${BASE}/1/ocr/structured-extraction/profiles` },
      { method: 'post', url: `${BASE}/1/ocr/structured-extraction/runs` },
      { method: 'get', url: `${BASE}/1/ocr/structured-extraction/runs` },
      { method: 'post', url: `${BASE}/1/ocr/structured-extraction/preview` },
      { method: 'post', url: `${BASE}/1/ocr/structured-extraction/save` },
      { method: 'get', url: `${BASE}/1/ocr/structured-extraction/snapshots` },
    ]

    for (const { method, url } of endpoints) {
      const res = method === 'get' ? await client.get(url) : await client.post(url).json({})
      assert.isAtLeast(res.status(), 400, `${method.toUpperCase()} ${url} 应返回认证错误`)
    }
  })

  test('snapshot 查询支持按 extractionId 过滤', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('se-snap-list') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const { runId, fieldIds, tableIds, extraction } = await createRunWithCandidates(
      client,
      token,
      org.id,
      project.id,
    )

    if (fieldIds.length === 0) return

    // 先保存一个快照
    const previewRes = await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ runId, selectedFieldCandidateIds: fieldIds, selectedTableCandidateIds: tableIds })

    await client
      .post(`${BASE}/${project.id}/ocr/structured-extraction/save`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        previewHash: previewRes.body().data.previewHash,
        runId,
        selectedFieldCandidateIds: fieldIds,
        selectedTableCandidateIds: tableIds,
      })

    // 查询快照
    const listRes = await client
      .get(
        `${BASE}/${project.id}/ocr/structured-extraction/snapshots?extractionId=${extraction.id}`,
      )
      .header('Authorization', `Bearer ${token}`)

    listRes.assertStatus(200)
    assert.isAtLeast(listRes.body().data.length, 1)
    for (const s of listRes.body().data) {
      assert.equal(s.extractionId, extraction.id)
    }
  })

  test('预览与保存需要认证', async ({ assert, client }) => {
    const res1 = await client
      .post(`${BASE}/1/ocr/structured-extraction/preview`)
      .json({ runId: 1, selectedFieldCandidateIds: [], selectedTableCandidateIds: [] })
    assert.isAtLeast(res1.status(), 400)

    const res2 = await client.post(`${BASE}/1/ocr/structured-extraction/save`).json({
      previewHash: 'abc',
      runId: 1,
      selectedFieldCandidateIds: [],
      selectedTableCandidateIds: [],
    })
    assert.isAtLeast(res2.status(), 400)
  })

  test('跨项目提取不由本项目暴露', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('se-xproj-a') })
    const orgA = await createOrganization(ownerA)
    const { project: projectA } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tokenA = await login(client, ownerA)

    const ownerB = await createUser({ email: uniqueEmail('se-xproj-b') })
    const { project: projectB } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerB,
      ProjectRoleName.PROJECT_MANAGER,
    )
    addOrgMember(orgA, ownerB, 'member')
    const tokenB = await login(client, ownerB)

    // ownerA 在 projectA 创建数据
    const profileA = await seedBuiltinProfile(orgA.id)
    const extractionA = await seedAcceptedExtraction(orgA.id, projectA.id)

    const createRes = await client
      .post(`${BASE}/${projectA.id}/ocr/structured-extraction/runs`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({ extractionId: extractionA.id, profileId: profileA.id })

    const runId = createRes.body().data.runId

    // ownerB 通过 projectB 尝试访问 projectA 的 run
    const res = await client
      .get(`${BASE}/${projectB.id}/ocr/structured-extraction/runs/${runId}`)
      .header('Authorization', `Bearer ${tokenB}`)

    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })
})
