'use client'

/**
 * v3-skill-as-plugin-adapter —— PluginInstallList 组件（task 6.1）。
 *
 * 职责：
 * 1. 组织内已安装插件列表展示：状态徽章、版本、权限确认时间、更新时间。
 * 2. 状态机动作触发：安装、启用、停用、升级、卸载。
 * 3. RBAC 门控：仅在具备 manage 权限时展示/允许写向操作。
 */
import * as React from 'react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { PluginInstallConfirmDialog } from './PluginInstallConfirmDialog'
import type { PluginInstallationDto } from '@/lib/api/plugin-install'
import type {
  PluginInstallAction,
  PluginInstallCommandPreview,
  PluginInstallConfirmRequest,
  PluginInstallationStatus,
} from '@aiproj/types'

const STATUS_VARIANTS: Record<
  PluginInstallationStatus,
  'neutral' | 'success' | 'danger' | 'warning' | 'outline'
> = {
  installed: 'neutral',
  enabled: 'success',
  uninstalled: 'danger',
}

const STATUS_LABELS: Record<PluginInstallationStatus, string> = {
  installed: '已安装 (未启用)',
  enabled: '已启用',
  uninstalled: '已卸载',
}

export interface PluginInstallListProps {
  installations: PluginInstallationDto[]
  loading?: boolean
  error?: string
  canManage?: boolean
  onPreviewAction: (
    action: PluginInstallAction,
    pluginId: string,
  ) => Promise<PluginInstallCommandPreview>
  onConfirmAction: (request: PluginInstallConfirmRequest) => Promise<void>
}

export function PluginInstallList({
  installations,
  loading = false,
  error,
  canManage = true,
  onPreviewAction,
  onConfirmAction,
}: PluginInstallListProps) {
  const [activeAction, setActiveAction] = React.useState<PluginInstallAction | null>(null)
  const [preview, setPreview] = React.useState<PluginInstallCommandPreview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const handleOpenAction = async (action: PluginInstallAction, pluginId: string) => {
    setActiveAction(action)
    setPreview(null)
    setActionError(null)
    setPreviewing(true)

    try {
      const prev = await onPreviewAction(action, pluginId)
      setPreview(prev)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '生成预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  const handleConfirm = async (request: PluginInstallConfirmRequest) => {
    setSubmitting(true)
    setActionError(null)
    try {
      await onConfirmAction(request)
      setActiveAction(null)
      setPreview(null)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '确认操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div data-install-skeleton className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card data-install-error className="p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    )
  }

  if (installations.length === 0) {
    return <EmptyState title="暂无已安装插件" description="组织当前未安装任何外部插件扩展。" />
  }

  return (
    <div data-plugin-install-list className="space-y-3">
      {installations.map((inst) => {
        const isEnabled = inst.status === 'enabled'
        const isInstalled = inst.status === 'installed'
        const isUninstalled = inst.status === 'uninstalled'

        return (
          <Card
            key={inst.id}
            data-install-card={inst.pluginId}
            className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{inst.pluginId}</span>
                <span className="text-xs text-muted-foreground">v{inst.version}</span>
                <Badge variant={STATUS_VARIANTS[inst.status]}>{STATUS_LABELS[inst.status]}</Badge>
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>Release: #{inst.releaseId}</span>
                {inst.permissionConfirmation && (
                  <span>
                    权限已确认于:{' '}
                    {new Date(inst.permissionConfirmation.confirmedAt).toLocaleString()}
                  </span>
                )}
                {inst.uninstalledAt && (
                  <span>卸载于: {new Date(inst.uninstalledAt).toLocaleString()}</span>
                )}
              </div>
            </div>

            {/* 操作按钮区（RBAC 门控） */}
            {canManage && !isUninstalled && (
              <div data-install-actions className="flex items-center gap-2 shrink-0">
                {isInstalled && (
                  <button
                    type="button"
                    data-action-enable
                    onClick={() => handleOpenAction('enable', inst.pluginId)}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    启用
                  </button>
                )}
                {isEnabled && (
                  <button
                    type="button"
                    data-action-disable
                    onClick={() => handleOpenAction('disable', inst.pluginId)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    停用
                  </button>
                )}
                <button
                  type="button"
                  data-action-uninstall
                  onClick={() => handleOpenAction('uninstall', inst.pluginId)}
                  className="rounded-md border border-destructive/30 text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/10"
                >
                  卸载
                </button>
              </div>
            )}
          </Card>
        )
      })}

      {activeAction && (
        <PluginInstallConfirmDialog
          open={Boolean(activeAction)}
          action={activeAction}
          preview={preview}
          previewing={previewing}
          submitting={submitting}
          error={actionError}
          onConfirm={handleConfirm}
          onClose={() => {
            setActiveAction(null)
            setPreview(null)
          }}
        />
      )}
    </div>
  )
}
