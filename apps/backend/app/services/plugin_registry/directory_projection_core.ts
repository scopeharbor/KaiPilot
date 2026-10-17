/**
 * v3-organization-private-plugin-directory — 目录投影纯核心（tasks 2.1/2.2）。
 *
 * 纯函数层：成员/管理员视图筛选、确定性排序、兼容性摘要、受影响安装桶聚合、
 * 低敏错误契约。**零 Adonis/Lucid/数据库依赖**，可被 vitest/japa 直跑。
 *
 * 红线：
 * - 不复制 release 状态机（D1）：目录视图只是 registry release 的实时投影，
 *   「禁用」语义 ≙ 既有封闭枚举中的 `withdrawn`（不可发现）与
 *   `deprecated`（成员不可分发），**不新增平行 directory_status**；
 * - 目录状态永不改写安装实例（上游 status_orchestration_core D4）；
 * - 错误契约非泄露：跨组织/不可发现目标一律返回同一 not-found 形态，
 *   不回显名称、版本、数量、ID 或 digest。
 */

import type { RegistryReleaseStatus } from '@aiproj/types'
import { comparePluginSemver } from '@aiproj/types'
import { FIXTURE_SEED_RECEIPT_PREFIX } from '@aiproj/types/plugin-fixture-market-seed'
import { evaluateCurrentReleaseApproval } from '../plugin_compatibility_service.js'

// =============================================================================
// 1. 视图角色与可见性（spec：目录发现必须只包含可分发 release）
// =============================================================================

/** 目录视图角色：普通成员只看可分发 release；管理员（review/manage 持有者）可看全部。 */
export type DirectoryViewerRole = 'member' | 'manager'

/**
 * 成员可分发状态：仅 approved。
 * pending_review/draft/rejected/withdrawn/deprecated 对成员一律不可见——
 * 成员不得借目录反推「存在某个待审/已撤回版本」。
 */
export const MEMBER_DISTRIBUTABLE_STATUSES: readonly RegistryReleaseStatus[] = ['approved']

export function isDistributableStatus(status: RegistryReleaseStatus): boolean {
  return MEMBER_DISTRIBUTABLE_STATUSES.includes(status)
}

/**
 * 按视图角色筛选 release 集合。
 * 管理员视图 MAY 展示草稿/待审/拒绝/撤回（权限过滤由 Policy 决定角色后传入）。
 */
export function selectReleasesForViewer<T extends { readonly status: RegistryReleaseStatus }>(
  releases: readonly T[],
  viewerRole: DirectoryViewerRole,
): T[] {
  if (viewerRole === 'manager') return [...releases]
  return releases.filter((release) => isDistributableStatus(release.status))
}

// =============================================================================
// 1b. 来源标记（v3-plugin-fixture-market-seed task 4.1）
// =============================================================================

/**
 * 判定一条 release 是否由本机示例插件库 seed 写入。
 *
 * 只读 `upstream_receipt_ref` 的**命名空间前缀**，返回布尔——receipt 原文属敏感
 * 字段，不进入任何目录 DTO。示例数据只在 development/test/demo 环境由显式启用的
 * seed 流程产生（production 侧 guard fail closed），因此该标记天然只会在
 * 非 production 库里为真。
 */
export function isFixtureSeededRelease(upstreamReceiptRef: string | null | undefined): boolean {
  return (
    typeof upstreamReceiptRef === 'string' &&
    upstreamReceiptRef.startsWith(FIXTURE_SEED_RECEIPT_PREFIX)
  )
}

// =============================================================================
// 2. 确定性排序契约（task 2.2）
// =============================================================================

export type DirectorySortKey = '-createdAt' | '+createdAt' | '-version' | '+version'

/**
 * 版本序比较：semver 降序，`id` 升序做最终 tiebreak——
 * 同版本同分页输入永远得到同一顺序（SQLite 字符串序会把 10.0.0 排在 9.0.0 前，禁用）。
 */
export function compareReleasesDeterministic(
  a: { readonly id: string | number; readonly version: string },
  b: { readonly id: string | number; readonly version: string },
): number {
  const byVersion = comparePluginSemver(b.version, a.version)
  if (byVersion !== 0) return byVersion
  return String(a.id).localeCompare(String(b.id))
}

/**
 * 内存版确定性排序（version 排序专用；createdAt 排序由 SQL 完成时也必须带 id tiebreak）。
 * 输入顺序不影响输出（先排序再稳定 tiebreak）。
 */
export function sortReleasesDeterministic<
  T extends { readonly id: string | number; readonly version: string },
