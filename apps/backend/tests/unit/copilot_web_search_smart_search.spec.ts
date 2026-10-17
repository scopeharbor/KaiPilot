import { test } from '@japa/runner'
import { buildLiveProviders } from '#services/copilot_web_search/live_providers'
import {
  createWebSearchPlanner,
  normalizeModelSearchPlan,
  ruleBasedSearchPlan,
  todayLabel,
  WEB_SEARCH_PLANNER_TIMEOUT_MS,
  type WebSearchPlan,
} from '#services/copilot_web_search/query_planner'
import {
  SmartSearchProvider,
  parseNewsRss,
  quoteFromTencent,
  quoteFromYahooMeta,
  relevanceScore,
  relevanceTerms,
  rrfFuse,
  toTencentCode,
} from '#services/copilot_web_search/smart_search'

const TODAY = new Date('2026-10-05T08:00:00Z')

function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = []
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    if (!key) throw new Error(`unexpected ${url}`)
    return routes[key]!()
  }) as typeof fetch
  return { impl, calls }
}

const rss = (
  items: Array<{ title: string; link: string; description?: string; pubDate?: string }>,
) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map(
      (item) =>
        `<item><title><![CDATA[${item.title}]]></title><link>${item.link}</link>` +
        `<description><![CDATA[${item.description ?? ''}]]></description>` +
        (item.pubDate ? `<pubDate>${item.pubDate}</pubDate>` : '') +
        '</item>',
    )
    .join('')}</channel></rss>`

const plan = (overrides: Partial<WebSearchPlan>): WebSearchPlan => ({
  queries: ['美国总统'],
  entities: ['美国总统'],
  tickers: [],
  lang: 'zh',
  focus: 'general',
  timeSensitive: false,
  source: 'rule',
  ...overrides,
})

test.group('网页搜索：检索规划', () => {
  test('规则改写：去掉口语、职位类问题按时效处理并补年份', ({ assert }) => {
    const president = ruleBasedSearchPlan('请问美国总统是谁？', TODAY)
    assert.equal(president.queries[0], '美国总统')
    assert.include(president.queries, '美国总统 2026')
    assert.isTrue(president.timeSensitive)
    assert.deepEqual(president.entities, ['美国总统'])
    assert.equal(president.lang, 'zh')

    const pm = ruleBasedSearchPlan('日本首相高市早苗', TODAY)
    assert.isTrue(pm.timeSensitive)
    assert.equal(pm.queries[0], '日本首相高市早苗')

    assert.equal(ruleBasedSearchPlan('東京の天気は？', TODAY).lang, 'ja')
    assert.equal(ruleBasedSearchPlan('who is the current US president', TODAY).lang, 'en')
  })

  test('规则改写：股价问题给出行情代码（含繁体与直接写出的代码）', ({ assert }) => {
    const tsmc = ruleBasedSearchPlan('帮我监视台积电股价', TODAY)
    assert.equal(tsmc.focus, 'finance')
    assert.includeMembers(tsmc.tickers, ['2330.TW', 'TSM'])
    assert.equal(tsmc.queries[0], '台积电股价')
    assert.include(tsmc.entities, '台积电')

    assert.includeMembers(ruleBasedSearchPlan('台積電股價多少', TODAY).tickers, ['2330.TW'])
    assert.include(ruleBasedSearchPlan('0700.HK 今天行情', TODAY).tickers, '0700.HK')
    assert.deepEqual(ruleBasedSearchPlan('台积电的创办人是谁', TODAY).tickers, [])
  })

  test('模型规划：校验输出、过滤非法代码，缺项用规则补齐', ({ assert }) => {
    const fallback = ruleBasedSearchPlan('美国总统是谁', TODAY)
    const normalized = normalizeModelSearchPlan(
      {
        queries: ['现任美国总统 2026', 'current US president 2026', '', 42],
        entities: ['美国总统', 'President of the United States'],
        tickers: ['tsm', 'rm -rf /'],
        focus: 'reference',
        timeSensitive: true,
      },
      fallback,
    )
    assert.deepEqual(normalized.queries, ['现任美国总统 2026', 'current US president 2026'])
    assert.deepEqual(normalized.tickers, ['TSM'])
    assert.include(normalized.entities, 'President of the United States')
    assert.equal(normalized.focus, 'reference')
    assert.equal(normalized.source, 'model')

    assert.deepEqual(normalizeModelSearchPlan({ queries: [] }, fallback), fallback)
    assert.deepEqual(normalizeModelSearchPlan('不是 JSON', fallback), fallback)
  })

  test('规划器：模型输出可用就用；没有模型、超时或报错都退回规则', async ({ assert }) => {
    let prompt = ''
    const viaModel = createWebSearchPlanner({
      now: () => TODAY,
      parseJson: (raw) => JSON.parse(raw),
      generate: async (system) => {
        prompt = system
        return JSON.stringify({
          queries: ['高市早苗 日本首相'],
          entities: ['高市早苗', 'Sanae Takaichi'],
          tickers: [],
          focus: 'news',
          timeSensitive: true,
        })
      },
    })
    const result = await viaModel('高市早苗')
    assert.equal(result.source, 'model')
    assert.deepEqual(result.queries, ['高市早苗 日本首相'])
    assert.include(prompt, todayLabel(TODAY))

    const noModel = createWebSearchPlanner({
      generate: null,
      parseJson: JSON.parse,
      now: () => TODAY,
    })
    const noModelPlan = await noModel('美国总统是谁')
    assert.equal(noModelPlan.source, 'rule')

    const errors: unknown[] = []
    let plannerSignal: AbortSignal | null = null
    const slow = createWebSearchPlanner({
      now: () => TODAY,
      timeoutMs: 20,
      parseJson: JSON.parse,
      generate: (_system, _user, signal) => {
        plannerSignal = signal
        return new Promise((resolve) => setTimeout(() => resolve('{}'), 500))
      },
      onError: (err) => errors.push(err),
    })
    const slowPlan = await slow('美国总统是谁')
    assert.equal(slowPlan.source, 'rule')
    assert.lengthOf(errors, 1)
    // 超时会真正取消模型请求，不再占着连接和正式回答抢并发 / 限流
    assert.isTrue(plannerSignal!.aborted)
  })

  test('默认规划等待上限给足慢模型（每秒约 10 字的 GPT、推理模型）', ({ assert }) => {
    assert.isAtLeast(WEB_SEARCH_PLANNER_TIMEOUT_MS, 60_000)
  })
})

test.group('网页搜索：解析、融合与相关性', () => {
  test('新闻 RSS：带发布时间与来源，Bing News 跳转链接还原为原文地址', ({ assert }) => {
    const items = parseNewsRss(
      `<rss><channel><item><title>高市早苗当选日本首相 - 新华网</title>` +
        `<link>https://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3a%2f%2fnews.example.com%2fa1&amp;c=1</link>` +
        `<description>&lt;b&gt;高市早苗&lt;/b&gt;在国会首相指名选举中当选。</description>` +
        `<pubDate>Tue, 21 Oct 2025 06:00:00 GMT</pubDate><source url="x">新华网</source></item></channel></rss>`,
    )
    assert.lengthOf(items, 1)
    assert.equal(items[0]!.url, 'https://news.example.com/a1')
    assert.equal(items[0]!.snippet, '高市早苗 在国会首相指名选举中当选。')
    assert.equal(items[0]!.publishedAt, '2025-10-21T06:00:00.000Z')
    assert.include(items[0]!.body!, '发布时间：2025-10-21 14:00（北京时间）')
  })

  test('行情：Yahoo 元数据与腾讯行情都能生成带价格、涨跌与时间的证据', ({ assert }) => {
    const yahoo = quoteFromYahooMeta({
      symbol: '2330.TW',
      currency: 'TWD',
      fullExchangeName: 'Taiwan',
      longName: 'Taiwan Semiconductor Manufacturing Company Limited',
      regularMarketPrice: 1450,
      chartPreviousClose: 1420,
      regularMarketTime: 1791178200,
      regularMarketDayLow: 1425,
      regularMarketDayHigh: 1455,
    })!
    assert.equal(yahoo.url, 'https://finance.yahoo.com/quote/2330.TW')
    assert.include(yahoo.body!, '最新价 1,450 TWD')
    assert.include(yahoo.body!, '涨跌 +30（+2.11%）')
    assert.include(yahoo.body!, '行情时间 2026-10-05')
    assert.isNull(quoteFromYahooMeta({ symbol: 'X' }))

    assert.equal(toTencentCode('600519.SS'), 'sh600519')
    assert.equal(toTencentCode('0700.HK'), 'hk00700')
    assert.equal(toTencentCode('TSM'), 'usTSM')
    assert.isNull(toTencentCode('2330.TW'))
    const fields = Array.from({ length: 40 }, () => '')
    fields[1] = '台积电'
    fields[3] = '285.10'
    fields[4] = '280.00'
    fields[30] = '2026-10-02 16:00:00'
    fields[31] = '5.10'
    fields[32] = '1.82'
    const tencent = quoteFromTencent('TSM', `v_usTSM="${fields.join('~')}";`)!
    assert.include(tencent.body!, '台积电（TSM）最新价 285.1')
    assert.include(tencent.body!, '+1.82%')
    assert.isNull(quoteFromTencent('TSM', 'v_pv_none_match="1";'))
  })

  test('相关性：与核心实体毫无关系的结果得 0 分；中英文实体任一命中即可', ({ assert }) => {
    const terms = relevanceTerms(
      plan({
        queries: ['现任美国总统 2026'],
        entities: ['美国总统', 'President of the United States'],
      }),
    )
    assert.notInclude(terms, '2026')
    assert.notInclude(terms, '现任')
    const score = (title: string, snippet = '') =>
      relevanceScore({ url: 'https://x.com', title, snippet }, terms)
    assert.equal(score('原神 4.0 版本更新公告', '新角色与活动'), 0)
    assert.equal(score('Steam 热门游戏排行榜'), 0)
    assert.equal(score('唐纳德·特朗普', '第 47 任美国总统'), 1)
    assert.equal(score('President of the United States - Wikipedia'), 1)
    assert.isAbove(score('美国现任总统一览'), 0.4)
  })

  test('RRF 融合：多引擎都排前的结果胜出，同一 URL 合并（忽略 www 与追踪参数）', ({ assert }) => {
    const fused = rrfFuse([
      {
        engine: 'bing',
        weight: 1,
        results: [
          { url: 'https://a.com/x', title: 'A', snippet: '' },
          { url: 'https://www.b.com/y?utm_source=bing', title: 'B', snippet: 'b' },
        ],
      },
      {
        engine: 'ddg',
        weight: 1,
        results: [
          { url: 'https://b.com/y/', title: 'B', snippet: '' },
          { url: 'https://c.com/z', title: 'C', snippet: '' },
        ],
      },
    ])
    assert.deepEqual(
      fused.map((r) => r.title),
      ['B', 'A', 'C'],
    )
    assert.equal(fused[0]!.snippet, 'b')
  })
})

