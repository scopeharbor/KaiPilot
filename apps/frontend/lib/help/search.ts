/**
 * 帮助中心搜索（design E：标题/摘要/heading/正文/标签索引，
 * 精确产品术语加权；角色/模块/content-type 筛选；空结果给术语与支持路径建议）。
 * 纯函数、无副作用，客户端与服务端共用。
 */
import type { HelpArticle, HelpLearningPath, HelpSearchDocument } from './types'

export interface HelpSearchFilters {
  role?: string
  module?: string
  contentType?: string
}

export interface HelpSearchHit {
  articleId: string
  title: string
  summary: string
  contentType: string
  area: string
  updatedAt: string
  /** 命中的 heading（按顺序去重）。 */
  matchedHeadings: string[]
  score: number
}

export interface HelpSearchResult {
  hits: HelpSearchHit[]
  /** 空结果时给出术语建议（如 报表→reports）与支持路径。 */
  suggestions: string[]
  total: number
}

export interface HelpSearchIndex {
  documents: HelpSearchDocument[]
  /** 术语同义词表：用户口语 → 规范术语。 */
  synonyms: Record<string, string[]>
  /** 学习路径（供模块筛选来源）。 */
  learningPaths: HelpLearningPath[]
}

/** 中文/拉丁分词：拉丁按词切，中文按二元组（bigram）切；同一 chunk 内去重。 */
export function tokenizeText(input: string): string[] {
  const out: string[] = []
  const latin = input.match(/[a-zA-Z0-9]+/g) ?? []
  for (const w of latin) out.push(w.toLowerCase())
  const cjk = input.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const chunk of cjk) {
    if (chunk.length === 1) {
      out.push(chunk)
      continue
    }
    const seen = new Set<string>()
    for (let i = 0; i < chunk.length - 1; i++) {
      seen.add(chunk.slice(i, i + 2))
    }
    // 整词也索引（短查询精确匹配）
    seen.add(chunk)
    out.push(...seen)
  }
  return out
}

/** 构建索引：每篇文档 = 标题/摘要/headings/关键词/正文 的 token 集合。 */
export function buildSearchIndex(
  articles: HelpArticle[],
  learningPaths: HelpLearningPath[],
): HelpSearchIndex {
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
  return buildSearchIndexFromDocuments(documents, learningPaths)
}

/** 直接从已加载的搜索文档构建索引（客户端 /api/help/index 数据）。 */
export function buildSearchIndexFromDocuments(
  documents: HelpSearchDocument[],
  learningPaths: HelpLearningPath[],
): HelpSearchIndex {
  const synonyms: Record<string, string[]> = {
    报表: ['reports', 'report', '报告'],
    甘特: ['gantt', '甘特图'],
    风险: ['risk', 'risks', '问题'],
    问题: ['issue', 'risks', '风险'],
    权限: ['permission', 'rbac', '角色'],
    登录: ['login', '认证', 'auth'],
    部署: ['deploy', 'docker', 'compose'],
    技能: ['skill', 'skills', '知识'],
    集成: ['integration', 'integrations', '插件'],
    ocr: ['识别', '文字识别'],
    copilot: ['助手', '辅助'],
    知识: ['knowledge', 'skills'],
  }
  return { documents, synonyms, learningPaths }
}

/** 单文档打分：title 精确/前缀/包含 → keywords → summary → headings → body。 */
export function scoreDocument(
  doc: HelpSearchDocument,
  queryTokens: string[],
  bodyTokens: Map<string, number>,
  docTokens: Map<string, number>,
): number {
  let score = 0
  for (const tok of queryTokens) {
    const titleLower = doc.title.toLowerCase()
    if (titleLower === tok) score += 100
    else if (titleLower.startsWith(tok)) score += 60
    else if (titleLower.includes(tok)) score += 40
    if (doc.summary.toLowerCase().includes(tok)) score += 15
    for (const heading of doc.headings) {
      if (heading.toLowerCase().includes(tok)) score += 8
    }
    for (const kw of doc.keywords) {
      if (kw.toLowerCase().includes(tok)) score += 10
    }
    const bodyFreq = bodyTokens.get(tok) ?? 0
    if (bodyFreq > 0) score += Math.min(bodyFreq, 5) * 2
    const docFreq = docTokens.get(tok) ?? 0
    if (docFreq > 0) score += Math.min(docFreq, 5) * 1
  }
  return score
}

export function searchHelp(
  index: HelpSearchIndex,
  rawQuery: string,
  filters: HelpSearchFilters = {},
): HelpSearchResult {
  const query = rawQuery.trim()
  if (!query) {
    return { hits: [], suggestions: ['输入关键词开始搜索'], total: 0 }
  }

  const queryTokens = tokenizeText(query)
  // 查询同义词扩展（精确术语优先：报表→reports）
  for (const [word, expanded] of Object.entries(index.synonyms)) {
    if (query.includes(word)) {
      for (const e of expanded) queryTokens.push(e)
    }
  }

  const scored: HelpSearchHit[] = []
  for (const doc of index.documents) {
    if (filters.role && !doc.roles.includes(filters.role as HelpSearchDocument['roles'][number]))
      continue
    if (filters.module && doc.area !== filters.module) continue
    if (filters.contentType && doc.contentType !== filters.contentType) continue

    const docText = `${doc.title}\n${doc.summary}\n${doc.headings.join('\n')}\n${doc.keywords.join('\n')}\n${doc.body}`
    const docTokens = new Map<string, number>()
    for (const t of tokenizeText(docText)) docTokens.set(t, (docTokens.get(t) ?? 0) + 1)

    const bodyTokens = new Map<string, number>()
    for (const t of queryTokens) bodyTokens.set(t, 0)

    const score = scoreDocument(doc, queryTokens, bodyTokens, docTokens)
    if (score <= 0) continue

    const matchedHeadings = doc.headings.filter((h) => {
      const hText = h.replace(/^#+\s*/, '')
      return queryTokens.some((t) => hText.toLowerCase().includes(t))
    })

    scored.push({
      articleId: doc.id,
      title: doc.title,
      summary: doc.summary,
      contentType: doc.contentType,
      area: doc.area,
      updatedAt: doc.updatedAt,
      matchedHeadings: matchedHeadings.slice(0, 3),
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  const suggestions: string[] = []
  if (scored.length === 0) {
    suggestions.push('没有找到匹配文章。试试更短的关键词，或使用同义词（例如「报表」「报告」）。')
    suggestions.push('也可以从「设置 → AI 连接」「项目 → 视图」等已知模块名开始。')
  }

  return { hits: scored.slice(0, 20), suggestions, total: scored.length }
}
