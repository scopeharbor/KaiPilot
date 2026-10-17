import { Suspense } from 'react'
import { HelpSearchResults } from '@/components/help/HelpSearchResults'

/**
 * `/help/search` 搜索页（v3-help-and-operational-issues-center 1.2）。
 * 查询真源是 URL 的 ?q=：同一路由内 ?q= 变化时，用 key={q} 强制重挂载
 * （Next.js 软导航下 useSearchParams 不随同路由 query 变化，重挂载保证输入同步）。
 * 结果、筛选与空/错/加载态在客户端呈现。
 */
export default async function HelpSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const q = typeof resolvedSearchParams?.q === 'string' ? resolvedSearchParams.q : ''
  return (
    <div className="mx-auto max-w-4xl py-8">
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">正在准备搜索…</div>}>
        <HelpSearchResults key={q} initialQuery={q} />
      </Suspense>
    </div>
  )
}
