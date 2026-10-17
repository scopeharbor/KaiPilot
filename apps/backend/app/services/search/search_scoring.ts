// v2-advanced-search — 搜索结果打分与稳定排序工具

import type { SearchResultItem, SearchEntityType, SearchSort } from '@aiproj/types'
import { getEntityTypePriority } from '@aiproj/types'
import { DateTime } from 'luxon'

/**
 * 命中字段权重配置。
 * 根据字段重要性赋予不同分数。
 */
const FIELD_WEIGHTS: Record<string, number> = {
  name: 10,
  title: 10,
  code: 8,
  fullName: 6,
  description: 5,
  summary: 4,
  content: 3,
  tags: 2,
  status: 1,
}

/** 默认字段权重 */
const DEFAULT_FIELD_WEIGHT = 1

/**
 * 根据搜索关键词计算单条结果的基础命中分数。
 *
 * 逻辑：
 * - 每个命中字段按 FIELD_WEIGHTS 加分
 * - 精确匹配比模糊匹配加分更多（1.5x）
 * - 高亮数量反映命中密度
 */
export function calculateHitScore(
  keyword: string,
  matchedFields: string[],
  highlights?: { field: string; snippet: string }[],
): number {
  if (!keyword || matchedFields.length === 0) return 0

  const lowerKeyword = keyword.toLowerCase()
  let score = 0

  for (const field of matchedFields) {
    const weight = FIELD_WEIGHTS[field] ?? DEFAULT_FIELD_WEIGHT
    // 精确匹配加成
    const exactBonus = field.toLowerCase().includes(lowerKeyword) ? 1.5 : 1.0
    score += weight * exactBonus
  }

  // 高亮密度加分（每个高亮 +2）
  if (highlights) {
    score += highlights.length * 2
  }

  return score
}

/**
 * 计算综合排序分数。
 *
 * 分数组成：
 * 1. 命中分数（来自 calculateHitScore）
 * 2. 更新时间分数（最近更新越高分）
 * 3. 实体类型优先级（项目 > 任务 > ... > 活动）
 * 4. 实体 ID（稳定排序决胜）
 */
export function calculateCompositeScore(
  hitScore: number,
  updatedAt: string | null,
  entityType: SearchEntityType,
  entityId: number,
): number {
  // 更新时间分数：最近 30 天内更新计 0-10 分
  let timeScore = 0
  if (updatedAt) {
    const dt = DateTime.fromISO(updatedAt)
    if (dt.isValid) {
      const daysAgo = dt.diffNow('days').negate().days
      if (daysAgo >= 0 && daysAgo <= 30) {
        timeScore = Math.max(0, 10 - daysAgo * (10 / 30))
      }
    }
  }

  // 实体类型优先级分数（越低优先级越高 → 越高分）
  const typePriority = getEntityTypePriority(entityType)
  const typeScore = Math.max(0, 10 - typePriority)

  // ID 稳定排序（作为最终决胜：ID 越大越新，越靠前）
  const idStability = entityId / 1000000

  return hitScore * 10 + timeScore * 3 + typeScore * 2 + idStability
}

/**
 * 多来源结果合并与稳定排序。
 *
 * 排序规则：
 * 1. 综合分数降序
 * 2. 实体类型优先级升序（项目优先）
 * 3. 更新时间降序
 * 4. 实体 ID 降序（稳定决胜）
 */
export function mergeAndSortResults(
  results: SearchResultItem[],
  sorts?: SearchSort[],
): SearchResultItem[] {
  if (sorts && sorts.length > 0) {
    return sortByUserPreference(results, sorts)
  }

  return [...results].sort((a, b) => {
    // 综合分数降序
    if (b.score !== a.score) return b.score - a.score
    // 实体类型优先级
    const pa = getEntityTypePriority(a.entityType)
    const pb = getEntityTypePriority(b.entityType)
    if (pa !== pb) return pa - pb
    // 更新时间降序
    if (a.updatedAt && b.updatedAt) {
      const cmp = b.updatedAt.localeCompare(a.updatedAt)
      if (cmp !== 0) return cmp
    } else if (a.updatedAt) {
      return -1
    } else if (b.updatedAt) {
      return 1
    }
    // ID 降序（稳定决胜）
    return b.entityId - a.entityId
  })
}

/**
 * 按用户偏好排序。
 */
function sortByUserPreference(
  results: SearchResultItem[],
  sorts: SearchSort[],
): SearchResultItem[] {
  return [...results].sort((a, b) => {
    for (const sort of sorts) {
      let cmp = 0
      switch (sort.field) {
        case 'updated_at':
          cmp = compareString(a.updatedAt, b.updatedAt)
          break
        case 'created_at':
          cmp = compareNumber(a.entityId, b.entityId)
          break
        case 'name':
          cmp = a.title.localeCompare(b.title)
          break
        case 'status':
          cmp = compareString(a.status, b.status)
          break
        default:
          cmp = 0
      }
      if (cmp !== 0) {
        return sort.direction === 'desc' ? -cmp : cmp
      }
    }
    // 稳定决胜
    return b.entityId - a.entityId
  })
}

function compareString(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  return a.localeCompare(b)
}

function compareNumber(a: number | null | undefined, b: number | null | undefined): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1
  if (b === null || b === undefined) return 1
  return a - b
}

/**
 * 分页裁剪结果。
 */
export function paginateResults(
  results: SearchResultItem[],
  page: number,
  perPage: number,
): { items: SearchResultItem[]; total: number; totalPages: number } {
  const total = results.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const start = (page - 1) * perPage
  const items = results.slice(start, start + perPage)

  return { items, total, totalPages }
}

/**
 * 为搜索结果项重新计算并设置综合分数。
 */
export function assignScores(items: SearchResultItem[], keyword: string): SearchResultItem[] {
  return items.map((item) => {
    const hitScore = calculateHitScore(keyword, item.matchedFields, item.highlights)
    const score = calculateCompositeScore(hitScore, item.updatedAt, item.entityType, item.entityId)
    return { ...item, score }
  })
}
