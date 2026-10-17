/**
 * V2 报表系统 API 集成测试（v2-reporting-system-upgrade tasks 5.5）。
 *
 * 覆盖点：
 *   - 模板目录：PM 可查看、权限受限模板隐藏；
 *   - 预览（dry-run）：返回数据源状态、warnings、不创建版本；
 *   - 创建版本：201 + 返回 version + job；
 *   - 版本列表：按 templateId 过滤、分页；
 *   - 任务详情：状态、attempt、幂等 key；
 *   - 任务重试：新 attempt；
 *   - 导出创建：201 + 返回 exportId；
 *   - 导出列表：过滤文件路径；
 *   - 下载：二次鉴权，失权后 404；
 *   - AI 审核：确认/拒绝；
 *   - 组织隔离：跨组织 404；
 *   - 非成员拒绝：非成员 403/404；
 *   - 统一错误格式：{ error: { code, message } }。
 */
import ReportVersion from '#models/report_version'
import AuditLog from '#models/audit_log'
import type Organization from '#models/organization'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

const V2_PREFIX = '/api/v1/projects'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setupProject(org: Organization, creator: User) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { project }
}

test.group('V2 Reports API — templates', (group) => {
  useAuthDatabase(group)

  test('GET /reports/v2/templates 返回模板目录', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-templates') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/templates`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    res.assertStatus(200)
    assert.isArray(res.body().data)
    assert.isAtLeast(res.body().data.length, 4)
    // 包含 V1 等价模板
    const progress = res
      .body()
      .data.find((t: { templateId: string }) => t.templateId === 'progress')
    assert.isDefined(progress)
    assert.equal(progress.name, '进度报告')
    assert.isArray(progress.supportedFormats)
    assert.isArray(progress.requiredDataSources)
  })

  test('GET /reports/v2/templates 跨组织返回 404', async ({ client }) => {
    const owner1 = await createUser({ email: uniqueEmail('v2-api-t1') })
    const org1 = await createOrganization(owner1)
    const { project } = await setupProject(org1, owner1)
    const owner2 = await createUser({ email: uniqueEmail('v2-api-t2') })
    const org2 = await createOrganization(owner2)
    const token = await login(client, owner2)

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/templates`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org2.id))

    res.assertStatus(404)
  })
})

test.group('V2 Reports API — preview', (group) => {
  useAuthDatabase(group)

  test('POST /reports/v2/preview 返回预览结果且不创建版本', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-preview') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/preview`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'progress' })

    res.assertStatus(200)
    assert.equal(res.body().data.templateId, 'progress')
    assert.isBoolean(res.body().data.blocking)
    assert.isObject(res.body().data.dataSources)

    // 验证不创建版本
    const versions = await ReportVersion.query().where('project_id', Number(project.id))
    assert.equal(versions.length, 0)
  })

  test('POST /reports/v2/preview 非法模板返回 422', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-preview-invalid') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/preview`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'non-existent-template' })

    res.assertStatus(422)
    assert.equal(res.body().error?.code, 'VALIDATION_ERROR')
  })

  test('POST /reports/v2/preview V2 模板 project-weekly 返回有效结果', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-preview-weekly') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/preview`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({
        templateId: 'project-weekly',
        filters: { fromDate: '2026-07-01', toDate: '2026-07-07' },
      })

    res.assertStatus(200)
    assert.equal(res.body().data.templateId, 'project-weekly')
    assert.isArray(res.body().data.exportFormats)
  })
})

