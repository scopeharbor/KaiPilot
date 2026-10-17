/**
 * 项目文档 Markdown 导入/导出服务测试（v3-document-markdown-import-export §4.10–4.12）。
 *
 * 覆盖：valid preview / 警告检测 / 稳定哈希 / create+replace 确认 / stale 拒绝 /
 * 单文档与选中树导出 / 隐藏目标 denied / 非 mutation 保证 / 低敏审计 / 性能预算。
 */
import { test } from '@japa/runner'
import Document from '#models/document'
import AuditService from '#services/audit_service'
import DocumentMarkdownImportExportService from '#services/document_markdown_import_export_service'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import { buildLargeMarkdownFixture } from '@aiproj/types'

const MD = '# 项目计划\n\n## 目标\n\n在季度末交付。'
const MD_RAW_HTML =
  '# 标题\n\n<div class="banner">hi</div>\n\n![x](https://example.com/a.png)\n\n![y](./local.png)'
const MD_BAD_FRONTMATTER = '---\ntitle: 标题\nauthor: 张三\n---\n\n正文'
const MD_DEEP_HEADING = '# a\n####### too deep'

async function setup() {
  const owner = await createUser({ email: uniqueEmail('mdm') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const audit = new AuditService()
  const service = new DocumentMarkdownImportExportService(audit)
  return { owner, org, project, service }
}

async function createDocument(projectId: number, overrides: Partial<Record<string, unknown>> = {}) {
  return Document.create({
    projectId: BigInt(projectId),
    name: '文档',
    documentType: 'document',
    parentId: null,
    content: MD,
    createdBy: BigInt(1),
    ...overrides,
  } as Record<string, unknown>)
}

test.group('MarkdownImportExportService — preview', (group) => {
  useAuthDatabase(group)

  test('create 模式预览返回确定性结果且不写库', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const before = await Document.query().count('* as total').first()

    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: `\uFEFF${MD.replace(/\n/g, '\r\n')}`,
      originalFilename: 'notes.md',
      userId: owner.id,
    })

    assert.equal(preview.mode, 'create')
    assert.equal(preview.normalizedContent, MD)
    assert.equal(preview.inferredTitle, '项目计划')
    assert.equal(preview.byteCount, Buffer.byteLength(MD, 'utf8'))
    assert.equal(preview.lineCount, MD.split('\n').length)
    assert.isNull(preview.sourceDocumentHash)
    assert.isNotNull(preview.previewHash)
    assert.equal(preview.warnings.length, 0)

    const after = await Document.query().count('* as total').first()
    assert.equal(after!.$extras.total, before!.$extras.total)
  })

  test('未支持特性产生确定性警告', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: `${MD_BAD_FRONTMATTER}\n\n${MD_RAW_HTML}\n\n${MD_DEEP_HEADING}`,
      userId: owner.id,
    })

    const codes = preview.warnings.map((w) => w.code)
    assert.include(codes, 'RAW_HTML')
    assert.include(codes, 'REMOTE_IMAGE')
    assert.include(codes, 'LOCAL_PATH_REFERENCE')
    assert.include(codes, 'UNSUPPORTED_FRONTMATTER')
    assert.include(codes, 'EXCESSIVE_HEADING_DEPTH')
    assert.deepEqual(codes, [...codes].sort())
  })

  test('等价输入（BOM/换行）产生相同 previewHash 与警告顺序', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const a = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: `\uFEFF${MD}`,
      userId: owner.id,
    })
    const b = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: MD.replace(/\n/g, '\r\n'),
      userId: owner.id,
    })

    assert.equal(a.previewHash, b.previewHash)
    assert.deepEqual(
      a.warnings.map((w) => w.code),
      b.warnings.map((w) => w.code),
    )
  })

  test('replace 模式报告当前 sourceDocumentHash 与目标名称', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const doc = await createDocument(project.id)

    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'replace',
      content: '# 新内容',
      targetDocumentId: doc.id,
      userId: owner.id,
    })

    assert.equal(preview.mode, 'replace')
    assert.equal(preview.target.targetDocumentId, doc.id)
    assert.equal(preview.target.targetDocumentName, '文档')
    assert.isNotNull(preview.sourceDocumentHash)
  })

  test('超大内容拒绝且不产生可确认结果', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await assert.rejects(() =>
      service.previewImport({
        organizationId: org.id,
        projectId: project.id,
        mode: 'create',
        content: 'x'.repeat(100_001),
        userId: owner.id,
      }),
    )
  })

  test('不可见/不存在目标不泄露存在性', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await assert.rejects(() =>
      service.previewImport({
        organizationId: org.id,
        projectId: project.id,
        mode: 'replace',
        content: '# x',
        targetDocumentId: 999_999,
        userId: owner.id,
      }),
    )
  })
})

