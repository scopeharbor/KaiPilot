/**
 * v3-ui-next-help-knowledge-domain W2 · tasks 2.6 —— 知识库抽屉录入与审查转正测试。
 *
 * 覆盖（spec「知识库记录新建、编辑与生命周期受控治理」场景 + tasks 2.6）：
 * - 新建抽屉：漏选必填项（标题/领域）即时红字阻断且网络 0 请求（RL-06）；
 * - 失焦即时校验红字；合法提交先弹二次确认模态，确认后 POST /knowledge 且刷新
 *   列表缓存（['knowledge','list'] 前缀失效 → harness 账本自动 refetch）；
 * - 审查抽屉：完整展示标题/层级徽标/正文/来源溯源/审核历史；
 * - 确认转正：点击弹阻断模态 → 确认 → POST /knowledge/:id/confirm → 状态徽标变活跃；
 * - 状态推进：按钮弹阻断模态 → 确认 → POST /knowledge/:id/transition；
 * - 无 knowledge:manage：治理按钮物理隐藏、只读说明呈现、写请求零发出；
 * - 跨租户/不存在 ID：详情 404 → 中性提示「未找到相关知识记录」（RL-05）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KnowledgeItem,
  KnowledgeLifecycleStatus,
  ReviewRecord,
  SourceRef,
} from '@aiproj/types'
import {
  KnowledgeCreateDrawer,
  KnowledgeReviewDrawer,
} from '@/components/next/knowledge/KnowledgeManageDrawers'
import { KNOWLEDGE_QUERY_KEYS } from '@/hooks/use-knowledge'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, {
      error: { code: 'RESOURCE_NOT_FOUND', message: `未匹配 ${method} ${path}` },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function writeRecords(records: RequestRecord[]) {
  return records.filter((record) => record.method !== 'GET')
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function sourceRef(overrides: Partial<SourceRef> = {}): SourceRef {
  return { layer: 'L1', sourceId: 's1', title: '团队工程规范 V2', ...overrides }
}

function reviewRecord(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    reviewer: 1,
    action: 'reviewed',
    timestamp: '2026-08-20T00:00:00.000Z',
    note: '评审通过',
    ...overrides,
  }
}

let nextItemId = 100
function makeKnowledgeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  const now = '2026-09-01T00:00:00.000Z'
  return {
    id: nextItemId++,
    organizationId: 1,
    layer: 'L2',
    layerMeta: {
      layer: 'L2',
      trust: '低到中',
      source: '真实经验',
      usage: '参考',
      frequency: '持续采集',
      annotation: ['必须标注来源项目/团队', '需记录观察时间'],
    },
    title: '双机房割接观察记录',
    content: '# 观察\n\n割接窗口内写放大明显。',
    status: 'pending',
    domain: '运维',
    purpose: '参考',
    complexity: '中级',
    provenance: {
      sources: [sourceRef({ layer: 'L2', sourceId: 's2', title: '2026-08 割接复盘' })],
      reviewHistory: [reviewRecord()],
    },
    isSynthetic: false,
    syntheticMethod: undefined,
    createdBy: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: now,
    ...overrides,
  } satisfies KnowledgeItem
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

/** 挂载在 ['knowledge','list'] 前缀下的账本 harness：验证写后缓存刷新联动。 */
function LedgerHarness() {
  const query = useQuery({
    queryKey: KNOWLEDGE_QUERY_KEYS.list({ mode: 'drawer-test-harness' }),
    queryFn: () =>
      fetch(`${API_PREFIX}/knowledge?status=active&page=1&perPage=100`).then((res) => res.json()),
  })
  return (
    <span data-ledger-harness data-loaded={String(query.isSuccess)}>
      harness
    </span>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('KnowledgeCreateDrawer：Zod 校验与受控提交（tasks 2.6 / spec 受控新建）', () => {
  it('必填项漏选（标题/领域为空）提交：即时红字阻断，网络 0 请求', async () => {
    setAuth(['knowledge:author', 'knowledge:manage'])
    const { records } = installFetchRouter(() => null)
    const client = newClient()
    const onClose = vi.fn()
    render(<KnowledgeCreateDrawer open onClose={onClose} />, { wrapper: wrapper(client) })

    fireEvent.click(document.querySelector('[data-knowledge-create-submit]') as Element)

    expect(screen.getByText('标题不能为空')).toBeInTheDocument()
    expect(screen.getByText('所属领域不能为空')).toBeInTheDocument()
    // 未通过校验：不弹二次确认、零网络外发
    expect(document.querySelector('[data-testid="knowledge-create-confirm-modal"]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeRecords(records)).toHaveLength(0)
    expect(records).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('失焦即时校验：标题留空 blur 后红字即现', () => {
    setAuth(['knowledge:author'])
    installFetchRouter(() => null)
    const client = newClient()
    render(<KnowledgeCreateDrawer open onClose={() => {}} />, { wrapper: wrapper(client) })

    const titleInput = document.querySelector('[data-knowledge-create-title]') as HTMLInputElement
    fireEvent.focus(titleInput)
    fireEvent.blur(titleInput)
    expect(screen.getByText('标题不能为空')).toBeInTheDocument()
  })

  it('合法填写：提交弹二次确认模态（此时零写请求），确认后 POST /knowledge 并刷新列表缓存', async () => {
    setAuth(['knowledge:author'])
    const store = new Map<number, KnowledgeItem>()
    const onClose = vi.fn()
    const { records } = installFetchRouter((path, method) => {
      if (path === '/knowledge' && method === 'POST') {
        // 解析 body 回放新条目
        return jsonResponse(201, { data: makeKnowledgeItem({ id: 501 }) })
      }
      if (path.startsWith('/knowledge?') && method === 'GET') {
        return jsonResponse(200, { data: Array.from(store.values()), meta: { total: 0 } })
      }
      return null
    })
    const client = newClient()
    render(
      <>
        <KnowledgeCreateDrawer open onClose={onClose} />
        <LedgerHarness />
      </>,
      { wrapper: wrapper(client) },
    )

    // 填写合法表单
    fireEvent.change(document.querySelector('[data-knowledge-create-title]') as Element, {
      target: { value: 'API 错误处理规范' },
    })
    fireEvent.change(document.querySelector('[data-knowledge-create-domain]') as Element, {
      target: { value: '接口架构' },
    })
    fireEvent.change(document.querySelector('[data-knowledge-create-content]') as Element, {
      target: { value: '# 规范\n\n统一错误码与提示语。' },
    })
    // 层级保持 L1（默认）
    fireEvent.click(document.querySelector('[data-knowledge-create-submit]') as Element)

    // 二次确认模态出现；确认前无任何写请求
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="knowledge-create-confirm-modal"]'),
      ).not.toBeNull(),
    )
    expect(writeRecords(records)).toHaveLength(0)
    const modal = document.querySelector('[data-testid="knowledge-create-confirm-modal"]')
    expect(modal?.textContent).toContain('确认创建知识记录')
    expect(modal?.textContent).toContain('API 错误处理规范')

    // 确认 → POST /knowledge；成功后抽屉关闭、onClose 触发、列表缓存被刷新
    fireEvent.click(within(modal as HTMLElement).getByText('确认创建') as Element)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const posts = records.filter((r) => r.method === 'POST' && r.url === '/knowledge')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toMatchObject({
      layer: 'L1',
      title: 'API 错误处理规范',
      domain: '接口架构',
      purpose: '参考',
      content: '# 规范\n\n统一错误码与提示语。',
      provenance: { sources: [{ layer: 'L1', title: 'API 错误处理规范' }] },
    })

    // ['knowledge','list'] 前缀失效 → harness 自动重取（初始 1 次 + 失效 1 次）
    await waitFor(() => {
      const listGets = records.filter(
        (r) => r.method === 'GET' && r.url.startsWith('/knowledge?status=active'),
      )
      expect(listGets.length).toBeGreaterThanOrEqual(2)
    })
    await waitFor(() =>
      expect(document.querySelector('[data-testid="knowledge-create-confirm-modal"]')).toBeNull(),
    )
  })

  it('提交请求失败：错误展示在模态内且抽屉保持打开可重试', async () => {
    setAuth(['knowledge:author'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/knowledge' && method === 'POST') {
        return jsonResponse(500, {
          error: { code: 'INTERNAL_ERROR', message: '后端写库失败' },
        })
      }
      return null
    })
    const client = newClient()
    render(<KnowledgeCreateDrawer open onClose={() => {}} />, { wrapper: wrapper(client) })
    fireEvent.change(document.querySelector('[data-knowledge-create-title]') as Element, {
      target: { value: '接口幂等规范' },
    })
    fireEvent.change(document.querySelector('[data-knowledge-create-domain]') as Element, {
      target: { value: '接口架构' },
    })
    fireEvent.click(document.querySelector('[data-knowledge-create-submit]') as Element)
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="knowledge-create-confirm-modal"]'),
      ).not.toBeNull(),
    )
    fireEvent.click(
      within(
        document.querySelector('[data-testid="knowledge-create-confirm-modal"]') as HTMLElement,
      ).getByText('确认创建') as Element,
    )
    await waitFor(() =>
      expect(
        within(
          document.querySelector('[data-testid="knowledge-create-confirm-modal"]') as HTMLElement,
        ).getByText('后端写库失败'),
      ).toBeInTheDocument(),
    )
    expect(writeRecords(records)).toHaveLength(1)
    // 模态仍开（可取消重试），抽屉未关闭
    expect(document.querySelector('[data-testid="knowledge-create-confirm-modal"]')).not.toBeNull()
  })
})

