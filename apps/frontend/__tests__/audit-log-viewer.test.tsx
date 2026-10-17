import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuditLogFilters } from '@/components/audit/AuditLogFilters'
import { AuditLogTable } from '@/components/audit/AuditLogTable'
import { AuditLogStats } from '@/components/audit/AuditLogStats'
import { AuditLogDetailDrawer } from '@/components/audit/AuditLogDetailDrawer'
import { AuditLogPageContent } from '@/components/audit/AuditLogPageContent'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import type {
  AuditLogEntry,
  AuditLogDetail,
  AuditLogStats as StatsData,
} from '@/lib/api/audit-logs'
import { auditLogsApi } from '@/lib/api/audit-logs'

// —— next/navigation mock（顶层，pathname/searchParams 由 mutable 变量控制） —— //
const mockReplace = vi.fn()
let mockSearchParams = new URLSearchParams()
const mockPathname = '/admin/audit-logs'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
  redirect: vi.fn(),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function login(permissions: string[], isSuperAdmin = false) {
  act(() => {
    useAuthStore.getState().setSession({
      user: {
        id: 1,
        email: 'a@b.com',
        fullName: '甲',
        isSuperAdmin,
        organizations: [{ id: 1, name: 'O1', slug: 'o1', role: 'owner' }],
      },
      accessToken: accessTokenWith(permissions, { organizationId: 1 }),
      refreshToken: 'r',
    })
  })
}

const sampleList: AuditLogEntry[] = [
  {
    id: 10,
    createdAt: '2026-07-01T10:00:00Z',
    action: 'create',
    event: 'TASK_CREATED',
    severity: 'info',
    userId: 1,
    organizationId: 1,
    projectId: null,
    entityType: 'task',
    entityId: 1,
    requestId: 'req-1',
    userName: '甲',
    organizationName: 'O1',
    entityName: null,
    projectName: null,
  },
  {
    id: 9,
    createdAt: '2026-07-01T09:00:00Z',
    action: 'update',
    event: 'TASK_STATUS_CHANGED',
    severity: 'warning',
    userId: 2,
    organizationId: 2,
    projectId: 1,
    entityType: 'task',
    entityId: 2,
    requestId: 'req-2',
    userName: '乙',
    organizationName: 'O2',
    entityName: null,
    projectName: '项目X',
  },
]

const sampleDetail: AuditLogDetail = {
  ...sampleList[0]!,
  changes: {
    before: { status: 'in_progress' },
    after: { status: 'completed' },
  },
  metadata: {
    event: 'TASK_CREATED',
    ip: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    requestId: 'req-1',
  },
}

const sampleStats: StatsData = {
  byAction: { create: 5, update: 3 },
  bySeverity: { info: 6, warning: 2 },
  byDay: [{ date: '2026-07-01', count: 8 }],
}

