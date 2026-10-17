/**
 * v3-multitenant-database-isolation §6 —— 批量、派生制品与生命周期覆盖测试。
 *
 * 对应 spec：
 * -「Batch database operations MUST reject mixed-tenant inputs」→ §6.1 / §6.3
 * -「Database-derived artifacts MUST include tenant namespace」→ §6.2 / §6.3
 * -「Same-tenant partial success excludes cross-tenant leakage」→ §6.4
 * -「Restore preserves tenant ownership」→ §6.5
 *
 * 全程本地 SQLite fixture，无外部依赖。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import Attachment from '#models/attachment'
import Project from '#models/project'
import DatabaseTenantBoundary from '#services/database_tenant_boundary'
import FileBatchService from '#services/file_v2/file_batch_service'
import TrashService from '#services/file_v2/trash_service'
import TenantNamespaceService from '#services/tenant_namespace_service'
import { DateTime } from 'luxon'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from '../auth/_helpers.js'

interface Fixture {
  organizationId: number
  ownerId: number
  project: Project
  attachment: Attachment
}

test.group('批量与派生制品跨租户覆盖（§6）', (group) => {
  useAuthDatabase(group)

  let boundary: DatabaseTenantBoundary
  let orgA: Fixture
  let orgB: Fixture

  async function seed(prefix: string): Promise<Fixture> {
    const owner = await createUser({ email: uniqueEmail(prefix) })
    const organization = await createOrganization(owner)
    const organizationId = Number(organization.id)
    const project = await Project.create({
      organizationId,
      name: '批量-同名项目',
      code: `${prefix.toUpperCase()}${Date.now()}`,
      createdBy: owner.id,
    })
    const attachment = await Attachment.create({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      fileName: '批量-同名附件.pdf',
      filePath: `uploads/${prefix}/batch.pdf`,
      fileSize: 256,
      mimeType: 'application/pdf',
      storageProvider: 'local',
      currentVersion: 1,
      uploadedBy: owner.id,
    })
    return { organizationId, ownerId: Number(owner.id), project, attachment }
  }

  group.each.setup(async () => {
    boundary = new DatabaseTenantBoundary()
    orgA = await seed('bata')
    orgB = await seed('batb')
  })

  // ── §6.1 批量混租整体拒绝 ───────────────────────────────────────────────────

  test('§6.1 批量删除：混租 ID 在任何行变更之前整体拒绝', async ({ assert }) => {
    const batchService = await app.container.make(FileBatchService)

    let rejected: unknown
    try {
      await batchService.batchDelete(
        [
          { fileType: 'attachment', fileId: Number(orgA.attachment.id) },
          { fileType: 'attachment', fileId: Number(orgB.attachment.id) },
        ],
        Number(orgA.project.id),
        orgA.ownerId,
        orgA.organizationId,
      )
    } catch (error) {
      rejected = error
    }

    assert.isDefined(rejected, '混租批量必须整体拒绝')
    assert.equal((rejected as { code?: string }).code, 'RESOURCE_NOT_FOUND')
    // 错误消息不得点名任何 ID / 类型（spec：不得指明哪个 ID 属于他租）
    assert.notInclude((rejected as Error).message, String(orgB.attachment.id))
    assert.notInclude((rejected as Error).message, 'attachment')

    // 本组织的行也不得被改动（原子性）
    const untouchedA = await Attachment.findOrFail(orgA.attachment.id)
    const untouchedB = await Attachment.findOrFail(orgB.attachment.id)
    assert.isNull(untouchedA.deletedAt)
    assert.isNull(untouchedB.deletedAt)
  })

  test('§6.1 批量删除：他租 projectId 整体拒绝（组织层不再只靠 Policy）', async ({ assert }) => {
    const batchService = await app.container.make(FileBatchService)
    let rejected: unknown
    try {
      await batchService.batchDelete(
        [{ fileType: 'attachment', fileId: Number(orgB.attachment.id) }],
        Number(orgB.project.id),
        orgA.ownerId,
        orgA.organizationId,
      )
    } catch (error) {
      rejected = error
    }
    assert.isDefined(rejected)
    const untouched = await Attachment.findOrFail(orgB.attachment.id)
    assert.isNull(untouched.deletedAt)
  })

  test('§6.4 同租批量：业务校验错误可部分成功，且不暴露他租信息', async ({ assert }) => {
    const batchService = await app.container.make(FileBatchService)
    // 两个同租 ID：一个存在、一个不存在 → 整批拒绝（不存在与跨租同形）
    let rejected: unknown
    try {
      await batchService.batchDelete(
        [
          { fileType: 'attachment', fileId: Number(orgA.attachment.id) },
          { fileType: 'attachment', fileId: 99999999 },
        ],
        Number(orgA.project.id),
        orgA.ownerId,
        orgA.organizationId,
      )
    } catch (error) {
      rejected = error
    }
    assert.isDefined(rejected)
    assert.equal((rejected as { code?: string }).code, 'RESOURCE_NOT_FOUND')

    // 纯同租且全部存在 → 正常成功（partial success 通道仍可用于业务校验错误）
    const ok = await batchService.batchDelete(
      [{ fileType: 'attachment', fileId: Number(orgA.attachment.id) }],
      Number(orgA.project.id),
      orgA.ownerId,
      orgA.organizationId,
    )
    assert.lengthOf(ok.success, 1)
    assert.lengthOf(ok.failed, 0)
  })

  // ── §6.2 / §6.3 派生制品重放 ────────────────────────────────────────────────

  test('§6.3 导出句柄：O1 的句柄在 O2 下校验失败', async ({ assert }) => {
    const namespaceService = await app.container.make(TenantNamespaceService)
    const scopeA = { organizationId: orgA.organizationId, projectId: null }
    const scopeB = { organizationId: orgB.organizationId, projectId: null }

    const handle = namespaceService.buildExportHandle({
      scope: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      resourceType: 'report',
      sourceHash: 'shared-source-hash',
      expiresAt: DateTime.now().plus({ minutes: 10 }).toISO()!,
    })

    assert.doesNotThrow(() => namespaceService.assertExportHandle(scopeA, handle))
    // O1 的导出句柄在 O2 下必须校验失败
    assert.throws(() => namespaceService.assertExportHandle(scopeB, handle), /导出句柄已失效/)
  })

  test('§6.3 缓存聚合摘要：同内容跨组织不可复用', async ({ assert }) => {
    const hashA = await boundary.hashInTenant('attachments', {
      organizationId: orgA.organizationId,
      columns: ['file_name'],
    })
    const hashB = await boundary.hashInTenant('attachments', {
      organizationId: orgB.organizationId,
      columns: ['file_name'],
    })
    assert.notEqual(hashA, hashB)
  })

  // ── §6.5 软删除恢复 ─────────────────────────────────────────────────────────

  test('§6.5 恢复：他租软删附件不可恢复，且恢复前重新校验归属', async ({ assert }) => {
    const trashService = await app.container.make(TrashService)

    // orgB 自己把附件放进回收站
    await trashService.trash(
      Number(orgB.attachment.id),
      Number(orgB.project.id),
      orgB.ownerId,
      orgB.organizationId,
      '自有删除',
    )
    const trashed = await Attachment.findOrFail(orgB.attachment.id)
    assert.isNotNull(trashed.deletedAt)

    // orgA 用 orgB 的 project/attachment ID 尝试恢复 → 404，且行未被恢复
    let rejected: unknown
    try {
      await trashService.restore(
        Number(orgB.attachment.id),
        Number(orgB.project.id),
        orgA.ownerId,
        orgA.organizationId,
      )
    } catch (error) {
      rejected = error
    }
    assert.isDefined(rejected)
    assert.equal((rejected as { code?: string }).code, 'RESOURCE_NOT_FOUND')
    const stillTrashed = await Attachment.findOrFail(orgB.attachment.id)
    assert.isNotNull(stillTrashed.deletedAt, '他租恢复不得生效')

    // 归属组织自己恢复 → 成功
    const restored = await trashService.restore(
      Number(orgB.attachment.id),
      Number(orgB.project.id),
      orgB.ownerId,
      orgB.organizationId,
    )
    assert.isNull(restored.deletedAt)
  })

  test('§6.5 回收站列表：meta.total 在组织 scope 之后计算', async ({ assert }) => {
    const trashService = await app.container.make(TrashService)
    await trashService.trash(
      Number(orgA.attachment.id),
      Number(orgA.project.id),
      orgA.ownerId,
      orgA.organizationId,
    )
    await trashService.trash(
      Number(orgB.attachment.id),
      Number(orgB.project.id),
      orgB.ownerId,
      orgB.organizationId,
    )

    const listA = await trashService.listTrash(Number(orgA.project.id), orgA.organizationId)
    assert.equal(listA.meta.total, 1)

    // 他租 projectId + 本组织 scope → 空（不泄露他租回收站计数）
    const listCross = await trashService.listTrash(Number(orgB.project.id), orgA.organizationId)
    assert.equal(listCross.meta.total, 0)
  })

  test('§6.5 清空回收站：他租项目不受影响', async ({ assert }) => {
    const trashService = await app.container.make(TrashService)
    await trashService.trash(
      Number(orgB.attachment.id),
      Number(orgB.project.id),
      orgB.ownerId,
      orgB.organizationId,
    )

    // orgA 拿 orgB 的 projectId 清空 → 0 删除，orgB 的软删行仍在
    const result = await trashService.emptyTrash(
      Number(orgB.project.id),
      orgA.ownerId,
      orgA.organizationId,
    )
    assert.equal(result.deletedCount, 0)
    const survivor = await Attachment.query().where('id', orgB.attachment.id).first()
    assert.isNotNull(survivor)
  })
})
