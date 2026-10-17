'use client'

import * as React from 'react'
import { CheckCircle2, Loader2, LockKeyhole, RefreshCw, ShieldAlert, Webhook } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useCreateOutgoingWebhook,
  useDeactivateOutgoingWebhook,
  useOutgoingWebhooks,
  useRotateOutgoingWebhook,
} from '@/hooks/use-outgoing-webhooks'
import {
  OUTGOING_WEBHOOK_MANAGE_PERMISSION,
  type OneTimeSecretState,
} from '@/lib/api/outgoing-webhooks'
import {
  OUTGOING_WEBHOOK_EVENT_METADATA,
  OUTGOING_WEBHOOK_EVENT_WHITELIST,
  isAllowedOutgoingWebhookEvent,
  type OutgoingWebhookEventType,
} from '@aiproj/types'

/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理面板（任务 6.3/6.5/6.6）。
 *
 * 列出脱敏订阅、从共享白名单创建、停用、轮换密钥；一次性密钥仅 create/rotate 成功态展示，
 * dismiss 后不再渲染，刷新后只显示非密钥指纹。无 outgoing_webhook:manage 权限的用户只读。
 * 投递尚未启用（本 change 只做订阅管理），UI 明确区分「已配置」与「投递未启用」。
 */
export function OutgoingWebhookSubscriptionsPanel() {
  const canManage = usePermissions().can(OUTGOING_WEBHOOK_MANAGE_PERMISSION)
  const query = useOutgoingWebhooks()
  const create = useCreateOutgoingWebhook()
  const deactivate = useDeactivateOutgoingWebhook()
  const rotate = useRotateOutgoingWebhook()
  const [oneTimeSecret, setOneTimeSecret] = React.useState<OneTimeSecretState | null>(null)
  const [form, setForm] = React.useState({
    name: '',
    targetUrl: '',
    eventTypes: [] as OutgoingWebhookEventType[],
  })
  const [urlError, setUrlError] = React.useState<string | null>(null)

  const subscriptions = query.data?.data ?? []

  function validateUrl(url: string): string | null {
    if (!url.trim()) return '目标 URL 不能为空'
    try {
      const parsed = new URL(url.trim())
      if (parsed.protocol !== 'https:') return '目标 URL 必须使用 HTTPS'
      if (!parsed.hostname) return '目标 URL 缺少 host'
      if (parsed.username || parsed.password) return '目标 URL 不得内嵌凭据'
    } catch {
      return '目标 URL 格式不合法'
    }
    return null
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const err = validateUrl(form.targetUrl)
    setUrlError(err)
    if (err) return
    if (!form.name.trim() || form.eventTypes.length === 0) return
    const res = await create.mutateAsync({
      name: form.name.trim(),
      targetUrl: form.targetUrl.trim(),
      eventTypes: form.eventTypes,
    })
    const data = (res as { data: { id: number; secret: OneTimeSecretState } }).data
    setOneTimeSecret({
      secret: data.secret.secret,
      fingerprint: data.secret.fingerprint,
      rotatedAt: data.secret.rotatedAt,
    })
    setForm({ name: '', targetUrl: '', eventTypes: [] })
  }

  async function handleRotate(id: number) {
    const res = await rotate.mutateAsync(id)
    const data = (res as { data: { id: number; secret: OneTimeSecretState } }).data
    setOneTimeSecret({
      secret: data.secret.secret,
      fingerprint: data.secret.fingerprint,
      rotatedAt: data.secret.rotatedAt,
    })
  }

  function toggleEvent(evt: OutgoingWebhookEventType) {
    setForm((f) =>
      f.eventTypes.includes(evt)
        ? { ...f, eventTypes: f.eventTypes.filter((e) => e !== evt) }
        : { ...f, eventTypes: [...f.eventTypes, evt] },
    )
  }

  return (
    <section
      id="outgoing-webhooks"
      className="rounded-[var(--radius-lg)] border border-border bg-gray-0"
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <span className="rounded-[var(--radius-md)] bg-gray-100 p-2 text-gray-700">
          <Webhook className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-md font-semibold text-gray-900">出站 Webhook 订阅</h2>
          <p className="mt-1 text-sm text-gray-600">
            管理出站事件订阅与密钥。当前仅支持订阅配置，事件投递将在后续版本启用。
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-[var(--radius-md)] bg-info-bg p-3 text-xs text-info">
          订阅状态为「已配置」并不代表已投递事件--投递功能尚未启用（delivery_not_enabled）。
        </div>

        {oneTimeSecret && (
          <div className="rounded-[var(--radius-md)] border border-warning bg-warning-bg p-4">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div className="flex-1">
                <p className="font-medium text-warning">请立即保存一次性密钥</p>
                <p className="mt-1 text-xs text-warning">
                  密钥明文仅此一次显示，关闭后将无法再次获取。指纹：{oneTimeSecret.fingerprint}
                </p>
                <code className="mt-2 block break-all rounded-[var(--radius-sm)] bg-gray-0 p-2 font-mono text-xs text-gray-900">
                  {oneTimeSecret.secret}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setOneTimeSecret(null)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  我已保存
                </Button>
              </div>
            </div>
          </div>
        )}

        {canManage ? (
          <form
            onSubmit={handleCreate}
            className="space-y-3 rounded-[var(--radius-md)] border border-border p-4"
          >
            <div>
              <label className="text-sm font-medium text-gray-700">订阅名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例如：团队通知接收器"
                className="mt-1 w-full rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm focus-visible:border-primary-500 focus-visible:outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">目标 URL（HTTPS）</label>
              <input
                type="url"
                value={form.targetUrl}
                onChange={(e) => {
                  setForm((f) => ({ ...f, targetUrl: e.target.value }))
                  setUrlError(null)
                }}
                placeholder="https://hooks.example.com/incoming"
                className="mt-1 w-full rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm focus-visible:border-primary-500 focus-visible:outline-none"
              />
              {urlError && <p className="mt-1 text-xs text-danger">{urlError}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">订阅事件</label>
              <div className="mt-1 space-y-1">
                {OUTGOING_WEBHOOK_EVENT_WHITELIST.map((evt) => (
                  <label key={evt} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.eventTypes.includes(evt)}
                      onChange={() => toggleEvent(evt)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span>{OUTGOING_WEBHOOK_EVENT_METADATA[evt].label}</span>
                    <span className="font-mono text-xs text-gray-400">{evt}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={create.isPending} size="sm">
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              创建订阅
            </Button>
          </form>
        ) : (
          <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-gray-50 p-3 text-sm text-gray-600">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>你无权管理出站 webhook 订阅，以下为只读视图。</span>
          </div>
        )}

        {query.isLoading ? (
          <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-gray-100" />
        ) : subscriptions.length === 0 ? (
          <EmptyState title="暂无出站 webhook 订阅" description="创建第一个订阅以接收事件通知。" />
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {subscriptions.map((sub) => (
              <li key={sub.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{sub.name}</span>
                      <Badge variant={sub.status === 'active' ? 'success' : 'neutral'}>
                        {sub.status === 'active' ? '已配置' : '已停用'}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all text-xs text-gray-500">{sub.targetUrl}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {sub.eventTypes.map((evt) => (
                        <span
                          key={evt}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                        >
                          {isAllowedOutgoingWebhookEvent(evt)
                            ? OUTGOING_WEBHOOK_EVENT_METADATA[evt].label
                            : evt}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      密钥指纹：{sub.secretFingerprint}
                      {sub.lastRotatedAt &&
                        ` · 最近轮换：${new Date(sub.lastRotatedAt).toLocaleString()}`}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rotate.isPending}
                        onClick={() => handleRotate(sub.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        轮换密钥
                      </Button>
                      {sub.status === 'active' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deactivate.isPending}
                          onClick={() => deactivate.mutate(sub.id)}
                        >
                          停用
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
