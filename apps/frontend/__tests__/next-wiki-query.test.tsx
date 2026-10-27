/**
 * v3-llm-wiki-query-navigation —— 记忆维基查阅前端：AI 同事维基结果卡、「存进维基」、影子对比、?page= 直达。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  WIKI_QUERY_NOTICE,
  type WikiQueryIndexDto,
  type WikiQueryReadDto,
  type WikiQuerySearchDto,
  type WikiSpaceDto,
} from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import {
  WikiIndexCard,
  WikiReadCard,
  WikiSearchCard,
} from '@/components/next/ai/cards/WikiResultCard'
import { WikiFileBackButton } from '@/components/next/ai/WikiFileBackButton'
import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'

const searchParams = { value: new URLSearchParams() }
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/wiki',
  useParams: () => ({}),
  useSearchParams: () => searchParams.value,
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

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  searchParams.value = new URLSearchParams()
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
})
afterEach(() => vi.unstubAllGlobals())

describe('AI 同事维基结果卡', () => {
  test('目录：按空间分组、可点开、附实时数据优先说明；空目录有提示', () => {
    const data: WikiQueryIndexDto = {
      notice: WIKI_QUERY_NOTICE,
      truncated: false,
      spaces: [
        {
          spaceId: 2,
          scopeKind: 'project',
          scopeRefId: 9,
          title: '支付项目 维基',
          pages: [
            {
              pageId: 5,
              slug: 'project-brief',
              title: '项目简报',
              type: 'project-brief',
              summary: '目标与风险',
            },
          ],
        },
        {
          spaceId: 1,
          scopeKind: 'organization',
          scopeRefId: 1,
          title: '组织维基',
          pages: [{ pageId: 7, slug: 'cert', title: '证书教训', type: 'lesson', summary: '' }],
        },
      ],
    }
    const { container, unmount } = render(<WikiIndexCard data={data} />)
    expect(screen.getByText('项目维基 · 1 页')).toBeTruthy()
    expect(screen.getByText('组织维基 · 1 页')).toBeTruthy()
    expect(screen.getByRole('link', { name: '项目简报' }).getAttribute('href')).toBe(
      '/next/projects/9/wiki?page=5',
    )
    expect(screen.getByRole('link', { name: '证书教训' }).getAttribute('href')).toBe(
      '/next/wiki?page=7',
    )
    expect(container.querySelector('[data-wiki-result-notice]')?.textContent).toBe(
      WIKI_QUERY_NOTICE,
    )
    unmount()
    render(<WikiIndexCard data={{ notice: '', truncated: false, spaces: [] }} />)
    expect(screen.getByText('还没有已发布的维基页面。')).toBeTruthy()
  })

  test('读页：显示一节、主张数与遮蔽提示；部门页没有链接；未发布有说明', () => {
    const read: WikiQueryReadDto = {
      notice: WIKI_QUERY_NOTICE,
      pageId: 7,
      spaceId: 3,
      scopeKind: 'department',
      scopeRefId: 4,
      title: '部门流程',
      type: 'process',
      published: true,
      section: '应对',
      body: '## 应对',
      truncated: false,
      claims: [{ key: 'a', statement: '甲', kind: 'rule', sources: [] }],
      hasMaskedContent: true,
      links: [],
    }
    const { unmount } = render(<WikiReadCard data={read} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(
      screen.getByText('只读了「应对」一节 · 1 条有来源的说法 · 部分内容需更高权限'),
    ).toBeTruthy()
    unmount()
    render(<WikiReadCard data={{ ...read, scopeKind: 'organization', published: false }} />)
    expect(screen.getByRole('link', { name: '部门流程' })).toBeTruthy()
    expect(screen.getByText('这一页还没有已发布的版本。')).toBeTruthy()
  })

  test('检索：列结果，无结果有提示', () => {
    const data: WikiQuerySearchDto = {
      notice: WIKI_QUERY_NOTICE,
      results: [
        {
          pageId: 7,
          spaceId: 1,
          scopeKind: 'organization',
          scopeRefId: 1,
          slug: 'cert',
          title: '证书教训',
          type: 'lesson',
          summary: '经验',
        },
      ],
    }
    const { unmount } = render(<WikiSearchCard data={data} />)
    expect(screen.getByRole('link', { name: '证书教训' })).toBeTruthy()
    unmount()
    render(<WikiSearchCard data={{ notice: '', results: [] }} />)
    expect(screen.getByText('没有找到相关的已发布页面。')).toBeTruthy()
  })
})

describe('存进维基', () => {
  const props = { question: '证书延误以前怎么处理的？', answer: '提前两周申请。', projectId: 9 }

  test('没有 QueryClientProvider 或未开启维基时不显示', async () => {
    const { container, unmount } = render(<WikiFileBackButton {...props} />)
    expect(container.innerHTML).toBe('')
    unmount()
    const records = installFetch((path) =>
      path === '/wiki/settings'
        ? jsonResponse(200, { data: { enabled: false, canManage: false } })
        : null,
    )
    const view = withClient(<WikiFileBackButton {...props} />)
    await waitFor(() => expect(records.some((r) => r.url === '/wiki/settings')).toBe(true))
    expect(view.container.querySelector('[data-wiki-file-back]')).toBeNull()
  })

  test('提交到组织维基后提示待审；默认标题取问题', async () => {
    const records = installFetch((path, method) => {
      if (path === '/wiki/settings')
        return jsonResponse(200, { data: { enabled: true, canManage: false } })
      if (path === '/wiki/file-back' && method === 'POST')
        return jsonResponse(201, { data: { pageId: 1, spaceId: 1, revision: { id: 3 } } })
      return null
    })
    withClient(<WikiFileBackButton {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /存进维基/ }))
    expect((screen.getByLabelText('页面标题') as HTMLInputElement).value).toBe(props.question)
    fireEvent.click(screen.getByLabelText('组织维基'))
    fireEvent.click(screen.getByRole('button', { name: '提交审阅' }))
    expect(await screen.findByText(/已存进组织维基的审阅队列/)).toBeTruthy()
    const post = records.find((r) => r.url === '/wiki/file-back')
    expect(post?.body).toEqual({
      projectId: null,
      title: props.question,
      question: props.question,
      answer: props.answer,
    })
  })

  test('重复存入给出中文提示', async () => {
    installFetch((path, method) => {
      if (path === '/wiki/settings')
        return jsonResponse(200, { data: { enabled: true, canManage: false } })
      if (path === '/wiki/file-back' && method === 'POST')
        return jsonResponse(409, { error: { code: 'WIKI_ANSWER_EXISTS', message: 'dup' } })
      return null
    })
    withClient(<WikiFileBackButton {...props} projectId={null} />)
    fireEvent.click(await screen.findByRole('button', { name: /存进维基/ }))
    expect(screen.queryByLabelText('组织维基')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '提交审阅' }))
    expect(await screen.findByText('这条回答已经存进维基了。')).toBeTruthy()
  })
})

describe('组织维基：影子对比与直达页面', () => {
  const SPACE: WikiSpaceDto = {
    id: 7,
    scopeKind: 'organization',
    scopeRefId: 1,
    title: '组织维基',
    canReview: true,
    canPropose: true,
    pageCount: 0,
    pendingProposalCount: 0,
  }
  const backend =
    (canManage: boolean) =>
    (path: string, method: string): Response | null => {
      if (path === '/wiki/settings')
        return jsonResponse(200, { data: { enabled: true, canManage } })
      if (path === '/wiki/spaces/resolve' && method === 'POST')
        return jsonResponse(200, { data: SPACE })
      if (path.startsWith('/wiki/spaces/7/pages'))
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 100, totalPages: 1 },
        })
      if (path === '/wiki/shadow-summary')
        return jsonResponse(200, {
          data: {
            days: 30,
            turns: 4,
            turnsWithWiki: 3,
            avgClaims: 2.5,
            avgBytes: 800,
            truncatedTurns: 1,
          },
        })
      return null
    }

  test('管理者看到影子对比；非管理者不请求', async () => {
    installFetch(backend(true))
    const { unmount } = withClient(<WikiWorkspace scopeKind="organization" />)
    expect(await screen.findByText(/AI 同事 4 次回答中，75%/)).toBeTruthy()
    expect(screen.getByText(/1 次超出预算被截断/)).toBeTruthy()
    unmount()
    const records = installFetch(backend(false))
    withClient(<WikiWorkspace scopeKind="organization" />)
    await screen.findByRole('heading', { name: '组织维基' })
    expect(records.some((r) => r.url === '/wiki/shadow-summary')).toBe(false)
  })

  test('组织维基审阅者可刷新计划档案并看到结果；项目空间没有该按钮', async () => {
    const records = installFetch((path, method) => {
      if (path === '/wiki/dossier/refresh' && method === 'POST')
        return jsonResponse(200, { data: { created: 2, updated: 1, unchanged: 0, skipped: 9 } })
      return backend(false)(path, method)
    })
    const { unmount } = withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /刷新计划档案/ }))
    expect(await screen.findByText(/新建 2 页、更新 1 页、未变 0 页/)).toBeTruthy()
    expect(records.filter((r) => r.url === '/wiki/dossier/refresh')).toHaveLength(1)
    unmount()
    installFetch((path, method) => {
      if (path === '/wiki/spaces/resolve' && method === 'POST')
        return jsonResponse(200, { data: { ...SPACE, scopeKind: 'project', scopeRefId: 9 } })
      return backend(false)(path, method)
    })
    withClient(<WikiWorkspace scopeKind="project" scopeRefId={9} />)
    await screen.findByRole('heading', { name: '组织维基' })
    expect(screen.queryByRole('button', { name: /刷新计划档案/ })).toBeNull()
  })

  test('?page= 直接打开指定页面', async () => {
    searchParams.value = new URLSearchParams('page=11')
    const records = installFetch(backend(false))
    withClient(<WikiWorkspace scopeKind="organization" />)
    await waitFor(() => expect(records.some((r) => r.url === '/wiki/pages/11')).toBe(true))
  })
})
