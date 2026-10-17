/**
 * 帮助中心内容 lint 核心（v3-help-and-operational-issues-center 1.1/1.4）。
 *
 * 检查项（design C 要求 + spec「Documentation is maintainable and accessible」）：
 * - frontmatter 解析与字段合法性（id 唯一、title/summary/owner 非空、日期格式、
 *   updatedAt<=reviewAfter、roles/editions/contentType 枚举、permissions 格式、
 *   related 可解析、screenshots 文件存在、id 与 area.slug 一致）；
 * - heading 不跳级；how-to/tutorial 且 contentStatus=complete 的文章必须含
 *   设计 D 固定结构（操作步骤/验证结果/常见问题/下一步）；
 * - 内部链接（/help/articles/...）与相对链接（area/slug.mdx）可解析、图片存在；
 * - orphan 文章（navigation 未收录）与导航引用缺失文章；
 * - staleness：reviewAfter 已过 → error；updatedAt 过旧（staleUpdatedAtDays）→ warn；
 * - 禁用词（internal-note 等内部注记/secret）→ error。
 *
 * 纯函数、无副作用，可被 CLI（scripts/help-content-lint.ts）与 vitest 直接调用。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  parseNavigation,
  listArticleFiles,
  articleIdMap,
  readLintConfig,
  parseArticleFile,
} from './load'
import type { HelpArticle } from './types'

export type LintSeverity = 'error' | 'warning'

export interface ContentLintIssue {
  severity: LintSeverity
  code: string
  articleId?: string
  path?: string
  message: string
}

export interface LintOptions {
  /** 明日日期用于 staleness（便于测试注入）。 */
  today?: string
  /** 允许逃逸的检查（调试用，不用于 CI）。 */
  skip?: Array<'headings' | 'sections' | 'links' | 'orphan' | 'stale' | 'frontmatter'>
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 设计 D 固定结构（complete 文章必须包含的标题集合）。 */
export const REQUIRED_SECTIONS = ['操作步骤', '验证结果', '常见问题', '下一步'] as const

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function isInternalLink(href: string): boolean {
  return href.startsWith('/help/') && !href.includes('://')
}

