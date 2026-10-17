import { NextResponse, type NextRequest } from 'next/server'
import { resolveHelpContentDir, loadArticlesCached, agentExportMarkdown } from '@/lib/help/load'
import { canAccessArticle, verifyHelpActor } from '@/lib/help/agent-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Agent 文章出口（v3-help-and-operational-issues-center 1.3）。
 *
 * GET /api/help/articles/:id
 * - 鉴权：Authorization: Bearer <token>，经后端 /auth/profile 权威校验；
 * - 过滤：frontmatter.permissions 非空时按用户权限过滤（403）；
 * - 正文与网页渲染同一 canonical body（agentExportMarkdown：标题+版本+时间，
 *   无导航 chrome、无 frontmatter 原文、无内部注释、无原始路径）；
 * - 响应 Content-Type: text/markdown。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const articleId = resolvedParams.id
  const authorization = request.headers.get('authorization')

  const actor = await verifyHelpActor(authorization)
  if (!actor) {
    return NextResponse.json(
      { error: { code: 'AUTH_REQUIRED', message: '请提供有效的 Bearer token' } },
      { status: 401 },
    )
  }

  const { articles } = loadArticlesCached(resolveHelpContentDir())

  const article = articles.find((a) => a.id === articleId)
  if (!article) {
    return NextResponse.json(
      { error: { code: 'RESOURCE_NOT_FOUND', message: `文章不存在：${articleId}` } },
      { status: 404 },
    )
  }

  if (!canAccessArticle(article.frontmatter.permissions, actor)) {
    return NextResponse.json(
      { error: { code: 'PERMISSION_DENIED', message: '你的角色无权读取该文章' } },
      { status: 403 },
    )
  }

  const markdown = agentExportMarkdown(article)
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Help-Article-Id': article.id,
      'X-Help-Article-Version': article.frontmatter.productVersion,
      'X-Help-Article-Updated-At': article.frontmatter.updatedAt,
      'X-Help-Article-Content-Status': article.frontmatter.contentStatus,
    },
  })
}
