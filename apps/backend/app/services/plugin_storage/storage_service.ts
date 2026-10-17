/**
 * v3-plugin-scoped-storage —— PluginStorageService（任务 2.3 / 2.5 / 3.1）。
 *
 * 插件组织/项目级 scoped 存储的宿主运行时门面。所有访问的合取式 fail-closed 授权：
 *   enabled installation ∧ 组织 scope ∧ project Policy（scope=project 时）∧ namespace lifecycle ∧ revision CAS。
 * - 客户端提供的 scope/pluginId 只是寻址参数，authority 一律由服务端会话与库内状态派生；
 * - 跨租/跨项目/跨插件统一返回 not-found 形状（非泄露），具体 reasonCode 仅进审计；
 * - 配额三层（namespace/project/org）在写入事务内以 byte delta 原子强制，超限整体回滚，
 *   绝不降级为文件系统或任意数据库访问（spec Requirement 4）；
 * - 生命周期由安装态派生：enabled→active、installed(disabled)→read-only、uninstalled→orphaned+保留期
 *   （design D4；卸载不删除数据）。
 * 错误形状：本服务用结果联合而非异常表达可预期拒绝；意外错误仍抛出。
 */
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import PluginStorageNamespace from '#models/plugin_storage_namespace'
import PluginStorageEntry from '#models/plugin_storage_entry'
import PluginInstallation from '#models/plugin_installation'
import {
  PLUGIN_STORAGE_LIMITS,
  assertRuntimeStorageAccess,
  computeEntryContentDigest,
  deriveStorageNamespaceStatus,
  evaluateRevisionCas,
  evaluateStorageQuota,
  normalizeStorageKey,
  normalizeStoragePagination,
  validateStorageValueDocument,
  type PluginStorageEntryDto,
  type PluginStorageErrorCode,
  type PluginStorageListResult,
  type PluginStorageScope,
} from '@aiproj/types'

/** 可预期拒绝（含 HTTP 映射建议；隔离类一律 404 非泄露）。 */
export interface StorageFailure {
  ok: false
  reasonCode: PluginStorageErrorCode
  httpStatus: 400 | 401 | 403 | 404 | 409 | 413
}

export type StorageGetResult = { ok: true; entry: PluginStorageEntryDto } | StorageFailure

export type StorageListResult = { ok: true; result: PluginStorageListResult } | StorageFailure

export type StoragePutResult =
  { ok: true; entry: PluginStorageEntryDto; warnings: readonly { code: string }[] } | StorageFailure

export type StorageDeleteResult = { ok: true } | StorageFailure

/** 运行时操作公共入参（authority 字段全部来自服务端会话，不接受客户端声明）。 */
export interface RuntimeStorageInput {
  organizationId: number
  /** 触发操作的 actor（宿主功能代表插件调用时为该用户）。 */
  actorId: number
  pluginId: string
  scope: PluginStorageScope
  projectId: number | null
}

const ISOLATION_404: ReadonlySet<PluginStorageErrorCode> = new Set<PluginStorageErrorCode>([
  'storage-install-not-enabled',
  'storage-namespace-not-found',
  'storage-cross-tenant-denied',
  'storage-cross-project-denied',
  'storage-cross-plugin-namespace',
])

function failure(reasonCode: PluginStorageErrorCode): StorageFailure {
  let httpStatus: StorageFailure['httpStatus'] = 400
  if (ISOLATION_404.has(reasonCode)) httpStatus = 404
  else if (
    reasonCode === 'storage-revision-conflict' ||
    reasonCode === 'storage-cleanup-binding-mismatch' ||
    reasonCode === 'storage-cleanup-already-consumed'
  ) {
    httpStatus = 409
  } else if (
    reasonCode === 'storage-value-too-large' ||
    reasonCode === 'storage-quota-exceeded' ||
    reasonCode === 'storage-quota-org-exceeded' ||
    reasonCode === 'storage-quota-project-exceeded' ||
    reasonCode === 'storage-entry-limit-reached' ||
    reasonCode === 'storage-export-too-large'
  ) {
    httpStatus = 413
  } else if (
    reasonCode === 'storage-permission-denied' ||
    reasonCode === 'storage-export-permission-denied' ||
    reasonCode === 'storage-namespace-read-only' ||
    reasonCode === 'storage-namespace-orphaned' ||
    reasonCode === 'storage-namespace-pending-deletion'
  ) {
    httpStatus = 403
  } else if (reasonCode === 'storage-auth-required') {
    httpStatus = 401
  }
  return { ok: false, reasonCode, httpStatus }
}

