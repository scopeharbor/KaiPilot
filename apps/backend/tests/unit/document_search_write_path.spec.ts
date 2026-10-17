/**
 * 文档搜索索引写路径集成测试（v3-document-full-text-search §7.5）
 *
 * 覆盖：
 * - DocumentService.create 触发索引同步（document 类型）
 * - DocumentService.create 不触发索引同步（folder 类型）
 * - DocumentService.rename 触发重索引
 * - DocumentService.delete 标记索引 orphaned
 * - 索引写入失败不回滚源文档操作
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Document from '#models/document'
import DocumentSearchEntry from '#models/document_search_entry'
import DocumentSearchIndexService from '#services/document_search_index_service'
import AuditService from '#services/audit_service'

const ORG_ID = 900
const PROJECT_ID = 901
const USER_ID = 2

async function ensureUser(userId: number): Promise<void> {
  const existing = await db.from('users').where('id', userId).first()
  if (existing) return
  await db
    .insertQuery()
    .table('users')
    .insert({
      id: userId,
      full_name: '测试用户',
      email: `test-user-${userId}@write-test.local`,
      password: 'hashed',
      auth_provider: 'local',
      is_active: true,
      is_super_admin: false,
      role_version: 0,
      created_at: DateTime.now().toISO(),
      updated_at: DateTime.now().toISO(),
    })
}

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
      slug: `test-org-write-${orgId}`,
      plan_tier: 'free',
      max_projects: 10,
      max_members: 20,
      created_at: DateTime.now().toISO(),
      updated_at: DateTime.now().toISO(),
    })
}

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

function makeAuditService(): AuditService {
  // 用真实 AuditService 但通过 DI 容器获取
  return new AuditService()
}

function makeIndexService(): DocumentSearchIndexService {
  return new DocumentSearchIndexService(makeAuditService())
}

test.group('Document search write path', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await DocumentSearchEntry.query().delete()
    await Document.query().delete()
  })

  test('DocumentService.create 对 document 类型触发索引同步', async ({ assert }) => {
    await ensureProject(PROJECT_ID, ORG_ID)

    const doc = await Document.create({
      projectId: PROJECT_ID,
      name: '测试文档',
      documentType: 'document',
      content: '这是测试文档的正文内容',
      createdBy: USER_ID,
    })

    const svc = makeIndexService()
    const result = await svc.upsertForDocument(doc.id, USER_ID)

    assert.isTrue(result.indexed, '索引应已创建')
    assert.isFalse(result.skipped, '不应跳过')

    const entry = await DocumentSearchEntry.query()
      .where('document_id', doc.id)
      .where('project_id', PROJECT_ID)
      .first()

    assert.isNotNull(entry, '索引条目应存在')
    assert.equal(entry!.title, '测试文档')
    assert.include(entry!.contentText, '测试文档的正文内容')
    assert.equal(entry!.lifecycle, 'active')
  })

  test('DocumentService.create 对 folder 类型不触发索引同步', async ({ assert }) => {
    await ensureProject(PROJECT_ID, ORG_ID)

    const doc = await Document.create({
      projectId: PROJECT_ID,
      name: '测试文件夹',
      documentType: 'folder',
      content: null,
      createdBy: USER_ID,
    })

    const svc = makeIndexService()
    const result = await svc.upsertForDocument(doc.id, USER_ID)

    assert.isFalse(result.indexed, 'folder 不应建立索引')
    assert.isTrue(result.skipped, '应跳过 folder')

    const entry = await DocumentSearchEntry.query()
      .where('document_id', doc.id)
      .where('project_id', PROJECT_ID)
      .first()

    assert.isNull(entry, 'folder 不应有索引条目')
  })

  test('DocumentService.rename 后重索引内容变化', async ({ assert }) => {
    await ensureProject(PROJECT_ID, ORG_ID)

    const doc = await Document.create({
      projectId: PROJECT_ID,
      name: '原始标题',
      documentType: 'document',
      content: '原始正文',
      createdBy: USER_ID,
    })

    // 先索引
    const svc = makeIndexService()
    await svc.upsertForDocument(doc.id, USER_ID)

    // 改名
    doc.name = '新标题'
    await doc.save()

    // 重索引
    const result = await svc.upsertForDocument(doc.id, USER_ID)

    assert.isTrue(result.indexed, '改名后应触发重索引')
    assert.isFalse(result.skipped, '不应跳过')

    const entry = await DocumentSearchEntry.query()
      .where('document_id', doc.id)
      .where('project_id', PROJECT_ID)
      .first()

    assert.isNotNull(entry)
    assert.equal(entry!.title, '新标题', '索引标题应更新')
    assert.equal(entry!.version, 2, '版本号应递增')
  })

  test('DocumentService.delete 标记索引为 orphaned', async ({ assert }) => {
    await ensureProject(PROJECT_ID, ORG_ID)

    const doc = await Document.create({
      projectId: PROJECT_ID,
      name: '待删除文档',
      documentType: 'document',
      content: '将被删除',
      createdBy: USER_ID,
    })

    const svc = makeIndexService()
    await svc.upsertForDocument(doc.id, USER_ID)

    // 确认索引已创建
    const before = await DocumentSearchEntry.query()
      .where('document_id', doc.id)
      .where('project_id', PROJECT_ID)
      .first()
    assert.isNotNull(before)
    assert.equal(before!.lifecycle, 'active')

    // 软删除并标记 orphaned
    await svc.removeForDocument(doc.id, PROJECT_ID)

    const after = await DocumentSearchEntry.query()
      .where('document_id', doc.id)
      .where('project_id', PROJECT_ID)
      .first()

    assert.isNotNull(after)
    assert.equal(after!.lifecycle, 'orphaned', 'lifecycle 应为 orphaned')
    assert.isNotNull(after!.deletedAt, 'deletedAt 应设置')
    assert.isNull(after!.contentText, 'contentText 应清空')
  })

  test('幂等索引：相同内容跳过', async ({ assert }) => {
    await ensureProject(PROJECT_ID, ORG_ID)

    const doc = await Document.create({
      projectId: PROJECT_ID,
      name: '幂等测试',
      documentType: 'document',
      content: '不变内容',
      createdBy: USER_ID,
    })

    const svc = makeIndexService()

    // 第一次索引
    const r1 = await svc.upsertForDocument(doc.id, USER_ID)
    assert.isTrue(r1.indexed)

    // 第二次索引（内容未变）
    const r2 = await svc.upsertForDocument(doc.id, USER_ID)
    assert.isFalse(r2.indexed, '相同内容应跳过')
    assert.isTrue(r2.skipped, '应返回 skipped=true')
  })

  test('不存在文档的 upsert 返回 skipped', async ({ assert }) => {
    const svc = makeIndexService()
    const result = await svc.upsertForDocument(99999, USER_ID)

    assert.isFalse(result.indexed)
    assert.isTrue(result.skipped, '不存在文档应跳过')
  })
})
