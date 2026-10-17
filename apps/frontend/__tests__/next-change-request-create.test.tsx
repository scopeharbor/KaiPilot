/**
 * v3-ui-next-risk-change-domains W2 · tasks 2.4 —— 新建变更表单与 AI 影响
 * 分析辅助测试。
 *
 * 覆盖（spec「变更请求创建与六维影响分析评估面板」）：
 * - 新建表单必填校验（标题为空禁用提交）与提交落库跳转（POST 载荷字段对齐）；
 * - 六维影响摘要文本域结构化录入随创建请求提交；
 * - 草稿态（edit 模式）触发 AI 影响辅助分析：免责声明、逐维预测与置信度回显；
 * - 「填入表单」仅引用至六维影响摘要文本域，不覆盖用户未保存的标题/描述。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeRequest } from '@/lib/api/change-requests'
import NewChangeRequestPage from '@/app/(next)/next/projects/[id]/change-requests/new/page'
import { NewChangeRequestForm } from '@/components/next/change-requests/NewChangeRequestForm'
import { useAuthStore } from '@/stores/auth-store'
import {
  jsonResponse,
  makeProject,
  resetFetchRouter,
  API_PREFIX,
} from './helpers/chart-gallery-network'

const paramsMock = vi.hoisted(() => ({
  value: { id: '42' } as { id: string },
}))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/change-requests/new',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

interface RequestRecord {
  method: string
  url: string
  body: string | null
}

/** 记录请求体的 fetch 路由（断言 POST 载荷字段）。 */
function installCaptureRouter(
  route: (path: string, method: string, body: string | null) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : null
    records.push({ method, url: rawUrl, body })
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, {
      error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeDraft(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 7,
    crCode: 'CR-2026-007',
    organizationId: 1,
    projectId: 42,
    title: '增加移动端扫码登录模块',
    description: '待完善描述',
    changeType: 'scope',
    status: 'draft',
    priority: 'high',
    requesterId: 1,
    approverId: null,
    requestedBy: 1,
    reviewedBy: null,
    impactSummary: { scope: '已有范围说明' },
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: null,
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
    currentImpactAnalysisId: null,
    approveRefAnalysisId: null,
    impactAnalysisConfirmStatus: null,
    ...overrides,
  }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  setAuth(['change_request:create'])
})

afterEach(() => {
  resetFetchRouter()
})

describe('新建表单必填校验与提交落库跳转', () => {
  test('标题为空时提交按钮禁用，填写六维摘要后可提交并携带载荷落库跳转', async () => {
    const { records } = installCaptureRouter((path, method) => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: makeProject() })
      }
      if (path === '/projects/42/change-requests' && method === 'POST') {
        return jsonResponse(201, { data: makeDraft() })
      }
      return null
    })
    renderWithClient(<NewChangeRequestPage />)
    await screen.findByText('新建变更请求')
    const submit = document.querySelector('[data-cr-form-submit]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(document.querySelector('[data-cr-form-title]')!, {
      target: { value: '增加移动端扫码登录模块' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-description]')!, {
      target: { value: '补充扫码登录能力' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-type]')!, {
      target: { value: 'scope' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-priority]')!, {
      target: { value: 'urgent' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-impact="schedule"]')!, {
      target: { value: '进度延期 5 天' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-impact="resources"]')!, {
      target: { value: '新增 2 名前端资源' },
    })
    expect((document.querySelector('[data-cr-form-submit]') as HTMLButtonElement).disabled).toBe(
      false,
    )

    fireEvent.click(document.querySelector('[data-cr-form-submit]')!)
    await waitFor(() => {
      const post = records.find((record) => record.method === 'POST')
      expect(post).toBeDefined()
      expect(post!.url).toContain('/projects/42/change-requests')
      const payload = JSON.parse(post!.body!) as {
        title: string
        description: string
        changeType: string
        priority: string
        impactSummary: { schedule: string; resources: string }
      }
      expect(payload.title).toBe('增加移动端扫码登录模块')
      expect(payload.changeType).toBe('scope')
      expect(payload.priority).toBe('urgent')
      expect(payload.impactSummary.schedule).toBe('进度延期 5 天')
      expect(payload.impactSummary.resources).toBe('新增 2 名前端资源')
    })
    await waitFor(() => {
      expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/change-requests/7')
    })
  })

  test('无 change_request:create 权限：受限横幅且零请求', async () => {
    setAuth(['change_request:view'])
    const { records } = installCaptureRouter(() => null)
    renderWithClient(<NewChangeRequestPage />)
    expect(await screen.findByText('暂无变更请求创建权限')).toBeInTheDocument()
    expect(records).toHaveLength(0)
  })
})

