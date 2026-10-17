'use client'

/**
 * v3-skill-as-plugin-adapter —— PluginInstallConfirmDialog 组件（task 6.2）。
 *
 * 职责：
 * 1. 预览-确认两步流：展示状态转移、权限清单与贡献影响面（含 skill-bundle 引用）。
 * 2. 权限确认门禁：启用操作（enable）必须显式勾选权限清单确认，未确认阻断提交。
 * 3. 低敏呈现：仅展示权限名、用途、副作用与贡献引用，不包含 secret/包体。
 */
import * as React from 'react'
import { AlertTriangle, Loader2, Shield, X, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Badge } from '@/components/ui/Badge'
import type {
  PluginInstallAction,
  PluginInstallCommandPreview,
  PluginInstallConfirmRequest,
} from '@aiproj/types'

export const INSTALL_ACTION_LABELS: Record<PluginInstallAction, string> = {
  install: '安装插件',
  enable: '启用插件',
  disable: '停用插件',
  upgrade: '升级插件',
  uninstall: '卸载插件',
}

export interface PluginInstallConfirmDialogProps {
  open: boolean
  action: PluginInstallAction
  preview: PluginInstallCommandPreview | null
  previewing?: boolean
  submitting?: boolean
  error?: string | null
  onConfirm: (request: PluginInstallConfirmRequest) => void
  onClose: () => void
}

export function PluginInstallConfirmDialog({
  open,
  action,
  preview,
  previewing = false,
  submitting = false,
  error,
  onConfirm,
  onClose,
}: PluginInstallConfirmDialogProps) {
  const [permissionConfirmed, setPermissionConfirmed] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setPermissionConfirmed(false)
    }
  }, [open, action])

  if (!open) return null

  const isEnable = action === 'enable'
  const canSubmit =
    !previewing && !submitting && Boolean(preview) && (!isEnable || permissionConfirmed)

  const handleConfirm = () => {
    if (!preview || !canSubmit) return
    onConfirm({
      previewHandle: preview.previewHandle,
      previewDigest: preview.previewDigest,
      permissionConfirmed: isEnable ? permissionConfirmed : undefined,
      permissionDigest: isEnable ? preview.permissionDigest : undefined,
    })
  }

  return (
    <div
      data-plugin-install-dialog
      role="dialog"
      aria-modal="true"
      aria-label={`${INSTALL_ACTION_LABELS[action]}确认`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-card shadow-lg">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <h2 className="text-base font-semibold text-foreground">
            {INSTALL_ACTION_LABELS[action]}
          </h2>
          <button
            type="button"
            data-dialog-close
            onClick={onClose}
            aria-label="关闭"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
              focusRing,
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {previewing && (
            <div
              data-install-previewing
              className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在生成状态转移与影响面预览…</span>
            </div>
          )}

          {!previewing && preview && (
            <>
              {/* 插件与版本基本信息 */}
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{preview.pluginName}</span>
                  <Badge variant="outline">{preview.pluginId}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>状态转移:</span>
                  <span className="font-semibold">{preview.currentStatus}</span>
                  <span>→</span>
                  <span className="font-semibold text-primary">{preview.targetStatus}</span>
                  {preview.targetVersion && (
                    <span className="ml-auto">目标版本: v{preview.targetVersion}</span>
                  )}
                </div>
              </div>

              {/* 贡献影响面 */}
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                  贡献影响面 ({preview.affectedContributions.length})
                </h3>
                {preview.affectedContributions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">该插件未声明任何贡献接缝。</p>
                ) : (
                  <div className="space-y-1.5">
                    {preview.affectedContributions.map((c, i) => (
                      <div
                        key={i}
                        data-contribution-item
                        className="rounded border border-border bg-card p-2 text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between font-medium">
                          <span>{c.title || c.contributionKey}</span>
                          <span className="text-muted-foreground font-mono text-[10px]">
                            {c.seamKey}
                          </span>
                        </div>
                        {c.skillKeyRef && (
                          <div className="text-muted-foreground text-[11px]">
                            引用宿主 Skill: <code className="text-primary">{c.skillKeyRef}</code>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 权限清单 */}
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  申请权限清单 ({preview.requestedPermissions.length})
                </h3>
                {preview.requestedPermissions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">该插件无需额外权限。</p>
                ) : (
                  <div className="space-y-1.5">
                    {preview.requestedPermissions.map((p, i) => (
                      <div
                        key={i}
                        data-permission-item
                        className="rounded border border-border bg-card p-2 text-xs flex items-center justify-between"
                      >
                        <div>
                          <div className="font-mono font-medium text-foreground">
                            {p.permissionKey}
                          </div>
                          {p.purpose && (
                            <div className="text-[11px] text-muted-foreground">{p.purpose}</div>
                          )}
                        </div>
                        <Badge variant={p.sideEffect === 'read-only' ? 'neutral' : 'warning'}>
                          {p.sideEffect}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 启用专属：显式权限确认 Checkbox */}
              {isEnable && (
                <div
                  data-permission-confirm-box
                  className="rounded-md border border-primary/20 bg-primary/5 p-3"
                >
                  <label className="flex items-start gap-2 cursor-pointer select-none text-xs text-foreground">
                    <input
                      type="checkbox"
                      data-permission-checkbox
                      checked={permissionConfirmed}
                      onChange={(e) => setPermissionConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="font-medium">
                      我已仔细审阅并同意授予该插件上述全部权限与接缝能力声明。
                    </span>
                  </label>
                </div>
              )}
            </>
          )}

          {/* 错误提示 */}
          {error && (
            <div
              data-dialog-error
              className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-3">
          <button
            type="button"
            data-cancel-button
            onClick={onClose}
            className={cn(
              'rounded-md border border-border px-4 py-2 text-xs font-medium text-foreground hover:bg-accent',
              focusRing,
            )}
          >
            取消
          </button>
          <button
            type="button"
            data-confirm-button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className={cn(
              'rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40',
              focusRing,
            )}
          >
            {submitting ? '处理中…' : `确认${INSTALL_ACTION_LABELS[action]}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