test.group('网页搜索：端到端（假 fetch，不出网）', () => {
  test('「美国总统是谁」：丢掉无关的游戏结果，留下百科导语与新闻', async ({ assert }) => {
    const fetcher = fakeFetch({
      'https://cn.bing.com/search': () =>
        new Response(
          rss([
            {
              title: '原神 4.0 版本更新',
              link: 'https://game.example.com/ys',
              description: '新角色',
            },
            { title: '热门手游排行榜', link: 'https://game.example.com/top', description: '下载' },
          ]),
        ),
      'https://html.duckduckgo.com/html/': () => new Response('anomaly', { status: 202 }),
      'https://news.google.com/rss/search': () =>
        new Response(
          rss([
            {
              title: '美国总统特朗普签署行政令 - 新华网',
              link: 'https://news.google.com/rss/articles/abc',
              description: '美国总统特朗普当地时间周五签署行政令。',
              pubDate: 'Fri, 03 Oct 2026 02:00:00 GMT',
            },
          ]),
        ),
      'https://www.bing.com/news/search': () => new Response(rss([])),
      'https://zh.wikipedia.org/w/api.php': () =>
        Response.json({ query: { search: [{ title: '美国总统', snippet: '美国总统是…' }] } }),
      'https://zh.wikipedia.org/api/rest_v1/page/summary/': () =>
        Response.json({
          extract:
            '美国总统是美国的国家元首与政府首脑。现任总统为第47任总统唐纳德·特朗普，于2025年1月20日就任。',
        }),
    })
    const bundle = buildLiveProviders(
      { kind: 'free', timeoutMs: 3000, fetchImpl: fetcher.impl },
      { now: () => TODAY },
    )
    const results = await bundle.searchProvider.search('美国总统是谁', 5)
    const urls = results.map((r) => r.url)
    assert.notInclude(urls, 'https://game.example.com/ys')
    assert.notInclude(urls, 'https://game.example.com/top')
    assert.include(urls, 'https://zh.wikipedia.org/wiki/%E7%BE%8E%E5%9B%BD%E6%80%BB%E7%BB%9F')
    assert.include(urls, 'https://news.google.com/rss/articles/abc')
    assert.equal(bundle.lastPlan()?.queries[0], '美国总统')

    // 百科导语与新闻是「已取得正文」：抓取层直接用，不再请求原网页
    const wikiUrl = 'https://zh.wikipedia.org/wiki/%E7%BE%8E%E5%9B%BD%E6%80%BB%E7%BB%9F'
    const page = await bundle.fetchProvider.fetch(wikiUrl, 1000)
    assert.include(page.body!, '现任总统为第47任总统唐纳德·特朗普')
    const summary = await bundle.summaryProvider.summarize(page.body!, '美国总统是谁')
    assert.include(summary, '唐纳德·特朗普')
    assert.notInclude(
      fetcher.calls.join('\n'),
      'news.google.com/rss/articles',
      '新闻条目不再抓 Google 跳转页',
    )
  })

  test('「台积电股价」：行情排在最前；Yahoo 失败时 TSM 退回腾讯行情', async ({ assert }) => {
    const fields = Array.from({ length: 40 }, () => '')
    fields[1] = '台积电'
    fields[3] = '285.10'
    fields[4] = '280.00'
    fields[30] = '2026-10-02 16:00:00'
    fields[31] = '5.10'
    fields[32] = '1.82'
    const fetcher = fakeFetch({
      'https://query1.finance.yahoo.com/v8/finance/chart/2330.TW': () =>
        Response.json({
          chart: {
            result: [
              {
                meta: {
                  symbol: '2330.TW',
                  currency: 'TWD',
                  shortName: 'TSMC',
                  regularMarketPrice: 1450,
                  chartPreviousClose: 1420,
                  regularMarketTime: 1791178200,
                },
              },
            ],
          },
        }),
      'https://query1.finance.yahoo.com/v8/finance/chart/TSM': () =>
        new Response('Too Many Requests', { status: 429 }),
      'https://qt.gtimg.cn/q=usTSM': () =>
        new Response(new TextEncoder().encode(`v_usTSM="${fields.join('~')}";`), {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
      'https://cn.bing.com/search': () =>
        new Response(
          rss([
            {
              title: '台积电(2330) 股价走势',
              link: 'https://tw.stock.example.com/q/2330',
              description: '台积电今日股价…',
            },
          ]),
        ),
      'https://zh.wikipedia.org/': () => Response.json({ query: { search: [] } }),
    })
    const bundle = buildLiveProviders(
      { kind: 'free', timeoutMs: 3000, fetchImpl: fetcher.impl },
      { now: () => TODAY },
    )
    const results = await bundle.searchProvider.search('帮我监视台积电股价', 5)
    assert.equal(results[0]!.url, 'https://finance.yahoo.com/quote/2330.TW')
    assert.include(results[0]!.snippet, '最新价 1,450 TWD')
    assert.equal(results[1]!.title, '台积电（TSM）实时行情')
    assert.include(
      results.map((r) => r.url),
      'https://tw.stock.example.com/q/2330',
    )
    const quote = await bundle.fetchProvider.fetch(results[0]!.url, 1000)
    assert.include(quote.body!, '涨跌 +30')
  })

  test('模型规划的英文检索式与组织商业搜索一起融合；商业搜索只查第一条检索式', async ({
    assert,
  }) => {
    let tavilyCalls = 0
    const fetcher = fakeFetch({
      'https://api.tavily.com/search': () => {
        tavilyCalls++
        return Response.json({
          results: [
            {
              url: 'https://www.whitehouse.gov/administration/',
              title: 'The Administration | The White House',
              content: 'President Donald J. Trump',
            },
          ],
        })
      },
      'https://zh.wikipedia.org/': () => Response.json({ query: { search: [] } }),
    })
    const search = new SmartSearchProvider({
      planner: async () =>
        plan({
          queries: ['现任美国总统 2026', 'current US president 2026'],
          entities: ['美国总统', 'President of the United States', 'White House'],
          timeSensitive: true,
          source: 'model',
        }),
      engines: [],
      now: () => TODAY,
    })
    assert.lengthOf(await search.search('美国总统是谁', 5), 0, '没有引擎时不编造结果')

    const bundle = buildLiveProviders(
      { kind: 'tavily', apiKey: 'tvly-x', timeoutMs: 3000, fetchImpl: fetcher.impl },
      {
        now: () => TODAY,
        planner: async () =>
          plan({
            queries: ['现任美国总统 2026', 'current US president 2026'],
            entities: ['美国总统', 'President of the United States', 'White House'],
            timeSensitive: true,
            source: 'model',
          }),
      },
    )
    const results = await bundle.searchProvider.search('美国总统是谁', 5)
    assert.equal(results[0]!.url, 'https://www.whitehouse.gov/administration/')
    assert.equal(tavilyCalls, 1)
  })
})

test.group('网页搜索：规则先行 + 模型补搜（慢模型不让搜索干等）', () => {
  test('规划还在跑时规则检索式已经开搜；模型规划回来后补搜新检索式，商业搜索只查一次', async ({
    assert,
  }) => {
    const order: string[] = []
    let releasePlanner: () => void = () => undefined
    const plannerGate = new Promise<void>((resolve) => {
      releasePlanner = resolve
    })
    const freeQueries: string[] = []
    const paidQueries: string[] = []
    const search = new SmartSearchProvider({
      now: () => TODAY,
      planner: async () => {
        await plannerGate
        order.push('planner-done')
        return plan({
          queries: ['现任美国总统 2026', 'current US president 2026'],
          entities: ['美国总统', 'President of the United States'],
          timeSensitive: true,
          source: 'model',
        })
      },
      engines: [
        {
          name: 'free',
          weight: 1,
          run: async (query) => {
            order.push(`free:${query}`)
            freeQueries.push(query)
            return [
              {
                url: `https://news.example.com/${encodeURIComponent(query)}`,
                title: `${query} - 美国总统新闻`,
                snippet: '美国总统…',
              },
            ]
          },
        },
        {
          name: 'paid',
          weight: 1.5,
          firstQueryOnly: true,
          costly: true,
          run: async (query) => {
            paidQueries.push(query)
            return []
          },
        },
      ],
    })
    const pending = search.search('美国总统是谁', 5)
    // 模型规划还没回来：规则检索式已经在搜
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.include(order, 'free:美国总统')
    assert.notInclude(order, 'planner-done')
    assert.deepEqual(paidQueries, [], '商业搜索不参与规则预搜')

    releasePlanner()
    const results = await pending
    assert.includeMembers(freeQueries, [
      '美国总统',
      '现任美国总统 2026',
      'current US president 2026',
    ])
    assert.deepEqual(paidQueries, ['现任美国总统 2026'], '商业搜索只用最终规划查一次')
    assert.equal(search.lastPlan?.source, 'model')
    assert.include(search.lastPlan!.queries, '美国总统')
    assert.isAbove(results.length, 0)
  })

  test('模型规划超时退回规则：规则检索式的结果照常返回，商业搜索用规则检索式查一次', async ({
    assert,
  }) => {
    const paidQueries: string[] = []
    const search = new SmartSearchProvider({
      now: () => TODAY,
      planner: createWebSearchPlanner({
        now: () => TODAY,
        timeoutMs: 20,
        parseJson: JSON.parse,
        generate: () => new Promise(() => undefined),
      }),
      engines: [
        {
          name: 'free',
          weight: 1,
          run: async () => [
            { url: 'https://a.example.com', title: '美国总统 - 维基百科', snippet: '' },
          ],
        },
        {
          name: 'paid',
          weight: 1.5,
          firstQueryOnly: true,
          costly: true,
          run: async (query) => {
            paidQueries.push(query)
            return []
          },
        },
      ],
    })
    const results = await search.search('美国总统是谁', 5)
    assert.equal(results[0]!.url, 'https://a.example.com')
    assert.equal(search.lastPlan?.source, 'rule')
    assert.deepEqual(paidQueries, ['美国总统'])
  })
})
