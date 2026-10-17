/**
 * Copilot 网页搜索：真实提供方（2026-09-26 经用户明确授权接入真实外网搜索）。
 *
 * - free（默认，始终参与）：Bing / DuckDuckGo 网页、Google News / Bing News 新闻 RSS、
 *   维基百科词条导语、Yahoo Finance / 腾讯行情，均无需密钥；
 * - tavily / brave / bocha：商业搜索 API，密钥由组织设置加密保存，调用时解密；
 * - searxng：自建实例（GET {base}/search?format=json）。
 * 组织配置的提供方与免费引擎一起由 SmartSearchProvider 做检索规划、多引擎召回、RRF 融合
 * 与相关性过滤（2026-10-05：原先直接拿原话去搜、不做过滤，常返回与问题无关的结果）。
 *
 * 安全与成本边界（与 tool gate 的五重判定配合，本模块只管「怎么搜」）：
 * - 只发 GET/POST 到固定的提供方端点与搜索结果页 URL；只接受 http(s)，拒绝内网/本机地址；
 * - 单页最多读取 512KB、只接受 text/html 与 text/plain；超时一律中止；
 * - 抓取结果只用于当回合生成摘要，不落库、不建索引（RetrievalService D6）；
 * - 摘要为抽取式（挑出与问题最相关的句子），不额外调用模型。
 */

import type {
  CopilotWebSearchProviderKind,
  RetrievalFetchProvider,
  RetrievalFetchResult,
  RetrievalSearchProvider,
  RetrievalSearchResult,
  RetrievalSummaryProvider,
} from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'
import type { WebSearchLang, WebSearchPlan, WebSearchPlanner } from './query_planner.js'
import {
  SmartSearchProvider,
  parseNewsRss,
  quoteFromTencent,
  quoteFromYahooMeta,
  toTencentCode,
  type EngineSpec,
  type SearchEngine,
  type SearchResultWithBody,
} from './smart_search.js'

export interface LiveProviderConfig {
  kind: CopilotWebSearchProviderKind
  apiKey?: string | null
  baseUrl?: string | null
  /** 单次请求超时（毫秒）。 */
  timeoutMs: number
  /** 注入 fetch（测试用）。 */
  fetchImpl?: typeof fetch
}

const USER_AGENT =
  'Mozilla/5.0 (compatible; aiproj-copilot/1.0; +https://github.com/aiproj) AppleWebKit/537.36'
const MAX_PAGE_BYTES = 512 * 1024

/** 拒绝本机与私网地址（防 SSRF：搜索结果 URL 来自外部）。 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))
    return false
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
  }
  return true
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
    })
  } finally {
    clearTimeout(timer)
  }
}

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
  decodeEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

// ---------------------------------------------------------------------------
// 免密钥：DuckDuckGo HTML + 维基百科
// ---------------------------------------------------------------------------

/** 解析 DuckDuckGo HTML 结果页（导出供单测）。 */
export function parseDuckDuckGoHtml(html: string): RetrievalSearchResult[] {
  const results: RetrievalSearchResult[] = []
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1)
  for (const block of blocks) {
    const link = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
      block,
    )
    if (!link) continue
    let href = decodeEntities(link[1]!)
    // 结果链接形如 //duckduckgo.com/l/?uddg=<编码后的真实地址>&rut=…
    const uddg = /[?&]uddg=([^&]+)/.exec(href)
    if (uddg) href = decodeURIComponent(uddg[1]!)
    if (href.startsWith('//')) href = `https:${href}`
    if (/duckduckgo\.com\/y\.js/.test(href)) continue // 广告
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block)
    const title = stripTags(link[2]!)
    if (!title || !isPublicHttpUrl(href)) continue
    results.push({ url: href, title, snippet: snippet ? stripTags(snippet[1]!) : '' })
  }
  return results
}