function toEntryDto(row: PluginStorageEntry): PluginStorageEntryDto {
  return {
    namespaceId: row.namespaceId,
    key: row.key,
    value: row.value,
    schemaVersion: '1.0',
    revision: row.revision,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISO() ?? '',
    updatedAt: row.updatedAt?.toISO() ?? '',
  }
}

export default class PluginStorageService {
  /**
   * 合取式授权 + namespace 解析（runtime 读路径）。
   * 任何一步失败都返回统一形状的失败；跨租/跨项目/跨插件与不存在不可区分。
   */
  private async authorizeAndResolve(
    input: RuntimeStorageInput,
    client?: TransactionClientContract,
  ): Promise<{ ok: true; namespace: PluginStorageNamespace } | StorageFailure> {
    // 1) enabled installation（org × plugin）
    let installQuery = PluginInstallation.query()
      .where('organization_id', input.organizationId)
      .where('plugin_id', input.pluginId)
      .where('status', 'enabled')
      .limit(1)
    if (client) installQuery = installQuery.useTransaction(client)
    const installation = await installQuery.first()
    if (!installation) return failure('storage-install-not-enabled')

    // 2) project Policy：project scope 必须重校验 actor 对项目的访问权
    if (input.scope === 'project') {
      if (!input.projectId) return failure('storage-key-invalid')
      const access = await this.assertActorProjectAccess(
        input.projectId,
        input.actorId,
        input.organizationId,
        client,
      )
      if (!access.ok) return access
    }

    // 3) namespace 解析（组织过滤强制；scope/project 由服务端组合寻址）
    let nsQuery = PluginStorageNamespace.query()
      .where('organization_id', input.organizationId)
      .where('plugin_id', input.pluginId)
      .where('scope', input.scope)
      .limit(1)
    if (input.scope === 'project') {
      nsQuery = nsQuery.where('project_id', input.projectId as number)
    } else {
      nsQuery = nsQuery.whereNull('project_id')
    }
    if (client) nsQuery = nsQuery.useTransaction(client)
    const namespace = await nsQuery.first()
    if (!namespace) return failure('storage-namespace-not-found')

    // 4) lifecycle gate：active 才允许 runtime 访问（read-only/orphaned/pending-deletion 全拒）
    const lifecycleDenial = assertRuntimeStorageAccess(namespace.status)
    if (lifecycleDenial) return failure(lifecycleDenial)

    return { ok: true, namespace }
  }

  /**
   * 项目访问权重校验（对齐 task_service.assertUserActiveProjectMember 的成员语义：
   * 活跃项目成员 ∨ 项目创建者 ∨ 同组织成员）。
   */
  async assertActorProjectAccess(
    projectId: number,
    actorId: number,
    organizationId: number,
    client?: TransactionClientContract,
  ): Promise<{ ok: true } | StorageFailure> {
    let memberQuery = (client ?? db)
      .from('project_members')
      .where('project_id', projectId)
      .where('user_id', actorId)
      .where('is_active', true)
      .limit(1)
    const member = await memberQuery.first()
    if (member) return { ok: true }

    const project = await (client ?? db).from('projects').where('id', projectId).limit(1).first()
    if (
      project &&
      Number(project.created_by) === actorId &&
      Number(project.organization_id) === organizationId
    ) {
      return { ok: true }
    }

    const orgMember = await (client ?? db)
      .from('organization_members')
      .where('organization_id', organizationId)
      .where('user_id', actorId)
      .limit(1)
      .first()
    if (orgMember) return { ok: true }

    return failure('storage-permission-denied')
  }

  /**
   * 读取单个 entry。
   */
  async get(input: RuntimeStorageInput & { key: string }): Promise<StorageGetResult> {
    const keyRes = normalizeStorageKey(input.key)
    if (!keyRes.ok) return failure(keyRes.reasonCode)

    const auth = await this.authorizeAndResolve(input)
    if (!auth.ok) return auth

    const row = await PluginStorageEntry.query()
      .where('namespace_id', auth.namespace.id)
      .where('key', keyRes.key)
      .first()
    if (!row) return failure('storage-namespace-not-found')
    return { ok: true, entry: toEntryDto(row) }
  }

