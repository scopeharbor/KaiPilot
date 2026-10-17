'use client'

/**
 * `/dev/plugin-install-harness` —— v3-plugin-e2e-lifecycle-certification 浏览器认证沙箱（抛弃型）。
 *
 * 刻意置于 dashboard 路由组之外（仓库 /dev/* 抛弃型沙箱约定）：无 AppShell，
 * 认证态复用全局 auth-store 的 sessionStorage 持久化（Playwright 经
 * `packages/e2e/e2e/_auth-helper.ts#setAuthSession` 注入），API 全部走真实后端。
 * 仅挂载既有 PluginInstallList/PluginInstallConfirmDialog 与目录只读列表，
 * 不实现任何新的产品功能；归档后本路由可移除。
 */
import * as React from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { apiFetchEnvelope } from '@/lib/api-client'
import { PluginInstallList } from '@/components/plugin-install/PluginInstallList'
import { PluginInstallConfirmDialog } from '@/components/plugin-install/PluginInstallConfirmDialog'
import {
  confirmPluginInstall,
  listPluginInstallations,
  previewPluginInstall,
  type PluginInstallationDto,
} from '@/lib/api/plugin-install'
import type { PluginInstallAction, PluginInstallCommandPreview } from '@aiproj/types'

/**
 * 目录只读列表条目。
 *
 * 字段名对齐 `/plugin-directory/releases` 的真实 DTO：主键是 **字符串** `releaseId`
 * （非 `id`）。写成 `id` 会让下方 option value 变成 "undefined"，安装预览拿到 NaN
 * releaseId，后端一律回 `plugin-install-payload-invalid`。
 */
interface DirectoryReleaseItem {
  releaseId: string
  pluginIdentity: string
  version: string
  status: string
}

export default function PluginInstallHarnessPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const organizationId = useAuthStore((s) => s.currentOrganizationId)
  const [installations, setInstallations] = React.useState<PluginInstallationDto[]>([])
  const [releases, setReleases] = React.useState<DirectoryReleaseItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedReleaseId, setSelectedReleaseId] = React.useState<string>('')
  const [installDialog, setInstallDialog] = React.useState<{
    action: PluginInstallAction
    preview: PluginInstallCommandPreview | null
  } | null>(null)
  const [lastErrorCode, setLastErrorCode] = React.useState<string>('')

  const errCodeOf = (err: unknown): string => {
    const code = (err as { code?: string })?.code
    return typeof code === 'string' && code ? code : 'UNKNOWN'
  }

  const refresh = React.useCallback(async () => {
    if (!organizationId) return
    setLoading(true)
    try {
      const res = await listPluginInstallations(organizationId)
      setInstallations(res.data)
      setLastErrorCode('')
    } catch (err) {
      setLastErrorCode(errCodeOf(err))
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  React.useEffect(() => {
    if (!organizationId) return
    void refresh()
    // 目录只读列表：仅 approved release，供安装选择
    apiFetchEnvelope<{ data: DirectoryReleaseItem[] }>(
      `/organizations/${organizationId}/plugin-directory/releases?status=approved&perPage=50`,
    )
      .then((res) => setReleases(res.data ?? []))
      .catch((err) => setLastErrorCode(errCodeOf(err)))
  }, [organizationId, refresh])

  if (!accessToken || !organizationId) {
    return (
      <main style={{ padding: 24 }}>
        <p data-harness-no-session>未检测到认证会话（等待 Playwright 注入）</p>
      </main>
    )
  }

  return (
    <main
      data-plugin-harness
      style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}
      className="space-y-6"
    >
      <header className="space-y-1">
        <h1 className="text-xl font-bold">插件生命周期认证沙箱</h1>
        <p className="text-xs text-muted-foreground" data-harness-org>
          org:{organizationId}
        </p>
        {lastErrorCode && (
          <p role="alert" data-error-code className="text-xs text-destructive">
            最近错误码:{lastErrorCode}
          </p>
        )}
      </header>

      {/* 目录安装入口：选择 approved release → 预览确认 */}
      <section className="space-y-2 rounded-md border border-border p-3" data-directory-section>
        <h2 className="text-sm font-semibold">从组织目录安装</h2>
        <div className="flex items-center gap-2">
          <select
            data-directory-select
            value={selectedReleaseId}
            onChange={(e) => setSelectedReleaseId(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            aria-label="选择要安装的目录版本"
          >
            <option value="">— 选择 release —</option>
            {releases.map((r) => (
              <option key={r.releaseId} value={r.releaseId}>
                {r.pluginIdentity}@{r.version}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-install-selected
            disabled={!selectedReleaseId}
            onClick={async () => {
              try {
                const selected = releases.find((r) => r.releaseId === selectedReleaseId)
                const pluginId = selected?.pluginIdentity ?? ''
                // 已有活动安装时选版本 = 升级；install 只对未安装插件合法，
                // 否则状态机先以 plugin-install-illegal-transition 拦下，
                // 兼容性/摘要等来源校验根本没机会执行。
                const active = installations.find(
                  (item) => item.pluginId === pluginId && item.status !== 'uninstalled',
                )
                const action: PluginInstallAction = active ? 'upgrade' : 'install'
                const preview = await previewPluginInstall(organizationId, {
                  action,
                  pluginId,
                  releaseId: Number(selectedReleaseId),
                })
                setInstallDialog({ action, preview: preview.data })
                setLastErrorCode('')
              } catch (err) {
                setLastErrorCode(errCodeOf(err))
              }
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            安装所选版本
          </button>
        </div>
      </section>

      {/* 已安装列表（真实状态机动作入口：启用/停用/卸载） */}
      <PluginInstallList
        installations={installations}
        loading={loading}
        canManage
        onPreviewAction={async (action, pluginId) => {
          try {
            const res = await previewPluginInstall(organizationId, { action, pluginId })
            setLastErrorCode('')
            return res.data
          } catch (err) {
            setLastErrorCode(errCodeOf(err))
            throw err
          }
        }}
        onConfirmAction={async (request) => {
          try {
            await confirmPluginInstall(organizationId, request)
            setLastErrorCode('')
            await refresh()
          } catch (err) {
            setLastErrorCode(errCodeOf(err))
            throw err
          }
        }}
      />

      {/* 目录安装确认对话框（与列表内对话框同一组件） */}
      {installDialog && (
        <PluginInstallConfirmDialog
          open
          action={installDialog.action}
          preview={installDialog.preview}
          onConfirm={async (request) => {
            try {
              await confirmPluginInstall(organizationId, request)
              setLastErrorCode('')
              setInstallDialog(null)
              await refresh()
            } catch (err) {
              setLastErrorCode(errCodeOf(err))
              throw err
            }
          }}
          onClose={() => setInstallDialog(null)}
        />
      )}
    </main>
  )
}
