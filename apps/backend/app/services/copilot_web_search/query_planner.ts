/**
 * Copilot 网页搜索：检索规划（把用户原话改写成搜索引擎能用的检索式）。
 *
 * 借鉴开源 agent 搜索工具 argo（taxueseek/argo，MIT）的思路，用 TypeScript 原生实现：
 * - 语言判定：中文 / 日文 / 英文分别路由搜索参数（避免日文问题打到只认中文的源）；
 * - 意图分类：finance（行情）/ news（时效）/ reference（百科）/ general；
 * - 检索式改写：去掉「是谁 / 请问 / 帮我查」等口语，补上实体全称与年份，产出 1–3 条检索式；
 * - 行情代码：股票类问题给出 Yahoo Finance 代码（如 2330.TW / TSM / 600519.SS / 0700.HK）。
 *
 * 优先用模型规划（由调用方注入，与回答同一模型）；模型不可用、超时或输出无法解析时
 * 退回确定性规则（`ruleBasedSearchPlan`），保证开关打开后总能搜。
 */

export type WebSearchLang = 'zh' | 'ja' | 'en'
export type WebSearchFocus = 'finance' | 'news' | 'reference' | 'general'

export interface WebSearchPlan {
  /** 交给网页搜索引擎的检索式（1–3 条，第一条最重要）。 */
  queries: string[]
  /** 核心实体（中英文名都可），用于百科检索与结果相关性过滤。 */
  entities: string[]
  /** Yahoo Finance 行情代码（股票 / 指数 / 汇率类问题）。 */
  tickers: string[]
  lang: WebSearchLang
  focus: WebSearchFocus
  /** 是否时效性问题（现任、最新、今天、股价、新闻…）：会加查新闻源并提示优先最新资料。 */
  timeSensitive: boolean
  /** 规划来源（落日志用）。 */
  source: 'model' | 'rule'
}

export type WebSearchPlanner = (question: string) => Promise<WebSearchPlan>

const MAX_QUERIES = 3
const MAX_ENTITIES = 4
const MAX_TICKERS = 4

export function detectQueryLang(text: string): WebSearchLang {
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[一-鿿]/.test(text)) return 'zh'
  return 'en'
}

const TIME_SENSITIVE_PATTERN =
  /现任|現任|现在|現在|目前|当前|當前|最新|今天|今日|昨天|本周|本週|本月|今年|近期|最近|刚刚|剛剛|实时|即時|实时|股价|股價|行情|汇率|匯率|报价|報價|新闻|新聞|消息|动态|動態|局势|局勢|选举|選舉|比分|天气|天氣|current|latest|today|now|news|price|stock|who is the/i

/** 职位类问题（「美国总统是谁」）：答案随任期变化，按时效性处理。 */
const OFFICE_PATTERN =
  /总统|總統|首相|总理|總理|主席|部长|部長|市长|市長|州长|州長|董事长|董事長|总裁|總裁|行政长官|行政長官|院长|院長|国王|國王|教宗|ceo|president|prime minister|chairman/i

const FINANCE_PATTERN =
  /股价|股價|股票|行情|涨跌|漲跌|收盘|收盤|开盘|開盤|市值|汇率|匯率|指数|指數|美股|港股|台股|a股|基金净值|stock|share price|ticker|quote|nasdaq|nyse/i

const NEWS_PATTERN = /新闻|新聞|消息|动态|動態|局势|局勢|发生了什么|發生了什麼|事件|news|headline/i

/** 口语与提问词（规则改写时去掉）。 */
const FILLER_PATTERN =
  /请问|請問|帮我|幫我|帮忙|幫忙|麻烦|麻煩|你知道|告诉我|告訴我|查一下|查查|搜一下|搜索一下|搜寻|搜尋|搜索|上网|上網|联网|聯網|网上|網上|监视|監視|监控|監控|看一下|看看|一下|是谁|是誰|是什么|是什麼|是多少|多少钱|多少錢|怎么样|怎麼樣|如何|吗|嗎|呢|吧|啊|呀|的话|的話|[?？!！。，,、]/g

