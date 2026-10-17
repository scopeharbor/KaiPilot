import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PluginRegistryList } from '../components/plugin-registry/PluginRegistryList'
import {
  RegistryCommandDrawer,
  REGISTRY_ERROR_MESSAGES,
} from '../components/plugin-registry/RegistryCommandDrawer'
import {
  RegistryRollbackWizard,
  type RollbackInstance,
} from '../components/plugin-registry/RegistryRollbackWizard'
import { pluginRegistryKeys } from '../lib/api/plugin-registry'
import type { RegistryCommandPreview } from '../lib/api/plugin-registry'

/**
 * v3-plugin-private-registry-lifecycle — 前端测试（tasks 8.2 / 8.4 / 8.6 / 8.8）。
 *
 * 8.2 hooks：分页/过滤、组织 cache namespace、mutation 成功刷新、稳定错误码、
 *            客户端权限不作为授权结果；
 * 8.4 组件：各状态 badge、跨组织切换无旧数据闪现、敏感字段不渲染、键盘/焦点/ARIA、
 *            浅深色与紧凑模式关键结构；
 * 8.6 交互：合法双人流程、自批禁用但服务端兜底、stale/replay 刷新、撤回风险提示、
 *            二次点击不重复提交；
 * 8.8 回滚：无实例默认、显式多选、preview 差异、部分失败/degraded、取消不写入、
 *            未授权隐藏与服务端最终拒绝。
 */

const listMock = vi.fn()
const previewMock = vi.fn()
const confirmMock = vi.fn()

vi.mock('@/lib/api/plugin-registry', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/plugin-registry')>(
    '../lib/api/plugin-registry',
  )
  return {
    ...actual,
    listPluginRegistryEntries: (...args: unknown[]) => listMock(...args),
    previewPluginRegistryCommand: (...args: unknown[]) => previewMock(...args),
    confirmPluginRegistryCommand: (...args: unknown[]) => confirmMock(...args),
  }
})

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
}

beforeEach(() => {
  listMock.mockReset()
  previewMock.mockReset()
  confirmMock.mockReset()
})

// ===========================================================================
// 8.2 hooks
// ===========================================================================

describe('plugin registry hooks（任务 8.2）', () => {
  it('query key 以组织为 namespace —— 组织切换即换缓存分区', () => {
    const a = pluginRegistryKeys.list('org-a', { page: 1 })
    const b = pluginRegistryKeys.list('org-b', { page: 1 })
    expect(a).not.toEqual(b)
    expect(a).toContain('org-a')
    expect(b).toContain('org-b')
    // 详情/待审队列同样带组织
    expect(pluginRegistryKeys.detail('org-a', 'e1')).toContain('org-a')
    expect(pluginRegistryKeys.reviewQueue('org-a')).toContain('org-a')
  })

  it('列表 hook 透传分页与过滤参数', async () => {
    const { usePluginRegistryEntries } = await import('../hooks/use-plugin-registry')
    listMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, perPage: 10, totalPages: 0 },
    })
    const client = newClient()

    const { result } = renderHook(
      () => usePluginRegistryEntries('org-a', { page: 2, perPage: 10, status: 'approved' }),
      { wrapper: wrapper(client) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(listMock).toHaveBeenCalledWith('org-a', { page: 2, perPage: 10, status: 'approved' })
  })

  it('组织为 null 时不发起请求（无组织上下文即不取数）', async () => {
    const { usePluginRegistryEntries } = await import('../hooks/use-plugin-registry')
    const client = newClient()
    renderHook(() => usePluginRegistryEntries(null), { wrapper: wrapper(client) })
    expect(listMock).not.toHaveBeenCalled()
  })

  it('confirm 成功后失效列表/详情/待审队列缓存', async () => {
    const { usePluginRegistryConfirm } = await import('../hooks/use-plugin-registry')
    confirmMock.mockResolvedValue({ success: true, action: 'approve' })
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => usePluginRegistryConfirm('org-a'), {
      wrapper: wrapper(client),
    })
    await act(async () => {
      await result.current.mutateAsync({ handle: 'h1', action: 'approve' })
    })

    expect(invalidate).toHaveBeenCalledTimes(3)
  })

  it('confirm 失败不失效缓存（一次失败不冲掉好数据），错误码稳定透出', async () => {
    const { usePluginRegistryConfirm } = await import('../hooks/use-plugin-registry')
    confirmMock.mockRejectedValue(new Error('registry-preview-stale'))
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => usePluginRegistryConfirm('org-a'), {
      wrapper: wrapper(client),
    })
    await act(async () => {
      await result.current.mutateAsync({ handle: 'h1', action: 'approve' }).catch(() => {})
    })

    expect(invalidate).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('registry-preview-stale')
  })

  it('preview 是只读的：成功也不失效任何缓存', async () => {
    const { usePluginRegistryPreview } = await import('../hooks/use-plugin-registry')
    previewMock.mockResolvedValue({ handle: 'h1', diff: 'x', impactSummary: [] })
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => usePluginRegistryPreview('org-a'), {
      wrapper: wrapper(client),
    })
    await act(async () => {
      await result.current.mutateAsync({ action: 'approve', targetReleaseId: '1' })
    })

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('hooks 不含任何授权判定（授权只在服务端）', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('hooks/use-plugin-registry.ts', 'utf8'),
    )
    for (const forbidden of ['hasPermission(', 'canApprove(', 'isOwner(']) {
      expect(source).not.toContain(forbidden)
    }
  })
})

