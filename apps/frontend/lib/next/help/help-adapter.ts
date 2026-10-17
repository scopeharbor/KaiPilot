/**
 * 帮助中心新轨纯函数适配器（v3-ui-next-help-knowledge-domain W1 · tasks 1.1，
 * spec「帮助中心首页与模块导航浏览」）。
 *
 * - 模块聚合（buildModuleGrid）：按产品模块分组并截取前 4 篇推荐文章；
 * - 角色学习路径解析（resolveLearningPathArticles）：按 navigation 登记顺序解析
 *   目标文章，缺失 id 静默剔除并健壮回退；
 * - 最近更新（getRecentArticles）：按 frontmatter.updatedAt 降序；
 * - 故障排查提取（extractTroubleshootingArticles）：troubleshooting 区优先，
 *   缺失时按 contentType 兜底。
 *
 * 全部纯计算：零 DOM、零 fs、零网络，服务端页面与单测共用。
 * 类型仅从 `lib/help/types` 引入（与 load.ts 契约同源，避免引入 node 依赖）。
 */
import type { HelpArea, HelpArticle, HelpLearningPath, HelpNav } from '@/lib/help/types'

/** 每个产品模块卡片最多展示的推荐指南数。 */
export const MODULE_GUIDE_LIMIT = 4
/** 「最近更新」列表默认条数。 */
export const RECENT_ARTICLES_LIMIT = 5
/** 故障排查区在 navigation.yaml 中的 area id。 */
export const TROUBLESHOOTING_AREA_ID = 'troubleshooting'

/** 模块网格卡片的单篇指南链接。 */
export interface HelpGuideLink {
  id: string
  title: string
}

/** 首页产品模块网格卡片。 */
export interface HelpModuleGridItem {
  areaId: string
  areaLabel: string
  description?: string
  /** 该模块可用的文章总数。 */
  totalArticles: number
  /** 推荐指南（≤ MODULE_GUIDE_LIMIT，遵循 navigation 登记顺序）。 */
  guides: HelpGuideLink[]
}

/** 学习路径解析结果。 */
export interface HelpResolvedLearningPath {
  id: string
  label: string
  description?: string
  /** 「开始使用」目标文章；路径内文章全部缺失时为 null（渲染侧给占位态）。 */
  firstArticleId: string | null
  /** 路径目标文章（按 articleIds 顺序，缺失 id 剔除）。 */
  articles: HelpGuideLink[]
}

/** 首页清单用的文章摘要投影（不含 body/path，props 直传客户端轻量化）。 */
export interface HelpArticleSummary {
  id: string
  title: string
  summary: string
}

/** 最近更新条目。 */
export interface HelpRecentEntry {
  id: string
  title: string
  area: string
  areaLabel: string
  updatedAt: string
}

/** area 列表 → areaId 标签映射（快速查表）。 */
export function areaLabelMap(areas: readonly HelpArea[]): Map<string, string> {
  return new Map(areas.map((area) => [area.id, area.label]))
}

/**
 * 模块聚合：遍历 nav.areas 并按 area.articleIds 顺序解析到实际文章，
 * 每个模块截取前 `limit` 篇推荐指南；空模块（无可解析文章）直接剔除。
 */
export function buildModuleGrid(
  areas: readonly HelpArea[],
  byId: ReadonlyMap<string, HelpArticle>,
  limit: number = MODULE_GUIDE_LIMIT,
): HelpModuleGridItem[] {
  const items: HelpModuleGridItem[] = []
  for (const area of areas) {
    const guides: HelpGuideLink[] = []
    for (const id of area.articleIds) {
      const article = byId.get(id)
      if (!article) continue
      if (guides.some((guide) => guide.id === id)) continue
      guides.push({ id: article.id, title: article.frontmatter.title })
    }
    if (guides.length === 0) continue
    items.push({
      areaId: area.id,
      areaLabel: area.label,
      description: area.description,
      totalArticles: guides.length,
      guides: guides.slice(0, Math.max(0, limit)),
    })
  }
  return items
}

/**
 * 学习路径解析：按 articleIds 登记顺序解析目标文章（缺失 id 静默剔除、去重），
 * 返回首篇可作为「开始使用」直达目标；全部缺失时 firstArticleId 为 null。
 */
export function resolveLearningPathArticles(
  path: HelpLearningPath,
  byId: ReadonlyMap<string, HelpArticle>,
): HelpResolvedLearningPath {
  const articles: HelpGuideLink[] = []
  for (const id of path.articleIds) {
    const article = byId.get(id)
    if (!article) continue
    if (articles.some((guide) => guide.id === id)) continue
    articles.push({ id: article.id, title: article.frontmatter.title })
  }
  return {
    id: path.id,
    label: path.label,
    description: path.description,
    firstArticleId: articles[0]?.id ?? null,
    articles,
  }
}

/**
 * 最近更新：按 frontmatter.updatedAt（YYYY-MM-DD，字典序即时间序）降序排序，
 * 同日期以 id 升序保证确定性，截取前 `limit` 条。
 */
export function getRecentArticles(
  articles: readonly HelpArticle[],
  labels: ReadonlyMap<string, string>,
  limit: number = RECENT_ARTICLES_LIMIT,
): HelpRecentEntry[] {
  const entries: HelpRecentEntry[] = articles.map((article) => ({
    id: article.id,
    title: article.frontmatter.title,
    area: article.area,
    areaLabel: labels.get(article.area) ?? article.area,
    updatedAt: article.frontmatter.updatedAt,
  }))
  return entries
    .sort((a, b) => {
      const byDate = b.updatedAt.localeCompare(a.updatedAt)
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id)
    })
    .slice(0, Math.max(0, limit))
}

/**
 * 故障排查快速列表：优先解析 nav 中 `troubleshooting` 区的登记文章；
 * 该区缺失或为空时，兜底按 contentType === 'troubleshooting' 收敛；
 * 两源均无命中返回 []（首页据此隐藏区块）。结果去重并保持解析顺序。
 */
export function extractTroubleshootingArticles(
  nav: HelpNav,
  articles: readonly HelpArticle[],
): HelpArticleSummary[] {
  const collected: HelpArticle[] = []
  const seen = new Set<string>()

  const pushIfMissing = (article: HelpArticle | undefined) => {
    if (!article || seen.has(article.id)) return
    seen.add(article.id)
    collected.push(article)
  }

  const area = nav.areas.find((candidate) => candidate.id === TROUBLESHOOTING_AREA_ID)
  if (area) {
    const byId = new Map(articles.map((article) => [article.id, article]))
    for (const id of area.articleIds) pushIfMissing(byId.get(id))
  }

  if (collected.length === 0) {
    for (const article of articles) {
      if (article.frontmatter.contentType === 'troubleshooting') pushIfMissing(article)
    }
  }

  return collected.map((article) => ({
    id: article.id,
    title: article.frontmatter.title,
    summary: article.frontmatter.summary,
  }))
}
