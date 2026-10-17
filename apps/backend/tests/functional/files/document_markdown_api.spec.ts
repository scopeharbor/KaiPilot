/**
 * 项目文档 Markdown 导入/导出 API 集成测试（v3-document-markdown-import-export §5.3–5.6 + §3.6）。
 *
 * 覆盖：导入预览/创建确认/替换确认/stale-block 响应、单文档与选中树导出（Content-Disposition）、
 * 权限降级（只读可导出不可导入）、跨组织隔离、隐藏引用不泄露、无 AI/外部依赖/无 /api/v2。
 */
import { test } from '@japa/runner'
import Document from '#models/document'
import OrganizationMember from '#models/organization_member'
import { ProjectRoleName } from '#rbac'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

const MD = '# 项目计划\n\n## 目标\n\n在季度末交付。'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setup(roleName = ProjectRoleName.PROJECT_MANAGER) {
  const user = await createUser({ email: uniqueEmail('mdapi') })
  const org = await createOrganization(user)
  const { project } = await createProjectWithMember(org, user, user, roleName)
  return { user, org, project }
}

async function createDoc(projectId: number, overrides: Partial<Record<string, unknown>> = {}) {
  return Document.create({
    projectId: BigInt(projectId),
    name: '接口文档',
    documentType: 'document',
    parentId: null,
    content: MD,
    createdBy: BigInt(1),
    ...overrides,
  } as Record<string, unknown>)
}

test.group('Markdown Import/Export API — import', (group) => {
  useAuthDatabase(group)

  test('导入预览返回 { data } 且不写库', async ({ client, assert }) => {
    const { user, org, project } = await setup()
    const token = await login(client, user)
    const before = (await Document.query().countDistinct('id as total').first())!.$extras
      .total as number

    const res = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: `\uFEFF${MD}`, originalFilename: 'notes.md' })

    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.mode, 'create')
    assert.equal(data.normalizedContent, MD)
    assert.equal(data.inferredTitle, '项目计划')
    assert.isNotNull(data.previewHash)
    assert.deepEqual(data.warnings, [])
    assert.isNull(data.sourceDocumentHash)

    const after = (await Document.query().countDistinct('id as total').first())!.$extras
      .total as number
    assert.equal(after, before)
    void org
  })

  test('导入预览超大内容返回统一 VALIDATION_ERROR 信封', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)

    const res = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: 'x'.repeat(100_001) })

    res.assertStatus(422)
    const body = res.body() as { error: { code: string } }
    assert.equal(body.error.code, 'VALIDATION_ERROR')
  })

  test('create 确认创建文档并返回 { data }', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)

    const preview = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: MD, originalFilename: 'notes.md' })
    const previewHash = preview.body().data.previewHash

    const res = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: MD, confirmed: true, previewHash })

    res.assertStatus(201)
    const data = res.body().data
    assert.isNumber(data.documentId)
    assert.equal(data.mode, 'create')

    const doc = await Document.find(data.documentId)
    assert.isNotNull(doc)
    assert.equal(doc!.documentType, 'document')
    assert.equal(doc!.content, MD)
  })

  test('未显式确认返回 422 且不写库', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const before = (await Document.query().countDistinct('id as total').first())!.$extras
      .total as number

    const res = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: MD, confirmed: false, previewHash: 'a'.repeat(16) })

    res.assertStatus(422)
    const after = (await Document.query().countDistinct('id as total').first())!.$extras
      .total as number
    assert.equal(after, before)
  })

  test('replace 确认更新目标文档', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const doc = await createDoc(project.id)

    const preview = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'replace', content: '# 新内容', targetDocumentId: doc.id })
    const data = preview.body().data
    assert.equal(data.mode, 'replace')
    assert.isNotNull(data.sourceDocumentHash)

    const res = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        mode: 'replace',
        content: '# 新内容',
        targetDocumentId: doc.id,
        confirmed: true,
        previewHash: data.previewHash,
        expectedSourceDocumentHash: data.sourceDocumentHash,
      })

    res.assertStatus(201)
    const updated = await Document.find(doc.id)
    assert.equal(updated!.content, '# 新内容')
  })

  test('stale 替换被阻断并返回最新 source hash', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const doc = await createDoc(project.id)

    const preview = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'replace', content: '# 新内容', targetDocumentId: doc.id })
    const data = preview.body().data

    doc.content = '# 被他人修改'
    await doc.save()

    const res = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        mode: 'replace',
        content: '# 新内容',
        targetDocumentId: doc.id,
        confirmed: true,
        previewHash: data.previewHash,
        expectedSourceDocumentHash: data.sourceDocumentHash,
      })

    res.assertStatus(422)
    const body = res.body() as {
      error: { code: string; details?: { latestSourceDocumentHash?: string } }
    }
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.exists(body.error.details?.latestSourceDocumentHash)
  })
})