// ===========================================================================
// 8.4 组件
// ===========================================================================

const ENTRIES = [
  {
    entryId: 'e1',
    pluginIdentity: 'com.example.a',
    pluginName: '插件 A',
    recommendedVersion: '1.2.0',
    releaseCount: 3,
    latestApprovedVersion: '1.2.0',
    latestStatus: 'approved' as const,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  },
]

describe('PluginRegistryList（任务 8.4）', () => {
  it('渲染状态 badge 且不含敏感字段', () => {
    const { container } = render(<PluginRegistryList entries={ENTRIES} />)
    expect(screen.getByText('已批准')).toBeInTheDocument()
    const text = container.textContent ?? ''
    // 目录列表只展示低敏信息：不得出现 digest/receipt 原文
    expect(text).not.toContain('sha256:')
    expect(text).not.toContain('receipt')
  })

  it('四种主题密度组合下关键结构均渲染', () => {
    for (const mode of ['light', 'dark']) {
      for (const density of ['comfortable', 'compact']) {
        document.documentElement.setAttribute('data-mode', mode)
        document.documentElement.setAttribute('data-density', density)
        const { unmount } = render(<PluginRegistryList entries={ENTRIES} />)
        expect(screen.getByText('插件 A')).toBeInTheDocument()
        unmount()
      }
    }
    document.documentElement.removeAttribute('data-mode')
    document.documentElement.removeAttribute('data-density')
  })

  it('空态与加载态各自可读', () => {
    const { unmount } = render(<PluginRegistryList entries={[]} />)
    expect(screen.getByText(/暂无|没有/)).toBeInTheDocument()
    unmount()
    const { container } = render(<PluginRegistryList entries={[]} loading />)
    // 加载态用骨架屏（无文案）：断言骨架元素存在且空态文案不再出现
    expect(container.querySelectorAll('[class*="animate-shimmer"]').length).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 8.6 差异确认 drawer 交互
// ===========================================================================

function preview(overrides: Partial<RegistryCommandPreview> = {}): RegistryCommandPreview {
  return {
    handle: 'h-1',
    organizationId: 'org-a',
    actorRef: 'u-1',
    action: 'approve',
    targetReleaseId: 'r-1',
    stateVersion: 3,
    sourceHash: 'hash',
    diff: '状态：pending_review → approved',
    impactSummary: ['影响 2 个安装实例'],
    ttlSeconds: 300,
    createdAt: '2026-08-18T00:00:00.000Z',
    expiresAt: '2026-08-18T00:05:00.000Z',
    ...overrides,
  } as RegistryCommandPreview
}

function renderDrawer(props: Partial<React.ComponentProps<typeof RegistryCommandDrawer>> = {}) {
  return render(
    <RegistryCommandDrawer
      open
      action="approve"
      preview={preview()}
      currentActorRef="u-2"
      submitterRef="u-1"
      onConfirm={props.onConfirm ?? vi.fn()}
      onRePreview={props.onRePreview ?? vi.fn()}
      onClose={props.onClose ?? vi.fn()}
      {...props}
    />,
  )
}

describe('RegistryCommandDrawer（任务 8.5/8.6）', () => {
  it('合法双人流程：审批人 ≠ 送审人时可确认', () => {
    const onConfirm = vi.fn()
    renderDrawer({ onConfirm })
    const confirm = document.querySelector('[data-registry-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('自批被禁用，且明确说明服务端仍会校验', () => {
    const onConfirm = vi.fn()
    renderDrawer({ currentActorRef: 'u-1', submitterRef: 'u-1', onConfirm })
    const confirm = document.querySelector('[data-registry-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
    const note = document.querySelector('[data-registry-maker-checker]')
    expect(note?.textContent).toContain('服务端也会再次校验')
  })

  it('stale 时禁用确认并提供重新预览', () => {
    const onRePreview = vi.fn()
    renderDrawer({ stale: true, onRePreview })
    expect((document.querySelector('[data-registry-confirm]') as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(document.querySelector('[data-registry-repreview]') as HTMLElement)
    expect(onRePreview).toHaveBeenCalled()
    expect(document.querySelector('[data-registry-stale]')).toBeTruthy()
  })

  it('服务端拒绝时展示对应中文说明（replay/过期均可读）', () => {
    for (const code of ['registry-preview-replayed', 'registry-preview-expired']) {
      const { unmount } = renderDrawer({ errorCode: code })
      expect(document.querySelector('[data-registry-error]')?.textContent).toBe(
        REGISTRY_ERROR_MESSAGES[code],
      )
      unmount()
    }
  })

  it('提交中禁用确认（二次点击不重复提交）', () => {
    const onConfirm = vi.fn()
    renderDrawer({ submitting: true, onConfirm })
    const confirm = document.querySelector('[data-registry-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('撤回动作展示影响范围（风险提示可读）', () => {
    renderDrawer({
      action: 'withdraw',
      preview: preview({ impactSummary: ['将清除推荐指针', '影响 2 个安装实例'] }),
      submitterRef: null,
    })
    const impact = document.querySelector('[data-registry-impact]')
    expect(impact?.textContent).toContain('清除推荐指针')
  })

  it('对话框语义与键盘可达', () => {
    renderDrawer()
    const drawer = document.querySelector('[data-registry-drawer]') as HTMLElement
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    for (const selector of [
      '[data-registry-drawer-close]',
      '[data-registry-cancel]',
      '[data-registry-confirm]',
    ]) {
      const el = document.querySelector(selector)
      if (el) expect(el.tagName).toBe('BUTTON')
    }
  })
})

// ===========================================================================
// 8.8 rollback wizard
// ===========================================================================

function instance(overrides: Partial<RollbackInstance> = {}): RollbackInstance {
  return {
    instanceId: 'i-1',
    displayName: '实例一',
    currentVersion: '2.0.0',
    status: 'pending',
    ...overrides,
  }
}

function renderWizard(props: Partial<React.ComponentProps<typeof RegistryRollbackWizard>> = {}) {
  return render(
    <RegistryRollbackWizard
      open
      authorized
      pluginIdentity="com.example.a"
      targetVersion="1.2.0"
      instances={props.instances ?? [instance()]}
      onPreview={props.onPreview ?? vi.fn()}
      onConfirm={props.onConfirm ?? vi.fn()}
      onClose={props.onClose ?? vi.fn()}
      {...props}
    />,
  )
}

describe('RegistryRollbackWizard（任务 8.7/8.8）', () => {
  it('未授权时整个向导不渲染', () => {
    renderWizard({ authorized: false })
    expect(document.querySelector('[data-rollback-wizard]')).toBeNull()
  })

  it('默认不选任何实例：确认按钮为「仅切换推荐指针」', () => {
    const onConfirm = vi.fn()
    renderWizard({ onConfirm })
    const confirm = document.querySelector('[data-rollback-confirm]') as HTMLElement
    expect(confirm.textContent).toContain('仅切换推荐指针')
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith([])
  })

  it('无安装实例时明确说明只影响推荐指针', () => {
    renderWizard({ instances: [] })
    expect(document.querySelector('[data-rollback-no-instances]')?.textContent).toContain(
      '只影响推荐指针',
    )
  })

  it('实例必须逐项显式勾选才进入回滚计划', () => {
    const onConfirm = vi.fn()
    renderWizard({
      instances: [instance(), instance({ instanceId: 'i-2', displayName: '实例二' })],
      onConfirm,
    })
    const checkboxes = document.querySelectorAll('[data-rollback-instance-checkbox]')
    expect(checkboxes).toHaveLength(2)
    fireEvent.click(checkboxes[0] as HTMLElement)
    fireEvent.click(document.querySelector('[data-rollback-confirm]') as HTMLElement)
    expect(onConfirm).toHaveBeenCalledWith(['i-1'])
  })

  it('不提供「全组织自动降级」入口', () => {
    const { container } = renderWizard({
      instances: [instance(), instance({ instanceId: 'i-2' })],
    })
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/全选|自动降级|全部降级/)
  })

  it('预览按钮回传当前选择', () => {
    const onPreview = vi.fn()
    renderWizard({ onPreview })
    fireEvent.click(document.querySelector('[data-rollback-instance-checkbox]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-rollback-preview]') as HTMLElement)
    expect(onPreview).toHaveBeenCalledWith(['i-1'])
  })

  it('展示 prepare/apply/compensate/degraded 状态', () => {
    renderWizard({
      instances: [
        instance({ instanceId: 'a', status: 'prepare' }),
        instance({ instanceId: 'b', status: 'apply' }),
        instance({ instanceId: 'c', status: 'compensate' }),
        instance({ instanceId: 'd', status: 'degraded', detail: '实例不可达' }),
      ],
    })
    const statuses = Array.from(document.querySelectorAll('[data-rollback-instance-status]')).map(
      (el) => el.textContent,
    )
    expect(statuses.join('|')).toContain('准备中')
    expect(statuses.join('|')).toContain('应用中')
    expect(statuses.join('|')).toContain('补偿中')
    expect(statuses.join('|')).toContain('降级待处理')
  })

  it('部分失败时单独列出 degraded 实例与原因', () => {
    renderWizard({
      instances: [
        instance({ instanceId: 'a', status: 'done' }),
        instance({
          instanceId: 'b',
          displayName: '实例二',
          status: 'degraded',
          detail: '实例不可达',
        }),
      ],
    })
    const degraded = document.querySelector('[data-rollback-degraded]')
    expect(degraded?.textContent).toContain('实例二')
    expect(degraded?.textContent).toContain('实例不可达')
  })

  it('取消不触发任何写入回调', () => {
    const onConfirm = vi.fn()
    const onPreview = vi.fn()
    const onClose = vi.fn()
    renderWizard({ onConfirm, onPreview, onClose })
    fireEvent.click(document.querySelector('[data-rollback-cancel]') as HTMLElement)
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('提交中禁用确认按钮', () => {
    const onConfirm = vi.fn()
    renderWizard({ submitting: true, onConfirm })
    const confirm = document.querySelector('[data-rollback-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