describe('AuditLogFilters', () => {
  test('渲染所有筛选控件', () => {
    render(<AuditLogFilters filters={{}} onChange={() => {}} />)
    expect(screen.getByLabelText('事件类型')).toBeInTheDocument()
    expect(screen.getByLabelText('操作类型')).toBeInTheDocument()
    expect(screen.getByLabelText('严重级别')).toBeInTheDocument()
    expect(screen.getByLabelText('开始日期')).toBeInTheDocument()
    expect(screen.getByLabelText('结束日期')).toBeInTheDocument()
    expect(screen.getByLabelText('操作人 ID')).toBeInTheDocument()
    expect(screen.getByLabelText('实体类型')).toBeInTheDocument()
    expect(screen.getByLabelText('请求 ID')).toBeInTheDocument()
  })

  test('文本筛选变更触发 onChange 并清空分页游标', () => {
    const onChange = vi.fn()
    render(<AuditLogFilters filters={{ event: 'test', page: 2, cursor: 5 }} onChange={onChange} />)
    const input = screen.getByLabelText('事件类型')
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    nativeInputValueSetter?.call(input, 'new-event')
    fireEvent.input(input, { target: { value: 'new-event' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ event: 'new-event' }))
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ page: expect.anything() }))
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ cursor: expect.anything() }),
    )
  })

  test('操作人 ID 为空时回退 undefined', () => {
    const onChange = vi.fn()
    render(<AuditLogFilters filters={{ actorId: 5 }} onChange={onChange} />)
    const input = screen.getByLabelText('操作人 ID')
    fireEvent.input(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ actorId: undefined }))
  })

  test('日期变更写入 filters', () => {
    const onChange = vi.fn()
    render(<AuditLogFilters filters={{}} onChange={onChange} />)
    fireEvent.input(screen.getByLabelText('开始日期'), { target: { value: '2026-06-01' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2026-06-01' }))
  })
})

describe('AuditLogTable', () => {
  test('加载状态显示骨架屏', () => {
    const { container } = render(
      <AuditLogTable
        data={undefined}
        isLoading
        hasMore={false}
        onLoadMore={() => {}}
        isLoadingMore={false}
        onRowClick={() => {}}
      />,
    )
    expect(container.querySelector('[class*="animate-shimmer"]')).toBeTruthy()
  })

  test('空数据时显示占位提示', () => {
    render(
      <AuditLogTable
        data={[]}
        isLoading={false}
        hasMore={false}
        onLoadMore={() => {}}
        isLoadingMore={false}
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByText('暂无审计记录')).toBeInTheDocument()
  })

  test('有数据时渲染行并展示顶层 event 与 severity 语义色', () => {
    render(
      <AuditLogTable
        data={sampleList}
        isLoading={false}
        hasMore={false}
        onLoadMore={() => {}}
        isLoadingMore={false}
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByText('创建任务')).toBeInTheDocument()
    expect(screen.getByText('变更任务状态')).toBeInTheDocument()
    expect(screen.getByText('信息')).toBeInTheDocument()
    expect(screen.getByText('警告')).toBeInTheDocument()
    // 去代号化：显示实名而非数字 ID
    expect(screen.getByText('甲')).toBeInTheDocument()
    expect(screen.getByText('O1')).toBeInTheDocument()
  })

  test('点击加载更多触发 onLoadMore', () => {
    const onLoadMore = vi.fn()
    render(
      <AuditLogTable
        data={sampleList}
        isLoading={false}
        hasMore
        onLoadMore={onLoadMore}
        isLoadingMore={false}
        onRowClick={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  test('加载更多中按钮禁用并显示加载文案', () => {
    render(
      <AuditLogTable
        data={sampleList}
        isLoading={false}
        hasMore
        onLoadMore={() => {}}
        isLoadingMore
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '加载中...' })).toBeDisabled()
  })

  test('点击行触发 onRowClick', () => {
    const onRowClick = vi.fn()
    render(
      <AuditLogTable
        data={sampleList}
        isLoading={false}
        hasMore={false}
        onLoadMore={() => {}}
        isLoadingMore={false}
        onRowClick={onRowClick}
      />,
    )
    fireEvent.click(screen.getByText('创建任务'))
    expect(onRowClick).toHaveBeenCalledWith(sampleList[0])
  })
})

describe('AuditLogDetailDrawer', () => {
  beforeEach(() => {
    vi.spyOn(auditLogsApi, 'show').mockResolvedValue(sampleDetail)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('渲染详情并展示 changes before/after diff 与完整 metadata', async () => {
    render(
      wrapper({
        children: <AuditLogDetailDrawer entry={sampleList[0]!} open onClose={() => {}} />,
      }),
    )
    expect(await screen.findByText('审计日志详情')).toBeInTheDocument()
    expect(await screen.findByText('变更前')).toBeInTheDocument()
    expect(screen.getByText('变更后')).toBeInTheDocument()
    expect(screen.getByText(/in_progress/)).toBeInTheDocument()
    expect(screen.getByText(/completed/)).toBeInTheDocument()
    expect(screen.getByText(/127\.0\.0\.1/)).toBeInTheDocument()
    expect(screen.getByText(/Mozilla\/5\.0/)).toBeInTheDocument()
  })

  test('changes 为 null 时显示历史降级占位', async () => {
    vi.spyOn(auditLogsApi, 'show').mockResolvedValue({ ...sampleDetail, changes: null })
    render(
      wrapper({
        children: <AuditLogDetailDrawer entry={sampleList[0]!} open onClose={() => {}} />,
      }),
    )
    expect(await screen.findByText('该记录无变更前后值')).toBeInTheDocument()
  })
})

describe('AuditLogStats', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('加载状态渲染骨架', () => {
    vi.spyOn(auditLogsApi, 'stats').mockImplementation(() => new Promise(() => {}))
    const { container } = render(wrapper({ children: <AuditLogStats /> }))
    expect(container.querySelector('[class*="animate-pulse"]')).toBeTruthy()
  })

  test('成功时渲染三维度概览卡片', async () => {
    vi.spyOn(auditLogsApi, 'stats').mockResolvedValue(sampleStats)
    render(wrapper({ children: <AuditLogStats /> }))
    expect(await screen.findByText('按操作')).toBeInTheDocument()
    expect(screen.getByText('按级别')).toBeInTheDocument()
    expect(screen.getByText('按日期')).toBeInTheDocument()
    expect(screen.getByText('create')).toBeInTheDocument()
  })

  test('超时降级为空概览并显示重试按钮', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(auditLogsApi, 'stats').mockImplementation(() => new Promise(() => {}))
    render(wrapper({ children: <AuditLogStats /> }))
    vi.advanceTimersByTime(900)
    expect(await screen.findByText('统计加载失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getAllByText('无数据').length).toBe(3)
  })
})

describe('AuditLogPageContent', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockSearchParams = new URLSearchParams()
    vi.spyOn(auditLogsApi, 'list').mockResolvedValue({
      data: sampleList,
      meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
    })
    vi.spyOn(auditLogsApi, 'stats').mockResolvedValue(sampleStats)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('从 URL 解析筛选条件并触发 list 查询', async () => {
    mockSearchParams = new URLSearchParams('event=TASK_CREATED&severity=critical&actorId=1')
    render(wrapper({ children: <AuditLogPageContent scope="global" /> }))
    await waitFor(() =>
      expect(auditLogsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'TASK_CREATED', severity: ['critical'], actorId: 1 }),
      ),
    )
  })

  test('筛选变更同步到 URL 并清空分页', async () => {
    render(wrapper({ children: <AuditLogPageContent scope="global" /> }))
    await waitFor(() => expect(auditLogsApi.list).toHaveBeenCalled())

    const input = screen.getByLabelText('事件类型')
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    nativeInputValueSetter?.call(input, 'USER_UPDATED')
    fireEvent.input(input, { target: { value: 'USER_UPDATED' } })

    await waitFor(() => {
      const url = new URL(`http://x.com?${mockReplace.mock.calls[0]?.[0]?.replace('?', '') ?? ''}`)
      expect(url.searchParams.get('event')).toBe('USER_UPDATED')
    })
  })

  test('深链接 URL 复制后可还原筛选条件', async () => {
    mockSearchParams = new URLSearchParams('action=update&dateFrom=2026-06-01&dateTo=2026-07-01')
    render(wrapper({ children: <AuditLogPageContent scope="org" /> }))
    await waitFor(() =>
      expect(auditLogsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ['update'],
          dateFrom: '2026-06-01',
          dateTo: '2026-07-01',
        }),
      ),
    )
  })
})

