/**
 * v3-copilot-web-search-tool §6 — Fixture Provider（默认实现）。
 *
 * 授权开启后的真实外发属授权门：默认全部走 fixture/mock。
 * 实现停在"构造请求 → 落决策 → 不发出"的可验证边界，授权开启后才真正出网。
 *
 * 职责：
 * - 提供搜索、抓取、摘要三步的 fixture 实现
 * - 作为可替换适配器的默认实现
 * - 不发起任何真实 HTTP 请求
 */

import type {
  RetrievalSearchProvider,
  RetrievalSearchResult,
  RetrievalFetchProvider,
  RetrievalFetchResult,
  RetrievalSummaryProvider,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Fixture 搜索 Provider
// ---------------------------------------------------------------------------

/** Fixture 搜索 Provider（返回固定结果，不发起网络请求）。 */
export class FixtureSearchProvider implements RetrievalSearchProvider {
  private results: RetrievalSearchResult[]

  constructor(results?: RetrievalSearchResult[]) {
    this.results = results ?? [
      { url: 'https://example.com/article1', title: '示例文章 1', snippet: '这是摘要 1' },
      { url: 'https://example.com/article2', title: '示例文章 2', snippet: '这是摘要 2' },
      { url: 'https://other.com/page', title: '其他页面', snippet: '其他摘要' },
    ]
  }

  async search(_query: string, maxResults: number): Promise<RetrievalSearchResult[]> {
    return this.results.slice(0, maxResults)
  }
}

// ---------------------------------------------------------------------------
// Fixture 抓取 Provider
// ---------------------------------------------------------------------------

/** Fixture 抓取 Provider（返回固定内容，不发起网络请求）。 */
export class FixtureFetchProvider implements RetrievalFetchProvider {
  private responses: Map<string, RetrievalFetchResult>

  constructor(responses?: Map<string, RetrievalFetchResult>) {
    this.responses =
      responses ??
      new Map([
        [
          'https://example.com/article1',
          {
            success: true,
            body: '<html><body>示例文章 1 的正文内容</body></html>',
          },
        ],
        [
          'https://example.com/article2',
          {
            success: true,
            body: '<html><body>示例文章 2 的正文内容</body></html>',
          },
        ],
        [
          'https://other.com/page',
          {
            success: true,
            body: '<html><body>其他页面的正文内容</body></html>',
          },
        ],
      ])
  }

  async fetch(url: string, _timeoutMs: number): Promise<RetrievalFetchResult> {
    const result = this.responses.get(url)
    if (result) {
      return result
    }
    // 默认返回抓取失败
    return {
      success: false,
      failureReason: 'fetch_failed',
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture 摘要 Provider
// ---------------------------------------------------------------------------

/** Fixture 摘要 Provider（返回固定摘要，不调用模型）。 */
export class FixtureSummaryProvider implements RetrievalSummaryProvider {
  async summarize(body: string, _query: string): Promise<string> {
    // 从 body 中提取前 200 字符作为摘要
    const plainText = body.replace(/<[^>]*>/g, '').trim()
    return plainText.slice(0, 200) || '无摘要内容'
  }
}

// ---------------------------------------------------------------------------
// 部分失败 Fixture Provider
// ---------------------------------------------------------------------------

/** 部分失败的抓取 Provider（某些 URL 成功，某些失败）。 */
export class FixturePartialFailureFetchProvider implements RetrievalFetchProvider {
  async fetch(url: string, _timeoutMs: number): Promise<RetrievalFetchResult> {
    if (url.includes('timeout')) {
      return { success: false, failureReason: 'fetch_timeout' }
    }
    if (url.includes('fail')) {
      return { success: false, failureReason: 'fetch_failed' }
    }
    return {
      success: true,
      body: `<html><body>${url} 的正文内容</body></html>`,
    }
  }
}
