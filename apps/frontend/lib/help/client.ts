/**
 * 帮助中心客户端访问（复制 Markdown / 搜索索引）。
 * 直接读取 auth store 中的 access token 并附加 Bearer（Route Handler 经后端权威校验）。
 */
import { useAuthStore } from '@/stores/auth-store'
import type { HelpContentType, HelpRole } from './types'

export interface HelpIndexResponse {
  locale: string
  productVersion: string
  documents: Array<{
    id: string
    title: string
    summary: string
    contentType: HelpContentType
    area: string
    roles: HelpRole[]
    updatedAt: string
    headings: string[]
    keywords: string[]
    body: string
  }>
  learningPaths: Array<{
    id: string
    label: string
    description?: string
    roles: HelpRole[]
    articleIds: string[]
  }>
  areas: Array<{ id: string; label: string; description?: string }>
  staleUpdatedAtDays: number
}

function authHeaders(): HeadersInit {
  const token = useAuthStore.getState().accessToken
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

/** 获取当前用户帮助索引（搜索用）。响应非 ok 抛错（调用方呈现 error 态）。 */
export async function fetchHelpIndex(signal?: AbortSignal): Promise<HelpIndexResponse> {
  const res = await fetch('/api/help/index', { headers: authHeaders(), signal })
  if (!res.ok) {
    throw new Error(`HELP_INDEX_${res.status}`)
  }
  const body = (await res.json()) as { data: HelpIndexResponse }
  return body.data
}

/** 获取文章 Markdown（复制 Markdown / Agent 同源出口）。 */
export async function fetchArticleMarkdown(
  articleId: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`/api/help/articles/${encodeURIComponent(articleId)}`, {
    headers: authHeaders(),
    signal,
  })
  if (!res.ok) {
    throw new Error(`HELP_ARTICLE_${res.status}`)
  }
  return res.text()
}