describe('审计日志页面权限', () => {
  beforeEach(() => {
    vi.spyOn(auditLogsApi, 'list').mockResolvedValue({
      data: sampleList,
      meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
    })
    vi.spyOn(auditLogsApi, 'stats').mockResolvedValue(sampleStats)
  })

  afterEach(() => {
    act(() => useAuthStore.getState().clear())
    vi.restoreAllMocks()
  })

  test('sysadmin 可访问 /admin/audit-logs 全局视图', async () => {
    login(['system:admin'], true)
    const { default: AdminPage } = await import('@/app/(dashboard)/admin/audit-logs/page')
    render(wrapper({ children: <AdminPage /> }))
    expect(await screen.findByText('审计日志（全局）')).toBeInTheDocument()
  })

  test('org_admin 可访问 /settings/audit-logs 本组织视图', async () => {
    login(['audit:view'])
    const { default: SettingsPage } = await import('@/app/(dashboard)/settings/audit-logs/page')
    render(wrapper({ children: <SettingsPage /> }))
    expect(await screen.findByText('审计日志')).toBeInTheDocument()
  })

  test('普通角色访问 /admin/audit-logs 被 PermissionGuard 拦截', async () => {
    login(['project:view'])
    const { default: AdminPage } = await import('@/app/(dashboard)/admin/audit-logs/page')
    render(wrapper({ children: <AdminPage /> }))
    expect(screen.getByText('无权访问审计日志')).toBeInTheDocument()
  })

  test('普通角色访问 /settings/audit-logs 被 PermissionGuard 拦截', async () => {
    login(['project:view'])
    const { default: SettingsPage } = await import('@/app/(dashboard)/settings/audit-logs/page')
    render(wrapper({ children: <SettingsPage /> }))
    expect(screen.getByText('无权访问审计日志')).toBeInTheDocument()
  })
})