  /**
   * 分页列举 entries（有界分页 + 可选前缀）。
   */
  async list(
    input: RuntimeStorageInput & { page?: number; perPage?: number; prefix?: string },
  ): Promise<StorageListResult> {
    const page = normalizeStoragePagination(input.page, input.perPage)
    if (!page.ok) return failure(page.reasonCode)

    let prefix: string | null = null
    if (input.prefix !== undefined && input.prefix !== null && input.prefix !== '') {
      const p = normalizeStorageKey(input.prefix)
      if (!p.ok) return failure(p.reasonCode)
      prefix = p.key
    }

    const auth = await this.authorizeAndResolve(input)
    if (!auth.ok) return auth

    let countQuery = db.from('plugin_storage_entries').where('namespace_id', auth.namespace.id)
    if (prefix) {
      countQuery = countQuery.andWhere('key', '>=', prefix).andWhere('key', '<', `${prefix}\uffff`)
    }
    const totalRow = await countQuery.count({ total: '*' }).first()
    const total = Number(totalRow?.total ?? 0)

    let rowsQuery = PluginStorageEntry.query().where('namespace_id', auth.namespace.id)
    if (prefix)
      rowsQuery = rowsQuery.where('key', '>=', prefix).where('key', '<', `${prefix}\uffff`)
    const rows = await rowsQuery
      .orderBy('key', 'asc')
      .offset((page.page - 1) * page.perPage)
      .limit(page.perPage)

    return {
      ok: true,
      result: {
        data: rows.map(toEntryDto),
        meta: {
          total: Number(total),
          page: page.page,
          perPage: page.perPage,
          totalPages: Math.max(1, Math.ceil(Number(total) / page.perPage)),
        },
      },
    }
  }

  /**
   * 写入（insert 或 CAS overwrite）：事务内完成校验 → 授权 → 配额 delta → upsert → 用量更新。
   * 任一层超限整体回滚（原子拒绝），既有数据与配额计数保持一致。
   */
  async put(
    input: RuntimeStorageInput & {
      key: string
      value: unknown
      expectedRevision?: number
    },
  ): Promise<StoragePutResult> {
    const keyRes = normalizeStorageKey(input.key)
    if (!keyRes.ok) return failure(keyRes.reasonCode)

    const docRes = validateStorageValueDocument(input.value)
    if (!docRes.ok || typeof docRes.canonicalJson !== 'string' || docRes.byteSize === undefined) {
      const code =
        docRes.findings.find((f) => f.code === 'storage-value-too-large')?.code ??
        docRes.findings[0]?.code ??
        'storage-value-invalid'
      return failure(code as PluginStorageErrorCode)
    }
    // 闭包内使用的窄化局部量（避免跨异步边界丢失字面量收窄）
    const canonicalJson: string = docRes.canonicalJson
    const newBytes: number = docRes.byteSize
    const contentDigest = computeEntryContentDigest(canonicalJson)

    return await db.transaction(async (trx) => {
      // 1) 合取授权（enabled 安装 ∧ project policy ∧ lifecycle）
      const auth = await this.authorizeAndResolve(input, trx)
      let namespace: PluginStorageNamespace
      if (auth.ok) {
        namespace = auth.namespace
      } else {
        // 写路径允许懒建 namespace（绑定当前 enabled 安装）；但其余失败码原样返回
        if (auth.reasonCode !== 'storage-namespace-not-found') return auth
        const created = await this.resolveOrCreateNamespace(input, trx)
        if (!created.ok) return created
        namespace = created.namespace
      }

      // 2) 现值与 CAS
      const current = await PluginStorageEntry.query()
        .useTransaction(trx)
        .where('namespace_id', namespace.id)
        .where('key', keyRes.key)
        .first()
      const cas = evaluateRevisionCas(
        current ? current.revision : null,
        input.expectedRevision ?? undefined,
      )
      if (!cas.ok) return failure(cas.reasonCode)

      // 3) 三层配额（事务内 delta；orphaned 数据同样占额）
      const oldBytes = current ? current.byteSize : 0
      const deltaBytes = newBytes - oldBytes
      const deltaEntries = current ? 0 : 1

      const orgAgg = await trx
        .from('plugin_storage_namespaces')
        .where('organization_id', input.organizationId)
        .sum({ bytes: 'used_bytes', entries: 'used_entries' })
        .first()
      const orgUsedBytes = Number(orgAgg?.bytes ?? 0)
      const orgUsedEntries = Number(orgAgg?.entries ?? 0)

      let projectSnap: { usedBytes: number; usedEntries: number } | null = null
      if (input.scope === 'project' && input.projectId) {
        const projAgg = await trx
          .from('plugin_storage_namespaces')
          .where('organization_id', input.organizationId)
          .where('project_id', input.projectId)
          .sum({ bytes: 'used_bytes', entries: 'used_entries' })
          .first()
        projectSnap = {
          usedBytes: Number(projAgg?.bytes ?? 0),
          usedEntries: Number(projAgg?.entries ?? 0),
        }
      }

      const verdict = evaluateStorageQuota({
        namespace: {
          usedBytes: namespace.usedBytes,
          usedEntries: namespace.usedEntries,
          quotaBytes: namespace.quotaBytes,
          quotaEntries: namespace.quotaEntries,
        },
        project: projectSnap
          ? {
              usedBytes: projectSnap.usedBytes,
              usedEntries: projectSnap.usedEntries,
              quotaBytes: PLUGIN_STORAGE_LIMITS.projectQuotaBytes,
              quotaEntries: PLUGIN_STORAGE_LIMITS.maxEntriesPerNamespace * 8,
            }
          : null,
        organization: {
          usedBytes: orgUsedBytes,
          usedEntries: orgUsedEntries,
          quotaBytes: PLUGIN_STORAGE_LIMITS.organizationQuotaBytes,
          quotaEntries: PLUGIN_STORAGE_LIMITS.maxEntriesPerNamespace * 64,
        },
        deltaBytes,
        deltaEntries,
      })
      if (!verdict.ok) return failure(verdict.reasonCode ?? 'storage-quota-exceeded')

      // 4) upsert entry（revision 单调递增）
      let entryRow: PluginStorageEntry
      if (current) {
        current.value = JSON.parse(canonicalJson)
        current.byteSize = newBytes
        current.canonicalDigest = contentDigest
        current.revision = current.revision + 1
        current.useTransaction(trx)
        await current.save()
        entryRow = current
      } else {
        entryRow = await PluginStorageEntry.create(
          {
            namespaceId: namespace.id,
            key: keyRes.key,
            value: JSON.parse(canonicalJson),
            canonicalDigest: contentDigest,
            byteSize: newBytes,
            revision: 1,
          },
          { client: trx },
        )
      }

      // 5) namespace 用量更新（rowVersion CAS 保护并发写）
      const updatedRows = await trx
        .from('plugin_storage_namespaces')
        .where('id', namespace.id)
        .where('row_version', namespace.rowVersion)
        .update({
          used_bytes: namespace.usedBytes + deltaBytes,
          used_entries: namespace.usedEntries + deltaEntries,
          row_version: namespace.rowVersion + 1,
          updated_at: new Date().toISOString(),
        })
      if (Number(updatedRows) !== 1) {
        throw Object.assign(new Error('namespace row version conflict'), {
          storageReasonCode: 'storage-revision-conflict' as PluginStorageErrorCode,
        })
      }

      return {
        ok: true,
        entry: toEntryDto(entryRow),
        warnings: verdict.warnings.map((w) => ({ code: w.code })),
      }
    })
  }

