/**
 * 帮助中心内容加载器（服务端/Build 时使用）。
 *
 * - 从 `content/help/<locale>/` 读取 navigation.yaml + 各 area 下 .mdx 文章；
 * - frontmatter 用 `yaml` 包解析并做 schema 校验（与 lint 共用同一 parse）；
 * - 文章正文 = 文件 body（不含 frontmatter），heading 抽出带锚点 id；
 * - 结果按 mtime 做进程级 memo，避免 dev 下每次请求重复读盘。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename, dirname, extname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  HELP_CONTENT_TYPES,
  HELP_CONTENT_STATUSES,
  HELP_EDITIONS,
  HELP_ROLES,
  type HelpArticle,
  type HelpArea,
  type HelpHeading,
  type HelpLearningPath,
  type HelpLintConfig,
  type HelpNav,
} from './types'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export const frontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  contentType: z.enum(HELP_CONTENT_TYPES),
  roles: z.array(z.enum(HELP_ROLES)).min(1),
  permissions: z.array(z.string().regex(/^[a-z][a-z0-9:_-]*$/)),
  editions: z.array(z.enum(HELP_EDITIONS)).min(1),
  productVersion: z.string().min(1),
  featureFlags: z.array(z.string()),
  owner: z.string().min(1),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  related: z.array(z.string()),
  screenshots: z.array(z.string()),
  keywords: z.array(z.string()).optional(),
  contentStatus: z.enum(HELP_CONTENT_STATUSES).default('skeleton'),
})

/** 解析 frontmatter + body。解析失败抛错（lint 收集）。 */
export function parseArticleFile(
  area: string,
  slug: string,
  raw: string,
  path: string,
): HelpArticle {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) {
    throw new Error(`缺少 frontmatter（需以 --- 包裹）：${path}`)
  }
  const parsed = parseYaml(match[1] ?? '') as Record<string, unknown>
  const fm = frontmatterSchema.parse(parsed)
  const body = (match[2] ?? '').trimStart()
  return {
    id: fm.id,
    area,
    slug,
    frontmatter: fm,
    body,
    headings: extractHeadings(body),
    path,
  }
}

export function extractHeadings(body: string): HelpHeading[] {
  const out: HelpHeading[] = []
  const seen = new Map<string, number>()
  for (const line of body.split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (!m) continue
    const level = m[1]!.length
    const text = m[2]!.trim()
    let id = slugifyHeading(text)
    const count = seen.get(id) ?? 0
    seen.set(id, count + 1)
    if (count > 0) id = `${id}-${count + 1}`
    out.push({ level, text, id })
  }
  return out
}

function slugifyHeading(text: string): string {
  const cn = text
    .toLowerCase()
    .trim()
    // 中文/字母/数字保留，其余转 `-`（连续压缩）
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return cn || 'section'
}

/**
 * 解析 contentDir 下的 navigation.yaml（含 lint 配置合并入口）。
 * contentDir 形如 `<root>/content/help/zh-CN`。
 */
export function parseNavigation(contentDir: string): { nav: HelpNav; config: HelpLintConfig } {
  const navFile = join(contentDir, 'navigation.yaml')
  const navRaw = readFileSync(navFile, 'utf8')
  const raw = parseYaml(navRaw) as {
    locale?: string
    productVersion?: string
    areas?: Array<{
      id: string
      label: string
      description?: string
      order?: number
      articleIds?: string[]
    }>
    learningPaths?: Array<{
      id: string
      label: string
      description?: string
      roles?: string[]
      articleIds?: string[]
    }>
  }

  const areas: HelpArea[] = (raw.areas ?? []).map((a, i) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    order: a.order ?? i,
    articleIds: a.articleIds ?? [],
  }))
  const learningPaths: HelpLearningPath[] = (raw.learningPaths ?? []).map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    roles: p.roles as HelpLearningPath['roles'],
    articleIds: p.articleIds ?? [],
  }))

  const nav: HelpNav = {
    locale: raw.locale ?? 'zh-CN',
    productVersion: raw.productVersion ?? '',
    areas: [...areas].sort((a, b) => a.order - b.order),
    learningPaths,
  }

  const config = readLintConfig(contentDir)
  return { nav, config }
}