describe('草稿态 AI 影响辅助分析（RL-01）', () => {
  const aiRoute = (path: string, method: string): Response | null => {
    if (path === '/change-requests/7/ai-impact' && method === 'POST') {
      return jsonResponse(200, {
        data: {
          suggestions: {
            scope: '',
            schedule: '进度：核心网关前序依赖延迟 4 天',
            resources: '资源：需新增 2 名前端资源',
            cost: '',
            risks: '',
            assumptions: '',
          },
          confidence: 0.85,
          source: '排程滑移规则推断',
          assumptions: ['当前排程为最新已确认版本'],
          needsConfirmation: true,
        },
      })
    }
    return null
  }

  test('触发 AI 辅助分析呈现免责声明、逐维预测与置信度', async () => {
    installCaptureRouter(aiRoute)
    renderWithClient(
      <NewChangeRequestForm
        projectId={42}
        mode="edit"
        crId={7}
        initial={makeDraft()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    await waitFor(() => {
      expect((document.querySelector('[data-cr-form-title]') as HTMLInputElement).value).toBe(
        '增加移动端扫码登录模块',
      )
    })

    fireEvent.click(document.querySelector('[data-cr-ai-trigger]')!)
    expect(await screen.findByText('AI 变更影响分析')).toBeInTheDocument()
    // 免责声明（RL-01）
    expect(screen.getByText(/仅供决策参考/)).toBeInTheDocument()
    // 置信度回显
    expect(await screen.findByText('85% 置信度')).toBeInTheDocument()
    // 逐维预测内容
    expect(await screen.findByText(/核心网关前序依赖延迟 4 天/)).toBeInTheDocument()
    expect(document.querySelector('[data-cr-ai-dimension="resources"]')).not.toBeNull()
    expect(document.querySelector('[data-cr-ai-assumptions]')).not.toBeNull()
  })

  test('人工点击「填入表单」：六维摘要正确回填且不影响标题/描述等未保存数据', async () => {
    installCaptureRouter(aiRoute)
    renderWithClient(
      <NewChangeRequestForm
        projectId={42}
        mode="edit"
        crId={7}
        initial={makeDraft()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    await waitFor(() => {
      expect((document.querySelector('[data-cr-form-title]') as HTMLInputElement).value).toBe(
        '增加移动端扫码登录模块',
      )
    })

    // 用户已录入的未保存标题/描述/范围文本
    const titleInput = document.querySelector('[data-cr-form-title]') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: '用户改过的标题（未保存）' } })
    const descInput = document.querySelector('[data-cr-form-description]') as HTMLTextAreaElement
    fireEvent.change(descInput, { target: { value: '用户改过的描述（未保存）' } })
    const scopeInput = document.querySelector(
      '[data-cr-form-impact="scope"]',
    ) as HTMLTextAreaElement
    fireEvent.change(scopeInput, { target: { value: '用户手工填写的范围（未保存）' } })

    fireEvent.click(document.querySelector('[data-cr-ai-trigger]')!)
    await screen.findByText('85% 置信度')
    fireEvent.click(document.querySelector('[data-cr-ai-fill]')!)

    await waitFor(() => {
      // AI 建议仅引用至对应六维文本域（schedule/resources 被建议文本覆盖）
      const scheduleInput = document.querySelector(
        '[data-cr-form-impact="schedule"]',
      ) as HTMLTextAreaElement
      expect(scheduleInput.value).toContain('核心网关前序依赖延迟 4 天')
      const resourcesInput = document.querySelector(
        '[data-cr-form-impact="resources"]',
      ) as HTMLTextAreaElement
      expect(resourcesInput.value).toContain('2 名前端资源')
      // 无建议的维度不受影响：scope 保留用户未保存的手工内容
      const scopeAfter = document.querySelector(
        '[data-cr-form-impact="scope"]',
      ) as HTMLTextAreaElement
      expect(scopeAfter.value).toBe('用户手工填写的范围（未保存）')
      // 标题与描述等非六维字段完全不被 AI 触碰
      expect(titleInput.value).toBe('用户改过的标题（未保存）')
      expect(descInput.value).toBe('用户改过的描述（未保存）')
    })
  })

  test('关闭 AI 浮层后表单内容完好无损', async () => {
    installCaptureRouter(aiRoute)
    renderWithClient(
      <NewChangeRequestForm
        projectId={42}
        mode="edit"
        crId={7}
        initial={makeDraft()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    await waitFor(() => {
      expect((document.querySelector('[data-cr-form-title]') as HTMLInputElement).value).toBe(
        '增加移动端扫码登录模块',
      )
    })
    const scopeInput = document.querySelector(
      '[data-cr-form-impact="scope"]',
    ) as HTMLTextAreaElement
    expect(scopeInput.value).toBe('已有范围说明')

    fireEvent.click(document.querySelector('[data-cr-ai-trigger]')!)
    await screen.findByText('85% 置信度')
    fireEvent.click(document.querySelector('[data-cr-ai-close-bottom]')!)

    await waitFor(() => {
      expect(document.querySelector('[data-cr-ai-modal]')).toBeNull()
      expect(
        (document.querySelector('[data-cr-form-impact="scope"]') as HTMLTextAreaElement).value,
      ).toBe('已有范围说明')
    })
  })
})
