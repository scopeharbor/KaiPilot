/**
 * v3-plugin-private-registry-lifecycle — 私有目录数据访问层（task 7.3 接线）。
 *
 * 把 `registry_service_core` 等纯核心与 Lucid 模型缝合：核心负责判定与派生，
 * 本层只负责**带组织过滤的读写**。
 *
 * 红线：
 * - 每个查询都强制 `organization_id` 过滤（组织级数据隔离，CLAUDE.md §6.5）；
 * - 不做权限判定（归 Policy），不碰 HTTP（归 Controller）。
 */
import PluginPrivateRegistryEntry from '#models/plugin_private_registry_entry'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginPrivateRegistryOperation from '#models/plugin_private_registry_operation'
import PluginPrivateRegistryReview from '#models/plugin_private_registry_review'
import type { RegistryReleaseStatus } from '@aiproj/types'
import {
  buildDirectoryListConditions,
  parseDirectorySort,
  isExcludedFromResolution,
} from './registry_service_core.js'

export interface DirectoryQuery {
  readonly organizationId: number
  readonly page?: number
  readonly perPage?: number
  readonly status?: string
  readonly pluginIdentity?: string
  readonly sort?: string
}

export interface DirectoryPage {
  readonly data: DirectoryEntryDto[]
  readonly meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface DirectoryEntryDto {
  readonly entryId: string
  readonly organizationId: string
  readonly pluginIdentity: string
  readonly pluginName: string
  readonly recommendedVersion: string | null
  readonly releaseCount: number
  readonly rowVersion: number
}

/** 单页上限：与其它列表端点一致，防止一次拉全表。 */
const MAX_PER_PAGE = 100

export class PluginRegistryRepository {
  /**
   * 组织私有目录列表（分页 + 过滤 + 排序）。
   * 过滤条件与排序列由纯核心派生，本层只落到查询上。
   */
  async listDirectory(query: DirectoryQuery): Promise<DirectoryPage> {
    const page = Math.max(1, Number(query.page ?? 1))
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(query.perPage ?? 20)))

    const conditions = buildDirectoryListConditions({
      organizationId: String(query.organizationId),
      status: query.status as RegistryReleaseStatus | undefined,
      pluginIdentity: query.pluginIdentity,
    })
    const { column, direction } = parseDirectorySort(query.sort ?? '-createdAt')

    // 组织隔离：无条件附加，且不接受调用方覆盖
    const base = PluginPrivateRegistryEntry.query().where('organization_id', query.organizationId)
    if (typeof conditions.pluginIdentity === 'string') {
      base.where('plugin_identity', conditions.pluginIdentity)
    }

    const countQuery = base.clone()
    const [countRow] = await countQuery.count('* as count')
    const total = Number(countRow?.$extras.count ?? 0)

    const rows = await base
      .orderBy(column, direction)
      .offset((page - 1) * perPage)
      .limit(perPage)

    // 批量聚合 release 计数：单条 GROUP BY 取回整页，避免逐行 count 的 N+1。
    const identities = [...new Set(rows.map((row) => row.pluginIdentity))]
    const countsByIdentity = new Map<string, number>()
    if (identities.length > 0) {
      const countRows = await PluginPrivateRegistryRelease.query()
        .where('organization_id', query.organizationId)
        .whereIn('plugin_identity', identities)
        .select('plugin_identity')
        .count('* as count')
        .groupBy('plugin_identity')
      for (const identityCountRow of countRows) {
        countsByIdentity.set(
          identityCountRow.pluginIdentity,
          Number(identityCountRow.$extras.count ?? 0),
        )
      }
    }

    const data = rows.map((row) => ({
      entryId: String(row.id),
      organizationId: String(row.organizationId),
      pluginIdentity: row.pluginIdentity,
      pluginName: row.pluginName,
      recommendedVersion: row.recommendedVersion,
      releaseCount: countsByIdentity.get(row.pluginIdentity) ?? 0,
      rowVersion: row.rowVersion,
    }))

    return {
      data,
      meta: { total, page, perPage, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    }
  }