describe('审计日志导航可见性', () => {
  afterEach(() => {
    act(() => useAuthStore.getState().clear())
  })

  test('sysadmin 在导航中见全局审计入口', async () => {
    login(['system:admin'], true)
    const { Sidebar } = await import('@/components/layout/Sidebar')
    const { TooltipProvider } = await import('@/components/ui/Tooltip')
    render(
      wrapper({
        children: (
          <TooltipProvider>
            <Sidebar />
          </TooltipProvider>
        ),
      }),
    )
    expect(screen.getByRole('link', { name: /审计日志（全局）/ })).toBeInTheDocument()
  })

  test('org_admin 在导航中见组织审计入口', async () => {
    login(['audit:view'])
    const { Sidebar } = await import('@/components/layout/Sidebar')
    const { TooltipProvider } = await import('@/components/ui/Tooltip')
    render(
      wrapper({
        children: (
          <TooltipProvider>
            <Sidebar />
          </TooltipProvider>
        ),
      }),
    )
    expect(screen.getByRole('link', { name: /审计日志（组织）/ })).toBeInTheDocument()
  })

  test('普通角色导航中无审计入口', async () => {
    login(['project:view'])
    const { Sidebar } = await import('@/components/layout/Sidebar')
    const { TooltipProvider } = await import('@/components/ui/Tooltip')
    render(
      wrapper({
        children: (
          <TooltipProvider>
            <Sidebar />
          </TooltipProvider>
        ),
      }),
    )
    expect(screen.queryByRole('link', { name: /审计日志/ })).not.toBeInTheDocument()
  })
})

describe('跨组织数据一致性', () => {
  beforeEach(() => {
    vi.spyOn(auditLogsApi, 'stats').mockResolvedValue(sampleStats)
  })

  afterEach(() => {
    act(() => useAuthStore.getState().clear())
    vi.restoreAllMocks()
  })

  test('sysadmin 全局视图列表含他组织记录', async () => {
    login(['system:admin'], true)
    vi.spyOn(auditLogsApi, 'list').mockResolvedValue({
      data: sampleList,
      meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
    })
    const { default: AdminPage } = await import('@/app/(dashboard)/admin/audit-logs/page')
    render(wrapper({ children: <AdminPage /> }))
    expect(await screen.findByText('变更任务状态')).toBeInTheDocument()
    // organizationId=2 的记录出现在全局视图（去代号化后以实名展示：操作人「乙」、组织「O2」）
    expect(screen.getByText('乙')).toBeInTheDocument()
    expect(screen.getByText('O2')).toBeInTheDocument()
  })

  test('org_admin 本组织视图不显示他组织记录', async () => {
    login(['audit:view'])
    vi.spyOn(auditLogsApi, 'list').mockResolvedValue({
      data: sampleList.filter((e) => e.organizationId === 1),
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { default: SettingsPage } = await import('@/app/(dashboard)/settings/audit-logs/page')
    render(wrapper({ children: <SettingsPage /> }))
    expect(await screen.findByText('创建任务')).toBeInTheDocument()
    expect(screen.queryByText('变更任务状态')).not.toBeInTheDocument()
  })
})