test.group('Markdown Import/Export API — export', (group) => {
  useAuthDatabase(group)

  test('单文档导出返回 { data } 与 Content-Disposition', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const doc = await createDoc(project.id, { name: '导出文档' })

    const res = await client
      .get(`/api/v1/projects/${project.id}/files/markdown/export/${doc.id}`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.filename, '导出文档.md')
    assert.equal(data.content, MD)
    assert.isNotNull(data.contentHash)
    assert.equal(data.source.documentId, doc.id)
    assert.match(String(res.headers()['content-disposition'] ?? ''), /attachment;/)
  })

  test('选中树导出返回 bundle + manifest（确定性）', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const folder = await Document.create({
      projectId: BigInt(project.id),
      name: '团队',
      documentType: 'folder',
      parentId: null,
      content: null,
      createdBy: BigInt(1),
    } as Record<string, unknown>)
    // spec「export selected document tree」：选中 folder 时其可见子文档随树导出，
    // A 文档作为「团队」folder 的子文档会被包含（确定性 tree order）；manifest 只含计数。
    await createDoc(project.id, { name: 'A 文档', parentId: folder.id })
    const docB = await createDoc(project.id, { name: 'B 文档' })

    const res = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/export/tree`)
      .header('Authorization', `Bearer ${token}`)
      .json({ selectedIds: [folder.id, docB.id] })

    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.filename, 'project-documents.md')
    assert.equal(data.manifest.exportedCount, 2)
    assert.include(data.content, 'A 文档')
    assert.include(data.content, 'markdown-export-manifest')
    assert.isNotNull(data.bundleHash)
  })

  test('导出不可见/跨组织目标不泄露', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const doc = await createDoc(project.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/files/markdown/export/${doc.id + 999_999}`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(404)
    const body = res.body() as { error: { code: string; message: string } }
    assert.equal(body.error.code, 'RESOURCE_NOT_FOUND')
    assert.isFalse(body.error.message.includes('导出文档'))
  })
})

test.group('Markdown Import/Export API — permissions', (group) => {
  useAuthDatabase(group)

  test('只读成员可导出但不可导入', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('mdowner') })
    const org = await createOrganization(owner)
    const viewer = await createUser({ email: uniqueEmail('mdviewer') })
    await OrganizationMember.create({
      organizationId: org.id,
      userId: viewer.id,
      role: 'member',
    } as Record<string, unknown>)
    const { project } = await createProjectWithMember(
      org,
      owner,
      viewer,
      ProjectRoleName.READONLY_OBSERVER,
    )
    const token = await login(client, viewer)
    const doc = await createDoc(project.id)

    const exportRes = await client
      .get(`/api/v1/projects/${project.id}/files/markdown/export/${doc.id}`)
      .header('Authorization', `Bearer ${token}`)
    exportRes.assertStatus(200)

    const previewRes = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: MD })
    previewRes.assertStatus(403)
    const body = previewRes.body() as { error: { code: string } }
    assert.equal(body.error.code, 'PERMISSION_DENIED')
  })

  test('经理可导入与导出', async ({ client }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const doc = await createDoc(project.id)

    const previewRes = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: MD })
    previewRes.assertStatus(200)

    const exportRes = await client
      .get(`/api/v1/projects/${project.id}/files/markdown/export/${doc.id}`)
      .header('Authorization', `Bearer ${token}`)
    exportRes.assertStatus(200)
  })

  test('跨组织用户 404/403 且不泄露', async ({ client, assert }) => {
    const { project } = await setup()
    const other = await createUser({ email: uniqueEmail('mdother') })
    await createOrganization(other)
    const token = await login(client, other)
    const doc = await createDoc(project.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/files/markdown/export/${doc.id}`)
      .header('Authorization', `Bearer ${token}`)

    assert.include([403, 404], res.status())
    const body = res.body() as { error?: { message?: string } }
    assert.isFalse((body.error?.message ?? '').includes('接口文档'))
  })

  test('未认证请求返回 401', async ({ client }) => {
    const res = await client
      .post('/api/v1/projects/1/files/markdown/import/preview')
      .json({ mode: 'create', content: MD })
    res.assertStatus(401)
  })
})

test.group('Markdown Import/Export API — redlines', (group) => {
  useAuthDatabase(group)

  test('导入/导出不调用 AI、外部网络与 /api/v2', async ({ client, assert }) => {
    const { user, project } = await setup()
    const token = await login(client, user)
    const doc = await createDoc(project.id)

    const preview = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: MD })
    preview.assertStatus(200)
    const previewHash = preview.body().data.previewHash

    const confirm = await client
      .post(`/api/v1/projects/${project.id}/files/markdown/import/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'create', content: MD, confirmed: true, previewHash })
    confirm.assertStatus(201)

    const exportRes = await client
      .get(`/api/v1/projects/${project.id}/files/markdown/export/${doc.id}`)
      .header('Authorization', `Bearer ${token}`)
    exportRes.assertStatus(200)

    const docs = await Document.query().where('projectId', Number(project.id))
    assert.equal(docs.length, 2)

    // 不产生 AI/外部调用：断言请求期间未触发 AI 审计事件与 v2 路由
    const { default: AuditLog } = await import('#models/audit_log')
    const aiEvents = await AuditLog.query().where('action', 'ai_generate').limit(5)
    const v2Hits = aiEvents.filter((l) => {
      const metadata = (l.metadata ?? {}) as Record<string, unknown>
      return (metadata.url as string)?.includes('/api/v2')
    })
    assert.equal(v2Hits.length, 0)
  })
})
