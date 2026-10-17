/**
 * DocumentSearchAdapter 集成测试（v3-document-full-text-search §6.8）
 *
 * 覆盖：
 * - 关键字搜索匹配
 * - 空关键字返回全部（结构化筛选场景）
 * - 组织隔离
 * - 项目过滤
 * - 日期范围过滤
 * - 摘要提取（低敏 DTO）
 * - suggest 功能
 *
 * 先创建外键链：organization → user → project → document → document_search_entry。
 * 用 db.insertQuery() 直接写库，避免 ORM 关系查找。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import DocumentSearchAdapter from '#services/search/adapters/document_search_adapter'

const ORG_ID = 800
const PROJECT_ID_A = 801
const PROJECT_ID_B = 802
const USER_ID = 1

/**
 * 创建测试组织（幂等）。
 */
async function ensureOrg(orgId: number): Promise<void> {
  const existing = await db.from('organizations').where('id', orgId).first()
  if (existing) return
  await ensureUser(USER_ID)
  await db
    .insertQuery()
    .table('organizations')
    .insert({
      id: orgId,
      owner_id: USER_ID,
      name: `测试组织 ${orgId}`,
      slug: `test-org-${orgId}`,
      plan_tier: 'free',
      created_at: DateTime.now().toISO(),
      updated_at: DateTime.now().toISO(),
    })
}

/**
 * 创建测试用户（幂等）。
 */
async function ensureUser(userId: number): Promise<void> {
  const existing = await db.from('users').where('id', userId).first()
  if (existing) return
  await db
    .insertQuery()
    .table('users')
    .insert({
      id: userId,
      full_name: '测试用户',
      email: `test-user-${userId}@test.local`,
      password: 'hashed',
      auth_provider: 'local',
      is_active: true,
      is_super_admin: false,
      role_version: 0,
      created_at: DateTime.now().toISO(),
      updated_at: DateTime.now().toISO(),
    })
}

/**
 * 创建测试项目（幂等）。
 */
