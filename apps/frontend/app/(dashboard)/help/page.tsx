import Link from 'next/link'
import { BookOpen, Compass, ArrowRight, LifeBuoy, Wrench, CalendarClock } from 'lucide-react'
import { resolveHelpContentDir, loadArticlesCached } from '@/lib/help/load'
import { HelpSearchBox } from '@/components/help/HelpSearchBox'
import { TextVariantSwitcher } from '@/components/locale/text-variant-switcher'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

/**
 * `/help` 帮助中心首页（v3-help-and-operational-issues-center 1.2，design E）。
 *
 * 首屏：搜索框、按角色开始、当前版本状态；后续：产品模块网格、故障排查、
 * 最近更新。内容全部来自仓库 Markdown 内容树（同一内容源，非营销页）。
 */
export default function HelpHomePage() {
  const { articles, nav } = loadArticlesCached(resolveHelpContentDir())

  const byId = new Map(articles.map((a) => [a.id, a]))
  const areaLabels = new Map(nav.areas.map((a) => [a.id, a.label]))
  const areaArticles = new Map<string, Array<{ id: string; title: string }>>()
  for (const area of nav.areas) {
    const list: Array<{ id: string; title: string }> = []
    for (const id of area.articleIds) {
      const a = byId.get(id)
      if (a) list.push({ id, title: a.frontmatter.title })
    }
    areaArticles.set(area.id, list)
  }

  const recent = [...articles]
    .sort((a, b) => (a.frontmatter.updatedAt < b.frontmatter.updatedAt ? 1 : -1))
    .slice(0, 5)

  const troubleshootingIds = nav.areas.find((a) => a.id === 'troubleshooting')?.articleIds ?? []
  const troubleshooting = troubleshootingIds
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))

  return (
    <div className="mx-auto max-w-5xl space-y-10 py-8" data-testid="help-home">
      {/* 首屏 */}
      <header className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <BookOpen className="h-7 w-7 text-primary" /> 帮助与文档
          </h1>
          <Badge variant="outline" data-testid="help-version">
            当前产品版本 {nav.productVersion}
          </Badge>
          <TextVariantSwitcher variant="ghost" className="ml-auto" />
        </div>
        <p className="max-w-2xl text-muted-foreground">
          用一句话启动项目，AI 生成完整计划。搜索文章、按角色开始，或直接浏览产品模块。
        </p>
        <HelpSearchBox
          size="large"
          placeholder="搜索：创建项目、AI 连接、Copilot、权限、Docker 部署…"
        />
      </header>

      {/* 系统状态入口 */}
      <section
        aria-label="系统状态与支持"
        className="flex flex-wrap gap-3"
        data-testid="help-status-entry"
      >
        <Button asChild variant="secondary">
          <Link href="/help/search?q=故障">
            <Wrench className="mr-1.5 h-4 w-4" /> 故障排查
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/help/search?q=部署">
            <LifeBuoy className="mr-1.5 h-4 w-4" /> 部署与运维支持
          </Link>
        </Button>
      </section>

      {/* 按角色开始 */}
      <section aria-label="按角色开始" data-testid="help-learning-paths">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Compass className="h-5 w-5 text-primary" /> 按角色开始
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {nav.learningPaths.map((path) => {
            const firstId = path.articleIds.find((id) => byId.has(id))
            return (
              <Card key={path.id} className="hover:border-primary/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{path.label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">{path.description}</p>
                  {firstId ? (
                    <Button asChild size="sm">
                      <Link href={`/help/articles/${encodeURIComponent(firstId)}`}>
                        开始使用 <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">内容准备中</span>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* 产品模块网格 */}
      <section aria-label="产品模块" data-testid="help-modules">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-primary" /> 产品模块
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {nav.areas.map((area) => {
            const list = areaArticles.get(area.id) ?? []
            if (list.length === 0) return null
            return (
              <Card key={area.id} data-testid={`help-module-${area.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{area.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {list.slice(0, 4).map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/help/articles/${encodeURIComponent(a.id)}`}
                          className="text-sm text-muted-foreground hover:text-primary"
                        >
                          {a.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* 故障排查 */}
      {troubleshooting.length > 0 && (
        <section aria-label="故障排查" data-testid="help-troubleshooting">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Wrench className="h-5 w-5 text-primary" /> 故障排查
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {troubleshooting.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/help/articles/${encodeURIComponent(a.id)}`}
                  className="block rounded border p-3 text-sm hover:border-primary/40 hover:bg-accent/40"
                >
                  {a.frontmatter.title}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {a.frontmatter.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 最近更新 */}
      <section aria-label="最近更新" data-testid="help-recent">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <CalendarClock className="h-5 w-5 text-primary" /> 最近更新
        </h2>
        <ul className="space-y-1.5">
          {recent.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <Link
                href={`/help/articles/${encodeURIComponent(a.id)}`}
                className="text-sm hover:text-primary"
              >
                {a.frontmatter.title}
              </Link>
              <Badge variant="neutral">{areaLabels.get(a.area) ?? a.area}</Badge>
              <span className="text-xs text-muted-foreground">{a.frontmatter.updatedAt}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
