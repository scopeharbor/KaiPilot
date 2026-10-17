/**
 * OCR 权限/审计 —— API 功能测试（v3-ocr-permission-and-audit §5.4–5.8）
 *
 * 覆盖：
 * §5.4 状态读取 / 决策预览 / 审计分页 / 非法 action 校验 / 有界过滤校验
 * §5.5 未认证 401 / 权限不足 403 / 跨组织 404 掩盖 / 前端允许动作声明被忽略
 * §5.6 状态/预览/审计/拒绝响应不含敏感载荷
 * §5.7 审计摘要仅低敏引用（哈希/枚举码），不含完整 OCR 文本
 * §5.8 审计摘要只读、同时间戳确定排序
 *
 * 红线：
 * - 只走 fixture 数据，不调用真实 OCR/model
 * - 组织隔离必须验证
 * - 每个测试独立可运行
 */

import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import AuditLog from '#models/audit_log'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
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

/** 创建 current accepted extraction（sourceId=10，含真实 OCR 文本，用于脱敏断言）。 */
async function seedAcceptedExtraction(organizationId: number, projectId: number) {
  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = organizationId
  extraction.projectId = projectId
  extraction.reviewerId = 1
  extraction.sourceKind = 'attachment'
  extraction.sourceId = 10
  extraction.sourceHash = 'sz-hash-001'
  extraction.candidateHash = 'cnd-hash-001'
  extraction.selectedTextHash = 'txt-hash-001'
  extraction.selectedText =
    '会议主题：Q3产品规划会\n会议日期：2025年9月15日\n组织者：张三\n\n## 决议事项\n1. 确定Q3产品路线图'
  extraction.pageRefsJson = [1]
  extraction.status = 'current'
  const { DateTime } = await import('luxon')
  extraction.confirmedAt = DateTime.now()
  extraction.purgedAt = null
  extraction.retentionLifecycle = null
  extraction.retentionSensitivity = null
  extraction.retentionEligibleAt = null
  await extraction.save()
  return extraction
}

/** 把用户加为指定项目成员（在既有项目上开一个项目角色 + 成员关系，不新建项目）。 */
async function addProjectMember(
  project: { id: number },
  user: { id: number },
  roleName: string,
  permissions: string[] = [],
) {
  const role = await ProjectRole.create({
    projectId: project.id,
    name: roleName,
    description: roleName,
    permissions: permissions as unknown as string[],
    isSystem: true,
  })
  return ProjectMember.create({
    projectId: project.id,
    userId: user.id,
    projectRoleId: role.id,
    isActive: true,
  })
}

/** 敏感 token 清单：响应绝不允许出现。 */
const FORBIDDEN_TOKENS = [
  'authorization',
  'bearer ',
  'secret',
  'api_key',
  'password',
  'prompt',
  'provider_body',
  'model_output',
  'raw_text',
  'full_text',
  'snippet',
  'selectedText',
  'Q3产品规划会',
  'C:\\\\',
  '/Users',
  '/home',
  '/var/',
]

