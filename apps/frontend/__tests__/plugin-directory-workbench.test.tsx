import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PluginDirectoryWorkbench } from '@/components/plugin-registry/PluginDirectoryWorkbench'
import { pluginDirectoryKeys } from '@/lib/api/plugin-directory'

/**
 * v3-organization-private-plugin-directory —— 目录工作台只读面测试（tasks 4.2/4.4）。
 *
 * 覆盖：组织化 query keys、加载/空态/错误重试、成员 vs 管理员视图、
 * 状态筛选、stale 提示、「无权限动作不渲染」与简体中文非市场文案。
 */

const hookMocks = vi.hoisted(() => ({
  useDirectoryReleases: vi.fn(),
  useDirectoryReleaseDetail: vi.fn(),
  useAffectedInstallations: vi.fn(),
}))

vi.mock('@/hooks/use-plugin-directory', () => hookMocks)

const releaseItem = {
  releaseId: '11',
  pluginIdentity: 'com.example.alpha',
  version: '1.0.0',
  status: 'approved' as const,
  createdAt: '2026-08-24T00:00:00Z',
  compatibilityAllowed: true,
  activeInstallationCount: 2,
  uninstalledInstallationCount: 1,
}

function makeListResult(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      data: [releaseItem],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    },
    isLoading: false,
    error: null,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...overrides,
  }
}

function renderWorkbench(props: React.ComponentProps<typeof PluginDirectoryWorkbench> = {}) {
  return render(<PluginDirectoryWorkbench {...props} />)
}

describe('PluginDirectoryWorkbench', () => {
  beforeEach(() => {
    hookMocks.useDirectoryReleases.mockReturnValue(makeListResult())
    hookMocks.useDirectoryReleaseDetail.mockReturnValue({
      data: {
        ...releaseItem,
        manifestDigestPresent: true,
        compatibility: { allowed: true, digest: 'sha256:abcdef0123456789', reasonCodes: [] },
        review: { latestCycleNumber: 2, latestDecision: 'approved', latestResolvedAt: null },
        impact: { activeCount: 2, uninstalledCount: 1 },
      },
      isLoading: false,
      error: null,
    })
    hookMocks.useAffectedInstallations.mockReturnValue({
      data: {
        data: [
          {
            id: '7',
            pluginId: 'com.example.alpha',
            version: '1.0.0',
            status: 'enabled',
            installedAt: null,
            uninstalledAt: null,
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('query keys 以组织为前缀隔离', () => {
    expect(pluginDirectoryKeys.all(101)).not.toEqual(pluginDirectoryKeys.all(202))
    expect(pluginDirectoryKeys.releaseList(101)).not.toEqual(pluginDirectoryKeys.releaseList(202))
    expect(pluginDirectoryKeys.releaseDetail(101, '11')).not.toEqual(
      pluginDirectoryKeys.releaseDetail(202, '11'),
    )
  })

  it('加载中渲染骨架屏（aria-busy）', () => {
    hookMocks.useDirectoryReleases.mockReturnValue(
      makeListResult({ isLoading: true, data: undefined }),
    )
    renderWorkbench()
    expect(screen.getByLabelText('正在加载目录')).toBeDefined()
  })

  it('空态使用组织私有语义文案', () => {
    hookMocks.useDirectoryReleases.mockReturnValue(
      makeListResult({
        data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      }),
    )
    renderWorkbench()
    expect(screen.getByText('暂无可展示的插件版本')).toBeDefined()
  })

  it('错误态提供统一非泄露文案与重试按钮', async () => {
    const refetch = vi.fn()
    hookMocks.useDirectoryReleases.mockReturnValue(
      makeListResult({ error: new Error('cross-org'), data: undefined, refetch }),
    )
    renderWorkbench()
    expect(screen.getByRole('alert')).toHaveTextContent('目录加载失败')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('列表行展示状态徽标、版本与安装计数，点击展开详情', async () => {
    renderWorkbench({ canManageReview: true })
    expect(screen.getByText('com.example.alpha')).toBeDefined()
    // 列表徽标 + 详情徽标可能同时存在
    expect(screen.getAllByText('已批准').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /com\.example\.alpha v1\.0\.0/ }))
    expect(await screen.findByLabelText(/版本详情 com\.example\.alpha/)).toBeDefined()
    expect(screen.getAllByText('宿主兼容').length).toBeGreaterThan(0)
    expect(screen.getByText('第 2 轮')).toBeDefined()
  })

  it('管理员可见受影响安装清单；普通成员不渲染该区块（无权限动作暗示）', async () => {
    const view = renderWorkbench({ canManageReview: false })
    fireEvent.click(screen.getByRole('button', { name: /com\.example\.alpha/ }))
    expect(screen.queryByText(/受影响安装/)).toBeNull()
    view.unmount()

    renderWorkbench({ canManageReview: true })
    fireEvent.click(screen.getByRole('button', { name: /com\.example\.alpha/ }))
    expect(await screen.findByText(/受影响安装/)).toBeDefined()
    expect(screen.getAllByText(/已启用/).length).toBeGreaterThan(0)
  })

  it('状态筛选触发带参数的重新查询', async () => {
    renderWorkbench()
    const select = screen.getByLabelText('按状态筛选')
    expect(hookMocks.useDirectoryReleases).toHaveBeenCalledWith({ sort: '-createdAt' })

    // 清除上次调用记录后切换筛选
    hookMocks.useDirectoryReleases.mockClear()
    fireEvent.change(select, { target: { value: 'withdrawn' } })
    expect(hookMocks.useDirectoryReleases).toHaveBeenLastCalledWith({
      status: 'withdrawn',
      sort: '-createdAt',
    })
  })

  it('stale 且未在刷新时显示过期提示', () => {
    hookMocks.useDirectoryReleases.mockReturnValue(makeListResult({ isStale: true }))
    renderWorkbench()
    expect(screen.getByRole('status')).toHaveTextContent('目录数据可能已过期')
  })

  it('只读边界：不渲染任何管理动作按钮', () => {
    renderWorkbench({ canManageReview: true })
    for (const action of ['审批', '禁用', '恢复', '回滚', '确认']) {
      expect(screen.queryByRole('button', { name: new RegExp(action) })).toBeNull()
    }
  })

  it('文案为简体中文且不含公开市场术语', () => {
    const { container } = renderWorkbench({ canManageReview: true })
    const text = container.textContent ?? ''
    expect(text).toContain('组织私有插件目录')
    for (const forbidden of ['市场', '上架', '评分', '计费', '分成', '入驻']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('键盘可达：卡片为原生 button 可聚焦，筛选控件为原生 select', () => {
    renderWorkbench({ canManageReview: false })
    const card = screen.getByRole('button', { name: /com\.example\.alpha v1\.0\.0/ })
    card.focus()
    expect(document.activeElement).toBe(card)
    // 原生元素自带键盘激活语义（Enter/Space 触发 click、select 支持方向键）
    expect(screen.getByLabelText('按状态筛选').tagName).toBe('SELECT')
    expect(screen.getByLabelText('排序方式').tagName).toBe('SELECT')
    expect(card.getAttribute('aria-expanded')).toBe('false')
  })

  it('主题与密度：语义 token + 圆角变量，无硬编码色值', () => {
    const { container } = renderWorkbench({ canManageReview: true })
    const html = container.innerHTML
    expect(html).toContain('rounded-[var(--radius-sm)]')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('border-border')
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}\b/)
  })
})
