/**
 * Copilot 网页搜索：多引擎召回 + RRF 融合 + 相关性过滤 + 行情直取。
 *
 * 借鉴 argo（taxueseek/argo，MIT）的「agent 找资料」流水线，用 TypeScript 原生实现、免密钥：
 * 1. 检索规划（query_planner）：把原话改写成 1–3 条检索式、核心实体、行情代码；
 * 2. 领域路由：
 *    - 行情（finance）：Yahoo Finance 行情接口直取最新价，失败退回腾讯行情；
 *    - 时效（news）：加查 Google News / Bing News RSS（带发布时间）；
 *    - 百科：维基百科搜索 + 词条摘要（直接给出「现任…」这类导语）；
 *    - 网页：Bing / DuckDuckGo（及组织配置的商业搜索）；
 * 3. 加权 RRF（Reciprocal Rank Fusion）融合多引擎、多检索式的排名；
 * 4. 相关性过滤：标题 + 摘要与核心实体毫无重合的结果直接丢弃（服务器出口常拿到与问题
 *    无关的「热门」结果，宁缺毋滥，避免模型被无关结果误导）；
 * 5. 新闻 / 行情 / 百科摘要作为「已取得正文」直接交给抓取层，不再二次抓取。
 */

import type { RetrievalSearchProvider, RetrievalSearchResult } from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'
import type { WebSearchPlan, WebSearchPlanner } from './query_planner.js'
import { ruleBasedSearchPlan } from './query_planner.js'

/** 带已取得正文的结果（新闻 RSS / 行情 / 百科摘要）：抓取层直接使用 `body`。 */
export interface SearchResultWithBody extends RetrievalSearchResult {
  body?: string
  publishedAt?: string
}

export type SearchEngine = (query: string, plan: WebSearchPlan) => Promise<SearchResultWithBody[]>

export interface EngineSpec {
  name: string
  weight: number
  /** 只对部分规划启用（如新闻源只在时效性问题上查）。 */
  when?: (plan: WebSearchPlan) => boolean
  /** 只用第一条检索式（百科、商业搜索省配额）。 */
  firstQueryOnly?: boolean
  /** 按次计费（商业搜索）：不参与规则先行的预搜，只用最终检索规划查一次。 */
  costly?: boolean
  run: SearchEngine
}

const RRF_K = 60

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

