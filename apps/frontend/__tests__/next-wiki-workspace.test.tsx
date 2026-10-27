/**
 * v3-llm-wiki-memory-foundation —— 记忆维基前端：开关与入口、遮蔽占位、编辑校验、审阅确认、撤回。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  WikiIngestRunDto,
  WikiPageSummaryDto,
  WikiPageViewDto,
  WikiReviewQueueItemDto,
  WikiSpaceDto,
} from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import { WikiEntryButton, WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'
import { prepareWikiMarkdown } from '@/components/next/wiki/WikiPageView'
import { lineDiff } from '@/components/next/wiki/wiki-ui'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/wiki',
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

interface Rec {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetch(route: (path: string, method: string, body: Rec['body']) => Response | null) {
  const records: Rec[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Rec['body']) : null
    const path = raw.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    return (
      route(path, method, body) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: path } })
    )
  })
  return records
}

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const SPACE: WikiSpaceDto = {
  id: 7,
  scopeKind: 'organization',
  scopeRefId: 1,
  title: '组织维基',
  canReview: true,
  canPropose: true,
  pageCount: 1,
  pendingProposalCount: 1,
}

const PAGE: WikiPageSummaryDto = {
  id: 11,
  spaceId: 7,
  slug: 'cert',
  title: '证书教训',
  pageType: 'lesson',
  summaryLine: '第三方证书相关经验',
  status: 'active',
  publishedRevisionId: 21,
  hasPendingProposal: false,
  updatedAt: '2026-10-24T00:00:00.000Z',
}

function pageView(overrides: Partial<WikiPageViewDto> = {}): WikiPageViewDto {
  return {
    page: PAGE,
    revision: {
      id: 21,
      authorKind: 'human',
      editClass: 'knowledge',
      createdAt: '2026-10-24T00:00:00.000Z',
      reviewedAt: '2026-10-24T00:00:00.000Z',
    },
    body: '## 内容\n- （此条需更高权限）\n- 联调前先确认环境。[^c:env]\n',
    claims: [
      { claimKey: 'cert', masked: true },
      {
        id: 31,
        claimKey: 'env',
        statement: '联调前先确认环境。',
        claimKind: 'rule',
        status: 'active',
        validFrom: null,
        validTo: null,
        recordedAt: '2026-10-24T00:00:00.000Z',
        supersededAt: null,
        evidenceCount: 1,
        invalidReason: null,
        sources: [{ kind: 'user_statement', id: '1', version: null, label: '本人陈述 #1' }],
      },
    ],
    hasMaskedContent: true,
    outgoingLinks: [],
    canReview: true,
    canEdit: true,
    sharedWithProjectIds: null,
    asOf: null,
    ...overrides,
  }
}

function setAuth() {
  useAuthStore.setState({
    user: { id: 1, email: 'a@example.com', fullName: '管理员', organizations: [] },
    accessToken: null,
    refreshToken: null,
    permissions: ['wiki:view'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  } as never)
}

function enabledBackend(
  opts: { view?: WikiPageViewDto; space?: WikiSpaceDto; queue?: WikiReviewQueueItemDto[] } = {},
) {
  const space = opts.space ?? SPACE
  return (path: string, method: string): Response | null => {
    if (path === '/wiki/settings')
      return jsonResponse(200, { data: { enabled: true, canManage: true } })
    if (path === '/wiki/spaces/resolve' && method === 'POST')
      return jsonResponse(200, { data: space })
    if (path.startsWith('/wiki/spaces/7/pages'))
      return jsonResponse(200, {
        data: [PAGE],
        meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
      })
    if (path === '/wiki/pages/11') return jsonResponse(200, { data: opts.view ?? pageView() })
    if (path === '/wiki/revisions/21')
      return jsonResponse(200, {
        data: { id: 21, body: '---\ntitle: x\n---\n正文', baseBody: null, hasMaskedContent: true },
      })
    if (path.startsWith('/wiki/review-queue'))
      return jsonResponse(200, {
        data: opts.queue ?? [],
        meta: { total: 0, page: 1, perPage: 0, totalPages: 1 },
      })
    return null
  }
}

beforeEach(() => setAuth())
afterEach(() => vi.unstubAllGlobals())

describe('开关与入口', () => {
  test('未开启：管理员看到开启按钮并可开启；不发任何空间请求', async () => {
    let enabled = false
    const records = installFetch((path, method) => {
      if (path === '/wiki/settings' && method === 'GET')
        return jsonResponse(200, { data: { enabled, canManage: true } })
      if (path === '/wiki/settings' && method === 'PUT') {
        enabled = true
        return jsonResponse(200, { data: { enabled: true, canManage: true } })
      }
      return null
    })
    renderUi(<WikiWorkspace scopeKind="organization" />)
    const button = await screen.findByRole('button', { name: '为本组织开启' })
    expect(records.some((r) => r.url.startsWith('/wiki/spaces'))).toBe(false)
    fireEvent.click(button)
    await waitFor(() =>
      expect(records.some((r) => r.method === 'PUT' && r.body?.enabled === true)).toBe(true),
    )
  })

  test('未开启：普通成员只看到说明，入口按钮隐藏', async () => {
    installFetch((path) =>
      path === '/wiki/settings'
        ? jsonResponse(200, { data: { enabled: false, canManage: false } })
        : null,
    )
    renderUi(
      <>
        <WikiWorkspace scopeKind="organization" />
        <WikiEntryButton />
      </>,
    )
    expect(await screen.findByText('请联系组织管理员开启。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '为本组织开启' })).toBeNull()
    expect(document.querySelector('[data-wiki-entry]')).toBeNull()
  })

  test('已开启：入口按钮指向组织维基', async () => {
    installFetch(enabledBackend())
    renderUi(<WikiEntryButton />)
    const link = await screen.findByRole('link', { name: /记忆维基/ })
    expect(link.getAttribute('href')).toBe('/next/wiki')
  })
})

describe('页面阅读', () => {
  test('遮蔽内容显示占位与提示，被遮蔽主张不出现在依据列表', async () => {
    installFetch(enabledBackend())
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /证书教训/ }))
    expect(await screen.findByText(/部分内容引用了你无权查看的资料/)).toBeTruthy()
    const body = document.querySelector('[data-wiki-body]') as HTMLElement
    expect(within(body).getByText('（此条需更高权限）')).toBeTruthy()
    const claims = document.querySelector('[data-wiki-claims]') as HTMLElement
    expect(within(claims).getAllByRole('listitem')).toHaveLength(1)
    expect(within(claims).getByText('联调前先确认环境。')).toBeTruthy()
    expect(screen.getByText(/不是正式记录/)).toBeTruthy()
  })

  test('含遮蔽内容的页面不能直接编辑', async () => {
    const records = installFetch(enabledBackend())
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /证书教训/ }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    expect(await screen.findByText(/不能直接编辑/)).toBeTruthy()
    expect(document.querySelector('[data-wiki-editor]')).toBeNull()
    expect(records.some((r) => r.url === '/wiki/revisions/21')).toBe(true)
  })

  test('撤回需在对话框中确认后才发请求', async () => {
    const records = installFetch((path, method, body) => {
      if (path === '/wiki/claims/31/retract' && method === 'POST')
        return jsonResponse(200, { data: { retractionId: 1, proposalId: 99, echo: body } })
      return enabledBackend()(path, method)
    })
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /证书教训/ }))
    fireEvent.click(await screen.findByRole('button', { name: /这条不对/ }))
    expect(records.some((r) => r.url.includes('/retract'))).toBe(false)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('撤回原因'), {
      target: { value: '没有这条规矩' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤回' }))
    await waitFor(() =>
      expect(records.find((r) => r.url === '/wiki/claims/31/retract')?.body).toEqual({
        reason: '没有这条规矩',
      }),
    )
    expect(await screen.findByText(/已撤回该主张/)).toBeTruthy()
  })

  test('非审阅者看不到撤回按钮，编辑按钮显示为「提议修改」', async () => {
    installFetch(enabledBackend({ view: pageView({ canReview: false, hasMaskedContent: false }) }))
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /证书教训/ }))
    expect(await screen.findByRole('button', { name: '提议修改' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /这条不对/ })).toBeNull()
  })
})

describe('编辑器', () => {
  test('解析错误逐行显示且禁止提交；非审阅者按钮为「提交审阅」', async () => {
    installFetch(enabledBackend({ space: { ...SPACE, canReview: false } }))
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /新建页面/ }))
    const textarea = await screen.findByLabelText('页面内容')
    fireEvent.change(screen.getByLabelText('页面标识'), { target: { value: 'gray' } })
    fireEvent.change(textarea, {
      target: { value: '---\ntype: concept\ntitle: 灰度\n---\n- 没来源的主张[^c:a]' },
    })
    expect(await screen.findByText(/第 5 行：主张「a」缺少脚注定义/)).toBeTruthy()
    const submit = screen.getByRole('button', { name: '提交审阅' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
  })

  test('提交成功后提示等待审阅', async () => {
    const records = installFetch((path, method) => {
      if (path === '/wiki/spaces/7/pages' && method === 'POST')
        return jsonResponse(201, {
          data: { page: { ...PAGE, id: 12 }, revision: { id: 40 }, published: false },
        })
      if (path === '/wiki/pages/12')
        return jsonResponse(200, { data: pageView({ page: { ...PAGE, id: 12 } }) })
      return enabledBackend({ space: { ...SPACE, canReview: false } })(path, method)
    })
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /新建页面/ }))
    fireEvent.change(await screen.findByLabelText('页面标识'), { target: { value: 'gray' } })
    fireEvent.click(screen.getByRole('button', { name: '提交审阅' }))
    expect(await screen.findByText(/已提交审阅/)).toBeTruthy()
    expect(
      records.find((r) => r.method === 'POST' && r.url === '/wiki/spaces/7/pages')?.body?.slug,
    ).toBe('gray')
  })
})

describe('审阅队列', () => {
  const queue: WikiReviewQueueItemDto[] = [
    {
      page: PAGE,
      proposals: [
        {
          id: 50,
          pageId: 11,
          baseRevisionId: 21,
          authorKind: 'system',
          authorUserId: null,
          editClass: 'knowledge',
          status: 'proposed',
          changeSummary: '撤回主张后的级联修订',
          reviewedBy: null,
          reviewedAt: null,
          rejectReason: null,
          createdAt: '2026-10-24T00:00:00.000Z',
        },
      ],
    },
  ]

  test('批量发布必须勾选并在对话框确认；基线过期的失败如实提示', async () => {
    const records = installFetch((path, method) => {
      if (path === '/wiki/revisions/50/publish' && method === 'POST')
        return jsonResponse(409, { error: { code: 'WIKI_STALE_BASE', message: 'stale' } })
      return enabledBackend({ queue })(path, method)
    })
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('tab', { name: /审阅队列/ }))
    const batch = await screen.findByRole('button', { name: /发布所选（0）/ })
    expect((batch as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('选择修订 #50'))
    fireEvent.click(screen.getByRole('button', { name: /发布所选（1）/ }))
    expect(records.some((r) => r.url.endsWith('/publish'))).toBe(false)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认发布' }))
    expect(await screen.findByText(/1 条未发布：#50：页面已有更新的版本/)).toBeTruthy()
  })

  test('展开差异显示增删行', async () => {
    installFetch((path, method) => {
      if (path === '/wiki/revisions/50')
        return jsonResponse(200, {
          data: {
            ...queue[0]!.proposals[0],
            body: '甲\n丙',
            baseBody: '甲\n乙',
            hasMaskedContent: false,
          },
        })
      return enabledBackend({ queue })(path, method)
    })
    renderUi(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('tab', { name: /审阅队列/ }))
    fireEvent.click(await screen.findByRole('button', { name: '查看差异' }))
    const diff = await screen.findByText((_, el) => el?.textContent === '+ 丙')
    expect(diff).toBeTruthy()
    expect(screen.getByText((_, el) => el?.textContent === '- 乙')).toBeTruthy()
  })
})

describe('AI 编入', () => {
  const PROJECT_SPACE: WikiSpaceDto = {
    ...SPACE,
    scopeKind: 'project',
    scopeRefId: 5,
    title: '项目维基',
  }
  const run = (overrides: Partial<WikiIngestRunDto> = {}): WikiIngestRunDto => ({
    id: 3,
    spaceId: 7,
    runKind: 'ingest',
    triggerKind: 'manual',
    status: 'queued',
    eventsCount: 0,
    pagesTouched: 0,
    proposalsCreated: 0,
    opsAccepted: 0,
    opsRejected: 0,
    pagesFailed: 0,
    hasMore: false,
    tokensUsed: 0,
    modelName: null,
    errorCode: null,
    createdAt: '2026-10-24T08:00:00.000Z',
    finishedAt: null,
    ...overrides,
  })
  const envelope = (data: WikiIngestRunDto[]) =>
    jsonResponse(200, { data, meta: { total: data.length, page: 1, perPage: 20, totalPages: 1 } })

  test('非项目空间没有「AI 编入」分页', async () => {
    installFetch(enabledBackend())
    renderUi(<WikiWorkspace scopeKind="organization" />)
    await screen.findByRole('tab', { name: /审阅队列/ })
    expect(screen.queryByRole('tab', { name: 'AI 编入' })).toBeNull()
  })

  test('无审阅权限的项目空间也没有该分页', async () => {
    installFetch(enabledBackend({ space: { ...PROJECT_SPACE, canReview: false } }))
    renderUi(<WikiWorkspace scopeKind="project" scopeRefId={5} />)
    await screen.findByRole('tab', { name: '操作日志' })
    expect(screen.queryByRole('tab', { name: 'AI 编入' })).toBeNull()
  })

  test('触发后轮询到完成，显示采纳与拦下数量', async () => {
    let runs: WikiIngestRunDto[] = []
    let polls = 0
    const records = installFetch((path, method) => {
      if (path === '/wiki/spaces/7/ingest' && method === 'POST') {
        runs = [run()]
        return jsonResponse(202, { data: runs[0] })
      }
      if (path === '/wiki/spaces/7/ingest-runs') {
        if (runs.length && ++polls > 1)
          runs = [
            run({
              status: 'succeeded',
              eventsCount: 4,
              proposalsCreated: 2,
              opsAccepted: 3,
              opsRejected: 1,
              hasMore: true,
              tokensUsed: 900,
              finishedAt: '2026-10-24T08:01:00.000Z',
            }),
          ]
        return envelope(runs)
      }
      return enabledBackend({ space: PROJECT_SPACE })(path, method)
    })
    renderUi(<WikiWorkspace scopeKind="project" scopeRefId={5} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'AI 编入' }))
    expect(await screen.findByText('还没有运行过 AI 编入。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /AI 编入近期动态/ }))
    await screen.findByText(/#3 · 排队中/)
    expect(
      (screen.getByRole('button', { name: /AI 编入近期动态/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      await screen.findByText(/采纳 3 条、拦下 1 条不合规的说法；还有更多动态/, undefined, {
        timeout: 5000,
      }),
    ).toBeTruthy()
    expect(screen.getByText(/#3 · 已完成/)).toBeTruthy()
    expect(records.filter((r) => r.method === 'POST' && r.url.endsWith('/ingest'))).toHaveLength(1)
  }, 10000)

  test('失败与无可用连接如实显示；进行中冲突给出提示', async () => {
    installFetch((path, method) => {
      if (path === '/wiki/spaces/7/ingest' && method === 'POST')
        return jsonResponse(409, { error: { code: 'WIKI_INGEST_BUSY', message: 'busy' } })
      if (path === '/wiki/spaces/7/ingest-runs')
        return envelope([
          run({ id: 9, status: 'failed', errorCode: 'MODEL_OUTPUT_INVALID' }),
          run({ id: 8, status: 'model_unavailable', triggerKind: 'command' }),
        ])
      return enabledBackend({ space: PROJECT_SPACE })(path, method)
    })
    renderUi(<WikiWorkspace scopeKind="project" scopeRefId={5} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'AI 编入' }))
    expect(await screen.findByText(/AI 返回的内容格式不对/)).toBeTruthy()
    expect(screen.getByText(/#8 · 没有可用的 AI 连接 · .* · 定时任务/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /AI 编入近期动态/ }))
    expect(await screen.findByText(/已有 AI 编入在进行中/)).toBeTruthy()
  })
})

describe('纯函数', () => {
  test('prepareWikiMarkdown：主张标记转角标、内部链接转导航、去掉脚注定义', () => {
    const out = prepareWikiMarkdown('- 甲[^c:a] 见 [[gray|灰度]]\n[^c:a]: task#1')
    expect(out).toBe('- 甲[※](#wiki-claim-a) 见 [灰度](#wiki-page-gray)')
  })

  test('lineDiff 逐行对比', () => {
    expect(lineDiff('a\nb', 'a\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'c' },
    ])
  })
})
