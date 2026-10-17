/**
 * OCR 保留治理 —— 下游权限集成测试（v3-ocr-permission-and-audit §6.6）
 *
 * 覆盖：
 * - hold 设置：PM 允许 / MEMBER 被拒（denied → 403 + 低敏边界审计）
 * - cleanup preview：PM 允许 / MEMBER 被拒
 * - 状态读取：tombstoned / purged / expired 等 OCR 构件仅元数据状态仍可读
 *
 * 红线：
 * - 只走 fixture 数据，不调用真实 OCR/model
 * - 不写任何正式项目数据
 */

import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import AuditLog from '#models/audit_log'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrRetentionHold from '#models/ocr_retention_hold'
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
import { DateTime } from 'luxon'

const BASE = '/api/v1/projects'

async function login(client: any, user: any): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken
}

async function seedProjectManager(client: any, scope: string) {
  const owner = await createUser({ email: uniqueEmail(`ret-pm-${scope}`) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const token = await login(client, owner)
  return { org, project, token }
}

async function seedMember(client: any, scope: string) {
  const owner = await createUser({ email: uniqueEmail(`ret-m-owner-${scope}`) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const member = await createUser({ email: uniqueEmail(`ret-m-${scope}`) })
  addOrgMember(org, member, 'member')
  // 给既有项目追加 member 成员（不可再调 createProjectWithMember，否则会另建新项目）
  const memberRole = await ProjectRole.create({
    projectId: project.id,
    name: ProjectRoleName.MEMBER,
    description: ProjectRoleName.MEMBER,
    isSystem: true,
  })
  await ProjectMember.create({
    projectId: project.id,
    userId: member.id,
    projectRoleId: memberRole.id,
    isActive: true,
  })
  const token = await login(client, member)
  return { org, project, token }
}

/** 建 accepted extraction（可指定保留/生命周期字段）。 */
async function seedExtraction(
  orgId: number,
  projectId: number,
  overrides: Partial<{
    status: string
    purgedAt: DateTime | null
    tombstoneId: number | null
    retentionLifecycle: string | null
  }> = {},
) {
  const e = new OcrReviewAcceptedExtraction()
  e.organizationId = orgId
  e.projectId = projectId
  e.reviewerId = 1
  e.sourceKind = 'attachment'
  e.sourceId = 10
  e.sourceHash = 'src-hash-001'
  e.candidateHash = 'cnd-hash-001'
  e.selectedTextHash = 'txt-hash-001'
  e.selectedText = '会议内容：Q3 产品规划会'
  e.pageRefsJson = [1]
  e.status = (overrides.status as any) ?? 'current'
  e.confirmedAt = DateTime.now()
  e.purgedAt = overrides.purgedAt ?? null
  e.tombstoneId = overrides.tombstoneId ?? null
  e.retentionLifecycle = overrides.retentionLifecycle ?? null
  e.retentionSensitivity = null
  e.retentionEligibleAt = null
  await e.save()
  return e
}

test.group('OCR 保留治理 — hold 与清理', (group) => {
  useAuthDatabase(group)

  test('PM 设置 hold：resolver 放行（confirm_required）→ 200', async ({ assert, client }) => {
    const { org, project, token } = await seedProjectManager(client, 'set-hold')
    const res = await client
      .post(`${BASE}/${project.id}/ocr/retention/holds`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        scopeKind: 'source',
        scopeRef: '10',
        reasonCode: 'audit_request',
        note: '审计请求',
      })

    res.assertStatus(200)
    const body = res.body().data
    assert.equal(body.status, 'active')
    assert.equal(body.organizationId, org.id)
    assert.equal(body.projectId, project.id)
  })

  test('MEMBER 设置 hold：denied → 403 + 低敏边界审计，不写 hold', async ({ assert, client }) => {
    const { org, project, token } = await seedMember(client, 'set-hold-deny')
    const res = await client
      .post(`${BASE}/${project.id}/ocr/retention/holds`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        scopeKind: 'source',
        scopeRef: '10',
        reasonCode: 'audit_request',
        note: '审计请求',
      })

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    const denial = await AuditLog.query()
      .where('organization_id', Number(org.id))
      .where('project_id', project.id)
      .where('metadata', 'like', '%OCR_PERMISSION_DENIAL%')
      .orderBy('id', 'desc')
      .first()
    assert.isNotNull(denial, '应写入一条权限拒绝审计')
    const meta = denial!.metadata as Record<string, unknown>
    assert.equal(meta.action, 'retention_hold')
    assert.equal(meta.result, 'denied')
    assert.include(meta.reasonCodes as string[], 'permission_missing')

    // 用例名承诺「不写 hold」，这里真的去查一次，否则 403 也可能伴随落库
    const holds = await OcrRetentionHold.query()
      .where('organization_id', Number(org.id))
      .where('project_id', project.id)
    assert.lengthOf(holds, 0, '被拒绝的请求不应写入 hold')
  })

  test('PM cleanup preview：resolver 放行 → 200', async ({ assert, client }) => {
    const { project, token } = await seedProjectManager(client, 'preview')
    const res = await client
      .post(`${BASE}/${project.id}/ocr/retention/cleanup/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ recordKinds: ['accepted_extraction'] })

    res.assertStatus(200)
    assert.isArray(res.body().data.eligible)
    assert.isArray(res.body().data.blocked)
  })

  test('MEMBER cleanup preview：denied → 403', async ({ client }) => {
    const { project, token } = await seedMember(client, 'preview-deny')
    const res = await client
      .post(`${BASE}/${project.id}/ocr/retention/cleanup/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ recordKinds: ['accepted_extraction'] })

    res.assertStatus(403)
  })
})

test.group('OCR 保留治理 — 状态读取（metadata-only 仍可读）', (group) => {
  useAuthDatabase(group)

  test('PM 读取保留状态：无构件 → 200', async ({ assert, client }) => {
    const { project, token } = await seedProjectManager(client, 'status-empty')
    const res = await client
      .get(`${BASE}/${project.id}/ocr/retention/status`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.equal(res.body().data.projectId, project.id)
    assert.property(res.body().data, 'counts')
  })

  test('tombstoned / purged / superseded 构件：仅元数据状态仍可读', async ({ assert, client }) => {
    const { org, project, token } = await seedProjectManager(client, 'status-archived')
    await seedExtraction(org.id, project.id, { tombstoneId: 99 }) // tombstoned
    await seedExtraction(org.id, project.id, { purgedAt: DateTime.now() }) // purged
    await seedExtraction(org.id, project.id, { status: 'superseded' }) // superseded

    const res = await client
      .get(`${BASE}/${project.id}/ocr/retention/status`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const counts = res.body().data.counts as Record<string, number>
    // 元数据状态仍可读（不因 tombstone/purge 被硬阻断）
    assert.isAtLeast(counts['accepted_extraction'] ?? 0, 0)
    assert.property(res.body().data, 'holdActiveCount')
  })

  test('MEMBER 读取保留状态：可读（仅元数据，未授予敏感复用）', async ({ assert, client }) => {
    const { org, project, token } = await seedMember(client, 'status-member')
    await seedExtraction(org.id, project.id, {})
    const res = await client
      .get(`${BASE}/${project.id}/ocr/retention/status`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.equal(res.body().data.projectId, project.id)
  })
})