const stripTags = (html: string): string =>
  decodeEntities(decodeEntities(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')

/** 发布时间 → 北京时间「YYYY-MM-DD HH:mm」。 */
export function formatPublished(raw: string | number | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  const date = typeof raw === 'number' ? new Date(raw) : new Date(raw)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

// ---------------------------------------------------------------------------
// 新闻 RSS（Google News / Bing News）
// ---------------------------------------------------------------------------

/** 解析新闻 RSS（Google News 与 Bing News 同为 RSS 2.0；导出供单测）。 */
export function parseNewsRss(xml: string): SearchResultWithBody[] {
  const results: SearchResultWithBody[] = []
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []) {
    const field = (name: string) =>
      cdata(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(item)?.[1] ?? '')
    let url = decodeEntities(field('link').trim())
    // Bing News 跳转链接：…/news/apiclick.aspx?…&url=<真实地址>
    const target = /[?&]url=([^&]+)/.exec(url)
    if (/bing\.com\/news\/apiclick/i.test(url) && target) url = decodeURIComponent(target[1]!)
    const title = stripTags(field('title'))
    if (!title || !url) continue
    const source = stripTags(field('source'))
    const description = stripTags(field('description'))
    const pubDate = new Date(field('pubDate').trim())
    const publishedAt = Number.isNaN(pubDate.getTime()) ? undefined : pubDate.toISOString()
    const published = formatPublished(publishedAt)
    const snippet = description && description !== title ? description : ''
    results.push({
      url,
      title,
      snippet: snippet || title,
      publishedAt,
      body: [
        title,
        snippet,
        source && !title.includes(source) ? `来源：${source}` : '',
        published ? `发布时间：${published}（北京时间）` : '',
      ]
        .filter(Boolean)
        .join('。'),
    })
  }
  return results
}

// ---------------------------------------------------------------------------
// 行情（Yahoo Finance → 腾讯行情兜底）
// ---------------------------------------------------------------------------

interface YahooChartMeta {
  symbol?: string
  currency?: string
  exchangeName?: string
  fullExchangeName?: string
  longName?: string
  shortName?: string
  regularMarketPrice?: number
  chartPreviousClose?: number
  previousClose?: number
  regularMarketTime?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  regularMarketVolume?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
}

const fmt = (value: number | undefined, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: digits })
    : undefined

/** Yahoo chart 接口 meta → 行情结果（导出供单测）。 */
export function quoteFromYahooMeta(meta: YahooChartMeta): SearchResultWithBody | null {
  const price = meta.regularMarketPrice
  if (!meta.symbol || typeof price !== 'number') return null
  const name = meta.longName || meta.shortName || meta.symbol
  const previous = meta.chartPreviousClose ?? meta.previousClose
  const change = typeof previous === 'number' ? price - previous : undefined
  const percent =
    typeof previous === 'number' && previous !== 0 && change !== undefined
      ? (change / previous) * 100
      : undefined
  const time = formatPublished(meta.regularMarketTime ? meta.regularMarketTime * 1000 : undefined)
  const currency = meta.currency ?? ''
  const parts = [
    `${name}（${meta.symbol}${meta.fullExchangeName || meta.exchangeName ? `，${meta.fullExchangeName ?? meta.exchangeName}` : ''}）最新价 ${fmt(price)} ${currency}`.trim(),
    previous !== undefined ? `前收 ${fmt(previous)}` : '',
    change !== undefined
      ? `涨跌 ${change >= 0 ? '+' : ''}${fmt(change)}（${percent !== undefined ? `${percent >= 0 ? '+' : ''}${fmt(percent)}%` : '—'}）`
      : '',
    meta.regularMarketDayLow !== undefined && meta.regularMarketDayHigh !== undefined
      ? `日内区间 ${fmt(meta.regularMarketDayLow)}–${fmt(meta.regularMarketDayHigh)}`
      : '',
    meta.fiftyTwoWeekLow !== undefined && meta.fiftyTwoWeekHigh !== undefined
      ? `52 周区间 ${fmt(meta.fiftyTwoWeekLow)}–${fmt(meta.fiftyTwoWeekHigh)}`
      : '',
    time ? `行情时间 ${time}（北京时间）` : '',
  ].filter(Boolean)
  const body = `${parts.join('；')}。数据来源 Yahoo Finance，可能有约 15 分钟延迟。`
  return {
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(meta.symbol)}`,
    title: `${name}（${meta.symbol}）实时行情`,
    snippet: body,
    body,
    publishedAt: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : undefined,
  }
}

/** Yahoo 代码 → 腾讯行情代码（A 股 / 港股 / 美股；台股等腾讯不覆盖的返回 null）。 */
export function toTencentCode(symbol: string): string | null {
  const upper = symbol.toUpperCase()
  let m = /^(\d{6})\.(SS|SZ)$/.exec(upper)
  if (m) return `${m[2] === 'SS' ? 'sh' : 'sz'}${m[1]}`
  m = /^(\d{4,5})\.HK$/.exec(upper)
  if (m) return `hk${m[1]!.padStart(5, '0')}`
  if (/^[A-Z]{1,5}$/.test(upper)) return `us${upper}`
  return null
}

/** 解析腾讯行情（`v_xxx="1~名称~代码~现价~前收~今开~…"`；导出供单测）。 */
export function quoteFromTencent(symbol: string, text: string): SearchResultWithBody | null {
  const fields = /="([^"]*)"/.exec(text)?.[1]?.split('~')
  if (!fields || fields.length < 33) return null
  const name = fields[1]
  const price = Number(fields[3])
  const previous = Number(fields[4])
  if (!name || !Number.isFinite(price) || price <= 0) return null
  const change = Number(fields[31])
  const percent = Number(fields[32])
  const rawTime = fields[30] ?? ''
  const time = /^\d{14}$/.test(rawTime)
    ? `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)} ${rawTime.slice(8, 10)}:${rawTime.slice(10, 12)}`
    : rawTime.slice(0, 16)
  const body =
    `${name}（${symbol}）最新价 ${fmt(price)}；前收 ${fmt(previous)}` +
    (Number.isFinite(change) ? `；涨跌 ${change >= 0 ? '+' : ''}${fmt(change)}` : '') +
    (Number.isFinite(percent) ? `（${percent >= 0 ? '+' : ''}${fmt(percent)}%）` : '') +
    (time ? `；行情时间 ${time}（交易所当地时间）` : '') +
    '。数据来源腾讯行情，可能有延迟。'
  return {
    url: `https://gu.qq.com/${toTencentCode(symbol) ?? symbol}`,
    title: `${name}（${symbol}）实时行情`,
    snippet: body,
    body,
  }
}

// ---------------------------------------------------------------------------
// 相关性
// ---------------------------------------------------------------------------

const STOP_TERMS = new Set([
  '最新',
  '现任',
  '現任',
  '目前',
  '当前',
  '現在',
  '现在',
  '今天',
  '新闻',
  '新聞',
  'the',
  'and',
  'of',
  'in',
  'is',
  'who',
  'what',
  'for',
  'with',
  'current',
  'latest',
  'news',
])

/**
 * 相关性用的关键词（导出供单测）：
 * - 核心实体整体保留（「美国总统」「president of the united states」）；
 * - 检索式按空白切词，去掉年份、时间副词与过短的英文词。
 */
