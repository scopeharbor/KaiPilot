/**
 * 文档搜索索引硬化与红线测试（v3-document-full-text-search §11.1~11.6）
 *
 * 覆盖：
 * - 组织隔离：跨组织查询不返回数据
 * - 低敏 DTO：搜索结果不返回完整正文
 * - 有界摘要：summary 长度不超过 150 字符
 * - 无效输入处理：空关键字、超大页码、特殊字符
 * - orphaned 条目不被搜索
 * - 红线：索引不修改源数据
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Document from '#models/document'
import DocumentSearchAdapter from '#services/search/adapters/document_search_adapter'
import DocumentSearchIndexService from '#services/document_search_index_service'
import AuditService from '#services/audit_service'

const ORG_ID = 700
const PROJECT_ID = 701
const USER_ID = 3

async function ensureAll(): Promise<void> {
  const existing = await db.from('users').where('id', USER_ID).first()
  if (!existing) {
    await db
      .insertQuery()
      .table('users')
      .insert({
        id: USER_ID,
        full_name: '测试用户',
        email: `test-user-${USER_ID}@harden-test.local`,
        password: 'hashed',
        auth_provider: 'local',
        is_active: true,
        is_super_admin: false,
        role_version: 0,
        created_at: DateTime.now().toISO(),
        updated_at: DateTime.now().toISO(),
      })
  }
  const orgExists = await db.from('organizations').where('id', ORG_ID).first()
  if (!orgExists) {
    await db
      .insertQuery()
      .table('organizations')
      .insert({
        id: ORG_ID,
        owner_id: USER_ID,
        name: '硬化测试组织',
        slug: `harden-org-${ORG_ID}`,
        plan_tier: 'free',
        max_projects: 10,
        max_members: 20,
        created_at: DateTime.now().toISO(),
        updated_at: DateTime.now().toISO(),
      })
  }
  const projExists = await db.from('projects').where('id', PROJECT_ID).first()
  if (!projExists) {
    await db.insertQuery().table('projects').insert({
      id: PROJECT_ID,
      organization_id: ORG_ID,
      name: '硬化测试项目',
      status: 'active',
      priority: 'medium',
      currency: 'CNY',
      progress_percent: 0,
      health_status: 'unknown',
      created_by: USER_ID,
      created_at: DateTime.now().toISO(),
      updated_at: DateTime.now().toISO(),
    })
  }
}

async function insertEntry(overrides: Record<string, unknown> = {}): Promise<number> {
  await ensureAll()
  const now = DateTime.now()
  const projectId = (overrides.projectId as number) ?? PROJECT_ID

  // 创建文档（FK 约束）
  const docId = await db
    .insertQuery()
    .table('documents')
    .insert({
      project_id: projectId,
      name: (overrides.title as string) ?? '硬化测试文档',
      document_type: 'document',
      content: (overrides.contentText as string) ?? '硬化测试正文',
      created_by: USER_ID,
      created_at: now.toISO(),
      updated_at: now.toISO(),
    })

  const id = await db
    .insertQuery()
    .table('document_search_entries')
    .insert({
      organization_id: (overrides.organizationId as number) ?? ORG_ID,
      project_id: projectId,
      document_id: Number(docId),
      title: (overrides.title as string) ?? '硬化测试文档',
      content_hash: (overrides.contentHash as string) ?? 'hash-harden-001',
      content_text: (overrides.contentText as string) ?? '硬化测试正文内容',
      content_length: ((overrides.contentText as string) ?? '硬化测试正文内容').length,
      truncated: false,
      version: 1,
      lifecycle: (overrides.lifecycle as string) ?? 'active',
      indexed_at: now.toISO(),
      deleted_at: (overrides.deletedAt as string | null) ?? null,
      created_at: now.toISO(),
      updated_at: now.toISO(),
    })
  return Number(id)
}

function makeAuditService(): AuditService {
  return new AuditService()
}
function makeIndexService(): DocumentSearchIndexService {
  return new DocumentSearchIndexService(makeAuditService())
}

test.group('Document search hardening — 组织隔离', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await db.from('document_search_entries').del()
    await db.from('documents').del()
  })

  test('跨组织查询不返回数据', async ({ assert }) => {
    await insertEntry({
      title: '组织A文档',
      contentText: '仅组织A可见',
    })

    const adapter = new DocumentSearchAdapter()
    // 查询不同组织
    const result = await adapter.search(
      { keyword: '组织A', entityTypes: ['document'] },
      { organizationId: 9999, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.lengthOf(result.items, 0, '跨组织不应返回结果')
  })

  test('orphaned 条目不被搜索', async ({ assert }) => {
    await insertEntry({
      title: '已删除文档',
      contentText: '不应被搜索到',
      lifecycle: 'orphaned',
      deletedAt: DateTime.now().toISO(),
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '已删除', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.lengthOf(result.items, 0, 'orphaned 条目不应被搜索')
  })
})

test.group('Document search hardening — 低敏 DTO', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await db.from('document_search_entries').del()
    await db.from('documents').del()
  })

  test('搜索结果不返回完整正文', async ({ assert }) => {
    await insertEntry({
      title: '敏感文档',
      contentText: '这是完整正文内容，包含敏感信息，不应在搜索结果中完整返回',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '敏感文档', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.isAtLeast(result.items.length, 1)
    const item = result.items[0]
    // 摘要不应包含「完整正文内容」这个完整短语
    const summary = item.summary ?? ''
    assert.isTrue(summary.length <= 150, '摘要长度不应超过 150')
    // summary 不包含 metadata 中的敏感字段
    assert.isFalse(summary.includes('完整正文内容'), '摘要不应包含完整正文')
  })

  test('搜索结果摘要长度有界', async ({ assert }) => {
    await insertEntry({
      title: '长文文档',
      contentText: 'B'.repeat(1000),
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '长文', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.isAtLeast(result.items.length, 1)
    const item = result.items[0]
    assert.isTrue(
      (item.summary?.length ?? 0) <= 150,
      `摘要长度 ${item.summary?.length} 超出 150 上限`,
    )
  })
})

test.group('Document search hardening — 输入处理', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await db.from('document_search_entries').del()
    await db.from('documents').del()
  })

  test('空关键字返回全部结果（结构化筛选）', async ({ assert }) => {
    await insertEntry({ title: '文档A', contentText: '内容A' })
    await insertEntry({ title: '文档B', contentText: '内容B' })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.isAtLeast(result.items.length, 2, '空关键字应返回全部结果')
  })

  test('空字符串关键字视为无关键字', async ({ assert }) => {
    await insertEntry({ title: '文档A', contentText: '内容A' })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '   ', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.isAtLeast(result.items.length, 1, '空白关键字应返回全部结果')
  })

  test('分页参数 page 兜底处理', async ({ assert }) => {
    await insertEntry({ title: '文档A', contentText: '内容A' })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '文档', entityTypes: ['document'], page: 1, perPage: 1 },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.isAtLeast(result.items.length, 1)
  })

  test('超大页码不崩溃', async ({ assert }) => {
    await insertEntry({ title: '文档A', contentText: '内容A' })

    const adapter = new DocumentSearchAdapter()
    // 页码 999 不应抛出异常
    const result = await adapter.search(
      { keyword: '文档', entityTypes: ['document'], page: 999, perPage: 100 },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.lengthOf(result.items, 0, '超大页码应返回空')
  })

  test('特殊字符关键字不崩溃', async ({ assert }) => {
    await insertEntry({ title: '普通文档', contentText: '普通内容' })

    const adapter = new DocumentSearchAdapter()
    // SQL LIKE 特殊字符不应抛出异常
    const result = await adapter.search(
      { keyword: '%_%测试', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID] },
    )

    assert.isDefined(result, '特殊字符不应导致崩溃')
    assert.isArray(result.items)
  })
})

test.group('Document search hardening — 红线：索引不修改源数据', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await db.from('document_search_entries').del()
    await db.from('documents').del()
  })

  test('索引操作不修改 documents 表', async ({ assert }) => {
    await ensureAll()

    const docId = await db.insertQuery().table('documents').insert({
      project_id: PROJECT_ID,
      name: '红线测试文档',
      document_type: 'document',
      content: '红线测试正文',
      created_by: USER_ID,
      created_at: DateTime.now().toISO(),
      updated_at: DateTime.now().toISO(),
    })

    const docBefore = await db.from('documents').where('id', Number(docId)).first()
    assert.isNotNull(docBefore)

    const indexEntryId = await db
      .insertQuery()
      .table('document_search_entries')
      .insert({
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        document_id: Number(docId),
        title: '红线测试文档',
        content_hash: 'hash-redline',
        content_text: '红线测试正文',
        content_length: 6,
        truncated: false,
        version: 1,
        lifecycle: 'active',
        indexed_at: DateTime.now().toISO(),
        created_at: DateTime.now().toISO(),
        updated_at: DateTime.now().toISO(),
      })

    // 验证 documents 表未被修改
    const docAfter = await db.from('documents').where('id', Number(docId)).first()
    assert.equal(docAfter!.name, '红线测试文档')
    assert.equal(docAfter!.content, '红线测试正文')

    // 删除索引条目
    await db.from('document_search_entries').where('id', Number(indexEntryId)).del()

    // 验证源文档未被级联删除（document_search_entries 的 FK 是 ON DELETE CASCADE）
    // 这里实际上 FK 是 CASCADE，所以删除 search_entry 不会影响 document
    // 但删除 document 会级联删除 search_entry
    const docAfterDelete = await db.from('documents').where('id', Number(docId)).first()
    assert.isNotNull(docAfterDelete, '删除索引条目不应影响源文档')
  })

  test('DocumentSearchIndexService 不修改源文档内容', async ({ assert }) => {
    await ensureAll()

    const doc = await Document.create({
      projectId: PROJECT_ID,
      name: '不可变测试',
      documentType: 'document',
      content: '原始不可变内容',
      createdBy: USER_ID,
    })

    const svc = makeIndexService()
    await svc.upsertForDocument(doc.id, USER_ID)

    // 验证源文档未被修改
    const docReload = await Document.find(doc.id)
    assert.isNotNull(docReload)
    assert.equal(docReload!.name, '不可变测试')
    assert.equal(docReload!.content, '原始不可变内容')
  })
})
