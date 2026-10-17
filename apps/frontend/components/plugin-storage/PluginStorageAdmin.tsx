'use client'

/**
 * v3-plugin-scoped-storage —— PluginStorageAdmin 管理组件（任务 4.3）。
 *
 * 组织级插件存储的配额/用量/生命周期视图与清理、导出操作：
 * - 权限隐藏：无 plugin_storage:view 不渲染；manage 控制清理按钮；export 控制导出按钮；
 * - 清理必须两步（预览影响面 → 显式确认），不可逆提示对屏幕阅读器可感知；
 * - 用量进度条带 aria 语义；状态徽标区分 active/read-only/orphaned/pending-deletion。
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/use-permissions'
import {
  listPluginStorageNamespaces,
  previewPluginStorageCleanup,
  confirmPluginStorageCleanup,
  exportPluginStorage,
  pluginStorageKeys,
  type PluginStorageNamespaceDto,
  type PluginStorageCleanupPreviewDto,
} from '@/lib/api/plugin-storage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'

const STATUS_LABELS: Record<string, string> = {
  active: '活跃',
  'read-only': '停用只读',
  orphaned: '卸载保留',
  'pending-deletion': '待删除',
}

function usagePercent(used: number, quota: number): number {
  if (quota <= 0) return 0
  return Math.min(100, Math.round((used / quota) * 100))
}

export interface PluginStorageAdminProps {
  organizationId: string | number
}

export function PluginStorageAdmin({ organizationId }: PluginStorageAdminProps) {
  const { hasPermission } = usePermissions()
  const queryClient = useQueryClient()

  const canView = hasPermission('plugin_storage:view')
  const canManage = hasPermission('plugin_storage:manage')
  const canExport = hasPermission('plugin_storage:export')

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<PluginStorageCleanupPreviewDto | null>(null)
  const [busy, setBusy] = useState(false)

  const namespacesQuery = useQuery({
    queryKey: pluginStorageKeys.namespaces(organizationId),
    queryFn: () => listPluginStorageNamespaces(organizationId),
    enabled: canView,
  })

  if (!canView) return null

  const namespaces: PluginStorageNamespaceDto[] = namespacesQuery.data?.data ?? []

  async function handlePreview(namespaceId: number): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      const res = await previewPluginStorageCleanup(organizationId, namespaceId)
      setPreview(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '清理预览失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const res = await confirmPluginStorageCleanup(organizationId, {
        cleanupHandle: preview.cleanupHandle,
        cleanupDigest: preview.cleanupDigest,
      })
      setNotice(
        `已清理 ${res.data.pluginId} 的 ${res.data.deletedEntries} 条数据（释放 ${res.data.freedBytes} 字节）`,
      )
      setPreview(null)
      await queryClient.invalidateQueries({ queryKey: pluginStorageKeys.all })
    } catch (e) {
      setError(e instanceof Error ? e.message : '清理确认失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleExport(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      const res = await exportPluginStorage(organizationId, {})
      setNotice(
        `导出完成：${res.data.manifest.totalEntries} 条记录，文件 ${res.data.filePath ?? '（空）'}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="plugin-storage-admin">
      <CardHeader>
        <CardTitle>插件存储管理</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="danger" role="alert" data-testid="storage-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert role="status" data-testid="storage-notice">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        {namespacesQuery.isLoading && <Skeleton data-testid="storage-loading" />}

        {!namespacesQuery.isLoading && namespaces.length === 0 && (
          <p role="status" data-testid="storage-empty">
            当前组织没有插件存储命名空间。
          </p>
        )}

        {namespaces.length > 0 && (
          <table aria-label="插件存储命名空间" data-testid="storage-table">
            <thead>
              <tr>
                <th scope="col">插件</th>
                <th scope="col">范围</th>
                <th scope="col">状态</th>
                <th scope="col">容量用量</th>
                <th scope="col">条目用量</th>
                {canManage && <th scope="col">操作</th>}
              </tr>
            </thead>
            <tbody>
              {namespaces.map((ns) => (
                <tr key={ns.namespaceId} data-testid={`storage-row-${ns.namespaceId}`}>
                  <td>{ns.pluginId}</td>
                  <td>{ns.scope === 'project' ? `项目 #${ns.projectId}` : '组织'}</td>
                  <td>
                    <span
                      data-testid={`storage-status-${ns.namespaceId}`}
                      aria-label={`状态：${STATUS_LABELS[ns.status] ?? ns.status}`}
                    >
                      {STATUS_LABELS[ns.status] ?? ns.status}
                    </span>
                  </td>
                  <td>
                    <div
                      role="meter"
                      aria-valuenow={usagePercent(ns.usedBytes, ns.quotaBytes)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${ns.pluginId} 容量使用率`}
                      data-testid={`storage-bytes-meter-${ns.namespaceId}`}
                    >
                      {ns.usedBytes}/{ns.quotaBytes} 字节
                    </div>
                  </td>
                  <td>
                    {ns.usedEntries}/{ns.quotaEntries} 条
                  </td>
                  {canManage && (
                    <td>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => handlePreview(ns.namespaceId)}
                        data-testid={`storage-cleanup-btn-${ns.namespaceId}`}
                        aria-label={`预览清理 ${ns.pluginId} 的存储数据`}
                      >
                        清理…
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canExport && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={handleExport}
            data-testid="storage-export-btn"
            aria-label="导出本组织插件存储数据"
          >
            导出数据
          </Button>
        )}

        {preview && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cleanup-preview-title"
            data-testid="cleanup-preview-dialog"
          >
            <h3 id="cleanup-preview-title">确认清理（不可逆）</h3>
            <p>
              插件 {preview.pluginId} · 范围{' '}
              {preview.scope === 'project' ? `项目 #${preview.projectId}` : '组织'} · 状态{' '}
              {STATUS_LABELS[preview.status] ?? preview.status}
            </p>
            <p>
              将删除 {preview.entryCount} 条数据，释放 {preview.totalBytes} 字节。此操作不可逆，
              并会写入审计日志。
            </p>
            <Button
              type="button"
              disabled={busy}
              onClick={handleConfirm}
              data-testid="cleanup-confirm-btn"
              aria-label="确认执行不可逆清理"
            >
              确认清理
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setPreview(null)}
              data-testid="cleanup-cancel-btn"
              aria-label="取消清理"
            >
              取消
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
