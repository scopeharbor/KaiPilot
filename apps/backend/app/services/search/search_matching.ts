// v2-advanced-search — SQLite 轻量匹配工具
//
// 提供 SQLite 可运行的关键词转义、LIKE/ILIKE 方言兼容和白名单字段匹配。

/**
 * 转义 LIKE 通配符（% _）。
 * SQLite 使用 % 和 _ 作为 LIKE 通配符，需用 ESCAPE '\\' 转义。
 */
export function escapeLikeWildcards(value: string): string {
  return value
    .replace(/\\/g, '\\\\') // 反斜杠先转义
    .replace(/%/g, '\\%') // % → \%
    .replace(/_/g, '\\_') // _ → \_
}

/**
 * 构建 SQLite LIKE 模式（匹配任意位置）。
 */
export function buildLikePattern(keyword: string): string {
  return `%${escapeLikeWildcards(keyword)}%`
}

/**
 * 构建 SQLite ILIKE 模式（匹配任意位置，大小写不敏感）。
 * SQLite 的 LIKE 默认大小写不敏感（ASCII 范围），
 * ILIKE 是显式大小写不敏感语法（PG 兼容）。
 */
export function buildILikePattern(keyword: string): string {
  return buildLikePattern(keyword)
}

/**
 * 从关键词中提取有意义的匹配 token。
 * 对中文关键词按字符拆分，对英文按空格拆分。
 */
export function extractSearchTokens(keyword: string): string[] {
  if (!keyword || keyword.trim().length === 0) return []

  const trimmed = keyword.trim()

  // 判断是否包含中文
  const hasChinese = /[一-鿿]/.test(trimmed)

  if (hasChinese) {
    // 中文：按字符拆分（单字搜索）
    const chars = trimmed.replace(/\s+/g, '').split('')
    // 去重并过滤空白字符
    return [...new Set(chars.filter((c) => c.trim().length > 0))]
  }

  // 英文/数字：按空白拆分
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0)
  return [...new Set(words)]
}

/**
 * 检查字段值是否匹配关键词（不区分大小写）。
 */
export function fieldMatchesKeyword(
  fieldValue: string | null | undefined,
  keyword: string,
): boolean {
  if (!fieldValue || !keyword) return false
  return fieldValue.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * 字段命中检测：判断给定字段是否匹配关键词。
 * 返回此字段的权重得分。
 */
export function getFieldMatchScore(fieldValue: string | null | undefined, keyword: string): number {
  if (!fieldValue || !keyword) return 0
  const lower = fieldValue.toLowerCase()
  const kw = keyword.toLowerCase()

  if (lower === kw) return 1.0 // 精确匹配
  if (lower.startsWith(kw)) return 0.8 // 前缀匹配
  if (lower.includes(kw)) return 0.5 // 子串匹配
  return 0
}

/**
 * 白名单字段过滤：确保只搜索允许的字段。
 */
export function filterAllowedFields(requested: string[], allowed: string[]): string[] {
  return requested.filter((f) => allowed.includes(f))
}

/**
 * SQLite 稳定排序辅助：结合排序字段和 ID 保证跨页排序确定性。
 */
export function buildStableSortOrder(sortField: string, sortDirection: 'asc' | 'desc'): string {
  return `${sortField} ${sortDirection}, id ${sortDirection}`
}
