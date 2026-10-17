import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSettingsPage from '@/app/(dashboard)/projects/[id]/settings/page'
import { projectsApi } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

const { activePermissions, toast } = vi.hoisted(() => ({
  activePermissions: { value: [] as string[] },
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: activePermissions.value,
    can: (permission: string) => activePermissions.value.includes(permission),
    canAny: (permissions: string[]) =>
      permissions.some((permission) => activePermissions.value.includes(permission)),
    canAll: (permissions: string[]) =>
      permissions.every((permission) => activePermissions.value.includes(permission)),
  }),
}))

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    json: async () => body,
  }
}

function login(permissions: string[]) {
  act(() => {
    activePermissions.value = permissions
    useAuthStore.getState().setSession({
      user: {
        id: 1,
        email: 'pm@test.local',
        fullName: '项目经理',
        isSuperAdmin: false,
        organizations: [],
      },
      accessToken: accessTokenWith(permissions, { organizationId: 1 }),
      refreshToken: 'refresh',
    })
    useAuthStore.setState({
      permissions,
      currentOrganizationId: 1,
      isAuthenticated: true,
    })
  })
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function renderSettings(client: QueryClient) {
  return render(<ProjectSettingsPage />, { wrapper: wrapper(client) })
}

describe('工作日历 API client', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ data: { version: 1, workdays: [1], holidays: [], extraWorkdays: [] } }),
        ),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('使用项目工作日历专用端点读写', async () => {
    const fetchMock = vi.mocked(fetch)
    await projectsApi.getWorkingCalendar(7)
    await projectsApi.updateWorkingCalendar(7, {
      version: 1,
      workdays: [1, 2, 3, 4, 5],
      holidays: [],
      extraWorkdays: [],
    })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/projects/7/working-calendar'),
      expect.stringContaining('/projects/7/working-calendar'),
    ])
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PATCH'])
  })
})

describe('项目设置工作日历页面', () => {
  let client: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    activePermissions.value = []
    toast.mockReset()
    act(() => useAuthStore.getState().clear())
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/projects/7') && !String(url).includes('working-calendar')) {
        return json({
          data: {
            id: 7,
            name: '项目',
            status: 'active',
            settings: null,
          },
        })
      }
      if (String(url).includes('/projects/7/working-calendar') && init?.method === 'PATCH') {
        return json({
          data: {
            version: 1,
            workdays: [1, 2, 3, 4, 5, 6],
            holidays: [],
            extraWorkdays: [],
          },
        })
      }
      return json({
        data: {
          version: 1,
          workdays: [1, 2, 3, 4, 5],
          holidays: [],
          extraWorkdays: [],
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    client.clear()
    act(() => useAuthStore.getState().clear())
  })

  it('编辑每周工作日后保存并刷新状态', async () => {
    login(['project:view', 'project:update'])
    renderSettings(client)

    const saturday = await screen.findByLabelText('周六是否为工作日')
    fireEvent.click(saturday)
    expect(screen.getByText('有未保存的工作日历变更')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/projects/7/working-calendar'),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '工作日历已保存', variant: 'success' }),
    )
  })

  it('保存失败时保留未保存提示并展示中文错误', async () => {
    login(['project:view', 'project:update'])
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/projects/7') && !String(url).includes('working-calendar')) {
        return json({ data: { id: 7, name: '项目', status: 'active', settings: null } })
      }
      if (String(url).includes('/working-calendar') && init?.method === 'PATCH') {
        return json(
          { error: { code: 'VALIDATION_ERROR', message: '同一日期不能同时作为节假日和调休日' } },
          422,
        )
      }
      return json({
        data: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
      })
    })
    renderSettings(client)

    fireEvent.click(await screen.findByLabelText('周六是否为工作日'))
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    expect(await screen.findByText('同一日期不能同时作为节假日和调休日')).toBeInTheDocument()
    expect(screen.getByText('有未保存的工作日历变更')).toBeInTheDocument()
  })

  it('只读角色只能查看且保存按钮禁用', async () => {
    login(['project:view'])
    renderSettings(client)

    expect(await screen.findByText('只读模式')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存/ })).toBeDisabled()
  })

  it('服务端冲突错误会显示在页面上', async () => {
    login(['project:view', 'project:update'])
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/projects/7') && !String(url).includes('working-calendar')) {
        return json({ data: { id: 7, name: '项目', status: 'active', settings: null } })
      }
      if (String(url).includes('/working-calendar') && init?.method === 'PATCH') {
        return json({ error: { code: 'RESOURCE_CONFLICT', message: '日历已被其他用户修改' } }, 409)
      }
      return json({
        data: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
      })
    })
    renderSettings(client)

    fireEvent.click(await screen.findByLabelText('周六是否为工作日'))
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    expect(await screen.findByText('日历已被其他用户修改')).toBeInTheDocument()
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: '日历已被其他用户修改' }),
      ),
    )
  })
})