  /**
   * 删除单条 entry（必须携带匹配的 expectedRevision，防并发误删）。
   */
  async deleteEntry(
    input: RuntimeStorageInput & { key: string; expectedRevision?: number },
  ): Promise<StorageDeleteResult> {
    const keyRes = normalizeStorageKey(input.key)
    if (!keyRes.ok) return failure(keyRes.reasonCode)

    return await db.transaction(async (trx) => {
      const auth = await this.authorizeAndResolve(input, trx)
      if (!auth.ok) return auth
      const namespace = auth.namespace

      const current = await PluginStorageEntry.query()
        .useTransaction(trx)
        .where('namespace_id', namespace.id)
        .where('key', keyRes.key)
        .first()
      if (!current) return failure('storage-namespace-not-found')

      const cas = evaluateRevisionCas(current.revision, input.expectedRevision)
      if (!cas.ok) return failure(cas.reasonCode)

      await current.useTransaction(trx).delete()

      await trx
        .from('plugin_storage_namespaces')
        .where('id', namespace.id)
        .where('row_version', namespace.rowVersion)
        .update({
          used_bytes: Math.max(0, namespace.usedBytes - current.byteSize),
          used_entries: Math.max(0, namespace.usedEntries - 1),
          row_version: namespace.rowVersion + 1,
          updated_at: new Date().toISOString(),
        })

      return { ok: true }
    })
  }