describe('KnowledgeReviewDrawer：审查展示与来源追溯（tasks 2.6）', () => {
  it('完整展示标题/层级徽标/正文/来源溯源/审核历史', async () => {
    setAuth(['knowledge:view', 'knowledge:author', 'knowledge:manage'])
    const item = makeKnowledgeItem({ id: 200 })
    installFetchRouter((path, method) => {
      if (path === '/knowledge/200' && method === 'GET') {
        return jsonResponse(200, { data: item })
      }
      return null
    })
    const client = newClient()
    render(<KnowledgeReviewDrawer knowledgeId={200} open onClose={() => {}} />, {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(screen.getByText('双机房割接观察记录')).toBeInTheDocument())
    // 层级徽标 + 状态徽标
    expect(document.querySelector('[data-knowledge-review-layer-badge]')?.textContent).toContain(
      'L2 观察',
    )
    expect(document.querySelector('[data-knowledge-review-status-badge]')?.textContent).toContain(
      '待审',
    )
    // 正文（pre 内容）
    expect(document.querySelector('[data-knowledge-review-content]')?.textContent).toContain(
      '割接窗口内写放大明显',
    )
    // 来源溯源
    expect(screen.getByText('2026-08 割接复盘')).toBeInTheDocument()
    // 审核历史（note + reviewer）
    const historyRows = document.querySelectorAll('[data-knowledge-review-history-row]')
    expect(historyRows.length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('评审通过')
    expect(document.body.textContent).toContain('reviewer #1')
  })

  it('L3 合成条目：审查面板顶部强制 SYNTHETIC 双标识与合成方法展示', async () => {
    setAuth(['knowledge:view'])
    const item = makeKnowledgeItem({
      id: 201,
      layer: 'L3',
      isSynthetic: true,
      syntheticMethod: 'LLM 生成 + baseKnowledge 交叉验证',
      title: '合成压测案例',
      provenance: {
        sources: [
          sourceRef({ layer: 'L3', sourceId: 'syn-1', title: '合成案例集', isSynthetic: true }),
        ],
        reviewHistory: [],
      },
    })
    installFetchRouter((path, method) => {
      if (path === '/knowledge/201' && method === 'GET') {
        return jsonResponse(200, { data: item })
      }
      return null
    })
    const client = newClient()
    render(<KnowledgeReviewDrawer knowledgeId={201} open onClose={() => {}} />, {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(screen.getByText('合成压测案例')).toBeInTheDocument())
    expect(
      document.querySelector('[data-knowledge-review-synthetic-badge]')?.textContent,
    ).toContain('SYNTHETIC')
    expect(screen.getByText('LLM 生成 + baseKnowledge 交叉验证')).toBeInTheDocument()
  })

  it('详情 404（跨租户/不存在）：中性提示「未找到相关知识记录」，不渲染内容（RL-05）', async () => {
    setAuth(['knowledge:view'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/knowledge/999' && method === 'GET') {
        return jsonResponse(404, {
          error: { code: 'RESOURCE_NOT_FOUND', message: '知识记录不存在或不属于当前组织' },
        })
      }
      return null
    })
    const client = newClient()
    render(<KnowledgeReviewDrawer knowledgeId={999} open onClose={() => {}} />, {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(screen.getByText('未找到相关知识记录')).toBeInTheDocument())
    expect(document.querySelector('[data-knowledge-review-content]')).toBeNull()
    // 中性处理：没有把后端消息原样当错误炸给用户
    expect(records.length).toBe(1)
    expect(records[0]?.url).toBe('/knowledge/999')
  })
})

describe('KnowledgeReviewDrawer：人工确认转正与状态推进（tasks 2.6 / RL-06）', () => {
  it('pending 条目：确认转正弹阻断模态，确认后 POST confirm 且状态徽标变活跃', async () => {
    setAuth(['knowledge:view', 'knowledge:manage'])
    const item = makeKnowledgeItem({ id: 300, status: 'pending' as KnowledgeLifecycleStatus })
    const { records } = installFetchRouter((path, method) => {
      if (path === '/knowledge/300' && method === 'GET') {
        return jsonResponse(200, { data: item })
      }
      if (path === '/knowledge/300/confirm' && method === 'POST') {
        item.status = 'active'
        item.provenance = {
          ...item.provenance,
          reviewHistory: [
            ...(item.provenance.reviewHistory ?? []),
            reviewRecord({ action: 'confirmed', note: '人工确认: pending → active' }),
          ],
        }
        return jsonResponse(200, { data: item })
      }
      return null
    })
    const client = newClient()
    render(<KnowledgeReviewDrawer knowledgeId={300} open onClose={() => {}} />, {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(screen.getByText('双机房割接观察记录')).toBeInTheDocument())
    // 状态推进白名单：pending 不含 active 直达按钮
    expect(document.querySelector('[data-knowledge-review-transition-open="active"]')).toBeNull()
    // 确认转正 → 二次确认模态
    fireEvent.click(document.querySelector('[data-knowledge-review-confirm-open]') as Element)
    const modal = await screen.findByTestId('knowledge-review-confirm-modal')
    expect(modal.textContent).toContain('确认转正知识记录')
    // 模态确认前零写请求
    expect(writeRecords(records)).toHaveLength(0)
    fireEvent.click(
      within(modal).getByText('确认转正', {
        selector: '[data-knowledge-confirm-submit]',
      }) as Element,
    )
    await waitFor(() =>
      expect(
        writeRecords(records).some(
          (r) => r.method === 'POST' && r.url === '/knowledge/300/confirm',
        ),
      ).toBe(true),
    )
    // 详情缓存刷新后徽标变为活跃
    await waitFor(() =>
      expect(document.querySelector('[data-knowledge-review-status-badge]')?.textContent).toContain(
        '活跃',
      ),
    )
  })

  it('active 条目：推进至已弃用弹阻断模态，确认后 POST transition', async () => {
    setAuth(['knowledge:view', 'knowledge:manage'])
    const item = makeKnowledgeItem({ id: 301, status: 'active' as KnowledgeLifecycleStatus })
    const { records } = installFetchRouter((path, method) => {
      if (path === '/knowledge/301' && method === 'GET') {
        return jsonResponse(200, { data: item })
      }
      if (path === '/knowledge/301/transition' && method === 'POST') {
        const body = JSON.parse(JSON.stringify(item))
        void body
        item.status = 'deprecated'
        return jsonResponse(200, { data: item })
      }
      return null
    })
    const client = newClient()
    render(<KnowledgeReviewDrawer knowledgeId={301} open onClose={() => {}} />, {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(screen.getByText('双机房割接观察记录')).toBeInTheDocument())
    // active 不可直达「确认转正」（非 pending），但可推进至已弃用/已过时
    expect(document.querySelector('[data-knowledge-review-confirm-open]')).toBeNull()
    fireEvent.click(
      document.querySelector('[data-knowledge-review-transition-open="deprecated"]') as Element,
    )
    const modal = await screen.findByTestId('knowledge-review-transition-modal')
    expect(modal.textContent).toContain('推进至已弃用')
    fireEvent.click(
      within(modal).getByText('推进至已弃用', {
        selector: '[data-knowledge-confirm-submit]',
      }) as Element,
    )
    await waitFor(() =>
      expect(
        writeRecords(records).some(
          (r) => r.method === 'POST' && r.url === '/knowledge/301/transition',
        ),
      ).toBe(true),
    )
    const transition = writeRecords(records).find(
      (r) => r.method === 'POST' && r.url === '/knowledge/301/transition',
    )
    expect(transition?.body).toEqual({ status: 'deprecated' })
    await waitFor(() =>
      expect(document.querySelector('[data-knowledge-review-status-badge]')?.textContent).toContain(
        '已弃用',
      ),
    )
  })

  it('无 knowledge:manage：治理按钮安全隐藏、只读说明呈现、写请求零发出', async () => {
    setAuth(['knowledge:view', 'knowledge:author'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/knowledge/302' && method === 'GET') {
        return jsonResponse(200, {
          data: makeKnowledgeItem({ id: 302, status: 'pending' as KnowledgeLifecycleStatus }),
        })
      }
      return null
    })
    const client = newClient()
    render(<KnowledgeReviewDrawer knowledgeId={302} open onClose={() => {}} />, {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(screen.getByText('双机房割接观察记录')).toBeInTheDocument())
    expect(document.querySelector('[data-knowledge-review-readonly-note]')).not.toBeNull()
    expect(document.querySelector('[data-knowledge-review-confirm-open]')).toBeNull()
    expect(document.querySelector('[data-knowledge-review-transition-open]')).toBeNull()
    expect(writeRecords(records)).toHaveLength(0)
  })
})
