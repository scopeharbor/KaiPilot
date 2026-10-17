/**
 * v3-organization-private-plugin-directory — 目录投影数据访问层（tasks 2.3/2.4）。
 *
 * 把 `directory_projection_core` 与 Lucid 模型缝合：release 级列表/详情、
 * 有界受影响安装清单。**只读**——本层不提供任何写入方法（任务 1.2 裁决：
 * 上游统一变更流未就绪，写入口保持关闭）。
 *
 * 红线：
 * - 每个查询都强制 `organization_id` 过滤（组织级数据隔离）；
 * - 批量聚合：安装影响计数用单条 GROUP BY 查询取回整页数据，
 *   绝不在行循环里逐条 count（N+1 禁止）；
 * - 成员视图对不可分发 release 一律按「不存在」处理（非泄露）；
 * - 不做权限判定（归 Policy），不碰 HTTP（归 Controller）。
 */
import db from '@adonisjs/lucid/services/db'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginPrivateRegistryReview from '#models/plugin_private_registry_review'
import PluginInstallation from '#models/plugin_installation'
import type { RegistryReleaseStatus } from '@aiproj/types'
import {
  aggregateInstallationBuckets,
  buildCompatibilitySummary,
  isFixtureSeededRelease,
  selectReleasesForViewer,
  sortReleasesDeterministic,
  type AffectedInstallationDto,
  type DirectoryCompatibilitySummary,
  type DirectorySortKey,
  type DirectoryViewerRole,
  type InstallationImpactSummary,
  AFFECTED_INSTALLATIONS_MAX_PER_PAGE,
} from './directory_projection_core.js'
import { FIXTURE_SEED_RECEIPT_PREFIX } from '@aiproj/types/plugin-fixture-market-seed'

const MAX_PER_PAGE = 100

export interface DirectoryReleaseQuery {
  readonly organizationId: number
  readonly viewerRole: DirectoryViewerRole
  readonly status?: string
  readonly pluginIdentity?: string
  /** 只看/排除本机示例库 seed 写入的 release（不传 = 不过滤）。 */
  readonly fixtureOnly?: boolean
  readonly sort?: DirectorySortKey
  readonly page?: number
  readonly perPage?: number
}

/** 目录 release 列表项 DTO（低敏：不含 metadata 原文与 upstreamReceiptRef）。 */
export interface DirectoryReleaseListItem {
  readonly releaseId: string
  readonly pluginIdentity: string
  readonly version: string
  readonly status: RegistryReleaseStatus
  readonly createdAt: string | null
  readonly compatibilityAllowed: boolean
  readonly activeInstallationCount: number
  readonly uninstalledInstallationCount: number
  /** 来源标记：true = 由本机示例插件库 seed 写入（非生产、离线 fixture）。 */
  readonly fixtureOnly: boolean
}

export interface DirectoryReleasePage {
  readonly data: DirectoryReleaseListItem[]
  readonly meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface DirectoryReviewSummary {
  readonly latestCycleNumber: number
  readonly latestDecision: string | null
  readonly latestResolvedAt: string | null
}

export interface DirectoryReleaseDetail extends DirectoryReleaseListItem {
  readonly manifestDigestPresent: boolean
  readonly compatibility: DirectoryCompatibilitySummary
  readonly review: DirectoryReviewSummary | null
  readonly impact: InstallationImpactSummary
}

export interface AffectedInstallationsPage {
  readonly data: AffectedInstallationDto[]
  readonly meta: { total: number; page: number; perPage: number; totalPages: number }
}

function normalizePagination(page?: number, perPage?: number): { page: number; perPage: number } {
  const safePage = Math.max(1, Number(page ?? 1) || 1)
  const safePerPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(perPage ?? 20) || 20))
  return { page: safePage, perPage: safePerPage }
}

/**
 * 单条 GROUP BY 查询取回一批 release 的安装影响桶（installed/enabled vs 已卸载）。
 * 组织隔离 + releaseId 白名单双重约束；空 id 列表直接短路不发查询。
 */
