import { Suspense } from 'react'
import { loadArticlesCached, resolveHelpContentDir } from '@/lib/help/load'
import { buildSearchIndex } from '@/lib/help/search'
import { HelpSearchWorkspace } from '@/components/next/help/HelpSearchWorkspace'

/**
 * 新轨帮助搜索中心（/next/help/search，v3-ui-next-help-knowledge-domain W1 ·
 * tasks 1.7，spec「帮助中心实时搜索与关键词过滤」）。
 *
 * - URL `?q=` 为查询唯一事实来源；同路由内参数变化用 `key={q}` 强制重挂载，
 *   保证软导航（含前进/后退）下输入与结果毫秒级同步；
 * - 索引由服务端经 `loadArticlesCached` 直出（RSC），客户端零网络检索；
 * - Suspense 外壳在 RSC 直出期间呈现发丝线骨架条目，杜绝页面高度塌陷。
 */
export default async function NextHelpSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const resolvedSearchParams = await searchParams
  const rawQuery = resolvedSearchParams?.q
  const q = typeof rawQuery === 'string' ? rawQuery : ''

  const { articles, nav } = loadArticlesCached(resolveHelpContentDir())
  const { documents } = buildSearchIndex(articles, nav.learningPaths)

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Suspense
        fallback={
          <div
            data-testid="next-help-search-skeleton"
            aria-busy="true"
            className="flex w-full flex-col gap-3"
          >
            <div className="h-10 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-16 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
              />
            ))}
          </div>
        }
      >
        <HelpSearchWorkspace
          key={q}
          initialQuery={q}
          documents={documents}
          areas={nav.areas.map((area) => ({ id: area.id, label: area.label }))}
        />
      </Suspense>
    </div>
  )
}