  /**
   * 写路径的 namespace 懒创建（并发下依赖部分唯一索引去重后重查）。
   */
  private async resolveOrCreateNamespace(
    input: RuntimeStorageInput,
    trx: TransactionClientContract,
  ): Promise<{ ok: true; namespace: PluginStorageNamespace } | StorageFailure> {
    let installQuery = PluginInstallation.query()
      .where('organization_id', input.organizationId)
      .where('plugin_id', input.pluginId)
      .where('status', 'enabled')
      .limit(1)
    installQuery = installQuery.useTransaction(trx)
    const installation = await installQuery.first()
    if (!installation) return failure('storage-install-not-enabled')

    try {
      const namespace = await PluginStorageNamespace.create(
        {
          organizationId: input.organizationId,
          projectId: input.scope === 'project' ? input.projectId : null,
          pluginId: input.pluginId,
          pluginVersion: installation.version,
          installationId: installation.id,
          scope: input.scope,
          status: 'active',
          quotaBytes: PLUGIN_STORAGE_LIMITS.namespaceQuotaBytes,
          usedBytes: 0,
          quotaEntries: PLUGIN_STORAGE_LIMITS.maxEntriesPerNamespace,
          usedEntries: 0,
          rowVersion: 1,
        },
        { client: trx },
      )
      return { ok: true, namespace }
    } catch (err) {
      // 唯一索引冲突 → 并发懒建，重查既有行
      const message = (err as Error).message ?? ''
      if (/UNIQUE|duplicate/i.test(message)) {
        let requery = PluginStorageNamespace.query()
          .where('organization_id', input.organizationId)
          .where('plugin_id', input.pluginId)
          .where('scope', input.scope)
          .limit(1)
          .useTransaction(trx)
        requery =
          input.scope === 'project'
            ? requery.where('project_id', input.projectId as number)
            : requery.whereNull('project_id')
        const existing = await requery.first()
        if (existing) return { ok: true, namespace: existing }
      }
      throw err
    }
  }

  /**
   * usage reconcile probe（任务 2.5）：只读核对计数漂移；fix=true 时按真实聚合修复。
   * reconcile 只修正计数，绝不成为授权来源（design D3）。
   */
  async reconcileUsage(
    namespaceId: number,
    fix = false,
  ): Promise<{
    namespaceId: number
    storedBytes: number
    actualBytes: number
    storedEntries: number
    actualEntries: number
    drift: boolean
    fixed: boolean
  }> {
    const ns = await PluginStorageNamespace.findOrFail(namespaceId)
    const agg = await db
      .from('plugin_storage_entries')
      .where('namespace_id', namespaceId)
      .sum({ bytes: 'byte_size' })
      .count({ total: '*' })
      .first()
    const actualBytes = Number(agg?.bytes ?? 0)
    const actualEntries = Number(agg?.total ?? 0)
    const drift = actualBytes !== ns.usedBytes || actualEntries !== ns.usedEntries
    if (drift && fix) {
      ns.usedBytes = actualBytes
      ns.usedEntries = actualEntries
      ns.rowVersion = ns.rowVersion + 1
      await ns.save()
    }
    return {
      namespaceId,
      storedBytes: ns.usedBytes,
      actualBytes,
      storedEntries: ns.usedEntries,
      actualEntries,
      drift,
      fixed: drift && fix,
    }
  }

  /**
   * 安装生命周期同步（任务 3.1）：宿主在 enable/disable/uninstall 后调用。
   * - enable → active；disable → read-only；uninstall → orphaned + 保留期。
   * - 不删除任何数据（卸载不静默删除，spec Requirement 5）。
   */
  async syncLifecycleForInstallation(input: {
    installationId: number
    organizationId: number
    pluginId: string
    installStatus: 'installed' | 'enabled' | 'uninstalled'
    referenceTime?: Date
  }): Promise<{ updatedNamespaces: number }> {
    const target = deriveStorageNamespaceStatus(input.installStatus)
    const now = input.referenceTime ?? new Date()
    const retentionUntil = new Date(
      now.getTime() + PLUGIN_STORAGE_LIMITS.orphanedRetentionDays * 24 * 60 * 60 * 1000,
    )

    const namespaces = await PluginStorageNamespace.query()
      .where('installation_id', input.installationId)
      .where('organization_id', input.organizationId)
      .where('plugin_id', input.pluginId)

    for (const ns of namespaces) {
      ns.status = target
      if (target === 'orphaned') {
        ns.orphanedAt = DateTime.fromJSDate(now)
        ns.retentionUntil = DateTime.fromJSDate(retentionUntil)
      }
      if (target === 'active') {
        ns.orphanedAt = null
        ns.retentionUntil = null
      }
      ns.rowVersion = ns.rowVersion + 1
      await ns.save()
    }
    return { updatedNamespaces: namespaces.length }
  }
}