export function relevanceTerms(plan: WebSearchPlan): string[] {
  const terms = new Set<string>()
  const keep = (raw: string) => {
    const term = raw.trim().toLowerCase()
    if (term.length < 2 || STOP_TERMS.has(term) || /^\d{1,4}$/.test(term)) return
    if (/^[a-z0-9.+#-]+$/.test(term) && term.length < 3) return
    terms.add(term)
  }
  for (const entity of plan.entities) keep(entity.replace(/\s+/g, ' '))
  for (const query of plan.queries) {
    for (const word of query.split(/[\s,，、;；:：|/()（）"“”'‘’]+/)) keep(word)
  }
  return [...terms]
}

function cjkBigrams(text: string): string[] {
  const cjk = text.replace(/[^一-鿿぀-ヿ]/g, '')
  const grams: string[] = []
  for (let i = 0; i < cjk.length - 1; i++) grams.push(cjk.slice(i, i + 2))
  return grams
}

/**
 * 结果与问题的相关度（0–1），取命中最好的那个关键词的得分
 * （「美国总统」或「President of the United States」任一命中即可）：
 * - 关键词整体出现记 1；
 * - 中日文长词按二元组重合度给部分分（≥50% 才算）；
 * - 英文短语按词重合度给部分分（≥60% 才算），单个英文词允许复数等词尾变化。
 */
export function relevanceScore(result: RetrievalSearchResult, terms: string[]): number {
  if (terms.length === 0) return 1
  const haystack =
    `${result.title} ${result.snippet} ${(result as SearchResultWithBody).body ?? ''}`
      .toLowerCase()
      .slice(0, 4000)
  let best = 0
  for (const term of terms) {
    if (haystack.includes(term)) return 1
    const grams = cjkBigrams(term)
    if (grams.length >= 2) {
      const hit = grams.filter((gram) => haystack.includes(gram)).length / grams.length
      if (hit >= 0.5) best = Math.max(best, hit * 0.8)
      continue
    }
    const words = term.split(' ').filter((word) => word.length >= 3 && !STOP_TERMS.has(word))
    if (words.length >= 2) {
      const hit = words.filter((word) => haystack.includes(word)).length / words.length
      if (hit >= 0.6) best = Math.max(best, hit * 0.9)
    } else if (/^[a-z]{5,}$/.test(term) && haystack.includes(term.slice(0, term.length - 1))) {
      best = Math.max(best, 0.6)
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// 融合
// ---------------------------------------------------------------------------

export interface RankedList {
  engine: string
  weight: number
  results: SearchResultWithBody[]
}

/** URL 规范化键（去协议、www、末尾斜杠与追踪参数）。 */
function urlKey(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|spm|from|ref|src)/i.test(key)) u.searchParams.delete(key)
    }
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`
  } catch {
    return url
  }
}

/** 加权 RRF：score = Σ weight / (K + rank)；同一 URL 合并，保留信息最全的一条（导出供单测）。 */
export function rrfFuse(lists: RankedList[]): Array<SearchResultWithBody & { score: number }> {
  const merged = new Map<string, SearchResultWithBody & { score: number }>()
  for (const list of lists) {
    list.results.forEach((result, index) => {
      const key = urlKey(result.url)
      const gain = list.weight / (RRF_K + index + 1)
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...result, score: gain })
        return
      }
      existing.score += gain
      if (!existing.snippet && result.snippet) existing.snippet = result.snippet
      if (!existing.body && result.body) existing.body = result.body
      if (!existing.publishedAt && result.publishedAt) existing.publishedAt = result.publishedAt
    })
  }
  return [...merged.values()].sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

export interface SmartSearchOptions {
  planner?: WebSearchPlanner
  engines: EngineSpec[]
  quotes?: (tickers: string[]) => Promise<SearchResultWithBody[]>
  now?: () => Date
}

/** 合并规则规划与模型规划（模型检索式在前；实体 / 代码取并集）。 */
export function mergeSearchPlans(rule: WebSearchPlan, model: WebSearchPlan): WebSearchPlan {
  const uniq = (items: string[], limit: number) => {
    const seen = new Set<string>()
    return items
      .filter((item) => {
        const key = item.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, limit)
  }
  return {
    queries: uniq([...model.queries, ...rule.queries], 6),
    entities: uniq([...model.entities, ...rule.entities], 8),
    tickers: uniq([...model.tickers, ...rule.tickers], 6),
    lang: rule.lang,
    focus: model.focus,
    timeSensitive: model.timeSensitive || rule.timeSensitive,
    source: 'model',
  }
}

/**
 * 编排（2026-10-05 调整：慢模型如每秒 10 字的 GPT 规划要十几秒到几十秒）：
 * 1. 规则改写立即得到检索式，免费引擎与行情马上开搜（不等模型）；
 * 2. 同时等模型规划（规划器自身有超时，超时 / 失败退回规则规划）；
 * 3. 模型给出新的检索式 / 行情代码时补搜；按次计费的商业搜索只用最终规划查一次；
 * 4. 全部结果一起 RRF 融合与相关性过滤。
 */
export class SmartSearchProvider implements RetrievalSearchProvider {
  #lastPlan: WebSearchPlan | null = null

  constructor(private readonly options: SmartSearchOptions) {}

  /** 最近一次检索规划（回答提示词里告诉模型实际用了哪些检索式）。 */
  get lastPlan(): WebSearchPlan | null {
    return this.#lastPlan
  }

  #runEngines(
    plan: WebSearchPlan,
    queries: string[],
    filter: (engine: EngineSpec) => boolean,
  ): Array<Promise<RankedList | null>> {
    const jobs: Array<Promise<RankedList | null>> = []
    if (queries.length === 0) return jobs
    for (const engine of this.options.engines) {
      if (!filter(engine) || (engine.when && !engine.when(plan))) continue
      const engineQueries = engine.firstQueryOnly ? queries.slice(0, 1) : queries
      engineQueries.forEach((q, queryIndex) => {
        jobs.push(
          engine
            .run(q, plan)
            .then((results) => ({
              engine: engine.name,
              // 后面的检索式是补充：权重递减
              weight: engine.weight * (queryIndex === 0 ? 1 : 0.7),
              results,
            }))
            .catch((err: unknown) => {
              logger.warn({ err: String(err), engine: engine.name }, '网页搜索引擎调用失败')
              return null
            }),
        )
      })
    }
    return jobs
  }

  #quotes(tickers: string[]): Promise<SearchResultWithBody[]> {
    if (tickers.length === 0 || !this.options.quotes) return Promise.resolve([])
    return this.options.quotes(tickers).catch((err: unknown) => {
      logger.warn({ err: String(err) }, '行情查询失败')
      return [] as SearchResultWithBody[]
    })
  }

  async search(query: string, maxResults: number): Promise<SearchResultWithBody[]> {
    const now = this.options.now ?? (() => new Date())
    const rulePlan = ruleBasedSearchPlan(query, now())

    // 1. 规则先行：免费引擎与行情立即开搜
    const jobs = this.#runEngines(rulePlan, rulePlan.queries, (engine) => !engine.costly)
    const quoteJobs = [this.#quotes(rulePlan.tickers)]

    // 2. 等模型规划（规划器内部超时退回规则规划）
    let plan = rulePlan
    if (this.options.planner) {
      try {
        const planned = await this.options.planner(query)
        if (planned.source === 'model') plan = mergeSearchPlans(rulePlan, planned)
      } catch {
        // 保持规则规划
      }
    }
    this.#lastPlan = plan

    // 3. 补搜模型新增的检索式与行情代码；商业搜索只用最终规划的第一条检索式
    if (plan !== rulePlan) {
      const searched = new Set(rulePlan.queries.map((q) => q.toLowerCase()))
      const extraQueries = plan.queries.filter((q) => !searched.has(q.toLowerCase()))
      jobs.push(...this.#runEngines(plan, extraQueries, (engine) => !engine.costly))
      quoteJobs.push(this.#quotes(plan.tickers.filter((t) => !rulePlan.tickers.includes(t))))
    }
    jobs.push(...this.#runEngines(plan, plan.queries.slice(0, 1), (engine) => !!engine.costly))

    const [lists, quoteLists] = await Promise.all([Promise.all(jobs), Promise.all(quoteJobs)])
    const quotes = quoteLists.flat()
    const fused = rrfFuse(lists.filter((list): list is RankedList => list !== null))

    const terms = relevanceTerms(plan)
    const scored = fused
      .map((result) => {
        const relevance = relevanceScore(result, terms)
        // 时效性问题：有发布时间的新闻略加权（越新越前）
        const fresh =
          plan.timeSensitive && result.publishedAt
            ? Math.max(
                0,
                1 - (now().getTime() - new Date(result.publishedAt).getTime()) / (7 * 86_400_000),
              ) * 0.004
            : 0
        return { result, relevance, rank: result.score * (0.5 + relevance) + fresh }
      })
      .filter((item) => item.relevance >= 0.4)
      .sort((a, b) => b.rank - a.rank)

    const dropped = fused.length - scored.length
    if (dropped > 0) {
      logger.info(
        { dropped, kept: scored.length, plan: plan.source },
        '网页搜索：丢弃与问题无关的结果',
      )
    }
    return [
      ...quotes,
      ...scored.slice(0, maxResults).map(({ result }) => {
        const { score, ...rest } = result
        void score
        return rest
      }),
    ]
  }
}

export { stripTags as stripSearchTags, decodeEntities as decodeSearchEntities }
