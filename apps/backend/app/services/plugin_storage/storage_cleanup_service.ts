/**
 * v3-plugin-scoped-storage —— StorageCleanupService（任务 3.3 / 3.4 / 3.5）。
 *
 * 清理（spec Requirement 6）：删除 namespace 数据必须先 preview（scope/条目数/字节数/
 * 保留状态/不可逆影响 + 一次性句柄绑定 namespace revision 与条目聚合 digest），经有权
 * 管理员显式 confirm 后由核心执行，并写可信审计（事务内、strict fail-closed）。
 * - 句柄一次性：confirm 成功即随 namespace 行删除；重复消费返回 already-consumed；
 * - 跨组织重放：handle 载荷携带 organizationId，confirm 时双重校验，两组织数据均不动；
 * - 内容陈旧：preview 后任何写入都会改变 entriesDigest/rowVersion → binding-mismatch。
 *
 * 导出（spec Requirement 7）：仅有权组织管理员可导出本组织指定插件/scope 的数据；
 * 版本化 `plugin-storage-export-v1` JSONL（manifest 首行 + 记录行）、分页有界、二次低敏
 * 扫描 fail-closed；临时文件写入系统临时目录并带到期清理；无匹配数据时不产生文件。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import AuditLog from '#models/audit_log'
import PluginStorageNamespace from '#models/plugin_storage_namespace'
import {
  PLUGIN_STORAGE_EXPORT_FORMAT,
  PLUGIN_STORAGE_LIMITS,
  buildStorageCleanupHandle,
  computeEntryContentDigest,
  computeStorageDigest,
  storageSecondaryScan,
  verifyStorageCleanupHandle,
  type PluginStorageCleanupPreview,
  type PluginStorageCleanupResult,
  type PluginStorageExportManifest,
  type PluginStorageExportRecord,
  type PluginStorageScope,
} from '@aiproj/types'

/** 导出临时根（与 file_storage 的 UPLOAD_ROOT 同源约定；组织级目录，不经项目路径）。 */
const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? 'storage/uploads'

/** 组织级导出临时目录：storage/uploads/organizations/<orgId>/plugin-storage-exports。 */
function storageExportDir(organizationId: number): string {
  return join(UPLOAD_ROOT, 'organizations', String(organizationId), 'plugin-storage-exports')
}

type Failure = {
  ok: false
  reasonCode:
    | 'storage-namespace-not-found'
    | 'storage-cross-tenant-denied'
    | 'storage-cleanup-handle-invalid'
    | 'storage-cleanup-handle-expired'
    | 'storage-cleanup-binding-mismatch'
    | 'storage-cleanup-already-consumed'
    | 'storage-cleanup-audit-failed'
    | 'storage-export-scan-failed'
  httpStatus: 400 | 401 | 403 | 404 | 409 | 413 | 500
}

function fail(reasonCode: Failure['reasonCode'], httpStatus: Failure['httpStatus']): Failure {
  return { ok: false, reasonCode, httpStatus }
}

/** 条目聚合 digest（key 有序拼接 key/revision/contentDigest）；清理绑定与导出摘要共用。 */
async function computeEntriesDigest(
  namespaceId: number,
  client?: TransactionClientContract,
): Promise<{ total: number; totalBytes: number; digest: string }> {
  const rows = await (client ?? db)
    .from('plugin_storage_entries')
    .where('namespace_id', namespaceId)
    .orderBy('key', 'asc')
    .select('key', 'revision', 'canonical_digest')
  const parts = rows.map((r) => `${r.key}:${r.revision}:${r.canonical_digest}`)
  // 字节数与条目数单独聚合（digest 行未含 byte_size）
  const agg = await (client ?? db)
    .from('plugin_storage_entries')
    .where('namespace_id', namespaceId)
    .sum({ bytes: 'byte_size' })
    .count({ total: '*' })
    .first()
  return {
    total: Number(agg?.total ?? 0),
    totalBytes: Number(agg?.bytes ?? 0),
    digest: computeStorageDigest(['entries', parts.join('|')]),
  }
}

/**
 * 可信审计写入器（可注入替身用于测试回滚路径）。
 * audit_logs.action 为封闭 CHECK 枚举：清理确认落 'delete'，导出落 'export'；
 * 语义事件名放 metadata.event（低敏）。
 */