  /** 单条目详情（组织隔离；跨组织一律当作不存在）。 */
  async findEntry(organizationId: number, entryId: string): Promise<DirectoryEntryDto | null> {
    const row = await PluginPrivateRegistryEntry.query()
      .where('organization_id', organizationId)
      .where('id', entryId)
      .first()
    if (!row) return null
    return this.toEntryDto(row, organizationId)
  }

  /** 待审队列：处于 pending_review 的 release 及其当前 review cycle。 */
  async listReviewQueue(
    organizationId: number,
    page = 1,
    perPage = 20,
  ): Promise<DirectoryPage['meta'] & { data: ReviewQueueItemDto[] }> {
    const safePage = Math.max(1, Number(page))
    const safePerPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(perPage)))

    const base = PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('status', 'pending_review')

    const [countRow] = await base.clone().count('* as count')
    const total = Number(countRow?.$extras.count ?? 0)

    const rows = await base
      .orderBy('created_at', 'asc')
      .offset((safePage - 1) * safePerPage)
      .limit(safePerPage)

    const data: ReviewQueueItemDto[] = rows.map((row) => ({
      releaseId: String(row.id),
      pluginIdentity: row.pluginIdentity,
      version: row.version,
      status: row.status as RegistryReleaseStatus,
      submittedAt: row.createdAt?.toISO() ?? null,
    }))

    return {
      data,
      total,
      page: safePage,
      perPage: safePerPage,
      totalPages: Math.ceil(total / safePerPage),
    }
  }

  /**
   * 版本解析：返回组织内该插件当前可解析的 release。
   * deprecated/withdrawn 由纯核心 `isExcludedFromResolution` 排除。
   */
  async resolveVersion(
    organizationId: number,
    pluginIdentity: string,
  ): Promise<ResolvedReleaseDto | null> {
    const rows = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('plugin_identity', pluginIdentity)
      .orderBy('created_at', 'desc')

    const candidate = rows.find(
      (row) => !isExcludedFromResolution(row.status as RegistryReleaseStatus),
    )
    if (!candidate) return null

    return {
      releaseId: String(candidate.id),
      pluginIdentity: candidate.pluginIdentity,
      version: candidate.version,
      status: candidate.status as RegistryReleaseStatus,
      packageDigest: candidate.packageDigest,
    }
  }

  /** 幂等 operation 查找（组织隔离 + 幂等键）。 */
  async findOperation(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<PluginPrivateRegistryOperation | null> {
    return PluginPrivateRegistryOperation.query()
      .where('organization_id', organizationId)
      .where('idempotency_key', idempotencyKey)
      .first()
  }

  /** 某 release 的既有 review cycle（组织隔离）。 */
  async listReviews(
    organizationId: number,
    releaseId: number,
  ): Promise<PluginPrivateRegistryReview[]> {
    return PluginPrivateRegistryReview.query()
      .where('organization_id', organizationId)
      .where('release_id', releaseId)
      .orderBy('cycle_number', 'asc')
  }

  private async toEntryDto(
    row: PluginPrivateRegistryEntry,
    organizationId: number,
  ): Promise<DirectoryEntryDto> {
    const [countRow] = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('plugin_identity', row.pluginIdentity)
      .count('* as count')

    return {
      entryId: String(row.id),
      organizationId: String(row.organizationId),
      pluginIdentity: row.pluginIdentity,
      pluginName: row.pluginName,
      recommendedVersion: row.recommendedVersion,
      releaseCount: Number(countRow?.$extras.count ?? 0),
      rowVersion: row.rowVersion,
    }
  }
}

export interface ReviewQueueItemDto {
  readonly releaseId: string
  readonly pluginIdentity: string
  readonly version: string
  readonly status: RegistryReleaseStatus
  readonly submittedAt: string | null
}

export interface ResolvedReleaseDto {
  readonly releaseId: string
  readonly pluginIdentity: string
  readonly version: string
  readonly status: RegistryReleaseStatus
  readonly packageDigest: string
}
