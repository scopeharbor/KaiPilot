/**
 * v3-plugin-scoped-storage —— PluginStorageAdmin 组件测试（任务 4.3）。
 *
 * 覆盖：
 * - 权限隐藏：无 view 不渲染；view-only 无清理/导出按钮；manage/export 才可见
 * - 清理两步流：预览影响面（alertdialog）→ 确认调用一次 API 并提示结果
 * - 可访问性：meter 语义、状态 aria-label、表格 caption
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PluginStorageAdmin } from '../components/plugin-storage/PluginStorageAdmin'
import type { PluginStorageNamespaceDto } from '../lib/api/plugin-storage'

const hoisted = vi.hoisted(() => ({
  permissions: new Set<string>(['plugin_storage:view']),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => hoisted.permissions.has(p),
  }),
}))

const listNamespaces = vi.fn()
const previewCleanup = vi.fn()
const confirmCleanup = vi.fn()
const exportData = vi.fn()

vi.mock('../lib/api/plugin-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/plugin-storage')>()
  return {
    ...actual,
    listPluginStorageNamespaces: (...args: unknown[]) => listNamespaces(...args),
    previewPluginStorageCleanup: (...args: unknown[]) => previewCleanup(...args),
    confirmPluginStorageCleanup: (...args: unknown[]) => confirmCleanup(...args),
    exportPluginStorage: (...args: unknown[]) => exportData(...args),
  }
})

const NAMESPACE: PluginStorageNamespaceDto = {
  namespaceId: 7,
  organizationId: 101,
  projectId: null,
  pluginId: 'acme.storage-demo',
  pluginVersion: '1.0.0',
  scope: 'organization',
  status: 'orphaned',
  quotaBytes: 524288,
  usedBytes: 1024,
  quotaEntries: 256,
  usedEntries: 3,
  retentionUntil: '2026-09-22T00:00:00.000Z',
  createdAt: '2026-08-23T00:00:00.000Z',
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  hoisted.permissions = new Set<string>(['plugin_storage:view'])
  vi.clearAllMocks()
  listNamespaces.mockResolvedValue({ data: [NAMESPACE] })
})

describe('PluginStorageAdmin', () => {
  it('无 view 权限：组件整体不渲染', () => {
    hoisted.permissions = new Set<string>()
    const Wrapper = makeWrapper()
    const { container } = render(
      <Wrapper>
        <PluginStorageAdmin organizationId={101} />
      </Wrapper>,
    )
    expect(container.querySelector('[data-testid="plugin-storage-admin"]')).toBeNull()
  })

  it('view-only：渲染表格与状态，但不出现清理/导出按钮（权限隐藏）', async () => {
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <PluginStorageAdmin organizationId={101} />
      </Wrapper>,
    )
    await waitFor(() => expect(screen.getByTestId('storage-table')).toBeDefined())
    expect(screen.getByTestId('storage-status-7').getAttribute('aria-label')).toContain('卸载保留')
    expect(screen.queryByTestId('storage-cleanup-btn-7')).toBeNull()
    expect(screen.queryByTestId('storage-export-btn')).toBeNull()
  })

  it('容量用量具备 meter 语义与 aria 标签', async () => {
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <PluginStorageAdmin organizationId={101} />
      </Wrapper>,
    )
    const meter = await screen.findByTestId('storage-bytes-meter-7')
    expect(meter.getAttribute('role')).toBe('meter')
    expect(meter.getAttribute('aria-label')).toContain('容量使用率')
  })

  it('manage+export：清理两步流生效且确认只调用一次 API', async () => {
    hoisted.permissions = new Set<string>([
      'plugin_storage:view',
      'plugin_storage:manage',
      'plugin_storage:export',
    ])
    previewCleanup.mockResolvedValue({
      data: {
        format: 'plugin-storage-cleanup-preview-v1',
        cleanupHandle: 'handle-x',
        namespaceId: 7,
        pluginId: 'acme.storage-demo',
        scope: 'organization',
        projectId: null,
        status: 'orphaned',
        entryCount: 3,
        totalBytes: 1024,
        cleanupDigest: 'abcd1234',
        irreversible: true,
        expiresAt: '2026-08-23T00:10:00.000Z',
        createdAt: '2026-08-23T00:00:00.000Z',
      },
    })
    confirmCleanup.mockResolvedValue({
      data: {
        namespaceId: 7,
        pluginId: 'acme.storage-demo',
        deletedEntries: 3,
        freedBytes: 1024,
        auditReceiptId: '42',
      },
    })

    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <PluginStorageAdmin organizationId={101} />
      </Wrapper>,
    )
    const btn = await screen.findByTestId('storage-cleanup-btn-7')
    fireEvent.click(btn)

    // 预览对话框展示不可逆影响面
    const dialog = await screen.findByTestId('cleanup-preview-dialog')
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(screen.getByText(/将删除 3 条数据/)).toBeDefined()
    expect(screen.getAllByText(/不可逆/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('cleanup-confirm-btn'))
    await waitFor(() => expect(confirmCleanup).toHaveBeenCalledTimes(1))
    expect(confirmCleanup).toHaveBeenCalledWith(101, {
      cleanupHandle: 'handle-x',
      cleanupDigest: 'abcd1234',
    })
    await waitFor(() => expect(screen.getByTestId('storage-notice')).toBeDefined())
  })

  it('导出按钮仅对 export 权限可见并触发一次导出', async () => {
    hoisted.permissions = new Set<string>(['plugin_storage:view', 'plugin_storage:export'])
    exportData.mockResolvedValue({
      data: {
        manifest: {
          format: 'plugin-storage-export-v1',
          organizationId: 101,
          requestedByActorRef: 'actor:1',
          filter: { pluginId: null, scope: null, includeOrphaned: true },
          page: 1,
          totalEntries: 0,
          totalBytes: 0,
          digest: 'x',
          expiresAt: '2026-08-23T00:10:00.000Z',
          createdAt: '2026-08-23T00:00:00.000Z',
        },
        records: [],
        filePath: null,
      },
    })
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <PluginStorageAdmin organizationId={101} />
      </Wrapper>,
    )
    const btn = await screen.findByTestId('storage-export-btn')
    fireEvent.click(btn)
    await waitFor(() => expect(exportData).toHaveBeenCalledTimes(1))
  })
})