function assertNoSensitiveTokens(assert: any, body: string, label: string) {
  const lower = body.toLowerCase()
  for (const token of FORBIDDEN_TOKENS) {
    assert.isFalse(lower.includes(token.toLowerCase()), `${label} 不应包含敏感 token: ${token}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.4 状态读取 / 决策预览 / 审计分页 / 校验
// ─────────────────────────────────────────────────────────────────────────────

test.group('OCR 权限/审计 — 状态读取与决策预览', (group) => {
  useAuthDatabase(group)

  test('GET status — 项目管理员读取权限状态（低敏）', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-status') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/status`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data
    assert.isArray(body.allowedActions)
    assert.isArray(body.blockedActions)
    assert.property(body, 'statusHash')
    assert.property(body, 'projectRef')
    assert.equal(body.projectRef.id, project.id)
    assertNoSensitiveTokens(assert, JSON.stringify(body), 'GET status')
  })

  test('GET status — 带来源引用读取（含哈希，无全文）', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-status-src') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, owner)

    const res = await client
      .get(
        `${BASE}/${project.id}/ocr/permission-audit/status?sourceRefId=10&sourceRefKind=attachment`,
      )
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data
    assert.isNotNull(body.sourceRef)
    assert.equal(body.sourceRef.id, 10)
    assert.equal(body.sourceHash, 'sz-hash-001')
    assertNoSensitiveTokens(assert, JSON.stringify(body), 'GET status with source')
  })

  test('POST decision-preview — 写类动作返回 confirm_required', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-preview-confirm') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, owner)

    const res = await client
      .post(`${BASE}/${project.id}/ocr/permission-audit/decision-preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'review_confirm', sourceRefId: 10, sourceRefKind: 'attachment' })

    res.assertStatus(200)
    const body = res.body().data
    assert.equal(body.action, 'review_confirm')
    assert.equal(body.result, 'confirm_required')
    assert.equal(body.requiresConfirmation, true)
    assert.property(body, 'decisionHash')
    assert.isTrue(body.reasonCodes.includes('confirmation_required'))
  })

  test('POST decision-preview — 只读动作返回 allow', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-preview-allow') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, owner)

    const res = await client
      .post(`${BASE}/${project.id}/ocr/permission-audit/decision-preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'accepted_text_read', sourceRefId: 10, sourceRefKind: 'attachment' })

    res.assertStatus(200)
    assert.equal(res.body().data.result, 'allow')
    assert.equal(res.body().data.requiresConfirmation, false)
  })

  test('POST decision-preview — MEMBER 确认动作被拒（缺 ocr:confirm）', async ({
    assert,
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pa-preview-member') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const member = await createUser({ email: uniqueEmail('pa-preview-member-u') })
    addOrgMember(org, member, 'member')
    await addProjectMember(project, member, ProjectRoleName.MEMBER)
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, member)

    const res = await client
      .post(`${BASE}/${project.id}/ocr/permission-audit/decision-preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'review_confirm', sourceRefId: 10, sourceRefKind: 'attachment' })

    res.assertStatus(200)
    const body = res.body().data
    assert.equal(body.result, 'denied')
    assert.isTrue(body.reasonCodes.includes('permission_missing'))
    assertNoSensitiveTokens(assert, JSON.stringify(body), 'denied preview')
  })

  test('POST decision-preview — 非法 action 返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-preview-bad') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const res = await client
      .post(`${BASE}/${project.id}/ocr/permission-audit/decision-preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'not_a_real_action' })

    res.assertStatus(422)
  })

  test('GET audit-summaries — 分页返回已写入的 OCR 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-audit-list') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 写 3 条 OCR 状态读取审计
    for (let i = 0; i < 3; i++) {
      await client
        .get(`${BASE}/${project.id}/ocr/permission-audit/status`)
        .header('Authorization', `Bearer ${token}`)
    }

    const res = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.isArray(res.body().data)
    assert.isAtLeast(res.body().data.length, 3)
    assert.equal(res.body().meta.total, res.body().data.length)
    assert.property(res.body().meta, 'perPage')
    assert.property(res.body().meta, 'totalPages')
  })

  test('GET audit-summaries — perPage 超上限返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-audit-bound') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries?perPage=500`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(422)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §5.5 认证 / 越权 / 跨组织 / 前端声明
// ─────────────────────────────────────────────────────────────────────────────

test.group('OCR 权限/审计 — 认证与越权', (group) => {
  useAuthDatabase(group)

  test('GET status — 未认证返回 401', async ({ client }) => {
    const res = await client.get(`${BASE}/1/ocr/permission-audit/status`)
    res.assertStatus(401)
  })

  test('GET status — 组织成员但非项目成员返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-403-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('pa-403-out') })
    addOrgMember(org, outsider, 'member')
    const token = await login(client, outsider)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/status`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('GET audit-summaries — MEMBER 无 audit_read 返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-403-audit') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const member = await createUser({ email: uniqueEmail('pa-403-audit-u') })
    addOrgMember(org, member, 'member')
    await createProjectWithMember(org, owner, member, ProjectRoleName.MEMBER)
    const token = await login(client, member)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(403)
  })

  test('GET status — 跨组织请求返回 404（不泄露存在性）', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('pa-xorg-a') })
    const orgA = await createOrganization(ownerA)
    const { project: projectA } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const ownerB = await createUser({ email: uniqueEmail('pa-xorg-b') })
    await createOrganization(ownerB) // ownerB 在 orgB，只有 orgB 成员身份
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`${BASE}/${projectA.id}/ocr/permission-audit/status`)
      .header('Authorization', `Bearer ${tokenB}`)

    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('POST decision-preview — 前端允许动作声明被忽略', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-claim') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const member = await createUser({ email: uniqueEmail('pa-claim-u') })
    addOrgMember(org, member, 'member')
    await addProjectMember(project, member, ProjectRoleName.MEMBER)
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, member)

    // MEMBER 无 ocr:confirm，但请求体声称已获允许
    const res = await client
      .post(`${BASE}/${project.id}/ocr/permission-audit/decision-preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        action: 'review_confirm',
        sourceRefId: 10,
        sourceRefKind: 'attachment',
        allowedActions: ['review_confirm', 'ocr:confirm'],
      })

    res.assertStatus(200)
    // 服务端裁决为准：仍为 denied，与前端声明无关
    assert.equal(res.body().data.result, 'denied')
    assert.isTrue(res.body().data.reasonCodes.includes('permission_missing'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §5.6 敏感载荷缺失 + §5.7 审计摘要仅低敏 + §5.8 只读/确定排序
// ─────────────────────────────────────────────────────────────────────────────

test.group('OCR 权限/审计 — 脱敏与只读', (group) => {
  useAuthDatabase(group)

  test('GET status — 响应绝不包含 OCR 全文/载荷/提示词/密钥/路径', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-redact') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, owner)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/status?sourceRefId=10`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assertNoSensitiveTokens(assert, JSON.stringify(res.body()), 'status')
  })

  test('POST decision-preview — 拒绝响应不含敏感载荷', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-redact-deny') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const member = await createUser({ email: uniqueEmail('pa-redact-deny-u') })
    addOrgMember(org, member, 'member')
    await addProjectMember(project, member, ProjectRoleName.MEMBER)
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, member)

    const res = await client
      .post(`${BASE}/${project.id}/ocr/permission-audit/decision-preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        action: 'review_confirm',
        sourceRefId: 10,
        sourceRefKind: 'attachment',
        sourceHash: 'sz-hash-001',
      })

    res.assertStatus(200)
    assert.equal(res.body().data.result, 'denied')
    assertNoSensitiveTokens(assert, JSON.stringify(res.body()), 'denied preview')
  })

  test('GET audit-summaries — 摘要仅低敏引用，不含全文', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-audit-redact') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedAcceptedExtraction(org.id, project.id)
    const token = await login(client, owner)

    // 先写一条状态审计
    await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/status?sourceRefId=10`)
      .header('Authorization', `Bearer ${token}`)

    const res = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assertNoSensitiveTokens(assert, JSON.stringify(res.body()), 'audit-summaries')
  })

  test('GET audit-summaries — 只读：不改变审计行数', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('pa-readonly') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 写一条基线审计
    await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/status`)
      .header('Authorization', `Bearer ${token}`)

    const before = await AuditLog.query()
      .where('projectId', project.id)
      .where('entityType', 'ocr')
      .count('* as total')
      .firstOrFail()
    const beforeCount = Number(before.$extras.total ?? 0)

    // 查询两次审计摘要
    await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries`)
      .header('Authorization', `Bearer ${token}`)
    await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries`)
      .header('Authorization', `Bearer ${token}`)

    const after = await AuditLog.query()
      .where('projectId', project.id)
      .where('entityType', 'ocr')
      .count('* as total')
      .firstOrFail()
    const afterCount = Number(after.$extras.total ?? 0)

    assert.equal(afterCount, beforeCount, '审计摘要查询不应新增/删除审计行')
  })

  test('GET audit-summaries — 同时间戳确定排序（createdAt desc, id desc）', async ({
    assert,
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pa-order') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 写 3 条审计
    for (let i = 0; i < 3; i++) {
      await client
        .get(`${BASE}/${project.id}/ocr/permission-audit/status`)
        .header('Authorization', `Bearer ${token}`)
    }

    const first = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries`)
      .header('Authorization', `Bearer ${token}`)
    const second = await client
      .get(`${BASE}/${project.id}/ocr/permission-audit/audit-summaries`)
      .header('Authorization', `Bearer ${token}`)

    const ids1 = first.body().data.map((d: any) => d.id)
    const ids2 = second.body().data.map((d: any) => d.id)
    assert.deepEqual(ids1, ids2, '两次查询应返回一致顺序')
    assert.isAtLeast(ids1.length, 3)
    // 确定降序：后写入的 id 更大，应排在前
    const sortedDesc = [...ids1].sort((a: number, b: number) => b - a)
    assert.deepEqual(ids1, sortedDesc, '应按 id 降序排列')
  })
})