export function readLintConfig(contentDir: string): HelpLintConfig {
  const cfgFile = join(dirname(contentDir), 'lint-config.yaml')
  if (!existsSync(cfgFile)) return {}
  const raw = parseYaml(readFileSync(cfgFile, 'utf8')) as HelpLintConfig
  return raw ?? {}
}

/** 列出 contentDir 下全部文章（递归查找 .mdx/.md）。 */
export function listArticleFiles(contentDir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(contentDir, { withFileTypes: true })) {
    const full = join(contentDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue
      out.push(...listArticleFiles(full))
    } else if (entry.isFile() && ['.mdx', '.md'].includes(extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

/** 加载全部文章（含 navigation 树校验：articleIds 必须命中文章）。 */
export function loadArticles(contentDir: string): {
  articles: HelpArticle[]
  nav: HelpNav
  config: HelpLintConfig
} {
  const { nav, config } = parseNavigation(contentDir)
  const articles: HelpArticle[] = []
  for (const file of listArticleFiles(contentDir)) {
    const rel = file.slice(contentDir.length + 1)
    const parts = rel.split(/[\\/]/)
    const slug = basename(file).replace(/\.(mdx|md)$/, '')
    if (parts.length < 2) continue
    const area = parts[0]!
    const raw = readFileSync(file, 'utf8')
    articles.push(parseArticleFile(area, slug, raw, file))
  }
  return { articles, nav, config }
}

/**
 * 进程级 memo：dev 下同一进程多次请求不再重复读盘。
 * key 为 contentDir 的 mtime（s 级精度足够，改文件会触发）。
 */
let memo: { key: string; value: ReturnType<typeof loadArticles> } | null = null

export function loadArticlesCached(contentDir: string): ReturnType<typeof loadArticles> {
  let key = 'missing'
  try {
    key = String(statSync(contentDir).mtimeMs)
  } catch {
    key = 'missing'
  }
  if (!memo || memo.key !== key) {
    memo = { key, value: loadArticles(contentDir) }
  }
  return memo.value
}

/** 从 cwd 推导内容根（frontend 进程 cwd=apps/frontend；根脚本 cwd=仓库根）。 */
export function resolveHelpContentRoot(cwd: string = process.cwd()): string {
  const direct = join(cwd, 'content', 'help')
  if (existsSync(direct)) return direct
  const viaApps = join(cwd, 'apps', 'frontend', 'content', 'help')
  if (existsSync(viaApps)) return viaApps
  return direct
}

export function resolveHelpContentDir(cwd: string = process.cwd()): string {
  const root = resolveHelpContentRoot(cwd)
  const locales = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'assets')
    .map((e) => e.name)
  const locale = locales[0] ?? 'zh-CN'
  return join(root, locale)
}

/** 文章 id 列表 → id 集合（供 related/orphan 校验）。 */
export function articleIdMap(articles: HelpArticle[]): Map<string, HelpArticle> {
  return new Map(articles.map((a) => [a.id, a]))
}

// ---- 导出工具（网页渲染与 Agent 出口共用） ----

/** 由 frontmatter 组装 Agent 出口头（标题 + 版本/更新时间，无导航 chrome）。 */
export function agentExportHeader(article: HelpArticle): string {
  const fm = article.frontmatter
  const lines = [
    `# ${fm.title}`,
    '',
    `> 摘要：${fm.summary}`,
    `> 适用角色：${fm.roles.join('、')}`,
    `> 适用版本：${fm.productVersion}（edition: ${fm.editions.join('/')}）`,
    `> 更新时间：${fm.updatedAt}（reviewAfter: ${fm.reviewAfter}）`,
    `> 文章 id：${fm.id}`,
    '',
  ]
  return lines.join('\n')
}

/** 去除正文中的 HTML 注释（内部注记载体）。 */
export function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, '')
}

/** Agent 出口正文：头 + 去注释 body。不包含导航 chrome、内部注释、原始路径。 */
export function agentExportMarkdown(article: HelpArticle): string {
  return `${agentExportHeader(article)}${stripHtmlComments(article.body).trimEnd()}\n`
}