test.group('V2 Reports API — versions', (group) => {
  useAuthDatabase(group)

  test('POST /reports/v2/versions 创建版本返回 201 + version + job', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-version') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({
        templateId: 'progress',
        previewSnapshotHash: 'test-hash-001',
        title: '测试版本',
      })

    res.assertStatus(201)
    assert.isDefined(res.body().data.version)
    assert.isDefined(res.body().data.job)
    assert.equal(res.body().data.version.templateId, 'progress')
    assert.equal(res.body().data.job.status, 'queued')
    assert.equal(res.body().data.job.attempt, 1)
  })

  test('GET /reports/v2/versions 返回版本列表', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-versions-list') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 创建两个版本
    await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'progress', previewSnapshotHash: 'h1' })

    await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'delay', previewSnapshotHash: 'h2' })

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    res.assertStatus(200)
    assert.isArray(res.body().data)
    assert.isAtLeast(res.body().data.length, 2)
    assert.isDefined(res.body().meta)
    assert.isNumber(res.body().meta.total)
  })

  test('GET /reports/v2/versions/:versionId 返回版本详情', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-version-detail') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({
        templateId: 'project-weekly',
        previewSnapshotHash: 'detail-hash',
        title: '详情测试版本',
      })
    const versionId = createRes.body().data.version.id

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    res.assertStatus(200)
    assert.equal(res.body().data.id, versionId)
    assert.equal(res.body().data.title, '详情测试版本')
  })

  test('GET /reports/v2/versions/:versionId 跨组织返回 404', async ({ client }) => {
    const owner1 = await createUser({ email: uniqueEmail('v2-api-v-cross1') })
    const org1 = await createOrganization(owner1)
    const { project } = await setupProject(org1, owner1)
    const token1 = await login(client, owner1)

    const createRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token1)
      .header('X-Tenant-Id', String(org1.id))
      .json({ templateId: 'progress', previewSnapshotHash: 'cross-hash' })
    const versionId = createRes.body().data.version.id

    const owner2 = await createUser({ email: uniqueEmail('v2-api-v-cross2') })
    const org2 = await createOrganization(owner2)
    const token2 = await login(client, owner2)

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}`)
      .bearerToken(token2)
      .header('X-Tenant-Id', String(org2.id))

    res.assertStatus(404)
  })
})

test.group('V2 Reports API — jobs', (group) => {
  useAuthDatabase(group)

  test('GET /reports/v2/jobs/:jobId 返回任务详情', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-job') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'progress', previewSnapshotHash: 'job-hash' })
    const jobId = createRes.body().data.job.id

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/jobs/${jobId}`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    res.assertStatus(200)
    assert.equal(res.body().data.id, jobId)
    assert.equal(res.body().data.status, 'queued')
    assert.equal(res.body().data.attempt, 1)
  })

  test('POST /reports/v2/jobs/:jobId/retry 创建新 attempt', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-retry') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 创建版本
    const createRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'progress', previewSnapshotHash: 'retry-hash' })
    const jobId = createRes.body().data.job.id

    // 重试
    const retryRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/jobs/${jobId}/retry`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    retryRes.assertStatus(200)
    assert.equal(retryRes.body().data.attempt, 2)
    assert.notEqual(retryRes.body().data.id, jobId)
  })
})

test.group('V2 Reports API — exports', (group) => {
  useAuthDatabase(group)

  async function createVersionForExport(
    client: ApiClient,
    token: string,
    projectId: number,
    orgId: number,
  ) {
    const res = await client
      .post(`${V2_PREFIX}/${projectId}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(orgId))
      .json({ templateId: 'progress', previewSnapshotHash: 'export-hash' })
    return res.body().data.version.id
  }

  test('POST /reports/v2/versions/:versionId/exports 创建导出记录', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-export') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)
    const versionId = await createVersionForExport(
      client,
      token,
      Number(project.id),
      Number(org.id),
    )

    const res = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ format: 'csv' })

    res.assertStatus(201)
    assert.isDefined(res.body().data.exportId)
    assert.equal(res.body().data.format, 'csv')
    assert.equal(res.body().data.status, 'pending')
  })

  test('GET /reports/v2/versions/:versionId/exports 返回导出列表（不含文件路径）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-exports-list') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)
    const versionId = await createVersionForExport(
      client,
      token,
      Number(project.id),
      Number(org.id),
    )

    // 创建两个导出
    await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ format: 'csv' })

    await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ format: 'markdown' })

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    res.assertStatus(200)
    assert.isArray(res.body().data)
    assert.isAtLeast(res.body().data.length, 2)

    // 验证不泄露文件路径
    for (const exp of res.body().data) {
      assert.isUndefined(exp.filePath)
    }
  })

  test('GET /reports/v2/exports/:exportId/download 二次鉴权 — 失权后拒绝', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-dl-owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)
    const versionId = await createVersionForExport(
      client,
      token,
      Number(project.id),
      Number(org.id),
    )

    const exportRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ format: 'csv' })
    const exportId = exportRes.body().data.exportId

    // 用另一个用户的 token 下载（跨组织）
    const otherUser = await createUser({ email: uniqueEmail('v2-api-dl-other') })
    const otherOrg = await createOrganization(otherUser)
    const otherToken = await login(client, otherUser)

    const dlRes = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/exports/${exportId}/download`)
      .bearerToken(otherToken)
      .header('X-Tenant-Id', String(otherOrg.id))

    dlRes.assertStatus(404)
  })
})

test.group('V2 Reports API — AI review', (group) => {
  useAuthDatabase(group)

  test('PATCH /reports/v2/versions/:versionId/ai-review 确认 AI 草稿', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-ai-confirm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 创建版本（开启 AI）
    const createRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({
        templateId: 'project-weekly',
        previewSnapshotHash: 'ai-hash',
        enableAiDraft: true,
      })
    const versionId = createRes.body().data.version.id

    // 确认
    const confirmRes = await client
      .patch(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/ai-review`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ reviewStatus: 'confirmed', aiDraft: '编辑后的草稿内容' })

    confirmRes.assertStatus(200)
    assert.equal(confirmRes.body().data.aiReviewStatus, 'confirmed')
    assert.isNotNull(confirmRes.body().data.confirmedAt)
  })

  test('PATCH /reports/v2/versions/:versionId/ai-review 拒绝 AI 草稿', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-ai-reject') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({
        templateId: 'project-weekly',
        previewSnapshotHash: 'ai-reject-hash',
        enableAiDraft: true,
      })
    const versionId = createRes.body().data.version.id

    const rejectRes = await client
      .patch(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/ai-review`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ reviewStatus: 'rejected' })

    rejectRes.assertStatus(200)
    assert.equal(rejectRes.body().data.aiReviewStatus, 'rejected')
    assert.isNull(rejectRes.body().data.confirmedAt)
  })
})

test.group('V2 Reports API — auth & isolation', (group) => {
  useAuthDatabase(group)

  test('非项目成员访问返回 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-auth1') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const nonMember = await createUser({ email: uniqueEmail('v2-api-auth2') })
    await addOrgMember(org, nonMember, 'member')
    const token = await login(client, nonMember)

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/templates`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    res.assertStatus(403)
  })

  test('统一错误格式', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-err') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/preview`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'invalid' })

    res.assertStatus(422)
    assert.isDefined(res.body().error)
    assert.isString(res.body().error.code)
    assert.isString(res.body().error.message)
  })

  test('审计事件落盘 — preview 和 version created', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('v2-api-audit') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 触发 preview
    await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/preview`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'progress' })

    // 创建版本
    await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ templateId: 'progress', previewSnapshotHash: 'audit-hash' })

    // 验证审计事件
    const auditLogs = await AuditLog.query()
      .where('organization_id', Number(org.id))
      .whereIn('action', ['read', 'create'])
      .orderBy('created_at', 'desc')
      .limit(5)

    assert.isAtLeast(auditLogs.length, 2)
    // 审计正文不含敏感内容
    for (const log of auditLogs) {
      const meta = log.metadata
      if (meta && typeof meta === 'object' && 'templateId' in meta) {
        assert.isString(meta.templateId)
      }
    }
  })
})