async function loadImpactBuckets(
  organizationId: number,
  releaseIds: readonly (string | number)[],
): Promise<Map<string, InstallationImpactSummary>> {
  if (releaseIds.length === 0) return new Map()
  const rows = await db
    .from('plugin_installations')
    .where('organization_id', organizationId)
    .whereIn('release_id', releaseIds as number[])
    .select('release_id', 'status')
    .count('* as total')
    .groupBy('release_id', 'status')
  return aggregateInstallationBuckets(
    rows.map((row) => ({
      releaseId: row.release_id,
      status: String(row.status),
      total: Number(row.total ?? 0),
    })),
  )
}

export class DirectoryProjectionRepository {
  /**
   * 组织私有目录 release 列表（只读投影）。
   * - 成员视图强制只看 approved（即使显式传入其他 status 过滤也不泄露存在性）；
   * - `-version/+version` 排序在内存中做 semver 比较（SQLite 字符串序不正确），
   *   其余排序走 SQL 且带 id tiebreak——两种路径都满足确定性排序契约。
   */
  async listReleases(query: DirectoryReleaseQuery): Promise<DirectoryReleasePage> {
    const { page, perPage } = normalizePagination(query.page, query.perPage)
    const sort: DirectorySortKey = query.sort ?? '-createdAt'

    // 成员视图：无条件收敛到可分发集合，忽略任何试图扩大可见性的过滤参数。
    const memberLocked = query.viewerRole === 'member'
    if (memberLocked && query.status && query.status !== 'approved') {
      // 成员显式请求不可分发状态（pending/withdrawn/…）→ 空结果：
      // 既不改写其查询意图，也不泄露「该组织存在此类 release」。
      return {
        data: [],
        meta: { total: 0, page, perPage, totalPages: 0 },
      }
    }
    const requestedStatus = memberLocked
      ? 'approved'
      : (query.status as RegistryReleaseStatus | undefined)

    const base = PluginPrivateRegistryRelease.query().where('organization_id', query.organizationId)
    if (requestedStatus) base.where('status', requestedStatus)
    if (query.pluginIdentity) base.where('plugin_identity', query.pluginIdentity)
    // 来源过滤走 receipt 命名空间前缀（LIKE 'fixture-seed:%'），DTO 只回布尔不回原文
    if (query.fixtureOnly === true) {
      base.where('upstream_receipt_ref', 'like', `${FIXTURE_SEED_RECEIPT_PREFIX}%`)
    } else if (query.fixtureOnly === false) {
      base.where((builder) => {
        builder
          .whereNull('upstream_receipt_ref')
          .orWhereNot('upstream_receipt_ref', 'like', `${FIXTURE_SEED_RECEIPT_PREFIX}%`)
      })
    }

    const [countRow] = await base.clone().count('* as count')
    const total = Number(countRow?.$extras.count ?? 0)

    let rows: PluginPrivateRegistryRelease[]
    if (sort === '-version' || sort === '+version') {
      const all = await base
      const wrapped = all.map((row) => ({
        id: String(row.id),
        version: row.version,
        status: row.status as RegistryReleaseStatus,
        row,
      }))
      const visible = selectReleasesForViewer(wrapped, query.viewerRole)
      const ordered = sortReleasesDeterministic(visible, sort)
      rows = ordered.slice((page - 1) * perPage, page * perPage).map((item) => item.row)
    } else {
      const direction = sort === '+createdAt' ? 'asc' : 'desc'
      rows = await base
        .orderBy('created_at', direction)
        .orderBy('id', 'asc')
        .offset((page - 1) * perPage)
        .limit(perPage)
      const wrapped = rows.map((row) => ({
        id: String(row.id),
        version: row.version,
        status: row.status as RegistryReleaseStatus,
        row,
      }))
      rows = selectReleasesForViewer(wrapped, query.viewerRole).map((item) => item.row)
    }

    const buckets = await loadImpactBuckets(
      query.organizationId,
      rows.map((row) => row.id),
    )

    const data: DirectoryReleaseListItem[] = rows.map((row) => {
      const impact = buckets.get(String(row.id)) ?? { activeCount: 0, uninstalledCount: 0 }
      return {
        releaseId: String(row.id),
        pluginIdentity: row.pluginIdentity,
        version: row.version,
        status: row.status as RegistryReleaseStatus,
        createdAt: row.createdAt?.toISO() ?? null,
        compatibilityAllowed: buildCompatibilitySummary(row.metadata).allowed,
        activeInstallationCount: impact.activeCount,
        uninstalledInstallationCount: impact.uninstalledCount,
        fixtureOnly: isFixtureSeededRelease(row.upstreamReceiptRef),
      }
    })

    return {
      data,
      meta: { total, page, perPage, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    }
  }

  /**
   * 目录 release 详情（组织隔离；成员视图下不可分发 release 一律返回 null → 404 非泄露）。
   * 兼容性摘要与审批摘要均为低敏投影，不含包体/manifest/receipt 原文。
   */
  async getReleaseDetail(
    organizationId: number,
    releaseId: string,
    viewerRole: DirectoryViewerRole,
  ): Promise<DirectoryReleaseDetail | null> {
    const row = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('id', Number(releaseId))
      .first()
    if (!row) return null

    const status = row.status as RegistryReleaseStatus
    if (viewerRole === 'member' && !['approved'].includes(status)) return null

    const [buckets, reviews] = await Promise.all([
      loadImpactBuckets(organizationId, [row.id]),
      PluginPrivateRegistryReview.query()
        .where('organization_id', organizationId)
        .where('release_id', row.id)
        .orderBy('cycle_number', 'desc')
        .first(),
    ])

    const impact = buckets.get(String(row.id)) ?? { activeCount: 0, uninstalledCount: 0 }
    const compatibility = buildCompatibilitySummary(row.metadata)

    return {
      releaseId: String(row.id),
      pluginIdentity: row.pluginIdentity,
      version: row.version,
      status,
      createdAt: row.createdAt?.toISO() ?? null,
      compatibilityAllowed: compatibility.allowed,
      activeInstallationCount: impact.activeCount,
      uninstalledInstallationCount: impact.uninstalledCount,
      fixtureOnly: isFixtureSeededRelease(row.upstreamReceiptRef),
      manifestDigestPresent: Boolean(row.manifestDigest),
      compatibility,
      review: reviews
        ? {
            latestCycleNumber: reviews.cycleNumber,
            latestDecision: reviews.decision,
            latestResolvedAt: reviews.resolvedAt?.toISO() ?? null,
          }
        : null,
      impact,
    }
  }

  /**
   * 有界受影响安装清单（管理员视图）：某 release 名下的安装实例分页列表。
   * 只读——禁用分发后的实例处置走独立受控变更请求，本清单只提供事实输入。
   */
  async listAffectedInstallations(
    organizationId: number,
    releaseId: string,
    page?: number,
    perPage?: number,
  ): Promise<AffectedInstallationsPage | null> {
    const release = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('id', Number(releaseId))
      .first()
    if (!release) return null

    const { page: safePage, perPage: safePerPage } = normalizePagination(
      page,
      Math.min(perPage ?? 20, AFFECTED_INSTALLATIONS_MAX_PER_PAGE),
    )

    const base = PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('release_id', Number(releaseId))

    const [countRow] = await base.clone().count('* as count')
    const total = Number(countRow?.$extras.count ?? 0)

    const rows = await base
      .orderBy('id', 'asc')
      .offset((safePage - 1) * safePerPage)
      .limit(safePerPage)

    const data: AffectedInstallationDto[] = rows.map((row) => ({
      id: String(row.id),
      pluginId: row.pluginId,
      version: row.version,
      status: row.status,
      installedAt: row.createdAt?.toISO() ?? null,
      uninstalledAt: row.uninstalledAt?.toISO() ?? null,
    }))

    return {
      data,
      meta: {
        total,
        page: safePage,
        perPage: safePerPage,
        totalPages: safePerPage > 0 ? Math.ceil(total / safePerPage) : 0,
      },
    }
  }
}
