import { NextResponse, type NextRequest } from 'next/server'
import { resolveHelpContentDir, loadArticlesCached } from '@/lib/help/load'
import { verifyHelpActor } from '@/lib/help/agent-auth'
import type { HelpSearchDocument } from '@/lib/help/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 搜索索引出口（v3-help-and-operational-issues-center 1.2）。
 *
 * GET /api/help/index → { documents, learningPaths, areas, config }
 * 与 `/help` 页面共用同一内容源；鉴权用户可读（帮助文档不含组织数据）。
 * body 用于客户端正文检索（design E）。
 */
export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  const actor = await verifyHelpActor(authorization)
  if (!actor) {
    return NextResponse.json(
      { error: { code: 'AUTH_REQUIRED', message: '请提供有效的 Bearer token' } },
      { status: 401 },
    )
  }

  const { articles, nav, config } = loadArticlesCached(resolveHelpContentDir())

  const documents: HelpSearchDocument[] = articles.map((a) => ({
    id: a.id,
    title: a.frontmatter.title,
    summary: a.frontmatter.summary,
    contentType: a.frontmatter.contentType,
    area: a.area,
    roles: a.frontmatter.roles,
    updatedAt: a.frontmatter.updatedAt,
    headings: a.headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`),
    keywords: a.frontmatter.keywords ?? [],
    body: a.body,
  }))

  return NextResponse.json({
    data: {
      locale: nav.locale,
      productVersion: nav.productVersion,
      documents,
      learningPaths: nav.learningPaths,
      areas: nav.areas.map((a) => ({ id: a.id, label: a.label, description: a.description })),
      staleUpdatedAtDays: config.staleUpdatedAtDays ?? 200,
    },
  })
}
