import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveHelpContentDir, loadArticlesCached } from '@/lib/help/load'
import { HelpArticleView, type HelpArticleViewArticle } from '@/components/help/HelpArticleView'
import { HelpNavigationTree, type HelpTreeItem } from '@/components/help/HelpNavigationTree'
import { HelpMobileNav } from '@/components/help/HelpMobileNav'

/**
 * `/help/articles/:id` 文章页（v3-help-and-operational-issues-center 1.2，design E）。
 * 左树/移动端 drawer + 中间正文 + 右侧目录；正文与复制 Markdown/Agent 出口同源。
 */
export default async function HelpArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const articleId = decodeURIComponent(resolvedParams.id)
  const { articles, nav } = loadArticlesCached(resolveHelpContentDir())

  const article = articles.find((a) => a.id === articleId)
  if (!article) notFound()

  const byId = new Map(articles.map((a) => [a.id, a]))
  const areaLabel = nav.areas.find((a) => a.id === article.area)?.label ?? article.area

  const treeItems: HelpTreeItem[] = nav.areas.flatMap((area) => {
    const list = area.articleIds
      .map((id) => byId.get(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
    if (list.length === 0) return []
    return [
      {
        areaId: area.id,
        areaLabel: area.label,
        articles: list.map((a) => ({ id: a.id, title: a.frontmatter.title })),
      },
    ]
  })

  const relatedTitles: Record<string, string> = {}
  for (const id of article.frontmatter.related) {
    const rel = byId.get(id)
    if (rel) relatedTitles[id] = rel.frontmatter.title
  }

  const viewArticle: HelpArticleViewArticle = {
    id: article.id,
    area: article.area,
    title: article.frontmatter.title,
    summary: article.frontmatter.summary,
    contentType: article.frontmatter.contentType,
    roles: article.frontmatter.roles,
    editions: article.frontmatter.editions,
    productVersion: article.frontmatter.productVersion,
    featureFlags: article.frontmatter.featureFlags,
    owner: article.frontmatter.owner,
    updatedAt: article.frontmatter.updatedAt,
    reviewAfter: article.frontmatter.reviewAfter,
    related: article.frontmatter.related,
    screenshots: article.frontmatter.screenshots,
    contentStatus: article.frontmatter.contentStatus,
    body: article.body,
    headings: article.headings,
  }

  return (
    <div className="mx-auto max-w-6xl py-8">
      {/* 移动端目录 */}
      <div className="mb-4 flex items-center gap-3 lg:hidden">
        <HelpMobileNav items={treeItems} currentId={article.id} />
      </div>

      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            <HelpNavigationTree items={treeItems} currentId={article.id} />
          </div>
        </aside>
        <main className="min-w-0">
          <HelpArticleView
            article={viewArticle}
            areaLabel={areaLabel}
            relatedTitles={relatedTitles}
          />
        </main>
      </div>
    </div>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const resolvedParams = await params
  const articleId = decodeURIComponent(resolvedParams.id)
  const { articles } = loadArticlesCached(resolveHelpContentDir())
  const article = articles.find((a) => a.id === articleId)
  if (!article) return { title: '文章不存在 · 帮助中心' }
  return {
    title: `${article.frontmatter.title} · 帮助中心`,
    description: article.frontmatter.summary,
  }
}