/** 常见公司 / 指数 → Yahoo Finance 代码（模型不可用时的兜底；模型会给出更全的代码）。 */
const TICKER_ALIASES: ReadonlyArray<[RegExp, string[]]> = [
  [/台积电|台積電|tsmc/i, ['2330.TW', 'TSM']],
  [/鸿海|鴻海|富士康|foxconn/i, ['2317.TW']],
  [/联发科|聯發科|mediatek/i, ['2454.TW']],
  [/英伟达|輝達|英偉達|nvidia/i, ['NVDA']],
  [/苹果公司|苹果股|蘋果|apple/i, ['AAPL']],
  [/微软|微軟|microsoft/i, ['MSFT']],
  [/谷歌|google|alphabet/i, ['GOOGL']],
  [/亚马逊|亞馬遜|amazon/i, ['AMZN']],
  [/特斯拉|tesla/i, ['TSLA']],
  [/脸书|臉書|meta platforms|facebook/i, ['META']],
  [/腾讯|騰訊|tencent/i, ['0700.HK']],
  [/阿里巴巴|alibaba/i, ['9988.HK', 'BABA']],
  [/小米/i, ['1810.HK']],
  [/比亚迪|比亞迪|byd/i, ['1211.HK', '002594.SZ']],
  [/贵州茅台|貴州茅台|茅台/i, ['600519.SS']],
  [/宁德时代|寧德時代|catl/i, ['300750.SZ']],
  [/中芯国际|中芯國際|smic/i, ['0981.HK']],
  [/三星电子|三星電子|samsung/i, ['005930.KS']],
  [/丰田|豐田|toyota/i, ['7203.T']],
  [/索尼|sony/i, ['6758.T']],
  [/台湾加权|台灣加權|加权指数|加權指數|台股大盘|台股大盤/i, ['^TWII']],
  [/上证指数|上證指數|上证综指/i, ['000001.SS']],
  [/恒生指数|恆生指數|恒指/i, ['^HSI']],
  [/纳斯达克|那斯達克|nasdaq/i, ['^IXIC']],
  [/标普500|標普500|s&p ?500/i, ['^GSPC']],
  [/道琼斯|道瓊|dow jones/i, ['^DJI']],
  [/日经|日經|nikkei/i, ['^N225']],
  [/美元兑人民币|美元對人民幣|美元人民币汇率/i, ['CNY=X']],
  [/美元兑新台币|美元兌新台幣|新台币汇率|新台幣匯率/i, ['TWD=X']],
  [/美元兑日元|美元兌日圓|日元汇率|日圓匯率/i, ['JPY=X']],
  [/比特币|比特幣|bitcoin|btc/i, ['BTC-USD']],
]

/** 文本里直接写出的行情代码（如 2330.TW、AAPL 股价、0700.HK）。 */
function explicitTickers(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\b(\d{4,6}\.(?:TW|TWO|SS|SZ|HK|T|KS))\b/gi)) {
    found.add(match[1]!.toUpperCase())
  }
  if (FINANCE_PATTERN.test(text)) {
    for (const match of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
      if (!['ETF', 'API', 'USD', 'CEO', 'AI'].includes(match[1]!)) found.add(match[1]!)
    }
  }
  return [...found]
}