test.group('MarkdownImportExportService — confirm', (group) => {
  useAuthDatabase(group)

  test('create 确认创建 document 类型条目并保存归一化内容', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: `\uFEFF${MD}`,
      userId: owner.id,
    })

    const result = await service.confirmImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: MD.replace(/\n/g, '\r\n'),
      confirmed: true,
      previewHash: preview.previewHash,
      userId: owner.id,
    })

    assert.equal(result.mode, 'create')
    assert.isNumber(result.documentId)

    const doc = await Document.find(result.documentId)
    assert.isNotNull(doc)
    assert.equal(doc!.documentType, 'document')
    assert.equal(doc!.content, MD)
    assert.equal(doc!.name, '项目计划')
  })

  test('confirmed=false 拒绝写入', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: MD,
      userId: owner.id,
    })

    await assert.rejects(() =>
      service.confirmImport({
        organizationId: org.id,
        projectId: project.id,
        mode: 'create',
        content: MD,
        confirmed: false,
        previewHash: preview.previewHash,
        userId: owner.id,
      }),
    )
  })

  test('previewHash 不匹配拒绝写入', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await assert.rejects(() =>
      service.confirmImport({
        organizationId: org.id,
        projectId: project.id,
        mode: 'create',
        content: MD,
        confirmed: true,
        previewHash: 'f'.repeat(16),
        userId: owner.id,
      }),
    )
  })

  test('replace 确认更新内容且保留归属', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const folder = await Document.create({
      projectId: BigInt(project.id),
      name: '文件夹',
      documentType: 'folder',
      parentId: null,
      content: null,
      createdBy: BigInt(1),
    } as Record<string, unknown>)
    const doc = await createDocument(project.id, { parentId: folder.id })

    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'replace',
      content: '# 新内容\n\n替换正文',
      targetDocumentId: doc.id,
      userId: owner.id,
    })

    const result = await service.confirmImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'replace',
      content: '# 新内容\n\n替换正文',
      targetDocumentId: doc.id,
      confirmed: true,
      previewHash: preview.previewHash,
      expectedSourceDocumentHash: preview.sourceDocumentHash!,
      userId: owner.id,
    })

    assert.equal(result.documentId, doc.id)
    const updated = await Document.find(doc.id)
    assert.equal(updated!.content, '# 新内容\n\n替换正文')
    assert.equal(Number(updated!.parentId), folder.id)
    assert.equal(updated!.projectId, BigInt(project.id))
  })

  test('stale 替换被拒绝并返回最新 source hash', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const doc = await createDocument(project.id)

    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'replace',
      content: '# 新内容',
      targetDocumentId: doc.id,
      userId: owner.id,
    })

    doc.content = '# 被其他人修改'
    await doc.save()

    try {
      await service.confirmImport({
        organizationId: org.id,
        projectId: project.id,
        mode: 'replace',
        content: '# 新内容',
        targetDocumentId: doc.id,
        confirmed: true,
        previewHash: preview.previewHash,
        expectedSourceDocumentHash: preview.sourceDocumentHash!,
        userId: owner.id,
      })
      assert.fail('应抛出 stale 校验错误')
    } catch (error: any) {
      assert.equal((error.constructor as any).code, 'VALIDATION_ERROR')
      assert.exists(error.details?.latestSourceDocumentHash)
    }

    const unchanged = await Document.find(doc.id)
    assert.equal(unchanged!.content, '# 被其他人修改')
  })
})

