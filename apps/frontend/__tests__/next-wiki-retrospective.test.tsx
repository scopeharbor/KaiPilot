/**
 * v3-llm-wiki-retrospective-lessons —— 项目维基「生成项目复盘」、复盘页「请 AI 提炼教训」与「晋升到组织教训库」、
 * 风险登记「历史上遇到过」召回卡片。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  WikiClaimDto,
  WikiIngestRunDto,
  WikiPageSummaryDto,
  WikiPageViewDto,
  WikiSpaceDto,
} from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'
import { WikiPageView } from '@/components/next/wiki/WikiPageView'
import { WikiLessonRecall } from '@/components/next/wiki/WikiLessonRecall'
import { wikiLessonsResultText } from '@/components/next/wiki/WikiRetrospective'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/projects/9/wiki',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers(),
    json: async () => body,
  } as Response
}

function installFetch(route: (path: string, method: string) => Response | null) {
  const records: Array<{ method: string; url: string }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = raw.replace(API_PREFIX, '')
    records.push({ method, url: path })
    return route(path, method) ?? jsonResponse(404, { error: { code: 'NOT_FOUND', message: path } })
  })
  return records
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const list = <T,>(data: T[]) => ({
  data,
  meta: { total: data.length, page: 1, perPage: data.length || 1, totalPages: 1 },
})

const RUN = (overrides: Partial<WikiIngestRunDto> = {}): WikiIngestRunDto =>
  ({
    id: 41,
    spaceId: 7,
    runKind: 'retrospective_lessons',
    triggerKind: 'manual',
    status: 'succeeded',
    eventsCount: 3,
    pagesTouched: 1,
    proposalsCreated: 1,
    opsAccepted: 2,
    opsRejected: 0,
    pagesFailed: 0,
    hasMore: false,
    tokensUsed: 100,
    errorCode: null,
    createdAt: '2026-10-26T00:00:00.000Z',
    finishedAt: '2026-10-26T00:00:01.000Z',
    ...overrides,
  }) as WikiIngestRunDto

const RETRO_PAGE: WikiPageSummaryDto = {
  id: 21,
  spaceId: 7,
  slug: 'retrospective',
  title: '项目复盘',
  pageType: 'lesson',
  summaryLine: '结项后的计划与实际对比',
  status: 'active',
  publishedRevisionId: 50,
  hasPendingProposal: false,
  updatedAt: '2026-10-26T00:00:00.000Z',
}

const claim = (
  id: number,
  key: string,
  statement: string,
  kind: 'derived' | 'inference',
): WikiClaimDto => ({
  id,
  claimKey: key,
  statement,
  claimKind: kind,
  status: 'active',
  validFrom: null,
  validTo: null,
  recordedAt: '2026-10-26T00:00:00.000Z',
  supersededAt: null,
  evidenceCount: 1,
  invalidReason: null,
  sources: [],
})

const BODY = [
  '## 计划与实际（确定性派生，勿手改）',
  '',
  '<!-- derived:project.retrospective -->',
  '- 任务 4 个，已完成 3 个。[^c:pr-tasks]',
  '<!-- /derived -->',
  '',
  '## 教训（经审阅）',
  '',
  '- 证书类任务开工前先确认办理周期。[^c:l1]',
  '',
  '[^c:pr-tasks]: derived_query#project.retrospective',
  '[^c:l1]: user_statement#1',
  '',
].join('\n')

function retroView(overrides: Partial<WikiPageViewDto> = {}): WikiPageViewDto {
  return {
    page: RETRO_PAGE,
    revision: {
      id: 50,
      authorKind: 'human',
      editClass: 'knowledge',
      createdAt: '2026-10-26T00:00:00.000Z',
      reviewedAt: null,
    },
    body: BODY,
    claims: [
      claim(1, 'pr-tasks', '任务 4 个，已完成 3 个。', 'derived'),
      claim(2, 'l1', '证书类任务开工前先确认办理周期。', 'inference'),
    ],
    hasMaskedContent: false,
    outgoingLinks: [],
    canReview: true,
    canEdit: true,
    sharedWithProjectIds: null,
    asOf: null,
    ...overrides,
  }
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 1, email: 'a@example.com', fullName: '项目经理', organizations: [] },
    accessToken: null,
    refreshToken: null,
    permissions: ['wiki:view', 'wiki:review'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  } as never)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('复盘页', () => {
  test('提炼教训结果说明覆盖各状态', () => {
    expect(wikiLessonsResultText(RUN({ status: 'running' }))).toMatch(/正在根据复盘统计/)
    expect(wikiLessonsResultText(RUN({ opsRejected: 1 }))).toBe(
      '已生成教训提议（2 条），拦下 1 条不合规的说法，请到「审阅队列」确认后才会生效。',
    )
    expect(wikiLessonsResultText(RUN({ proposalsCreated: 0, opsAccepted: 0 }))).toBe(
      'AI 没有找到值得写进复盘的教训。',
    )
    expect(wikiLessonsResultText(RUN({ status: 'no_events' }))).toMatch(/请先生成项目复盘/)
    expect(wikiLessonsResultText(RUN({ status: 'model_unavailable' }))).toMatch(/没有生成教训/)
  })

  test('项目空间审阅者：可请 AI 提炼；只有「教训」章节的主张可晋升，晋升后提示等待组织审阅', async () => {
    const records = installFetch((path, method) => {
      if (path === '/wiki/pages/21/lessons' && method === 'POST')
        return jsonResponse(202, { data: RUN({ status: 'queued', proposalsCreated: 0 }) })
      if (path === '/wiki/spaces/7/ingest-runs') return jsonResponse(200, list([RUN()]))
      if (path === '/wiki/claims/2/promote' && method === 'POST')
        return jsonResponse(201, { data: { pageId: 99, revisionId: 100 } })
      return null
    })
    withClient(
      <WikiPageView
        view={retroView()}
        spaceId={7}
        spaceScope="project"
        onOpenSlug={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(document.querySelector('[data-wiki-promote="1"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /晋升到组织教训库/ }))
    expect(await screen.findByText(/已提交到组织教训库/)).toBeTruthy()
    expect(records.some((r) => r.url === '/wiki/claims/2/promote')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /请 AI 提炼教训/ }))
    expect(await screen.findByText(/已生成教训提议（2 条）/)).toBeTruthy()
  })

  test('晋升失败显示错误；非项目空间或非审阅者没有提炼与晋升', async () => {
    installFetch((path, method) =>
      path === '/wiki/claims/2/promote' && method === 'POST'
        ? jsonResponse(409, { error: { code: 'WIKI_CONFLICT', message: '组织教训库已有这条教训' } })
        : null,
    )
    const { unmount } = withClient(
      <WikiPageView
        view={retroView()}
        spaceId={7}
        spaceScope="project"
        onOpenSlug={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /晋升到组织教训库/ }))
    expect(await screen.findByText('组织教训库已有这条教训')).toBeTruthy()
    unmount()

    const second = withClient(
      <WikiPageView
        view={retroView()}
        spaceId={7}
        spaceScope="organization"
        onOpenSlug={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /请 AI 提炼教训/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /晋升到组织教训库/ })).toBeNull()
    second.unmount()

    withClient(
      <WikiPageView
        view={retroView({ canReview: false })}
        spaceId={7}
        spaceScope="project"
        onOpenSlug={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /请 AI 提炼教训/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /晋升到组织教训库/ })).toBeNull()
  })
})

describe('项目维基 · 生成项目复盘', () => {
  const SPACE: WikiSpaceDto = {
    id: 7,
    scopeKind: 'project',
    scopeRefId: 9,
    title: '项目维基',
    canReview: true,
    canPropose: true,
    pageCount: 0,
    pendingProposalCount: 0,
  }

  function backend(extra: (path: string, method: string) => Response | null) {
    return (path: string, method: string): Response | null => {
      const hit = extra(path, method)
      if (hit) return hit
      if (path === '/wiki/settings')
        return jsonResponse(200, { data: { enabled: true, canManage: false } })
      if (path === '/wiki/spaces/resolve' && method === 'POST')
        return jsonResponse(200, { data: SPACE })
      if (path.startsWith('/wiki/spaces/7/pages')) return jsonResponse(200, list([]))
      if (path === '/wiki/shared-with-me') return jsonResponse(200, list([]))
      return null
    }
  }

  test('生成、已是最新、没有任务与未结项各有说明', async () => {
    const results: Array<[number, unknown]> = [
      [200, { data: { created: 1, updated: 0, unchanged: 0, skipped: 0 } }],
      [200, { data: { created: 0, updated: 1, unchanged: 0, skipped: 0 } }],
      [200, { data: { created: 0, updated: 0, unchanged: 1, skipped: 0 } }],
      [200, { data: { created: 0, updated: 0, unchanged: 0, skipped: 1 } }],
      [
        400,
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: '项目结项（已完成、已取消或已归档）后才生成复盘',
          },
        },
      ],
    ]
    installFetch(
      backend((path, method) => {
        if (path === '/wiki/projects/9/retrospective/refresh' && method === 'POST') {
          const [status, body] = results.shift()!
          return jsonResponse(status, body)
        }
        return null
      }),
    )
    withClient(<WikiWorkspace scopeKind="project" scopeRefId={9} />)
    const button = await screen.findByRole('button', { name: /生成项目复盘/ })
    const expectations = [
      /已生成项目复盘页/,
      /项目复盘已更新统计，人写的教训保持不变/,
      /项目复盘已是最新/,
      /本项目还没有任务/,
      /项目结项（已完成、已取消或已归档）后才生成复盘/,
    ]
    for (const text of expectations) {
      fireEvent.click(button)
      expect(await screen.findByText(text)).toBeTruthy()
      await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    }
  })
})

describe('风险登记 · 历史上遇到过', () => {
  test('开启维基且文字足够时防抖查询并显示；未开启不请求；文字太短不请求', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let enabled = true
    const records = installFetch((path) => {
      if (path === '/wiki/settings')
        return jsonResponse(200, { data: { enabled, canManage: false } })
      if (path.startsWith('/wiki/lessons/recall'))
        return jsonResponse(
          200,
          list([
            {
              claimId: 5,
              pageId: 99,
              statement: '证书类任务开工前先确认办理周期（来自「支付改造」复盘）。',
              section: '软件类',
              score: 3,
            },
          ]),
        )
      return null
    })
    const { rerender, unmount } = withClient(<WikiLessonRecall text="证书" projectId={9} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(records.some((r) => r.url.startsWith('/wiki/lessons/recall'))).toBe(false)

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <WikiLessonRecall text="第三方证书申请延误" projectId={9} />
      </QueryClientProvider>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(await screen.findByText(/历史上遇到过/)).toBeTruthy()
    expect(screen.getByText('［软件类］')).toBeTruthy()
    const recall = records.find((r) => r.url.startsWith('/wiki/lessons/recall'))!
    expect(recall.url).toContain('projectId=9')
    expect(decodeURIComponent(recall.url)).toContain('第三方证书申请延误')
    unmount()

    enabled = false
    const before = records.filter((r) => r.url.startsWith('/wiki/lessons/recall')).length
    withClient(<WikiLessonRecall text="第三方证书申请延误" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() =>
      expect(records.filter((r) => r.url === '/wiki/settings').length).toBeGreaterThan(1),
    )
    expect(records.filter((r) => r.url.startsWith('/wiki/lessons/recall')).length).toBe(before)
    expect(document.querySelector('[data-wiki-lesson-recall]')).toBeNull()
  })
})
