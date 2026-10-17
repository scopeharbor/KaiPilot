// v2-advanced-search — 搜索结果低敏 DTO 映射工具
//
// 确保搜索结果不泄露敏感信息：
// - 禁止文件路径、下载 URL
// - 禁止完整业务正文
// - 禁止完整 AI 输出
// - 禁止完整报表正文
// - 禁止完整评论正文
// - 禁止 access token 或未脱敏 metadata

import type { SearchResultItem, SearchEntityType } from '@aiproj/types'

/**
 * 低敏摘要选项。
 */
export interface SummaryOptions {
  /** 最大摘要长度。默认 200 */
  maxLength?: number
  /** 是否允许包含项目名 */
  allowProjectName?: boolean
}

/**
 * 从原始内容生成低敏摘要。
 *
 * - 截断至 maxLength
 * - 过滤 HTML 标签
 * - 移除多余空白
 */
export function toLowSensitivitySummary(
  content: string | null | undefined,
  options?: SummaryOptions,
): string | null {
  if (!content) return null

  const maxLength = options?.maxLength ?? 200
  const cleaned = content
    .replace(/<[^>]*>/g, '') // 移除 HTML 标签
    .replace(/\s+/g, ' ') // 归一化空白
    .trim()

  if (cleaned.length <= maxLength) {
    return cleaned
  }
  return cleaned.substring(0, maxLength - 3) + '...'
}

/**
 * 构建安全跳转目标 URL。
 * 只导航到详情/审查/确认页面，不触发自动执行操作。
 */
export function buildSafeTarget(
  entityType: SearchEntityType,
  entityId: number,
  projectId?: number | null,
): string {
  switch (entityType) {
    case 'project':
      return `/projects/${entityId}`
    case 'task':
      return projectId ? `/projects/${projectId}/tasks/${entityId}` : `/tasks/${entityId}`
    case 'milestone':
      return projectId ? `/projects/${projectId}?milestone=${entityId}` : `/milestones/${entityId}`
    case 'file':
      return projectId ? `/projects/${projectId}/files/${entityId}` : `/files/${entityId}`
    case 'risk':
      return projectId ? `/projects/${projectId}/risks/${entityId}` : `/risks/${entityId}`
    case 'change_request':
      return projectId
        ? `/projects/${projectId}/change-requests/${entityId}`
        : `/change-requests/${entityId}`
    case 'report':
      return projectId ? `/projects/${projectId}/reports/${entityId}` : `/reports/${entityId}`
    case 'comment':
      return projectId ? `/projects/${projectId}/comments/${entityId}` : `/comments/${entityId}`
    case 'activity':
      return projectId
        ? `/projects/${projectId}/activity?logId=${entityId}`
        : `/activity?logId=${entityId}`
    case 'document':
      return projectId ? `/projects/${projectId}/documents/${entityId}` : `/documents/${entityId}`
    default:
      return projectId ? `/projects/${projectId}` : '/'
  }
}

/**
 * 构建 SearchResultItem 的基础工厂方法。
 */
export function makeSearchResultItem(params: {
  entityType: SearchEntityType
  entityId: number
  projectId?: number | null
  title: string
  summary?: string | null
  matchedFields: string[]
  highlights?: { field: string; snippet: string }[]
  status?: string | null
  updatedAt: string | null
  source: string
  metadata?: Record<string, unknown>
}): SearchResultItem {
  return {
    entityType: params.entityType,
    entityId: params.entityId,
    projectId: params.projectId ?? null,
    title: params.title,
    summary: params.summary ?? null,
    matchedFields: params.matchedFields,
    highlights: params.highlights,
    status: params.status ?? null,
    updatedAt: params.updatedAt,
    target: buildSafeTarget(params.entityType, params.entityId, params.projectId),
    source: params.source,
    score: 0, // 由 scoring 模块后续计算
    metadata: sanitizeMetadata(params.metadata),
  }
}

/**
 * 脱敏元数据：删除已知敏感字段。
 */
function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined

  const sensitiveKeys = [
    'filePath',
    'storagePath',
    'downloadUrl',
    'accessToken',
    'fullBody',
    'aiOutput',
    'fullReport',
    'fullComment',
    'password',
    'secret',
    'token',
  ]

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = value
    }
  }
  return sanitized
}