test.group('MarkdownImportExportService — export', (group) => {
  useAuthDatabase(group)

  test('单文档导出返回安全文件名/载荷/哈希/字节数', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const doc = await createDocument(project.id)

    const result = await service.exportSingle({
      organizationId: org.id,
      projectId: project.id,
      documentId: doc.id,
      userId: owner.id,
    })

    assert.equal(result.filename, '文档.md')
    assert.equal(result.content, MD)
    assert.equal(result.byteCount, Buffer.byteLength(MD, 'utf8'))
    assert.isNotNull(result.contentHash)
    assert.equal(result.source.documentId, doc.id)
    assert.equal(result.source.name, '文档')
  })

  test('导出不修改文档（内容与时间戳不变）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const doc = await createDocument(project.id)
    const before = doc.content
    const beforeUpdatedAt = (await Document.find(doc.id))!.updatedAt?.toMillis()

    await service.exportSingle({
      organizationId: org.id,
      projectId: project.id,
      documentId: doc.id,
      userId: owner.id,
    })

    const after = await Document.find(doc.id)
    assert.equal(after!.content, before)
    assert.equal(after!.updatedAt?.toMillis(), beforeUpdatedAt)
  })

  test('文件夹目标导出被拒绝（无文本内容）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const folder = await Document.create({
      projectId: BigInt(project.id),
      name: '文件夹',
      documentType: 'folder',
      parentId: null,
      content: null,
      createdBy: BigInt(1),
    } as Record<string, unknown>)

    await assert.rejects(() =>
      service.exportSingle({
        organizationId: org.id,
        projectId: project.id,
        documentId: folder.id,
        userId: owner.id,
      }),
    )
  })

  test('选中树导出：确定性 manifest + 隐藏目标 denied', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const folder = await Document.create({
      projectId: BigInt(project.id),
      name: '团队',
      documentType: 'folder',
      parentId: null,
      content: null,
      createdBy: BigInt(1),
    } as Record<string, unknown>)
    // spec「export selected document tree」：选中 folder 时其下可见文档随树导出；
    // A 文档作为 folder 的可见子文档会被一并导出（确定性 tree order）。
    await createDocument(project.id, { name: 'A 文档', parentId: folder.id })
    const docB = await createDocument(project.id, { name: 'B 文档' })

    const result = await service.exportTree({
      organizationId: org.id,
      projectId: project.id,
      selectedIds: [folder.id, docB.id, 999_999],
      userId: owner.id,
    })

    assert.equal(result.manifest.exportedCount, 2)
    assert.equal(result.manifest.deniedCount, 1)
    const paths = result.manifest.items.map((i) => i.path)
    assert.deepEqual(paths, [...paths].sort())
    // 不存在的目标（999_999）必须以 denied + 脱敏路径返回，绝不回显真实标题/路径
    const denied = result.manifest.items.find((i) => i.status === 'denied')
    assert.equal(denied!.reasonCode, 'HIDDEN_SOURCE_DENIAL')
    assert.match(denied!.path, /^\[hidden-\d+\]$/)
    assert.isNotNull(result.bundleHash)
  })

  test('选中树导出包含 manifest 与分隔符且不泄露隐藏内容', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const doc = await createDocument(project.id)

    const result = await service.exportTree({
      organizationId: org.id,
      projectId: project.id,
      selectedIds: [doc.id],
      userId: owner.id,
    })

    assert.include(result.content, 'markdown-export-manifest')
    assert.include(result.content, '---')
    assert.include(result.content, doc.name)
    assert.equal(result.filename, 'project-documents.md')
  })

  test('空选中拒绝', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await assert.rejects(() =>
      service.exportTree({
        organizationId: org.id,
        projectId: project.id,
        selectedIds: [],
        userId: owner.id,
      }),
    )
  })
})

test.group('MarkdownImportExportService — audit & performance', (group) => {
  useAuthDatabase(group)

  test('preview 审计为低敏（无正文/无文件名）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: '# 机密正文 123',
      originalFilename: 'secret-notes.md',
      userId: owner.id,
    })

    const { default: AuditLog } = await import('#models/audit_log')
    const logs = await AuditLog.query().where('action', 'read').limit(50)
    const entry = logs.find((l) => {
      const metadata = (l.metadata ?? {}) as Record<string, unknown>
      return metadata.event === 'MARKDOWN_IMPORT_PREVIEW'
    })
    assert.isNotNull(entry)
    const metadata = (entry!.metadata ?? {}) as Record<string, unknown>
    const serialized = JSON.stringify(metadata)
    assert.isFalse(serialized.includes('机密正文'))
    assert.isFalse(serialized.includes('secret-notes'))
    assert.exists(metadata.previewHash)
    assert.exists(metadata.byteCount)
  })

  test('大 Markdown fixture 预览与树导出在预算内', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const large = buildLargeMarkdownFixture()
    assert.isAtMost(Buffer.byteLength(large, 'utf8'), 100_000)

    const doc = await createDocument(project.id)
    doc.content = large
    await doc.save()

    const startPreview = Date.now()
    const preview = await service.previewImport({
      organizationId: org.id,
      projectId: project.id,
      mode: 'create',
      content: large,
      userId: owner.id,
    })
    assert.isAtMost(Date.now() - startPreview, 2000)
    assert.isNotNull(preview.previewHash)

    const startTree = Date.now()
    const tree = await service.exportTree({
      organizationId: org.id,
      projectId: project.id,
      selectedIds: [doc.id],
      userId: owner.id,
    })
    assert.isAtMost(Date.now() - startTree, 2000)
    assert.equal(tree.manifest.exportedCount, 1)
  })

  test('导出审计不含导出载荷', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const doc = await createDocument(project.id, { name: '审计文档' })

    await service.exportSingle({
      organizationId: org.id,
      projectId: project.id,
      documentId: doc.id,
      userId: owner.id,
    })

    const { default: AuditLog } = await import('#models/audit_log')
    const logs = await AuditLog.query().where('action', 'export').limit(50)
    const entry = logs.find((l) => {
      const metadata = (l.metadata ?? {}) as Record<string, unknown>
      return metadata.event === 'MARKDOWN_EXPORT'
    })
    assert.isNotNull(entry)
    const metadata = (entry!.metadata ?? {}) as Record<string, unknown>
    const serialized = JSON.stringify(metadata)
    assert.isFalse(serialized.includes('# 项目计划'))
    assert.isFalse(serialized.includes('审计文档'))
    assert.exists(metadata.contentHash)
  })
})