function unique(items: Iterable<string>, limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const item = raw.replace(/\s+/g, ' ').trim()
    const key = item.toLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

/** 确定性规则规划（模型不可用时兜底；导出供单测）。 */
export function ruleBasedSearchPlan(question: string, today: Date = new Date()): WebSearchPlan {
  const text = question.replace(/\s+/g, ' ').trim().slice(0, 300)
  const lang = detectQueryLang(text)
  const finance = FINANCE_PATTERN.test(text)
  const news = NEWS_PATTERN.test(text)
  const timeSensitive =
    TIME_SENSITIVE_PATTERN.test(text) || OFFICE_PATTERN.test(text) || finance || news
  const core = text.replace(FILLER_PATTERN, ' ').replace(/\s+/g, ' ').trim() || text
  const year = String(today.getFullYear())

  const tickers = new Set<string>(explicitTickers(text))
  if (finance) {
    for (const [pattern, symbols] of TICKER_ALIASES) {
      if (pattern.test(text)) symbols.forEach((symbol) => tickers.add(symbol))
    }
  }

  const queries = [core]
  // 时效性问题补年份，避免搜到多年前的旧闻（「现任美国总统」→「现任美国总统 2026」）
  if (timeSensitive && !core.includes(year)) queries.push(`${core} ${year}`)
  if (finance && lang !== 'en' && !core.includes('最新')) queries.push(`${core} 最新`)

  return {
    queries: unique(queries, MAX_QUERIES),
    entities: unique(
      core
        .replace(/现任|現任|最新|目前|当前|當前|现在|現在|今天|今日|股价|股價|行情/g, ' ')
        .split(/\s+/)
        .filter((term) => term.length >= 2),
      MAX_ENTITIES,
    ),
    tickers: [...tickers].slice(0, MAX_TICKERS),
    lang,
    focus: finance ? 'finance' : news ? 'news' : timeSensitive ? 'news' : 'general',
    timeSensitive,
    source: 'rule',
  }
}

/** 给模型的检索规划提示词（今天日期由调用方注入）。 */
export function webSearchPlannerPrompt(today: string): string {
  return [
    `你是搜索引擎检索式规划器。今天是 ${today}。用户在聊天里问了一个需要联网搜索的问题，请把它改写成搜索引擎能检索到答案的检索式。`,
    '只输出一个 JSON 对象，不要输出其他文字：',
    '{"queries":["检索式1","检索式2"],"entities":["核心实体中文名","English name"],"tickers":["2330.TW"],"focus":"finance|news|reference|general","timeSensitive":true}',
    '规则：',
    '1. queries 1–3 条：去掉「请问 / 是谁 / 帮我查」等口语，换成关键词组合；第一条用提问语言，另一条可用英文（国际话题）或补充年份 / 同义词；涉及「现任 / 最新 / 现在 / 今天」时加上今年年份。',
    '2. entities：问题里的核心人物 / 机构 / 公司 / 职位 / 事件，中英文名都列（如 ["美国总统","President of the United States"]、["高市早苗","Sanae Takaichi","日本首相"]）。',
    '3. tickers：只有问股价 / 行情 / 市值 / 汇率 / 指数时才填 Yahoo Finance 代码：台股 2330.TW，美股 TSM / AAPL，A 股 600519.SS / 000001.SZ，港股 0700.HK，日股 7203.T，指数 ^TWII / ^GSPC / ^IXIC，汇率 CNY=X / TWD=X，加密货币 BTC-USD；同一公司多地上市可都列；不确定代码就留空数组。',
    '4. timeSensitive：答案会随时间变化（现任职位、股价、新闻、比分、最新版本等）为 true。',
  ].join('\n')
}

const FOCUS_VALUES: readonly WebSearchFocus[] = ['finance', 'news', 'reference', 'general']

/** 校验模型输出的规划；缺项用规则规划补齐（导出供单测）。 */
export function normalizeModelSearchPlan(raw: unknown, fallback: WebSearchPlan): WebSearchPlan {
  if (!raw || typeof raw !== 'object') return fallback
  const record = raw as Record<string, unknown>
  const strings = (value: unknown, maxLength: number) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().slice(0, maxLength))
          .filter(Boolean)
      : []
  const queries = unique(strings(record.queries, 120), MAX_QUERIES)
  if (queries.length === 0) return fallback
  const tickers = unique(
    strings(record.tickers, 16).filter((symbol) => /^[\^A-Za-z0-9.=-]{1,16}$/.test(symbol)),
    MAX_TICKERS,
  ).map((symbol) => symbol.toUpperCase())
  const focus = FOCUS_VALUES.includes(record.focus as WebSearchFocus)
    ? (record.focus as WebSearchFocus)
    : fallback.focus
  return {
    queries,
    entities: unique([...strings(record.entities, 60), ...fallback.entities], MAX_ENTITIES),
    tickers: tickers.length > 0 ? tickers : fallback.tickers,
    lang: fallback.lang,
    focus,
    timeSensitive:
      typeof record.timeSensitive === 'boolean'
        ? record.timeSensitive || fallback.timeSensitive
        : fallback.timeSensitive,
    source: 'model',
  }
}

/** 现在时间标签（北京时间，含星期与时分；规划提示词与回答提示词共用）。 */
export function todayLabel(now: Date = new Date(), timeZone = 'Asia/Shanghai'): string {
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  return `${date}（${timeZone}）`
}

/**
 * 模型规划的默认等待上限：慢模型（如每秒约 10 字的 GPT、会先思考的推理模型）规划也要
 * 十几秒到几十秒，给足 90 秒；规则改写的检索式在此期间已经先搜了（见 SmartSearchProvider），
 * 超时只是少了模型补充的检索式，不会让回答失败。
 */
export const WEB_SEARCH_PLANNER_TIMEOUT_MS = 90_000

/**
 * 组装规划器：优先模型（`generate` 返回模型原文），超时 / 失败 / 无法解析时退回规则。
 * `generate` 为 null 表示没有可用的真实模型。超时时通过 `signal` 真正取消模型请求，
 * 避免它继续占着模型连接，和随后的正式回答抢并发 / 限流。
 */
export function createWebSearchPlanner(options: {
  generate:
    ((systemPrompt: string, userPrompt: string, signal: AbortSignal) => Promise<string>) | null
  parseJson: (rawText: string) => unknown
  timeoutMs?: number
  now?: () => Date
  onError?: (err: unknown) => void
}): WebSearchPlanner {
  const now = options.now ?? (() => new Date())
  return async (question) => {
    const today = now()
    const fallback = ruleBasedSearchPlan(question, today)
    if (!options.generate) return fallback
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const raw = await Promise.race([
        options.generate(
          webSearchPlannerPrompt(todayLabel(today)),
          JSON.stringify({ question: question.slice(0, 600) }),
          controller.signal,
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(new Error('检索规划超时'))
            reject(new Error('检索规划超时'))
          }, options.timeoutMs ?? WEB_SEARCH_PLANNER_TIMEOUT_MS)
        }),
      ])
      return normalizeModelSearchPlan(options.parseJson(raw), fallback)
    } catch (err) {
      options.onError?.(err)
      return fallback
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