/** 链接目标解析成文章 id（/help/... 形式）。 */
function linkToArticleId(href: string): string | null {
  const m = /^\/help\/(?:articles\/)?(.+?)(?:#.*)?$/.exec(href)
  if (!m) return null
  return m[1]!.replace(/\/$/, '')
}

export interface LintOptions {
  /** 明日日期用于 staleness（便于测试注入）。 */
  today?: string
  /** 允许逃逸的检查（调试用，不用于 CI）。 */
  skip?: Array<'headings' | 'sections' | 'links' | 'orphan' | 'stale' | 'frontmatter'>
}

export function lintContent(contentDir: string, options: LintOptions = {}): ContentLintIssue[] {
  const issues: ContentLintIssue[] = []
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const cfg = readLintConfig(contentDir)
  const allowedHosts = new Set(cfg.allowedExternalHosts ?? [])

  // ---- 加载与 frontmatter ----
  const parsed: Array<{ article?: HelpArticle; error?: unknown; path: string }> = []
  for (const file of listArticleFiles(contentDir)) {
    const slash = file.replace(/\\/g, '/')
    const relParts = slash.split('/')
    if (relParts.length < 2) continue
    const area = relParts[relParts.length - 2]!
    const slug = (relParts[relParts.length - 1] ?? '').replace(/\.(mdx|md)$/, '')
    try {
      const raw = readFileSync(file, 'utf8')
      parsed.push({ article: parseArticleFile(area, slug, raw, file), path: file })
    } catch (err) {
      parsed.push({ error: err, path: file })
    }
  }

  const articles = parsed.flatMap((p) => (p.article ? [p.article] : []))
  const byId = articleIdMap(articles)

  // 重复 id（不同文件声称同一文章 id → 同源契约破坏）
  const idCount = new Map<string, number>()
  for (const article of articles) {
    idCount.set(article.id, (idCount.get(article.id) ?? 0) + 1)
  }
  for (const [id, count] of idCount) {
    if (count > 1) {
      issues.push({
        severity: 'error',
        code: 'frontmatter.duplicate-id',
        articleId: id,
        message: `文章 id「${id}」被 ${count} 个文件重复声明`,
      })
    }
  }

  // frontmatter 解析失败
  for (const p of parsed) {
    if (!p.error) continue
    const msg = p.error instanceof Error ? p.error.message : String(p.error)
    issues.push({
      severity: 'error',
      code: 'frontmatter.invalid',
      path: p.path,
      message: `frontmatter 解析/校验失败：${msg}`,
    })
  }

  // ---- frontmatter 规则 ----
  for (const article of articles) {
    const fm = article.frontmatter
    const where = { articleId: article.id, path: article.path }

    if (fm.id !== `${article.area}.${article.slug}`) {
      issues.push({
        ...where,
        severity: 'error',
        code: 'frontmatter.id-mismatch',
        message: `id 应为 <area>.<slug>（${article.area}.${article.slug}），实际 ${fm.id}`,
      })
    }
    if (!DATE_RE.test(fm.updatedAt) || !DATE_RE.test(fm.reviewAfter)) {
      issues.push({
        ...where,
        severity: 'error',
        code: 'frontmatter.date-invalid',
        message: 'updatedAt/reviewAfter 须为 YYYY-MM-DD',
      })
    }
    if (fm.updatedAt > fm.reviewAfter) {
      issues.push({
        ...where,
        severity: 'error',
        code: 'frontmatter.date-order',
        message: 'updatedAt 不能晚于 reviewAfter',
      })
    }
    for (const relatedId of fm.related) {
      if (!byId.has(relatedId)) {
        issues.push({
          ...where,
          severity: 'error',
          code: 'frontmatter.related-missing',
          message: `related 引用了不存在的文章：${relatedId}`,
        })
      }
    }
    for (const shot of fm.screenshots) {
      // 相对内容根或文章同目录解析图片资源（assets/<name>.png）
      const fromRoot = join(contentDir, shot.replace(/^\.\//, ''))
      const fromArticle = join(dirname(article.path), shot.replace(/^\.\//, ''))
      if (!existsSync(fromRoot) && !existsSync(fromArticle)) {
        issues.push({
          ...where,
          severity: 'error',
          code: 'frontmatter.screenshot-missing',
          message: `截图资源不存在：${shot}`,
        })
      }
    }
    for (const term of fm.featureFlags) {
      if (!/^[a-z][a-z0-9-]*$/.test(term)) {
        issues.push({
          ...where,
          severity: 'warning',
          code: 'frontmatter.flag-format',
          message: `featureFlag 命名不规范：${term}`,
        })
      }
    }
  }

  // ---- heading 不跳级 / 固定结构 / 禁用词 ----
  for (const article of articles) {
    const where = { articleId: article.id, path: article.path }
    let prev = 0
    for (const h of article.headings) {
      if (prev !== 0 && h.level > prev + 1) {
        issues.push({
          ...where,
          severity: 'warning',
          code: 'heading.skip-level',
          message: `标题跳级：${h.text}（${prev} → ${h.level}）`,
        })
      }
      prev = h.level
    }
    if (article.frontmatter.contentStatus === 'complete') {
      if (['how-to', 'tutorial'].includes(article.frontmatter.contentType)) {
        const titles = article.headings.map((h) => h.text)
        for (const section of REQUIRED_SECTIONS) {
          if (!titles.includes(section)) {
            issues.push({
              ...where,
              severity: 'error',
              code: 'sections.missing',
              message: `complete 的 how-to/tutorial 缺少固定结构「${section}」（设计 D）`,
            })
          }
        }
      }
    }
    if (cfg.forbiddenTerms?.length) {
      for (const term of cfg.forbiddenTerms) {
        if (article.body.includes(term)) {
          issues.push({
            ...where,
            severity: 'error',
            code: 'content.forbidden-term',
            message: `正文包含禁止词「${term}」（内部注记/secret 不得进入 Agent 出口）`,
          })
        }
      }
    }
  }

  // ---- 链接与图片 ----
  for (const article of articles) {
    const where = { articleId: article.id, path: article.path }
    const inlineLinkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    for (const m of article.body.matchAll(inlineLinkRe)) {
      const href = m[2]!
      if (href.startsWith('#')) continue
      if (isInternalLink(href)) {
        const targetArticleId = linkToArticleId(href)
        if (!targetArticleId || !byId.has(targetArticleId)) {
          issues.push({
            ...where,
            severity: 'error',
            code: 'link.broken-internal',
            message: `内部链接无法解析到文章：${href}`,
          })
        }
      } else if (!href.includes('://') && !href.startsWith('/')) {
        // 相对链接：解析到文章自身同目录（area/slug.mdx 或 assets/...）
        const slash = article.path.replace(/\\/g, '/')
        const base = slash.slice(0, slash.lastIndexOf('/'))
        const target = join(base, href.split('#')[0] ?? href)
        if (!existsSync(target)) {
          issues.push({
            ...where,
            severity: 'error',
            code: 'link.broken-relative',
            message: `相对链接目标不存在：${href}（解析到 ${target}）`,
          })
        }
      } else if (href.startsWith('http') && allowedHosts.size > 0) {
        let host: string | null = null
        try {
          host = new URL(href).hostname
        } catch {
          host = null
        }
        if (host && !allowedHosts.has(host)) {
          issues.push({
            ...where,
            severity: 'error',
            code: 'link.host-not-allowed',
            message: `外链 host 不在允许列表：${host}`,
          })
        }
      }
    }
    // 图片
    const imgRe = /!\[([^\]]*)\]\(([^)\s]+)\)/g
    for (const m of article.body.matchAll(imgRe)) {
      const src = m[2]!
      if (src.startsWith('http') || src.startsWith('/')) continue
      const slash = article.path.replace(/\\/g, '/')
      const base = slash.slice(0, slash.lastIndexOf('/'))
      if (!existsSync(join(base, src))) {
        issues.push({
          ...where,
          severity: 'error',
          code: 'image.missing',
          message: `图片不存在：${src}`,
        })
      }
      if (!(m[1] ?? '').trim()) {
        issues.push({
          ...where,
          severity: 'error',
          code: 'image.alt-missing',
          message: `图片缺少替代文字（alt）：${src}`,
        })
      }
    }
  }

  // ---- orphan / 导航引用 ----
  let nav: ReturnType<typeof parseNavigation>['nav'] | null = null
  try {
    nav = parseNavigation(contentDir).nav
  } catch {
    nav = null
  }
  if (nav) {
    const navIds = new Set<string>()
    for (const area of nav.areas) for (const id of area.articleIds) navIds.add(id)
    for (const path of nav.learningPaths) for (const id of path.articleIds) navIds.add(id)
    // 版本一致性：文章 productVersion 与导航版本对齐（1.4 文档版本契约）
    for (const article of articles) {
      if (
        nav.productVersion &&
        article.frontmatter.productVersion &&
        article.frontmatter.productVersion !== nav.productVersion
      ) {
        issues.push({
          severity: 'warning',
          code: 'frontmatter.version-mismatch',
          articleId: article.id,
          path: article.path,
          message: `文章版本 ${article.frontmatter.productVersion} 与导航版本 ${nav.productVersion} 不一致`,
        })
      }
    }
    for (const article of articles) {
      if (!navIds.has(article.id)) {
        issues.push({
          severity: 'warning',
          code: 'orphan.article',
          articleId: article.id,
          path: article.path,
          message: `文章未被 navigation.yaml 收录（orphan）`,
        })
      }
    }
    for (const id of navIds) {
      if (!byId.has(id)) {
        issues.push({
          severity: 'error',
          code: 'orphan.nav-missing',
          message: `navigation.yaml 引用了不存在的文章：${id}`,
        })
      }
    }
    // area 引用校验
    for (const area of nav.areas) {
      for (const id of area.articleIds) {
        const a = byId.get(id)
        if (a && a.area !== area.id) {
          issues.push({
            severity: 'error',
            code: 'frontmatter.area-mismatch',
            articleId: id,
            message: `文章 ${id} 位于 area「${a.area}」，navigation 却挂在「${area.id}」`,
          })
        }
      }
    }
  } else {
    issues.push({
      severity: 'error',
      code: 'orphan.nav-unreadable',
      message: 'navigation.yaml 无法解析',
    })
  }

  // ---- staleness ----
  for (const article of articles) {
    const where = { articleId: article.id, path: article.path }
    if (article.frontmatter.reviewAfter < today) {
      issues.push({
        ...where,
        severity: 'error',
        code: 'stale.review-overdue',
        message: `reviewAfter（${article.frontmatter.reviewAfter}）已过期，需 owner 复核`,
      })
    }
    const staleDays = cfg.staleUpdatedAtDays ?? 200
    if (daysBetween(article.frontmatter.updatedAt, today) > staleDays) {
      issues.push({
        ...where,
        severity: 'warning',
        code: 'stale.updated-old',
        message: `updatedAt（${article.frontmatter.updatedAt}）超过 ${staleDays} 天未更新`,
      })
    }
  }

  return issues
}

/** CLI 汇总：返回是否有 error 级问题。 */
export function summarizeIssues(issues: ContentLintIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  }
}
