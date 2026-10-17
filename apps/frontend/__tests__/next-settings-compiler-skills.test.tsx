/**
 * v3-ui-next-settings-admin-domains W5 · tasks 5.6 —— 编译器技能工作区测试
 * （spec「编译器技能注册表」：注册表渲染 + 停用二次确认流 + 只读态隐藏写按钮 + 服务端错误回显 + 权限守卫 0 请求）。
 *
 * 覆盖：
 * - 注册表列表渲染：名称、skillKey、版本、分类、状态徽章、标签；
 * - 停用二次确认流：点击停用弹出影响说明对话框，取消 0 请求，确认后调用 `POST /ai/compiler/skills/:id/lifecycle`；
 * - 只读态隐藏写按钮：具备 `ai:compiler:skill:view` 但缺失写权限时，新建技能按钮与启停操作按钮物理隐藏；
 * - 服务端错误回显：写接口返回 400/500 错误时，在弹窗中展示错误信息而不静默吞咽；
 * - 无 `ai:compiler:skill:view` 权限时渲染受限横幅，且底层接口 0 请求（RL-06）。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { CompilerSkillsWorkspace } from '@/components/next/settings/ai/CompilerSkillsWorkspace'
import type { Skill } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings/compiler-skills',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body?: unknown
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(
  route: (path: string, method: string, body?: unknown) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    let parsedBody: unknown
    if (init?.body && typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        parsedBody = init.body
      }
    }
    records.push({ method, url: path, body: parsedBody })
    return (
      route(path, method, parsedBody) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[], organizationId: number = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'engineer@example.com',
      fullName: '架构师',
      organizations: [{ id: organizationId, name: '主研发组织', slug: 'main-org', role: 'admin' }],
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

const mockSkill: Skill = {
  id: 101,
  organizationId: 1,
  skillKey: 'react-arch-review',
  name: 'React 架构审查规范',
  version: '1.2.0',
  description: '自动检测与审查 React 项目中的状态提升、Hook 依赖与 SSR 水合问题。',
  status: 'active',
  category: { primary: 'domain' },
  tags: ['frontend', 'react', 'code-review'],
  dependencies: [],
  activation: { stages: ['codegen'], priority: 80 },
  knowledge: { rules: [] },
  basePriority: 100,
  createdBy: 1,
  updatedBy: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

describe('CompilerSkillsWorkspace (v3-ui-next-settings-admin-domains W5 · 5.5/5.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('渲染技能注册表列表与状态徽章', async () => {
    setAuth(['ai:compiler:skill:view', 'ai:compiler:skill:manage'])
    installFetchRouter((path, method) => {
      if (path.startsWith('/ai/compiler/skills') && method === 'GET') {
        return jsonResponse(200, { data: [mockSkill], meta: { total: 1, page: 1, perPage: 100 } })
      }
      return null
    })

    renderWithClient(<CompilerSkillsWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('React 架构审查规范')).toBeInTheDocument()
    })

    expect(screen.getByText('(react-arch-review)')).toBeInTheDocument()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
    expect(screen.getByText('领域知识')).toBeInTheDocument()
    expect(screen.getByTestId('skill-status-101')).toHaveTextContent('已激活')
    expect(screen.getByText('code-review')).toBeInTheDocument()
    expect(screen.getByTestId('create-skill-button')).toBeInTheDocument()
  })

  test('停用技能二次确认流：取消零请求，确认后调用 lifecycle 并刷新', async () => {
    setAuth(['ai:compiler:skill:view', 'ai:compiler:skill:manage'])
    let skillList = [mockSkill]

    const { records } = installFetchRouter((path, method, body) => {
      if (path.startsWith('/ai/compiler/skills') && method === 'GET') {
        return jsonResponse(200, {
          data: skillList,
          meta: { total: skillList.length, page: 1, perPage: 100 },
        })
      }
      if (path === '/ai/compiler/skills/101/lifecycle' && method === 'POST') {
        const payload = body as { status: string }
        skillList = [{ ...mockSkill, status: payload.status as never }]
        return jsonResponse(200, { data: skillList[0] })
      }
      return null
    })

    renderWithClient(<CompilerSkillsWorkspace />)

    await waitFor(() => {
      expect(screen.getByTestId('toggle-skill-101')).toBeInTheDocument()
    })

    // 点击停用触发二次确认弹窗
    fireEvent.click(screen.getByTestId('toggle-skill-101'))
    expect(screen.getByTestId('lifecycle-confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('停用技能确认')).toBeInTheDocument()
    expect(screen.getByText(/不再自动加载和注入该技能/)).toBeInTheDocument()

    // 取消确认
    fireEvent.click(screen.getByTestId('cancel-lifecycle-button'))
    expect(screen.queryByTestId('lifecycle-confirm-dialog')).toBeNull()

    // 断言网络记录中 0 写请求
    expect(records.filter((r) => r.method === 'POST').length).toBe(0)

    // 再次点击并确认停用
    fireEvent.click(screen.getByTestId('toggle-skill-101'))
    fireEvent.click(screen.getByTestId('confirm-lifecycle-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('lifecycle-confirm-dialog')).toBeNull()
    })

    // 校验 POST lifecycle 请求发送
    const lifecycleReq = records.find(
      (r) => r.method === 'POST' && r.url === '/ai/compiler/skills/101/lifecycle',
    )
    expect(lifecycleReq).toBeDefined()
    expect((lifecycleReq?.body as Record<string, unknown>).status).toBe('deprecated')

    // 列表刷新后按钮变为激活
    await waitFor(() => {
      expect(screen.getByTestId('toggle-skill-101')).toHaveTextContent('激活')
    })
  })

  test('只读用户（仅 view 权限，无 manage/author/eval）隐藏写按钮', async () => {
    // 仅授予 view 权限
    setAuth(['ai:compiler:skill:view'])

    installFetchRouter((path, method) => {
      if (path.startsWith('/ai/compiler/skills') && method === 'GET') {
        return jsonResponse(200, { data: [mockSkill], meta: { total: 1, page: 1, perPage: 100 } })
      }
      return null
    })

    renderWithClient(<CompilerSkillsWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('React 架构审查规范')).toBeInTheDocument()
    })

    // 验证新建技能按钮被隐藏
    expect(screen.queryByTestId('create-skill-button')).toBeNull()

    // 验证启停操作按钮被隐藏
    expect(screen.queryByTestId('toggle-skill-101')).toBeNull()
  })

  test('写操作服务端错误回显不静默吞咽', async () => {
    setAuth(['ai:compiler:skill:view', 'ai:compiler:skill:manage'])

    installFetchRouter((path, method) => {
      if (path.startsWith('/ai/compiler/skills') && method === 'GET') {
        return jsonResponse(200, { data: [mockSkill], meta: { total: 1, page: 1, perPage: 100 } })
      }
      if (path === '/ai/compiler/skills/101/lifecycle' && method === 'POST') {
        return jsonResponse(400, {
          error: { code: 'INVALID_TRANSITION', message: '存在下游依赖项尚未废弃，禁止停用' },
        })
      }
      return null
    })

    renderWithClient(<CompilerSkillsWorkspace />)

    await waitFor(() => {
      expect(screen.getByTestId('toggle-skill-101')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('toggle-skill-101'))
    fireEvent.click(screen.getByTestId('confirm-lifecycle-button'))

    // 校验服务端错误信息在弹窗中如实呈现，且弹窗保持打开
    await waitFor(() => {
      expect(screen.getByText('存在下游依赖项尚未废弃，禁止停用')).toBeInTheDocument()
    })
    expect(screen.getByTestId('lifecycle-confirm-dialog')).toBeInTheDocument()
  })

  test('无 ai:compiler:skill:view 权限时渲染受限横幅且 0 请求（RL-06）', async () => {
    setAuth(['project:view'])

    const { records } = installFetchRouter(() => {
      return jsonResponse(200, { data: [] })
    })

    renderWithClient(<CompilerSkillsWorkspace />)

    expect(screen.getByText('没有查看编译器技能的权限')).toBeInTheDocument()
    expect(screen.getByText(/需要 ai:compiler:skill:view 权限/)).toBeInTheDocument()

    // 验证网络监控：底层接口 0 请求
    const apiRequests = records.filter((r) => r.url.includes('/ai/compiler/skills'))
    expect(apiRequests.length).toBe(0)
  })
})
