/**
 * OCR 审查确认 —— 下游权限集成测试（v3-ocr-permission-and-audit §6.2）
 *
 * 覆盖：
 * - 确认仍要求既有 preview/hash 校验（resolver 放行后模块自身校验仍生效）
 * - denied 决策不写 accepted extraction（resolver 守卫在 service 之前拦截）
 * - 保留滞留（retention_blocked）阻断确认保存并写低敏边界审计
 *
 * 红线：
 * - 只走 fixture 数据，不调用真实 OCR/model
 * - 不写任何正式项目数据
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { ProjectRoleName } from '#rbac'
import AuditLog from '#models/audit_log'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrRetentionHold from '#models/ocr_retention_hold'
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

/** 构造合法的确认保存请求体（校验通过即可，具体哈希由服务端判定）。 */
function saveBody(overrides: Record<string, unknown> = {}) {
  return {
    previewHash: 'wrong-preview-hash-000',
    selection: {
      candidateId: 1,
      mode: 'full',
      selectedText: '会议内容：Q3 产品规划会',
      pageRefs: [1],
    },
    reviewNote: '审查通过',
    ...overrides,
  }
}

/** 建 PM 有权审查的项目 + 返回 token。 */
async function seedProjectManager(client: any, scope: string) {
  const owner = await createUser({ email: uniqueEmail(`rev-pm-${scope}`) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const token = await login(client, owner)
  return { owner, org, project, token }
}

/** 建 MEMBER（无 ocr:confirm）项目。 */
async function seedMember(client: any, scope: string) {
  const owner = await createUser({ email: uniqueEmail(`rev-m-owner-${scope}`) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const member = await createUser({ email: uniqueEmail(`rev-m-${scope}`) })
  addOrgMember(org, member, 'member')
  await createProjectWithMember(org, owner, member, ProjectRoleName.MEMBER)
  const token = await login(client, member)
  return { org, project, member, token }
}

test.group('OCR 审查确认 — 下游权限集成', (group) => {
  useAuthDatabase(group)

  test('PM 确认保存：resolver 放行后模块自身 preview/hash 校验仍生效（坏哈希 → 422）', async ({
    assert,
    client,
  }) => {
    const { project, token } = await seedProjectManager(client, 'pm-hash')
    const res = await client
      .post(`${BASE}/${project.id}/ocr/document-jobs/10/confirmation-save`)
      .header('Authorization', `Bearer ${token}`)
      .json(saveBody())

    // PM 权限放行（confirm_required），但 previewHash 不匹配 → 模块自身校验拒绝
    res.assertStatus(422)

    const count = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', Number(project.organizationId))
      .where('project_id', project.id)
      .count('* as total')
      .firstOrFail()
    assert.equal(Number(count.$extras.total), 0, '不应写入 accepted extraction')
  })

  test('MEMBER（无 ocr:confirm）：denied 决策写低敏边界审计且不写 accepted extraction', async ({
    assert,
    client,
  }) => {
    const { org, project, token } = await seedMember(client, 'member')
    const res = await client
      .post(`${BASE}/${project.id}/ocr/document-jobs/10/confirmation-save`)
      .header('Authorization', `Bearer ${token}`)
      .json(saveBody())

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    const count = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .firstOrFail()
    assert.equal(Number(count.$extras.total), 0, 'denied 决策不应写入 accepted extraction')

    // 低敏边界审计：OCR_PERMISSION_DENIAL 且不含敏感文本
    const denial = await AuditLog.query()
      .where('projectId', project.id)
      .where('metadata', 'like', '%OCR_PERMISSION_DENIAL%')
      .orderBy('id', 'desc')
      .first()
    assert.isNotNull(denial, '应写入一条权限拒绝审计')
    const meta = denial!.metadata as Record<string, unknown>
    assert.equal(meta.result, 'denied')
    assert.include(meta.reasonCodes as string[], 'permission_missing')
    assert.isUndefined(meta.selectedText)
    assert.isUndefined(meta.fullText)
  })

  test('MEMBER 确认预览：denied 决策同样被拦截', async ({ assert, client }) => {
    const { org, project, token } = await seedMember(client, 'member-preview')
    const res = await client
      .post(`${BASE}/${project.id}/ocr/document-jobs/10/confirmation-preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        selection: {
          candidateId: 1,
          mode: 'full',
          selectedText: '会议内容：Q3 产品规划会',
          pageRefs: [1],
        },
      })

    res.assertStatus(403)
    const count = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .firstOrFail()
    assert.equal(Number(count.$extras.total), 0)
  })

  test('保留滞留（retention_blocked）：PM 确认保存被阻断并写边界审计，不写 accepted extraction', async ({
    assert,
    client,
  }) => {
    const { org, project, token } = await seedProjectManager(client, 'pm-hold')
    // 项目级活跃 hold → resolver 的保留适配器返回 retention_blocked
    await OcrRetentionHold.create({
      organizationId: org.id,
      projectId: project.id,
      scopeKind: 'project',
      scopeHash: 'hold-scope-hash',
      reasonCode: 'audit_request',
      note: '审计请求',
      status: 'active',
      setBy: 1,
      setAt: DateTime.now(),
    })

    const res = await client
      .post(`${BASE}/${project.id}/ocr/document-jobs/10/confirmation-save`)
      .header('Authorization', `Bearer ${token}`)
      .json(saveBody())

    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    const count = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .count('* as total')
      .firstOrFail()
    assert.equal(Number(count.$extras.total), 0, '保留滞留不应写入 accepted extraction')

    const hold = await AuditLog.query()
      .where('projectId', project.id)
      .where('metadata', 'like', '%OCR_PERMISSION_RETENTION_HOLD%')
      .orderBy('id', 'desc')
      .first()
    assert.isNotNull(hold, '应写入一条保留滞留边界审计')
    const meta = hold!.metadata as Record<string, unknown>
    assert.equal(meta.result, 'retention_blocked')
    assert.include(meta.reasonCodes as string[], 'retention_held')
  })
})