/** 解析 Bing RSS 结果（`/search?format=rss`，免密钥；导出供单测）。 */
export function parseBingRss(xml: string): RetrievalSearchResult[] {
  const results: RetrievalSearchResult[] = []
  const cdata = (s: string) => s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []) {
    const field = (name: string) =>
      new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i').exec(item)?.[1] ?? ''
    const url = decodeEntities(cdata(field('link').trim()))
    const title = stripTags(cdata(field('title')))
    if (!title || !isPublicHttpUrl(url)) continue
    results.push({ url, title, snippet: stripTags(cdata(field('description'))) })
  }
  return results
}

// ---------------------------------------------------------------------------
// 免密钥引擎（交给 SmartSearchProvider 多引擎召回 + RRF 融合）
// ---------------------------------------------------------------------------

const DDG_REGION: Record<WebSearchLang, string> = { zh: 'cn-zh', ja: 'jp-jp', en: 'wt-wt' }
const BING_MARKET: Record<WebSearchLang, string> = {
  zh: 'setlang=zh-Hans&cc=CN',
  ja: 'setlang=ja&cc=JP',
  en: 'setlang=en&cc=US',
}
const GOOGLE_NEWS_LOCALE: Record<WebSearchLang, string> = {
  zh: 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  ja: 'hl=ja&gl=JP&ceid=JP:ja',
  en: 'hl=en-US&gl=US&ceid=US:en',
}
const WIKI_VARIANT: Record<WebSearchLang, string> = { zh: 'zh-CN', ja: 'ja', en: 'en' }

