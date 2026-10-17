'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Compass,
  LifeBuoy,
  Search,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  HelpArticleSummary,
  HelpModuleGridItem,
  HelpRecentEntry,
  HelpResolvedLearningPath,
} from '@/lib/next/help/help-adapter'

/**
 * 帮助中心新轨首页工作区（v3-ui-next-help-knowledge-domain W1 · tasks 1.3，
 * spec「帮助中心首页与模块导航浏览」）。
 *
 * - 数据由 RSC 页面经 `loadArticlesCached` 直出后以轻量投影 props 传入（零网络）；
 * - 全站登录可见、零 RBAC 判断；首屏搜索框回车/点击跳转 `/next/help/search?q=`;
 * - Layer 2 暗黑仪器感：发丝线面板、模块网格、学习路径卡片、故障排查与最近更新；
 * - 面板一律纯色 + 1px 发丝线、无动效装饰，对所有沉浸档位（含 precise）均安全。
 */

export interface HelpHomeWorkspaceProps {
  /** navigation.yaml 的 productVersion（如 v3）。 */
  productVersion: string
  /** 产品模块网格（页面侧已按模块聚合 ≤4 篇）。 */
  moduleGrid: HelpModuleGridItem[]
  /** 按角色学习路径（含「开始使用」首篇目标）。 */
  learningPaths: HelpResolvedLearningPath[]
  /** 常见故障排查直达清单（空数组时隐藏区块）。 */
  troubleshooting: HelpArticleSummary[]
  /** 按 updatedAt 降序的最近更新列表。 */
  recent: HelpRecentEntry[]
}

const QUICK_LINKS: Array<{ label: string; q: string; icon: typeof Wrench }> = [
  { label: '故障排查', q: '故障', icon: Wrench },
  { label: '部署与运维支持', q: '部署', icon: LifeBuoy },
]

export function HelpHomeWorkspace({
  productVersion,
  moduleGrid,
  learningPaths,
  troubleshooting,
  recent,
}: HelpHomeWorkspaceProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')

  function goSearch(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return
    router.push(`/next/help/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <div data-testid="next-help-home" className="mx-auto flex w-full max-w-6xl flex-col gap-8 py-2">
      {/* 首屏：标题 + 版本徽标 */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-[var(--nx-text-primary)]">
            <BookOpen className="h-6 w-6 text-[var(--nx-accent)]" aria-hidden />
            帮助与文档
          </h1>
          <span
            data-testid="next-help-version-badge"
            className="inline-flex items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 font-mono text-[11px] text-[var(--nx-text-secondary)]"
          >
            当前产品版本 {productVersion}
          </span>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-[var(--nx-text-muted)]">
          用一句话启动项目，AI 生成完整计划。搜索文章、按角色开始，或直接浏览产品模块。
        </p>
      </header>

      {/* 首屏检索 + 快捷入口 */}
      <div data-testid="next-help-home-search" className="flex flex-col gap-3">
        <form
          className="relative w-full"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            goSearch(query)
          }}
        >
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--nx-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                goSearch(query)
              }
            }}
            placeholder="搜索：创建项目、AI 连接、Copilot、权限、Docker 部署…"
            aria-label="搜索帮助文档"
            data-testid="next-help-home-search-input"
            className="h-12 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] pl-10 pr-24 text-sm text-[var(--nx-text-primary)] shadow-inner placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
          <button
            type="submit"
            data-testid="next-help-home-search-submit"
            className="absolute right-1.5 top-1/2 flex h-9 -translate-y-1/2 items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            搜索
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_LINKS.map((entry) => {
            const Icon = entry.icon
            return (
              <Link
                key={entry.q}
                href={`/next/help/search?q=${encodeURIComponent(entry.q)}`}
                data-testid={
                  entry.q === '故障' ? 'next-help-quick-troubleshooting' : 'next-help-quick-deploy'
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {entry.label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* 按角色开始 */}
      <section
        aria-label="按角色开始"
        data-testid="next-help-learning-paths"
        className="flex flex-col gap-3"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-secondary)]">
          <Compass className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          按角色开始
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {learningPaths.map((path) => (
            <div
              key={path.id}
              data-testid={`next-help-path-${path.id}`}
              className="flex flex-col gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
            >
              <p className="text-sm font-medium text-[var(--nx-text-primary)]">{path.label}</p>
              {path.description ? (
                <p className="min-h-8 text-xs leading-4 text-[var(--nx-text-muted)]">
                  {path.description}
                </p>
              ) : null}
              {path.firstArticleId ? (
                <Link
                  href={`/next/help/articles/${encodeURIComponent(path.firstArticleId)}`}
                  data-testid={`next-help-path-start-${path.id}`}
                  className="mt-auto inline-flex items-center gap-1 self-start text-xs font-medium text-[var(--nx-accent)] hover:text-[var(--nx-space-cyan)]"
                >
                  开始使用 <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : (
                <span
                  data-testid={`next-help-path-empty-${path.id}`}
                  className="text-xs text-[var(--nx-text-muted)]"
                >
                  内容准备中
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 产品模块网格 */}
      <section
        aria-label="产品模块"
        data-testid="next-help-modules"
        className="flex flex-col gap-3"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-secondary)]">
          <BookOpen className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          产品模块
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {moduleGrid.map((module) => (
            <div
              key={module.areaId}
              data-testid={`next-help-module-${module.areaId}`}
              className="flex flex-col gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                  {module.areaLabel}
                </h3>
                <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {module.totalArticles} 篇
                </span>
              </div>
              {module.description ? (
                <p className="text-xs leading-4 text-[var(--nx-text-muted)]">
                  {module.description}
                </p>
              ) : null}
              <ul className="flex flex-col gap-1">
                {module.guides.map((guide) => (
                  <li key={guide.id}>
                    <Link
                      href={`/next/help/articles/${encodeURIComponent(guide.id)}`}
                      data-testid={`next-help-guide-${guide.id}`}
                      className="block truncate text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-accent)]"
                    >
                      {guide.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 故障排查直达 */}
      {troubleshooting.length > 0 && (
        <section
          aria-label="故障排查"
          data-testid="next-help-troubleshooting"
          className="flex flex-col gap-3"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-secondary)]">
            <Wrench className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
            故障排查
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {troubleshooting.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/next/help/articles/${encodeURIComponent(entry.id)}`}
                  data-testid={`next-help-trouble-${entry.id}`}
                  className="block rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 hover:border-[var(--nx-border-focus)]"
                >
                  <span className="block text-xs font-medium text-[var(--nx-text-primary)]">
                    {entry.title}
                  </span>
                  <span className="mt-1 block text-xs leading-4 text-[var(--nx-text-muted)]">
                    {entry.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 最近更新 */}
      <section aria-label="最近更新" data-testid="next-help-recent" className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-secondary)]">
          <CalendarClock className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          最近更新
        </h2>
        <ul className="flex flex-col">
          {recent.map((entry) => (
            <li
              key={entry.id}
              data-testid={`next-help-recent-${entry.id}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--nx-border-hairline)] py-2 last:border-b-0"
            >
              <Link
                href={`/next/help/articles/${encodeURIComponent(entry.id)}`}
                className={cn(
                  'text-xs text-[var(--nx-text-primary)]',
                  'hover:text-[var(--nx-accent)]',
                )}
              >
                {entry.title}
              </Link>
              <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-px font-mono text-[10px] text-[var(--nx-text-secondary)]">
                {entry.areaLabel}
              </span>
              <span className="ml-auto font-mono text-[10px] text-[var(--nx-text-muted)]">
                {entry.updatedAt}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default HelpHomeWorkspace
