import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { agentExportMarkdown, loadArticlesCached, resolveHelpContentDir } from '@/lib/help/load'
import {
  HelpArticleReader,
  type HelpNavTreeGroup,
  type HelpReaderArticle,
} from '@/components/next/help/HelpArticleReader'

/**
 * 新轨帮助文章详情页（/next/help/articles/[id]，
 * v3-ui-next-help-knowledge-domain W1 · tasks 1.5，
 * spec「帮助文章详情与长文纸光排版阅读」）。
 *
 * - RSC + `loadArticlesCached` 毫秒级直出；`generateMetadata` 按 frontmatter
 *   动态产出 title/description；
 * - 无效 articleId → 触发 `notFound()` 中性 404（零网络、零数据外泄）；
 * - 复制 Markdown / Agent 提示词文本在服务端预计算后传入客户端叶子组件，
 *   正文阅读链路零网络请求（Design D3）。
 */
export default async function NextHelpArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const articleId = decodeURIComponent(resolvedParams.id)
  const { articles, nav } = loadArticlesCached(resolveHelpContentDir())

  const article = articles.find((candidate) => candidate.id === articleId)
  if (!article) notFound()

  const byId = new Map(articles.map((candidate) => [candidate.id, candidate]))
  const areaLabel = nav.areas.find((area) => area.id === article.area)?.label ?? article.area

  // 左树：各 area 按其导航顺序解析，仅保留含文章的组
  const tree: HelpNavTreeGroup[] = []
  for (const area of nav.areas) {
    const resolved = area.articleIds
      .map((id) => byId.get(id))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    if (resolved.length === 0) continue
    tree.push({
      areaId: area.id,
      areaLabel: area.label,
      articles: resolved.map((candidate) => ({
        id: candidate.id,
        title: candidate.frontmatter.title,
      })),
    })
  }

  const relatedTitles: Record<string, string> = {}
  for (const id of article.frontmatter.related) {
    const related = byId.get(id)
    if (related) relatedTitles[id] = related.frontmatter.title
  }

  const viewArticle: HelpReaderArticle = {
    id: article.id,
    area: article.area,
    title: article.frontmatter.title,
    summary: article.frontmatter.summary,
    contentType: article.frontmatter.contentType,
    contentStatus: article.frontmatter.contentStatus,
    productVersion: article.frontmatter.productVersion,
    editions: article.frontmatter.editions,
    owner: article.frontmatter.owner,
    updatedAt: article.frontmatter.updatedAt,
    reviewAfter: article.frontmatter.reviewAfter,
    related: article.frontmatter.related,
    body: article.body,
    headings: article.headings,
  }

  return (
    <HelpArticleReader
      article={viewArticle}
      areaLabel={areaLabel}
      tree={tree}
      relatedTitles={relatedTitles}
      markdownText={article.body}
      agentPromptText={agentExportMarkdown(article)}
    />
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
  const article = articles.find((candidate) => candidate.id === articleId)
  if (!article) return { title: '文章不存在 · 帮助中心' }
  return {
    title: `${article.frontmatter.title} · 帮助中心`,
    description: article.frontmatter.summary,
  }
}
