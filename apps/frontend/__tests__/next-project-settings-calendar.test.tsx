/**
 * v3-ui-next-settings-admin-domains W8 · tasks 8.2 —— 项目设置工作日历编辑器
 * 校验与保存测试（真实工作区组件 + 全局伪后端）。
 *
 * 覆盖（spec「项目设置（工作日历）」与 design 敏感写操作确认矩阵）：
 * - 周工作日勾选与节假日/调休日增删；
 * - 重复日期、互斥日期（同日既节假日又调休）即时阻断并断言零写请求；
 * - 未选工作日时阻断保存（按钮禁用 + 警示文案）；
 * - 保存调用 `PATCH /projects/:id/working-calendar` 与脏检查按钮态；
 * - 归档只读模式（只读横幅 + 控件禁用）；
 * - 服务端错误回显且保留未保存草稿。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { ProjectSettingsWorkspace } from '@/components/next/project-settings/ProjectSettingsWorkspace'
import type { Project } from '@/lib/api/projects'
import type { WorkingCalendarSettings } from '@aiproj/types'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/settings',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

const BASE_CALENDAR: WorkingCalendarSettings = {
  version: 1,
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  extraWorkdays: [],
}

interface BackendOptions {
  project?: Project
  calendar?: WorkingCalendarSettings
  patchStatus?: number
  patchError?: string
}

function installBackend(records: RequestRecord[], options: BackendOptions = {}) {
  const project = options.project ?? makeProject()
  let calendar = options.calendar ?? BASE_CALENDAR
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    records.push({ method, url: path, body })

    if (method === 'GET' && path === '/projects/42') {
      return jsonResponse(200, { data: project })
    }
    if (path === '/projects/42/working-calendar') {
      if (method === 'GET') return jsonResponse(200, { data: calendar })
      if (method === 'PATCH') {
        if (options.patchStatus && options.patchStatus >= 400) {
          return jsonResponse(options.patchStatus, {
            error: {
              code: 'VALIDATION_ERROR',
              message: options.patchError ?? '同一日期不能同时作为节假日和调休日',
            },
          })
        }
        calendar = {
          version: 1,
          workdays: (body?.workdays as number[] | undefined) ?? calendar.workdays,
          holidays: (body?.holidays as string[] | undefined) ?? calendar.holidays,
          extraWorkdays: (body?.extraWorkdays as string[] | undefined) ?? calendar.extraWorkdays,
        }
        return jsonResponse(200, { data: calendar })
      }
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
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

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProjectSettingsWorkspace projectId={42} />
    </QueryClientProvider>,
  )
}

function writeRequests(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET')
}

async function readyWorkspace() {
  await waitFor(() => expect(document.querySelector('[data-calendar-editor]')).not.toBeNull())
}

function addDate(field: 'holidays' | 'extraWorkdays', value: string) {
  fireEvent.change(document.querySelector(`[data-calendar-date-input="${field}"]`)!, {
    target: { value },
  })
  fireEvent.click(document.querySelector(`[data-calendar-add-date="${field}"]`)!)
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('工作日历编辑器：周工作日与节假日/调休增删（tasks 8.1/8.2）', () => {
  test('勾选周六进入脏态，取消按钮复位草稿；节假日与调休日可增删', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([])
    renderWorkspace()
    await readyWorkspace()

    // 初始态：无脏提示，保存/取消均禁用
    expect(document.querySelector('[data-project-settings-dirty]')).toBeNull()
    expect(document.querySelector('[data-calendar-save]')).toBeDisabled()
    expect(document.querySelector('[data-calendar-cancel]')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('周六是否为工作日'))
    expect(document.querySelector('[data-project-settings-dirty]')).not.toBeNull()
    expect(document.querySelector('[data-project-settings-dirty]')?.textContent).toContain(
      '任务起止日期不会自动改写',
    )
    expect(document.querySelector('[data-calendar-save]')).not.toBeDisabled()
    expect(document.querySelector('[data-calendar-cancel]')).not.toBeDisabled()

    // 新增节假日与调休日
    addDate('holidays', '2026-10-01')
    addDate('extraWorkdays', '2026-10-10')
    expect(document.querySelector('[data-calendar-date-chip="holidays:2026-10-01"]')).not.toBeNull()
    expect(
      document.querySelector('[data-calendar-date-chip="extraWorkdays:2026-10-10"]'),
    ).not.toBeNull()

    // 删除调休日
    fireEvent.click(
      document.querySelector('[data-calendar-remove-date="extraWorkdays:2026-10-10"]')!,
    )
    expect(
      document.querySelector('[data-calendar-date-chip="extraWorkdays:2026-10-10"]'),
    ).toBeNull()

    // 取消：草稿复位为已保存态
    fireEvent.click(document.querySelector('[data-calendar-cancel]')!)
    expect(document.querySelector('[data-project-settings-dirty]')).toBeNull()
    expect(document.querySelector('[data-calendar-save]')).toBeDisabled()
    expect(document.querySelector('[data-calendar-date-chip="holidays:2026-10-01"]')).toBeNull()
    expect(writeRequests(records)).toHaveLength(0)
  })
})

describe('工作日历前端即时校验（非法输入零请求）', () => {
  test('同一日期既作节假日又作调休日：即时阻断并展示互斥提示，零写请求', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([])
    renderWorkspace()
    await readyWorkspace()

    addDate('holidays', '2026-10-01')
    addDate('extraWorkdays', '2026-10-01')

    expect(document.querySelector('[data-project-settings-error]')?.textContent).toContain(
      '同一日期不能同时作为节假日和调休日',
    )
    expect(
      document.querySelector('[data-calendar-date-chip="extraWorkdays:2026-10-01"]'),
    ).toBeNull()
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('同列表内重复日期：即时阻断并提示重复，零写请求', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([])
    renderWorkspace()
    await readyWorkspace()

    addDate('holidays', '2026-10-01')
    addDate('holidays', '2026-10-01')

    expect(document.querySelector('[data-project-settings-error]')?.textContent).toContain(
      '日期不能重复',
    )
    expect(document.querySelectorAll('[data-calendar-date-chip^="holidays:"]')).toHaveLength(1)
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('未选工作日：警示文案上屏且保存按钮物理禁用（零请求）', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([])
    renderWorkspace()
    await readyWorkspace()

    for (const label of ['周一', '周二', '周三', '周四', '周五']) {
      fireEvent.click(screen.getByLabelText(`${label}是否为工作日`))
    }

    expect(document.querySelector('[data-project-settings-error]')?.textContent).toContain(
      '至少选择一个每周工作日',
    )
    expect(document.querySelector('[data-calendar-save]')).toBeDisabled()
    fireEvent.click(document.querySelector('[data-calendar-save]')!)
    expect(writeRequests(records)).toHaveLength(0)
  })
})

describe('工作日历保存（tasks 8.1/8.2）', () => {
  test('保存草稿：PATCH /projects/:id/working-calendar 并携带归一化载荷', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([])
    renderWorkspace()
    await readyWorkspace()

    fireEvent.click(screen.getByLabelText('周六是否为工作日'))
    addDate('holidays', '2026-10-01')
    fireEvent.click(document.querySelector('[data-calendar-save]')!)

    await waitFor(() => expect(writeRequests(records)).toHaveLength(1))
    const patch = writeRequests(records)[0]!
    expect(patch.method).toBe('PATCH')
    expect(patch.url).toBe('/projects/42/working-calendar')
    expect(patch.body).toMatchObject({
      version: 1,
      workdays: [1, 2, 3, 4, 5, 6],
      holidays: ['2026-10-01'],
      extraWorkdays: [],
    })
    // 保存成功后脏态消除
    await waitFor(() => expect(document.querySelector('[data-project-settings-dirty]')).toBeNull())
  })

  test('保存失败：回显服务端错误原文并保留未保存草稿', async () => {
    setAuth(['project:view', 'project:update'])
    installBackend([], {
      patchStatus: 422,
      patchError: '同一日期不能同时作为节假日和调休日',
    })
    renderWorkspace()
    await readyWorkspace()

    addDate('holidays', '2026-10-01')
    fireEvent.click(document.querySelector('[data-calendar-save]')!)

    await waitFor(() =>
      expect(document.querySelector('[data-project-settings-error]')?.textContent).toContain(
        '同一日期不能同时作为节假日和调休日',
      ),
    )
    // 草稿保留：脏态仍在，节假日条目未被回滚
    expect(document.querySelector('[data-project-settings-dirty]')).not.toBeNull()
    expect(document.querySelector('[data-calendar-date-chip="holidays:2026-10-01"]')).not.toBeNull()
  })
})

describe('归档与只读锁（spec「归档项目的设置页呈只读」）', () => {
  test('项目已归档：渲染只读横幅、控件禁用且零写请求', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([], { project: makeProject({ status: 'archived' }) })
    renderWorkspace()
    await readyWorkspace()

    expect(document.querySelector('[data-project-settings-readonly]')?.textContent).toContain(
      '项目已归档',
    )
    expect(screen.getByLabelText('周一是否为工作日')).toBeDisabled()
    expect(document.querySelector('[data-calendar-date-input="holidays"]')).toBeDisabled()
    expect(document.querySelector('[data-calendar-save]')).toBeDisabled()
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('无 project:update 权限：只读横幅 + 日历只读视图（零写请求）', async () => {
    setAuth(['project:view'])
    const { records } = installBackend([])
    renderWorkspace()
    await readyWorkspace()

    expect(document.querySelector('[data-project-settings-readonly]')?.textContent).toContain(
      '没有项目更新权限',
    )
    expect(screen.getByLabelText('周一是否为工作日')).toBeDisabled()
    expect(document.querySelector('[data-calendar-save]')).toBeDisabled()
    expect(writeRequests(records)).toHaveLength(0)
  })
})

describe('项目隔离与三态（RL-05/RL-06）', () => {
  test('跨组织项目：中性 404「项目不存在或已被移除」且工作日历端点零请求', async () => {
    setAuth(['project:view', 'project:update'], 2)
    const { records } = installBackend([])
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('项目不存在或已被移除')
    expect(records.some((record) => record.url.includes('working-calendar'))).toBe(false)
  })

  test('工作日历接口 500：错误卡可重试', async () => {
    setAuth(['project:view', 'project:update'])
    const records: RequestRecord[] = []
    let calendarAttempts = 0
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = rawUrl.replace(API_PREFIX, '')
      records.push({ method, url: path, body: null })
      if (method === 'GET' && path === '/projects/42') {
        return jsonResponse(200, { data: makeProject() })
      }
      if (path === '/projects/42/working-calendar') {
        calendarAttempts += 1
        if (calendarAttempts === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '服务暂不可用' } })
        }
        return jsonResponse(200, { data: BASE_CALENDAR })
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } })
    }) as typeof fetch)

    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-calendar-load-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-calendar-load-retry]')!)
    await waitFor(() => expect(document.querySelector('[data-calendar-editor]')).not.toBeNull())
    expect(screen.getByLabelText('周一是否为工作日')).not.toBeDisabled()
  })
})

describe('精确档（precise）与语义空态（RL-15 / 三态闭环）', () => {
  test('precise 档：工作区剥离空间光晕，面板以 1px 发丝线纯色呈现', async () => {
    const { useNextTrackStore } = await import('@/stores/next-track-store')
    const { act } = await import('@testing-library/react')
    act(() => useNextTrackStore.setState({ immersionTier: 'precise' }))
    try {
      setAuth(['project:view', 'project:update'])
      installBackend([])
      renderWorkspace()
      await readyWorkspace()

      const workspace = document.querySelector('[data-project-settings-workspace]')!
      expect(workspace.getAttribute('data-immersion')).toBe('precise')
      expect(workspace.className).not.toContain('nx-space-atmosphere')
      expect(workspace.className).toContain('--nx-workspace-bg')
      expect(workspace.className).toContain('--nx-border-hairline')
      expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    } finally {
      act(() => useNextTrackStore.setState({ immersionTier: null }))
      document.documentElement.removeAttribute('data-immersion')
    }
  })

  test('节假日与调休日均为空：渲染语义空态文案（不是空白面板）', async () => {
    setAuth(['project:view', 'project:update'])
    installBackend([])
    renderWorkspace()
    await readyWorkspace()

    expect(document.querySelector('[data-calendar-date-empty="holidays"]')?.textContent).toBe(
      '暂无节假日',
    )
    expect(document.querySelector('[data-calendar-date-empty="extraWorkdays"]')?.textContent).toBe(
      '暂无调休日',
    )
  })

  test('数据层信封防御：支持双层 { data: ... } 信封解包与归一化兜底（Rule 5）', async () => {
    setAuth(['project:view', 'project:update'])
    const records: RequestRecord[] = []
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = rawUrl.replace(API_PREFIX, '')
      records.push({ method, url: path, body: null })
      if (method === 'GET' && path === '/projects/42') {
        return jsonResponse(200, { data: makeProject() })
      }
      if (path === '/projects/42/working-calendar') {
        return jsonResponse(200, {
          data: { data: { ...BASE_CALENDAR, holidays: ['2026-12-25'] } },
        })
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } })
    }) as typeof fetch)

    renderWorkspace()
    await readyWorkspace()

    expect(document.querySelector('[data-calendar-date-chip="holidays:2026-12-25"]')).not.toBeNull()
  })
})