/** 免密钥网页 / 新闻 / 百科引擎（导出供单测与组装）。 */
export function freeSearchEngines(
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): EngineSpec[] {
  const get = (url: string, accept: string, extra: Record<string, string> = {}) =>
    timedFetch(fetchImpl, url, { headers: { Accept: accept, ...extra } }, timeoutMs)

  const bing: SearchEngine = async (query, plan) => {
    const host = plan.lang === 'zh' ? 'https://cn.bing.com' : 'https://www.bing.com'
    const res = await get(
      `${host}/search?format=rss&q=${encodeURIComponent(query)}&${BING_MARKET[plan.lang]}`,
      'application/rss+xml,text/xml;q=0.9',
    )
    if (!res.ok) throw new Error(`Bing HTTP ${res.status}`)
    return parseBingRss(await res.text())
  }

  const duckDuckGo: SearchEngine = async (query, plan) => {
    const res = await timedFetch(
      fetchImpl,
      'https://html.duckduckgo.com/html/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
        body: new URLSearchParams({ q: query, kl: DDG_REGION[plan.lang] }).toString(),
      },
      timeoutMs,
    )
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`)
    return parseDuckDuckGoHtml(await res.text())
  }

  const googleNews: SearchEngine = async (query, plan) => {
    const res = await get(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${GOOGLE_NEWS_LOCALE[plan.lang]}`,
      'application/rss+xml,text/xml;q=0.9',
    )
    if (!res.ok) throw new Error(`Google News HTTP ${res.status}`)
    return parseNewsRss(await res.text()).slice(0, 8)
  }

  const bingNews: SearchEngine = async (query, plan) => {
    const res = await get(
      `https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(query)}&${BING_MARKET[plan.lang]}`,
      'application/rss+xml,text/xml;q=0.9',
    )
    if (!res.ok) throw new Error(`Bing News HTTP ${res.status}`)
    return parseNewsRss(await res.text()).slice(0, 8)
  }

  /** 维基百科：按核心实体搜词条，前两条再取词条导语（「现任…」这类事实通常在导语里）。 */
  const wikipedia: SearchEngine = async (query, plan) => {
    const lang = plan.lang
    const term = plan.entities[0] ?? query
    const res = await get(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1` +
        `&srlimit=5&srsearch=${encodeURIComponent(term)}`,
      'application/json',
    )
    if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`)
    const body = (await res.json()) as {
      query?: { search?: Array<{ title: string; snippet: string }> }
    }
    const hits = (body.query?.search ?? []).slice(0, 5)
    return Promise.all(
      hits.map(async (item, index): Promise<SearchResultWithBody> => {
        const result: SearchResultWithBody = {
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
          title: `${item.title} - 维基百科`,
          snippet: stripTags(item.snippet),
        }
        if (index > 1) return result
        try {
          const summary = await get(
            `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
            'application/json',
            { 'Accept-Language': WIKI_VARIANT[lang] },
          )
          if (summary.ok) {
            const extract = ((await summary.json()) as { extract?: string }).extract?.trim()
            if (extract) return { ...result, snippet: extract.slice(0, 300), body: extract }
          }
        } catch {
          // 导语取不到就用搜索摘要
        }
        return result
      }),
    )
  }

  return [
    { name: 'bing', weight: 1, run: bing },
    { name: 'duckduckgo', weight: 1, run: duckDuckGo },
    {
      name: 'google-news',
      weight: 1.1,
      when: (plan) => plan.timeSensitive || plan.focus === 'news' || plan.focus === 'finance',
      run: googleNews,
    },
    {
      name: 'bing-news',
      weight: 0.9,
      when: (plan) => plan.timeSensitive || plan.focus === 'news',
      firstQueryOnly: true,
      run: bingNews,
    },
    {
      name: 'wikipedia',
      // 时效性问题百科可能滞后：权重低一些，但「现任…」导语仍是重要佐证
      weight: 0.8,
      firstQueryOnly: true,
      run: wikipedia,
    },
  ]
}

/** 行情直取：Yahoo Finance 行情接口，失败时（A 股 / 港股 / 美股）退回腾讯行情。 */
export function financeQuotes(timeoutMs: number, fetchImpl: typeof fetch = fetch) {
  const yahoo = async (symbol: string): Promise<SearchResultWithBody | null> => {
    const res = await timedFetch(
      fetchImpl,
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      { headers: { Accept: 'application/json' } },
      timeoutMs,
    )
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`)
    const body = (await res.json()) as {
      chart?: { result?: Array<{ meta?: Parameters<typeof quoteFromYahooMeta>[0] }> }
    }
    const meta = body.chart?.result?.[0]?.meta
    return meta ? quoteFromYahooMeta(meta) : null
  }
  const tencent = async (symbol: string): Promise<SearchResultWithBody | null> => {
    const code = toTencentCode(symbol)
    if (!code) return null
    const res = await timedFetch(
      fetchImpl,
      `https://qt.gtimg.cn/q=${code}`,
      { headers: { Accept: 'text/plain', Referer: 'https://gu.qq.com/' } },
      timeoutMs,
    )
    if (!res.ok) throw new Error(`Tencent quote HTTP ${res.status}`)
    // 腾讯行情默认 GBK 编码；响应头声明 UTF-8 时按 UTF-8 解码
    const bytes = new Uint8Array(await res.arrayBuffer())
    const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'gbk'
    let text: string
    try {
      text = new TextDecoder(/utf-?8/i.test(charset) ? 'utf-8' : 'gbk').decode(bytes)
    } catch {
      text = new TextDecoder('utf-8').decode(bytes)
    }
    return quoteFromTencent(symbol, text)
  }
  return async (tickers: string[]): Promise<SearchResultWithBody[]> => {
    const quotes = await Promise.all(
      tickers.map(async (symbol) => {
        try {
          const quote = await yahoo(symbol)
          if (quote) return quote
        } catch (err) {
          logger.warn({ err: String(err), symbol }, 'Yahoo 行情失败，尝试腾讯行情')
        }
        try {
          return await tencent(symbol)
        } catch {
          return null
        }
      }),
    )
    return quotes.filter((quote): quote is SearchResultWithBody => quote !== null)
  }
}

// ---------------------------------------------------------------------------
// 需要密钥 / 自建
// ---------------------------------------------------------------------------

export class TavilySearchProvider implements RetrievalSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async search(query: string, maxResults: number): Promise<RetrievalSearchResult[]> {
    const res = await timedFetch(
      this.fetchImpl,
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, max_results: maxResults, search_depth: 'basic' }),
      },
      this.timeoutMs,
    )
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`)
    const body = (await res.json()) as {
      results?: Array<{ url: string; title: string; content?: string }>
    }
    return (body.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content ?? '',
    }))
  }
}

export class BraveSearchProvider implements RetrievalSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async search(query: string, maxResults: number): Promise<RetrievalSearchResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(20, maxResults)}`
    const res = await timedFetch(
      this.fetchImpl,
      url,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey } },
      this.timeoutMs,
    )
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}`)
    const body = (await res.json()) as {
      web?: { results?: Array<{ url: string; title: string; description?: string }> }
    }
    return (body.web?.results ?? []).map((r) => ({
      url: r.url,
      title: stripTags(r.title),
      snippet: stripTags(r.description ?? ''),
    }))
  }
}

export class BochaSearchProvider implements RetrievalSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async search(query: string, maxResults: number): Promise<RetrievalSearchResult[]> {
    const res = await timedFetch(
      this.fetchImpl,
      'https://api.bochaai.com/v1/web-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, count: maxResults, summary: true }),
      },
      this.timeoutMs,
    )
    if (!res.ok) throw new Error(`Bocha HTTP ${res.status}`)
    const body = (await res.json()) as {
      data?: {
        webPages?: {
          value?: Array<{ url: string; name: string; snippet?: string; summary?: string }>
        }
      }
    }
    return (body.data?.webPages?.value ?? []).map((r) => ({
      url: r.url,
      title: r.name,
      snippet: r.summary || r.snippet || '',
    }))
  }
}

export class SearxngSearchProvider implements RetrievalSearchProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async search(query: string, maxResults: number): Promise<RetrievalSearchResult[]> {
    const base = this.baseUrl.replace(/\/+$/, '')
    const res = await timedFetch(
      this.fetchImpl,
      `${base}/search?format=json&q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } },
      this.timeoutMs,
    )
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`)
    const body = (await res.json()) as {
      results?: Array<{ url: string; title: string; content?: string }>
    }
    return (body.results ?? [])
      .slice(0, maxResults)
      .map((r) => ({ url: r.url, title: r.title, snippet: r.content ?? '' }))
  }
}

// ---------------------------------------------------------------------------
// 抓取 + 抽取式摘要
// ---------------------------------------------------------------------------

/**
 * 页面抓取：搜索结果到手即并行预取（RetrievalService 逐条串行调用 fetch，预取避免 N×超时）；
 * 抓不到正文时退回搜索摘要，结果仍可作为证据引用。
 */
export class PrefetchingFetchProvider implements RetrievalFetchProvider {
  readonly #pending = new Map<string, Promise<RetrievalFetchResult>>()
  readonly #snippets = new Map<string, string>()

  constructor(
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** 由搜索包装器在拿到结果后调用；已带正文的结果（新闻 / 行情 / 百科导语）不再抓取。 */
  prefetch(results: SearchResultWithBody[]): void {
    for (const r of results) {
      this.#snippets.set(r.url, r.snippet)
      if (r.body) {
        this.#pending.set(r.url, Promise.resolve({ success: true, body: r.body }))
      } else if (!this.#pending.has(r.url)) {
        this.#pending.set(r.url, this.#load(r.url))
      }
    }
  }

  async fetch(url: string, _timeoutMs: number): Promise<RetrievalFetchResult> {
    const result = await (this.#pending.get(url) ?? this.#load(url))
    if (result.success) return result
    const snippet = this.#snippets.get(url)
    return snippet ? { success: true, body: snippet } : result
  }

  async #load(url: string): Promise<RetrievalFetchResult> {
    if (!isPublicHttpUrl(url)) return { success: false, failureReason: 'fetch_failed' }
    try {
      const res = await timedFetch(
        this.fetchImpl,
        url,
        { headers: { Accept: 'text/html,text/plain;q=0.9' }, redirect: 'follow' },
        this.timeoutMs,
      )
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !/text\/(html|plain)/i.test(type) || !res.body) {
        return { success: false, failureReason: 'fetch_failed' }
      }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (size < MAX_PAGE_BYTES) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        size += value.byteLength
      }
      await reader.cancel().catch(() => {})
      const body = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks))
      return { success: true, body }
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError'
      return { success: false, failureReason: aborted ? 'fetch_timeout' : 'fetch_failed' }
    }
  }
}

/** 搜索结果到手即通知抓取器预取。 */
export class PrefetchingSearchProvider implements RetrievalSearchProvider {
  constructor(
    private readonly inner: RetrievalSearchProvider,
    private readonly fetcher: PrefetchingFetchProvider,
  ) {}
  async search(query: string, maxResults: number): Promise<RetrievalSearchResult[]> {
    const raw = await this.inner.search(query, maxResults)
    const results = raw.filter((r) => isPublicHttpUrl(r.url))
    this.fetcher.prefetch(results)
    return results
  }
}

/** HTML → 正文纯文本（去脚本/样式/导航）。导出供单测。 */
export function htmlToText(html: string): string {
  const body = /<body[\s\S]*?>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  return decodeEntities(
    body
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/** 查询词切分：英文按词，中日文按二元组（无分词依赖）。 */
function queryTerms(query: string): string[] {
  const terms = new Set<string>()
  for (const word of query.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]*/g) ?? []) {
    if (word.length >= 2) terms.add(word)
  }
  for (const segment of query.split(/[^一-鿿぀-ヿ]+/)) {
    for (let i = 0; i < segment.length - 1; i++) terms.add(segment.slice(i, i + 2))
  }
  return [...terms]
}

/** 摘要上限（ExternalEvidence 节选上限 600 字，留出余量）。 */
const SUMMARY_MAX = 520

/**
 * 抽取式摘要：按与查询词的重合度挑句子，保持原文顺序，最多约 520 字。导出供单测。
 * `extraTerms` 返回检索规划里的改写检索式与实体（原话常是口语，挑句子要用改写后的关键词）。
 * 已经很短的正文（新闻摘要、行情、百科导语）原样保留，不再挑句子。
 */
export class ExtractiveSummaryProvider implements RetrievalSummaryProvider {
  constructor(private readonly extraTerms: () => string = () => '') {}

  async summarize(body: string, query: string): Promise<string> {
    const text = /<[a-z][\s\S]*>/i.test(body) ? htmlToText(body) : body.trim()
    if (!text) return ''
    if (text.length <= SUMMARY_MAX) return text
    const sentences = text
      .split(/(?<=[。！？!?；;])|\n|(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8 && s.length <= 400)
    if (sentences.length === 0) return text.slice(0, SUMMARY_MAX)
    const terms = queryTerms(`${query} ${this.extraTerms()}`)
    const scored = sentences.map((sentence, index) => {
      const lower = sentence.toLowerCase()
      const score = terms.reduce((sum, t) => sum + (lower.includes(t) ? 1 : 0), 0)
      return { sentence, index, score }
    })
    const picked = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
    const chosen: typeof scored = []
    let length = 0
    for (const s of picked.length > 0 ? picked : scored) {
      if (length + s.sentence.length > SUMMARY_MAX && chosen.length > 0) break
      chosen.push(s)
      length += s.sentence.length
    }
    return chosen
      .sort((a, b) => a.index - b.index)
      .map((s) => s.sentence)
      .join(' ')
      .slice(0, SUMMARY_MAX + 40)
  }
}

export interface LiveProviderBundle {
  searchProvider: RetrievalSearchProvider
  fetchProvider: RetrievalFetchProvider
  summaryProvider: RetrievalSummaryProvider
  /** 本回合实际使用的检索规划（还没搜索时为 null）。 */
  lastPlan: () => WebSearchPlan | null
}

/** 组织配置的商业搜索 / 自建 SearXNG：作为融合里权重最高的一路（失败不影响免费引擎）。 */
function configuredEngine(
  config: LiveProviderConfig,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): EngineSpec | null {
  const key = config.apiKey?.trim()
  let provider: RetrievalSearchProvider | null = null
  if (config.kind === 'tavily' && key)
    provider = new TavilySearchProvider(key, timeoutMs, fetchImpl)
  else if (config.kind === 'brave' && key)
    provider = new BraveSearchProvider(key, timeoutMs, fetchImpl)
  else if (config.kind === 'bocha' && key)
    provider = new BochaSearchProvider(key, timeoutMs, fetchImpl)
  else if (config.kind === 'searxng' && config.baseUrl)
    provider = new SearxngSearchProvider(config.baseUrl, timeoutMs, fetchImpl)
  if (!provider) return null
  const search = provider
  return {
    name: config.kind,
    weight: 1.5,
    // 商业搜索按次计费：只用最终检索规划的第一条检索式查一次；自建 SearXNG 不计费，全部检索式都查
    firstQueryOnly: config.kind !== 'searxng',
    costly: config.kind !== 'searxng',
    run: (query) => search.search(query, 10),
  }
}

/** 按组织设置组装一次回合用的提供方（每回合新建：预取缓存不跨回合）。 */
export function buildLiveProviders(
  config: LiveProviderConfig,
  options: { planner?: WebSearchPlanner; now?: () => Date } = {},
): LiveProviderBundle {
  const fetchImpl = config.fetchImpl ?? fetch
  // 单个引擎按组织设置的超时（默认 15 秒），最长 30 秒；各引擎并行，慢的不拖累快的
  const timeoutMs = Math.max(5000, Math.min(config.timeoutMs || 15_000, 30_000))
  const configured = configuredEngine(config, timeoutMs, fetchImpl)
  const smart = new SmartSearchProvider({
    planner: options.planner,
    engines: [...(configured ? [configured] : []), ...freeSearchEngines(timeoutMs, fetchImpl)],
    quotes: financeQuotes(timeoutMs, fetchImpl),
    now: options.now,
  })
  // 页面抓取：单页最多等 15 秒（并行预取），拿不到就用搜索摘要
  const fetchProvider = new PrefetchingFetchProvider(Math.min(timeoutMs, 15_000), fetchImpl)
  const planTerms = () => {
    const plan = smart.lastPlan
    return plan ? [...plan.queries, ...plan.entities].join(' ') : ''
  }
  return {
    searchProvider: new PrefetchingSearchProvider(smart, fetchProvider),
    fetchProvider,
    summaryProvider: new ExtractiveSummaryProvider(planTerms),
    lastPlan: () => smart.lastPlan,
  }
}

/**
 * 延迟组装：首次搜索时才读取组织提供方配置（含解密密钥），同一回合复用同一组提供方。
 */
export function lazyLiveProviders(
  resolveConfig: () => Promise<Omit<LiveProviderConfig, 'fetchImpl'>>,
  options: { planner?: WebSearchPlanner } = {},
): LiveProviderBundle {
  let bundle: Promise<LiveProviderBundle> | null = null
  let resolved: LiveProviderBundle | null = null
  const get = () =>
    (bundle ??= resolveConfig().then((config) => {
      resolved = buildLiveProviders(config, options)
      return resolved
    }))
  return {
    searchProvider: {
      search: async (query, maxResults) => {
        const { searchProvider } = await get()
        return searchProvider.search(query, maxResults)
      },
    },
    fetchProvider: {
      fetch: async (url, timeoutMs) => {
        const { fetchProvider } = await get()
        return fetchProvider.fetch(url, timeoutMs)
      },
    },
    summaryProvider: {
      summarize: async (body, query) => {
        const { summaryProvider } = await get()
        return summaryProvider.summarize(body, query)
      },
    },
    lastPlan: () => resolved?.lastPlan() ?? null,
  }
}
