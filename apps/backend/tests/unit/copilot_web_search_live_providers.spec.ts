import { test } from '@japa/runner'
import {
  ExtractiveSummaryProvider,
  buildLiveProviders,
  htmlToText,
  isPublicHttpUrl,
  parseBingRss,
  parseDuckDuckGoHtml,
} from '#services/copilot_web_search/live_providers'
import { DomainPolicyService } from '#services/copilot_web_search/domain_policy_service'

/** DuckDuckGo HTML 结果页片段（2026-09-26 实测结构，含一个 uddg 跳转链接与一个广告）。 */
const DDG_HTML = `
<div id="links" class="results">
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://support.huaweicloud.com/bulletin-cce/cce_bulletin_0099.html">Kubernetes 1.31版本说明_Kubernetes版本发布记录</a>
      </h2>
      <a class="result__snippet" href="https://support.huaweicloud.com/x">在<b>Kubernetes</b> 1.31中，MatchLabelKeysInPodAffinity特性进阶至Beta。</a>
    </div>
  </div>
  <div class="result results_links web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fkubernetes.io%2Fblog%2F2024%2F08%2F13%2Fkubernetes-v1-31-release%2F&amp;rut=abc">Kubernetes v1.31: Elli &amp; friends</a>
    </h2>
    <a class="result__snippet" href="#">Release announcement.</a>
  </div>
  <div class="result result--ad">
    <a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">广告</a>
  </div>
  <div class="result">
    <a class="result__a" href="http://192.168.1.10/admin">内网</a>
  </div>
</div>`

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

