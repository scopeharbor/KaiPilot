/**
 * OCR 权限/审计 —— 实体链接下游集成测试（v3-ocr-permission-and-audit §6.12）
 *
 * 证明：
 * - PM（ocr_entity_link:manage）放行 → 可创建运行
 * - MEMBER（无 manage 权限）denied → 403 + 低敏边界审计，不读 selectedText 全文、不持久化 advisory link
 * - explain denied（无 ai:trigger）→ 403
 *
 * 红线：只走 fixture，不调真实 provider/model；不写正式项目数据。
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { ProjectRoleName } from '#rbac'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrEntityLinkRun from '#models/ocr_entity_link_run'
import OcrEntityLinkCandidate from '#models/ocr_entity_link_candidate'
import AuditLog from '#models/audit_log'
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

async function seedAcceptedExtraction(organizationId: number, projectId: number) {
  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = organizationId
  extraction.projectId = projectId
  extraction.reviewerId = 1
  extraction.sourceKind = 'attachment'
  extraction.sourceId = 10
  extraction.sourceHash = 'el-hash-perm-001'
  extraction.candidateHash = 'el-cand-001'
  extraction.selectedTextHash = 'el-txt-001'
  extraction.selectedText = '项目经理张三负责Q3路线图，李四负责开发资源'
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

/** 种子 PM + MEMBER 同项目。 */
async function seedPmAndMember(client: any, scope: string) {
  const owner = await createUser({ email: uniqueEmail(`el-pm-${scope}`) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const member = await createUser({ email: uniqueEmail(`el-mem-${scope}`) })
  addOrgMember(org, member, 'member')
  const role = await ProjectRole.create({
    projectId: project.id,
    name: ProjectRoleName.MEMBER,
    description: ProjectRoleName.MEMBER,
    isSystem: true,
  })
  await ProjectMember.create({
    projectId: project.id,
    userId: member.id,
    projectRoleId: role.id,
    isActive: true,
  })
  return {
    org,
    project,
    extraction: await seedAcceptedExtraction(org.id, project.id),
    pmToken: await login(client, owner),
    memberToken: await login(client, member),
  }
}

test.group('OcrPermissionAudit — Entity Linking Integration', (group) => {
  useAuthDatabase(group)

  group.each.setup(async () => {
    await OcrEntityLinkRun.query().delete()
    await OcrEntityLinkCandidate.query().delete()
    await OcrReviewAcceptedExtraction.query().delete()
  })

  test('MEMBER（无 manage 权限）denied → 403 + 低敏边界审计，不持久化 advisory link', async ({
    assert,
    client,
  }) => {
    const { org, project, extraction, memberToken } = await seedPmAndMember(client, 'deny-run')

    const res = await client
      .post(`${BASE}/${project.id}/ocr/entity-links/runs`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({ acceptedExtractionIds: [extraction.id] })

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    const runs = await OcrEntityLinkRun.query().where('organization_id', org.id)
    assert.lengthOf(runs, 0, 'denied 决策不应创建运行')

    const candidates = await OcrEntityLinkCandidate.query().where('organization_id', org.id)
    assert.lengthOf(candidates, 0, 'denied 决策不应持久化 advisory link 候选')

    const denial = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('metadata', 'like', '%OCR_PERMISSION_DENIAL%')
      .first()
    assert.isNotNull(denial, '应写入权限拒绝审计')
  })

  test('MEMBER explain denied（无 ai:trigger）→ 403 + 不暴露 advisory 候选', async ({
    assert,
    client,
  }) => {
    const { project, memberToken } = await seedPmAndMember(client, 'deny-explain')

    const res = await client
      .post(`${BASE}/${project.id}/ocr/entity-links/explain`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({ runId: 1, candidateId: 1 })

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    // 响应体不含任何 advisory 候选引用
    assert.isFalse(
      JSON.stringify(res.body()).includes('advisory'),
      'denied 决策不应暴露 advisory 候选',
    )
  })
})