async function ensureProject(projectId: number, orgId: number): Promise<void> {
  const existing = await db.from('projects').where('id', projectId).first()
  if (existing) return
  await ensureUser(USER_ID)
  await ensureOrg(orgId)
  await db
    .insertQuery()
    .table('projects')
    .insert({
      id: projectId,
      organization_id: orgId,
      name: `测试项目 ${projectId}`,
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

/**
 * 创建测试文档行并返回 documentId。
 */
async function createDocument(projectId: number, title: string): Promise<number> {
  await ensureProject(projectId, ORG_ID)
  const result = await db.insertQuery().table('documents').insert({
    project_id: projectId,
    name: title,
    document_type: 'document',
    content: '正文内容',
    created_by: USER_ID,
    created_at: DateTime.now().toISO(),
    updated_at: DateTime.now().toISO(),
  })
  return Number(result)
}

/**
 * 创建搜索索引条目（含前置依赖：organization → user → project → document）。
 */
async function insertEntry(overrides: Record<string, unknown> = {}): Promise<number> {
  const now = DateTime.now()
  const projectId = (overrides.projectId as number) ?? PROJECT_ID_A
  const title = (overrides.title as string) ?? '项目章程'

  const documentId = await createDocument(projectId, title)

  const id = await db
    .insertQuery()
    .table('document_search_entries')
    .insert({
      organization_id: (overrides.organizationId as number) ?? ORG_ID,
      project_id: projectId,
      document_id: documentId,
      title,
      content_hash: (overrides.contentHash as string) ?? 'hash-001',
      content_text: (overrides.contentText as string) ?? '这是项目章程的正文内容，包含需求分析',
      content_length: ((overrides.contentText as string) ?? '这是项目章程的正文内容，包含需求分析')
        .length,
      truncated: false,
      version: 1,
      lifecycle: (overrides.lifecycle as string) ?? 'active',
      indexed_at: now.toISO(),
      deleted_at: (overrides.deletedAt as string | null) ?? null,
      created_at: now.toISO(),
      updated_at: (overrides.updatedAt as string) ?? now.toISO(),
    })
  return Number(id)
}

test.group('DocumentSearchAdapter — 集成测试', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await db.from('document_search_entries').del()
  })

  // ── §6.8: 关键字搜索匹配 ─────────────────────────────────────────────────

  test('关键字匹配标题', async ({ assert }) => {
    await insertEntry({
      title: '甘特图功能需求文档',
      contentText: '本文档描述甘特图的需求',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '甘特图', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.isAtLeast(result.items.length, 1)
    assert.include(result.items[0].title, '甘特图')
  })

  test('关键字匹配正文', async ({ assert }) => {
    await insertEntry({
      title: '需求分析',
      contentText: 'WBS分解结构详细说明',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: 'WBS分解', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.isAtLeast(result.items.length, 1)
  })

  test('中文关键字匹配', async ({ assert }) => {
    await insertEntry({
      title: '测试文档',
      contentText: '项目管理风险管理资源分配风险控制',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '风险管理', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.isAtLeast(result.items.length, 1)
  })

  test('不存在的关键字返回空结果', async ({ assert }) => {
    await insertEntry({
      title: '测试文档',
      contentText: '一些正文内容',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '不存在的关键词', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.lengthOf(result.items, 0)
  })

  // ── §6.8: 空关键字返回全部 ──────────────────────────────────────────────

  test('空关键字返回全部活跃索引', async ({ assert }) => {
    await insertEntry({ title: '文档A', contentText: '内容A' })
    await insertEntry({ title: '文档B', contentText: '内容B' })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.isAtLeast(result.items.length, 2)
  })

  // ── §6.8: 组织隔离 ─────────────────────────────────────────────────────

  test('跨组织不返回搜索结果', async ({ assert }) => {
    await insertEntry({
      title: '跨组织测试',
      contentText: '仅组织A可见',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '跨组织测试', entityTypes: ['document'] },
      { organizationId: 9999, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.lengthOf(result.items, 0, '跨组织不应返回结果')
  })

  // ── §6.8: 项目过滤 ─────────────────────────────────────────────────────

  test('query.projectIds 过滤正确', async ({ assert }) => {
    await insertEntry({
      projectId: PROJECT_ID_A,
      title: '项目A文档',
      contentText: '仅项目A',
    })
    await insertEntry({
      projectId: PROJECT_ID_B,
      title: '项目B文档',
      contentText: '仅项目B',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '项目', entityTypes: ['document'], projectIds: [PROJECT_ID_A] },
      { organizationId: ORG_ID, userId: 1 },
    )

    for (const item of result.items) {
      assert.equal(item.projectId, PROJECT_ID_A, '应只返回项目A的文档')
    }
  })

  test('ctx.projectIds 默认过滤', async ({ assert }) => {
    await insertEntry({
      projectId: PROJECT_ID_A,
      title: '项目A文档',
    })
    await insertEntry({
      projectId: PROJECT_ID_B,
      title: '项目B文档',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '项目', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    for (const item of result.items) {
      assert.equal(item.projectId, PROJECT_ID_A, '应只返回 ctx.projectIds 限定的项目')
    }
  })

  // ── §6.8: 日期过滤 ─────────────────────────────────────────────────────

  test('dateFrom 过滤早于起始日期的文档', async ({ assert }) => {
    const oldDate = DateTime.now().minus({ days: 10 }).toISO()!
    await insertEntry({
      title: '旧文档',
      contentText: '旧内容',
      updatedAt: oldDate,
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      {
        keyword: '旧文档',
        entityTypes: ['document'],
        dateFrom: DateTime.now().minus({ days: 5 }).toISO()!,
      },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.lengthOf(result.items, 0, 'dateFrom 应排除旧文档')
  })

  test('dateTo 过滤晚于截止日期的文档', async ({ assert }) => {
    const now = DateTime.now().toISO()!
    await insertEntry({
      title: '新文档',
      contentText: '新内容',
      updatedAt: now,
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      {
        keyword: '新文档',
        entityTypes: ['document'],
        dateTo: DateTime.now().minus({ days: 1 }).toISO()!,
      },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.lengthOf(result.items, 0, 'dateTo 应排除新文档')
  })

  // ── §6.8: 摘要提取（低敏 DTO） ─────────────────────────────────────────

  test('搜索结果摘要长度有界', async ({ assert }) => {
    await insertEntry({
      title: '长文文档',
      contentText: 'A'.repeat(500),
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '长文', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.isAtLeast(result.items.length, 1)
    const item = result.items[0]
    assert.isTrue(
      (item.summary?.length ?? 0) <= 150,
      `摘要长度 ${item.summary?.length} 超出 150 上限`,
    )
  })

  // ── §6.8: matchedFields ──────────────────────────────────────────────────

  test('匹配标题时 matchedFields 含 title', async ({ assert }) => {
    await insertEntry({
      title: '唯一标题ABC',
      contentText: '正文内容',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: '唯一标题', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.isAtLeast(result.items.length, 1)
    assert.include(result.items[0].matchedFields, 'title')
  })

  test('匹配正文时 matchedFields 含 content', async ({ assert }) => {
    await insertEntry({
      title: '普通标题',
      contentText: '仅在正文中出现的唯一关键词CONFIRM',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.search(
      { keyword: 'CONFIRM', entityTypes: ['document'] },
      { organizationId: ORG_ID, userId: 1, projectIds: [PROJECT_ID_A] },
    )

    assert.isAtLeast(result.items.length, 1)
    assert.include(result.items[0].matchedFields, 'content')
  })

  // ── §6.8: suggest ────────────────────────────────────────────────────────

  test('suggest 按标题前缀匹配', async ({ assert }) => {
    await insertEntry({
      title: '项目需求文档',
      contentText: '需求分析',
    })
    await insertEntry({
      title: '项目计划书',
      contentText: '计划',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.suggest('项目', 5, {
      organizationId: ORG_ID,
      userId: 1,
      projectIds: [PROJECT_ID_A],
    })

    assert.isAtLeast(result.items.length, 1)
    for (const item of result.items) {
      assert.include(item.title, '项目')
    }
  })

  test('suggest 不匹配不存在的标题', async ({ assert }) => {
    await insertEntry({
      title: '文档标题',
      contentText: '内容',
    })

    const adapter = new DocumentSearchAdapter()
    const result = await adapter.suggest('不存在的标题', 5, {
      organizationId: ORG_ID,
      userId: 1,
      projectIds: [PROJECT_ID_A],
    })

    assert.lengthOf(result.items, 0)
  })
})