test.group('网页搜索：真实提供方（假 fetch，不出网）', () => {
  test('解析 DuckDuckGo 结果：还原跳转地址、去广告与内网地址、解码实体', ({ assert }) => {
    const results = parseDuckDuckGoHtml(DDG_HTML)
    assert.deepEqual(
      results.map((r) => r.url),
      [
        'https://support.huaweicloud.com/bulletin-cce/cce_bulletin_0099.html',
        'https://kubernetes.io/blog/2024/08/13/kubernetes-v1-31-release/',
      ],
    )
    assert.equal(results[1]!.title, 'Kubernetes v1.31: Elli & friends')
    assert.include(results[0]!.snippet, 'MatchLabelKeysInPodAffinity')
  })

  test('只接受公网 http(s)：拒绝本机、私网与非 http 协议', ({ assert }) => {
    assert.isTrue(isPublicHttpUrl('https://zh.wikipedia.org/wiki/x'))
    for (const bad of [
      'http://localhost:3333',
      'http://127.0.0.1/',
      'http://10.0.0.8/',
      'http://172.20.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'file:///etc/passwd',
      'ftp://example.com/',
    ]) {
      assert.isFalse(isPublicHttpUrl(bad), bad)
    }
  })

  test('免费搜索：网页结果与维基百科融合；DuckDuckGo 失败时仍有百科结果', async ({ assert }) => {
    const wiki = () =>
      Response.json({
        query: { search: [{ title: 'Kubernetes', snippet: '<span>Kubernetes</span> 容器编排' }] },
      })
    const ok = fakeFetch({
      'https://html.duckduckgo.com/html/': () => new Response(DDG_HTML, { status: 200 }),
      'https://zh.wikipedia.org/': wiki,
    })
    const both = buildLiveProviders({ kind: 'free', timeoutMs: 3000, fetchImpl: ok.impl })
    const merged = await both.searchProvider.search('Kubernetes 1.31 有什么变化', 5)
    assert.equal(
      merged[0]!.url,
      'https://support.huaweicloud.com/bulletin-cce/cce_bulletin_0099.html',
    )
    assert.include(
      merged.map((r) => r.title),
      'Kubernetes - 维基百科',
    )

    const ddgDown = fakeFetch({
      'https://html.duckduckgo.com/html/': () => new Response('blocked', { status: 403 }),
      'https://zh.wikipedia.org/': wiki,
    })
    const onlyWiki = buildLiveProviders({ kind: 'free', timeoutMs: 3000, fetchImpl: ddgDown.impl })
    const results = await onlyWiki.searchProvider.search('Kubernetes 1.31 有什么变化', 5)
    assert.lengthOf(results, 1)
    assert.equal(results[0]!.snippet, 'Kubernetes 容器编排')
  })

  test('免费搜索：DuckDuckGo 拦截服务器出口时用 Bing RSS 兜底（含 CDATA、去内网地址）', async ({
    assert,
  }) => {
    const rss = `<?xml version="1.0"?><rss><channel><title>Bing</title>
      <item><title><![CDATA[台积电(2330) 股价 &amp; 行情]]></title><link>https://tw.stock.example.com/q/2330</link>
      <description>台积电今日收盘 1,050 元，涨 1.2%。</description></item>
      <item><title>内网</title><link>http://10.0.0.1/x</link><description>x</description></item>
    </channel></rss>`
    assert.deepEqual(parseBingRss(rss), [
      {
        url: 'https://tw.stock.example.com/q/2330',
        title: '台积电(2330) 股价 & 行情',
        snippet: '台积电今日收盘 1,050 元，涨 1.2%。',
      },
    ])
    const fetcher = fakeFetch({
      'https://html.duckduckgo.com/html/': () => new Response('anomaly', { status: 202 }),
      'https://cn.bing.com/search': () => new Response(rss, { status: 200 }),
      'https://zh.wikipedia.org/': () =>
        Response.json({ query: { search: [{ title: '台积电', snippet: '半导体公司' }] } }),
    })
    const bundle = buildLiveProviders({ kind: 'free', timeoutMs: 3000, fetchImpl: fetcher.impl })
    const results = await bundle.searchProvider.search('台积电 2330 股价', 5)
    assert.equal(results[0]!.url, 'https://tw.stock.example.com/q/2330')
    assert.include(
      results.map((r) => r.title),
      '台积电 - 维基百科',
    )
  })

  test('付费提供方：带密钥调用；失败时自动退回免费搜索', async ({ assert }) => {
    let tavilyAuth = ''
    const fetcher = fakeFetch({
      'https://api.tavily.com/search': () => new Response('quota', { status: 432 }),
      'https://html.duckduckgo.com/html/': () => new Response(DDG_HTML, { status: 200 }),
      'https://en.wikipedia.org/': () => Response.json({ query: { search: [] } }),
    })
    const wrapped = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).startsWith('https://api.tavily.com')) {
        tavilyAuth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
      }
      return fetcher.impl(input, init)
    }) as typeof fetch
    const bundle = buildLiveProviders({
      kind: 'tavily',
      apiKey: 'tvly-test-key',
      timeoutMs: 3000,
      fetchImpl: wrapped,
    })
    const results = await bundle.searchProvider.search('kubernetes release notes', 5)
    assert.equal(tavilyAuth, 'Bearer tvly-test-key')
    assert.isAbove(results.length, 0, '退回免费搜索后仍有结果')
  })

  test('页面抓取：预取正文并生成抽取式摘要；抓不到时退回搜索摘要', async ({ assert }) => {
    const page = `<html><head><style>.x{}</style></head><body><nav>导航</nav>
      <p>Kubernetes 1.31 于 2024 年 8 月发布。</p>
      <p>MatchLabelKeysInPodAffinity 特性在 Kubernetes 1.31 进阶至 Beta，改进滚动更新时的亲和性调度。</p>
      <p>与本主题无关的一段很长的页脚说明文字。</p></body></html>`
    const fetcher = fakeFetch({
      'https://html.duckduckgo.com/html/': () => new Response(DDG_HTML, { status: 200 }),
      'https://zh.wikipedia.org/': () => Response.json({ query: { search: [] } }),
      'https://support.huaweicloud.com/': () =>
        new Response(page, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      'https://kubernetes.io/': () => new Response('gone', { status: 404 }),
    })
    const bundle = buildLiveProviders({ kind: 'free', timeoutMs: 3000, fetchImpl: fetcher.impl })
    const results = await bundle.searchProvider.search('Kubernetes 1.31 亲和性', 5)

    const first = await bundle.fetchProvider.fetch(results[0]!.url, 1000)
    assert.isTrue(first.success)
    const summary = await bundle.summaryProvider.summarize(first.body!, 'Kubernetes 1.31 亲和性')
    assert.include(summary, 'MatchLabelKeysInPodAffinity')
    assert.notInclude(summary, '导航')

    const second = await bundle.fetchProvider.fetch(results[1]!.url, 1000)
    assert.isTrue(second.success, '抓取失败时用搜索摘要兜底')
    assert.equal(second.body, 'Release announcement.')
  })

  test('HTML 转正文去掉脚本、样式与导航；摘要长度有上限', async ({ assert }) => {
    const text = htmlToText(
      '<body><script>alert(1)</script><header>站点头</header><p>正文一。</p><p>正文二&amp;三。</p></body>',
    )
    assert.equal(text, '正文一。\n正文二&三。')
    const long = Array.from({ length: 60 }, (_, i) => `第${i}句讲的是项目排期与依赖。`).join('')
    const summary = await new ExtractiveSummaryProvider().summarize(long, '项目排期')
    assert.isAtMost(summary.length, 560)
    assert.isBelow(summary.length, long.length)
    // 短正文（新闻摘要、行情、百科导语）原样保留
    const short = '台积电（2330.TW）最新价 1,050 TWD；前收 1,040；行情时间 2026-10-05 13:30。'
    assert.equal(await new ExtractiveSummaryProvider().summarize(short, '台积电股价'), short)
  })

  test('域名白名单留空 = 不限制（黑名单仍生效）', ({ assert }) => {
    const service = new DomainPolicyService()
    const now = new Date().toISOString()
    const policy = {
      organizationId: 1,
      allowlist: [],
      denylist: [{ pattern: 'bad.example.com', type: 'exact' as const }],
      createdAt: now,
      updatedAt: now,
    }
    assert.isTrue(service.check({ domain: 'kubernetes.io', organizationId: 1 }, policy).allowed)
    assert.isFalse(service.check({ domain: 'bad.example.com', organizationId: 1 }, policy).allowed)
  })
})