>(releases: readonly T[], sort: DirectorySortKey): T[] {
  const sorted = [...releases]
  const byIdAsc = (a: T, b: T) => String(a.id).localeCompare(String(b.id))
  if (sort === '-version') {
    // 版本降序，id 升序 tiebreak
    sorted.sort((a, b) => {
      const byVersion = comparePluginSemver(b.version, a.version)
      return byVersion !== 0 ? byVersion : byIdAsc(a, b)
    })
    return sorted
  }
  if (sort === '+version') {
    // 版本升序，id 仍升序 tiebreak（确定性契约不随方向翻转）
    sorted.sort((a, b) => {
      const byVersion = comparePluginSemver(a.version, b.version)
      return byVersion !== 0 ? byVersion : byIdAsc(a, b)
    })
    return sorted
  }
  // createdAt 排序在 SQL 侧执行；此处仅用于纯函数测试对齐：created_at desc/asc + id asc。
  const desc = sort === '-createdAt'
  sorted.sort((a, b) => {
    const av = (a as unknown as { createdAt?: string }).createdAt ?? ''
    const bv = (b as unknown as { createdAt?: string }).createdAt ?? ''
    if (av !== bv) {
      if (av < bv) return desc ? 1 : -1
      return desc ? -1 : 1
    }
    return byIdAsc(a, b)
  })
  return sorted
}

// =============================================================================
// 3. 兼容性摘要（低敏：只暴露 allowed/reasonCodes/digest）
// =============================================================================

export interface DirectoryCompatibilitySummary {
  /** 当前宿主是否接受该 release 的兼容性声明（审批最早权威门的只读复述）。 */
  readonly allowed: boolean
  readonly digest: string
  readonly reasonCodes: readonly string[]
}

/**
 * 从 release.metadata 投影兼容性摘要。
 * 复用 v3-plugin-compatibility-matrix 的评估器；损坏 metadata 由其 fail-closed，
 * 此处再兜底一层，保证目录查询永不因脏数据 500。
 */
export function buildCompatibilitySummary(metadata: string | null): DirectoryCompatibilitySummary {
  try {
    const result = evaluateCurrentReleaseApproval(metadata)
    return {
      allowed: result.allowed,
      digest: result.digest,
      reasonCodes: [...result.reasonCodes],
    }
  } catch {
    return { allowed: false, digest: '', reasonCodes: ['compatibility-evaluation-unavailable'] }
  }
}

// =============================================================================
// 4. 受影响安装聚合（有界影响清单的数据形态；task 2.1/3.3 只读半边）
// =============================================================================

export interface InstallationBucketRow {
  readonly releaseId: string | number
  readonly status: string
  readonly total: number | string
}

export interface InstallationImpactSummary {
  /** installed/enabled 的活动实例数（禁用分发后仍按既有安装态运行）。 */
  readonly activeCount: number
  /** 已卸载的历史记录数（保留句柄与审计，不参与影响清单）。 */
  readonly uninstalledCount: number
}

const ACTIVE_INSTALLATION_STATUSES = new Set(['installed', 'enabled'])

/** 把 GROUP BY(release_id,status) 聚合行折叠成每 release 的影响摘要。 */
export function aggregateInstallationBuckets(
  rows: readonly InstallationBucketRow[],
): Map<string, InstallationImpactSummary> {
  const map = new Map<string, InstallationImpactSummary>()
  for (const row of rows) {
    const key = String(row.releaseId)
    const total = Number(row.total) || 0
    const previous = map.get(key) ?? { activeCount: 0, uninstalledCount: 0 }
    const current = { ...previous }
    if (ACTIVE_INSTALLATION_STATUSES.has(row.status)) {
      current.activeCount += total
    } else {
      current.uninstalledCount += total
    }
    map.set(key, current)
  }
  return map
}

/** 受影响安装条目 DTO：低敏字段集，不含 digest/permissionConfirmation。 */
export interface AffectedInstallationDto {
  readonly id: string
  readonly pluginId: string
  readonly version: string
  readonly status: string
  readonly installedAt: string | null
  readonly uninstalledAt: string | null
}

/** 有界清单上限：单次最多返回 100 条，超出走分页（防一次拉全表）。 */
export const AFFECTED_INSTALLATIONS_MAX_PER_PAGE = 100

// =============================================================================
// 5. 低敏错误契约（跨组织/不可发现 → 同一 not-found 形态）
// =============================================================================

export type DirectoryErrorCode = 'directory-release-not-found' | 'directory-invalid-query'

export interface DirectoryErrorBody {
  readonly error: {
    readonly code: DirectoryErrorCode
    readonly message: string
  }
}

/** 固定文案错误体：不携带任何目标标识/digest/数量，杜绝反向推断。 */
export function directoryError(code: DirectoryErrorCode): DirectoryErrorBody {
  const messages: Record<DirectoryErrorCode, string> = {
    'directory-release-not-found': '目录条目不存在',
    'directory-invalid-query': '目录查询参数不合法',
  }
  return { error: { code, message: messages[code] } }
}