export type StorageAuditWriter = (params: {
  organizationId: number
  projectId: number | null
  userId: number | null
  event: 'plugin_storage_cleanup_confirmed' | 'plugin_storage_exported'
  entityId: number
  metadata: Record<string, unknown>
  client: TransactionClientContract
}) => Promise<{ auditLogId: number }>

const defaultAuditWriter: StorageAuditWriter = async (params) => {
  const created = await AuditLog.create(
    {
      action: params.event === 'plugin_storage_cleanup_confirmed' ? 'delete' : 'export',
      severity: 'info',
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'plugin_storage',
      entityId: params.entityId,
      changes: null,
      metadata: { ...params.metadata, event: params.event } as Record<string, unknown>,
    },
    { client: params.client },
  )
  return { auditLogId: created.id }
}

export default class StorageCleanupService {
  constructor(private auditWriter: StorageAuditWriter = defaultAuditWriter) {}

  /**
   * 清理预览（任务 3.3）：展示影响面并签发一次性句柄（TTL 内有效）。
   */
  async previewCleanup(input: {
    organizationId: number
    actorId: number
    namespaceId: number
    referenceTime?: Date
  }): Promise<{ ok: true; preview: PluginStorageCleanupPreview } | Failure> {
    const now = input.referenceTime ?? new Date()
    const expiresAt = new Date(now.getTime() + PLUGIN_STORAGE_LIMITS.cleanupHandleTtlSeconds * 1000)

    const ns = await PluginStorageNamespace.query()
      .where('id', input.namespaceId)
      .where('organization_id', input.organizationId)
      .first()
    if (!ns) return fail('storage-namespace-not-found', 404)

    const agg = await computeEntriesDigest(ns.id)
    const payload = {
      namespaceId: ns.id,
      organizationId: ns.organizationId,
      pluginId: ns.pluginId,
      namespaceRevision: ns.rowVersion,
      entriesDigest: agg.digest,
      nonce: randomUUID(),
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
    const { handle, digest } = buildStorageCleanupHandle(payload)

    // 持久化绑定：confirm 时必须与行内 digest 一致（防多预览并存）
    ns.cleanupHandleDigest = digest
    ns.cleanupHandleExpiresAt = DateTime.fromJSDate(expiresAt)
    await ns.save()

    return {
      ok: true,
      preview: {
        format: 'plugin-storage-cleanup-preview-v1',
        cleanupHandle: handle,
        namespaceId: ns.id,
        pluginId: ns.pluginId,
        scope: ns.scope,
        projectId: ns.projectId,
        status: ns.status,
        entryCount: agg.total,
        totalBytes: agg.totalBytes,
        cleanupDigest: digest,
        irreversible: true,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
      },
    }
  }

  /**
   * 清理确认（任务 3.3/3.4）：逐字校验句柄与绑定 → 可信审计（strict）→ 删除数据。
   * 审计失败整体回滚；确认成功后 namespace 行删除（句柄天然一次性）。
   */
  async confirmCleanup(input: {
    organizationId: number
    actorId: number
    request: { cleanupHandle: string; cleanupDigest: string }
    referenceTime?: Date
  }): Promise<{ ok: true; result: PluginStorageCleanupResult } | Failure> {
    const now = input.referenceTime ?? new Date()

    // 1) 契约层校验：形状/digest 绑定/过期
    const verified = verifyStorageCleanupHandle({
      handle: input.request.cleanupHandle,
      expectedDigest: input.request.cleanupDigest,
      referenceTime: now.toISOString(),
    })
    if (!verified.ok) {
      if (verified.reasonCode === 'storage-cleanup-handle-expired') {
        return fail('storage-cleanup-handle-expired', 400)
      }
      if (verified.reasonCode === 'storage-cleanup-binding-mismatch') {
        return fail('storage-cleanup-binding-mismatch', 409)
      }
      return fail('storage-cleanup-handle-invalid', 400)
    }
    const payload = verified.payload

    try {
      const result = await db.transaction(
        async (trx): Promise<{ denial: Failure } | { result: PluginStorageCleanupResult }> => {
          // 2) 跨租重放防护：载荷组织必须与调用组织一致，行也必须属于该组织
          if (payload.organizationId !== input.organizationId) {
            return { denial: fail('storage-cross-tenant-denied', 404) }
          }
          const ns = await PluginStorageNamespace.query()
            .useTransaction(trx)
            .where('id', payload.namespaceId)
            .where('organization_id', input.organizationId)
            .first()
          if (!ns) return { denial: fail('storage-cleanup-already-consumed', 409) }

          // 3) 绑定复核：签发后的任何写入/并发变更都会失配
          const currentAgg = await computeEntriesDigest(ns.id, trx)
          if (
            ns.cleanupHandleDigest !== input.request.cleanupDigest ||
            ns.rowVersion !== payload.namespaceRevision ||
            currentAgg.digest !== payload.entriesDigest
          ) {
            return { denial: fail('storage-cleanup-binding-mismatch', 409) }
          }

          // 4) 可信审计先行（strict：失败抛错回滚）
          let auditReceiptId: number
          try {
            const receipt = await this.auditWriter({
              organizationId: input.organizationId,
              projectId: ns.projectId,
              userId: input.actorId,
              event: 'plugin_storage_cleanup_confirmed',
              entityId: Number(ns.id),
              metadata: {
                pluginId: ns.pluginId,
                scope: ns.scope,
                deletedEntries: currentAgg.total,
                freedBytes: currentAgg.totalBytes,
                namespaceRevision: ns.rowVersion,
                entriesDigest: payload.entriesDigest,
              },
              client: trx,
            })
            auditReceiptId = receipt.auditLogId
          } catch (error) {
            throw Object.assign(new Error('audit write failed'), {
              storageReasonCode: 'storage-cleanup-audit-failed' as const,
              cause: error,
            })
          }

          // 5) 执行删除（entries 随 namespace 级联）
          await ns.useTransaction(trx).delete()

          return {
            result: {
              namespaceId: ns.id,
              pluginId: ns.pluginId,
              deletedEntries: currentAgg.total,
              freedBytes: currentAgg.totalBytes,
              auditReceiptId: String(auditReceiptId),
            } satisfies PluginStorageCleanupResult,
          }
        },
      )

      if ('denial' in result) return result.denial
      return { ok: true, result: result.result }
    } catch (error) {
      if (
        (error as { storageReasonCode?: string }).storageReasonCode ===
        'storage-cleanup-audit-failed'
      ) {
        return fail('storage-cleanup-audit-failed', 500)
      }
      throw error
    }
  }

  /**
   * 管理员分页导出（任务 3.5）。权限由 Policy 层强制；本方法只做组织隔离与有界输出。
   * 无匹配数据时返回空清单且不产生临时文件；扫描命中敏感内容时 fail closed 并清理残留。
   */
  async exportPage(input: {
    organizationId: number
    actorId: number
    filter: {
      pluginId?: string | null
      scope?: PluginStorageScope | null
      includeOrphaned?: boolean
    }
    page?: number
    referenceTime?: Date
    writeFile?: boolean
  }): Promise<
    | {
        ok: true
        manifest: Omit<PluginStorageExportManifest, 'pages'> & { page: number }
        records: readonly PluginStorageExportRecord[]
        filePath: string | null
      }
    | { ok: false; reasonCode: 'storage-export-scan-failed'; httpStatus: 413 }
  > {
    const now = input.referenceTime ?? new Date()
    const page = Math.max(1, input.page ?? 1)
    const includeOrphaned = input.filter.includeOrphaned ?? true

    let nsQuery = PluginStorageNamespace.query().where('organization_id', input.organizationId)
    if (input.filter.pluginId) nsQuery = nsQuery.where('plugin_id', input.filter.pluginId)
    if (input.filter.scope) nsQuery = nsQuery.where('scope', input.filter.scope)
    if (!includeOrphaned) nsQuery = nsQuery.whereNot('status', 'orphaned')
    const namespaces = await nsQuery.orderBy('id', 'asc')
    const nsById = new Map(namespaces.map((n) => [n.id, n]))

    // 分页读取 entries（跨 namespace 按 namespace_id,key 稳定排序）
    const offset = (page - 1) * PLUGIN_STORAGE_LIMITS.exportBatchEntries
    const rows = await db
      .from('plugin_storage_entries')
      .whereIn('namespace_id', namespaces.length > 0 ? namespaces.map((n) => n.id) : [-1])
      .orderBy('namespace_id', 'asc')
      .orderBy('key', 'asc')
      .offset(offset)
      .limit(PLUGIN_STORAGE_LIMITS.exportBatchEntries)

    const records: PluginStorageExportRecord[] = []
    let totalBytes = 0
    for (const row of rows) {
      const ns = nsById.get(Number(row.namespace_id))
      if (!ns) continue
      let value: unknown = null
      try {
        value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
      } catch {
        value = null
      }
      totalBytes += Number(row.byte_size ?? 0)
      records.push({
        namespaceId: Number(row.namespace_id),
        pluginId: ns.pluginId,
        scope: ns.scope,
        projectId: ns.projectId,
        status: ns.status,
        key: String(row.key),
        value,
        schemaVersion: '1.0',
        revision: Number(row.revision ?? 1),
        byteSize: Number(row.byte_size ?? 0),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
      })
    }

    // 二次低敏扫描：命中即 fail closed（不落盘、不外发）
    const scan = storageSecondaryScan(records)
    if (scan.violations > 0) {
      return { ok: false, reasonCode: 'storage-export-scan-failed', httpStatus: 413 }
    }

    // 无匹配数据：不创建临时文件
    if (records.length === 0 && input.writeFile !== false) {
      return {
        ok: true,
        manifest: {
          format: PLUGIN_STORAGE_EXPORT_FORMAT,
          organizationId: input.organizationId,
          requestedByActorRef: `actor:${input.actorId}`,
          filter: {
            pluginId: input.filter.pluginId ?? null,
            scope: input.filter.scope ?? null,
            includeOrphaned,
          },
          page,
          totalEntries: 0,
          totalBytes: 0,
          digest: computeStorageDigest(['export', 'empty']),
          expiresAt: new Date(
            now.getTime() + PLUGIN_STORAGE_LIMITS.exportTempTtlSeconds * 1000,
          ).toISOString(),
          createdAt: now.toISOString(),
        },
        records,
        filePath: null,
      }
    }

    const manifest = {
      format: PLUGIN_STORAGE_EXPORT_FORMAT as typeof PLUGIN_STORAGE_EXPORT_FORMAT,
      organizationId: input.organizationId,
      requestedByActorRef: `actor:${input.actorId}`,
      filter: {
        pluginId: input.filter.pluginId ?? null,
        scope: input.filter.scope ?? null,
        includeOrphaned,
      },
      page,
      totalEntries: records.length,
      totalBytes,
      digest: computeStorageDigest([
        'export',
        ...records.map(
          (r) =>
            `${r.namespaceId}:${r.key}:${r.revision}:${computeEntryContentDigest(JSON.stringify(r.value))}`,
        ),
      ]),
      expiresAt: new Date(
        now.getTime() + PLUGIN_STORAGE_LIMITS.exportTempTtlSeconds * 1000,
      ).toISOString(),
      createdAt: now.toISOString(),
    }

    let filePath: string | null = null
    if (input.writeFile !== false && records.length > 0) {
      this.purgeExpiredExportFiles(now)
      const dir = storageExportDir(input.organizationId)
      mkdirSync(dir, { recursive: true })
      const fileName = `plugin-storage-export-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`
      filePath = join(dir, fileName)
      const lines = [JSON.stringify(manifest), ...records.map((r) => JSON.stringify(r))]
      writeFileSync(filePath, lines.join('\n'), 'utf8')
    }

    return { ok: true, manifest, records, filePath }
  }

  /**
   * 到期临时文件清理（任务 3.5）：只触碰本能力命名前缀的文件，超期即删。
   * 扫描所有组织的 plugin-storage-exports 目录。
   */
  purgeExpiredExportFiles(referenceTime: Date = new Date()): number {
    const orgsRoot = join(UPLOAD_ROOT, 'organizations')
    if (!existsSync(orgsRoot)) return 0
    let removed = 0
    for (const orgDir of readdirSync(orgsRoot)) {
      const exportDir = join(orgsRoot, orgDir, 'plugin-storage-exports')
      if (!existsSync(exportDir)) continue
      for (const name of readdirSync(exportDir)) {
        if (!name.startsWith('plugin-storage-export-')) continue
        const full = join(exportDir, name)
        try {
          const stats = statSync(full)
          const ageMs = referenceTime.getTime() - stats.mtimeMs
          if (ageMs > PLUGIN_STORAGE_LIMITS.exportTempTtlSeconds * 1000) {
            unlinkSync(full)
            removed += 1
          }
        } catch {
          // 单个文件失败不阻断清理循环
        }
      }
    }
    return removed
  }
}
