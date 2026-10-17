'use client'

/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板面板（5.3 P1）。
 *
 * 展示内置模板列表，支持从模板创建订阅。
 * 权限控制：无 outgoing_webhook:manage 权限的用户只读（看到模板列表但不能创建）。
 * feature-off：模板只读始终可用，apply 在 feature-off 时返回不可用态。
 */
import * as React from 'react'
import { Copy, LayoutTemplate, ShieldAlert, Webhook } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useOutgoingWebhookTemplates,
  useApplyOutgoingWebhookTemplate,
} from '@/hooks/use-outgoing-webhook-templates-and-stats'
import { OUTGOING_WEBHOOK_MANAGE_PERMISSION } from '@/lib/api/outgoing-webhooks'
import { OUTGOING_WEBHOOK_EVENT_METADATA } from '@aiproj/types'
import type { OutgoingWebhookTemplateDto } from '@aiproj/types'

const STABILITY_BADGE: Record<string, { label: string; variant: 'info' | 'neutral' | 'warning' }> =
  {
    stable: { label: '稳定', variant: 'info' },
    disabled: { label: '已弃用', variant: 'neutral' },
    internal: { label: '内部', variant: 'warning' },
  }

function TemplateCard({
  template,
  onApply,
  applying,
}: {
  template: OutgoingWebhookTemplateDto
  onApply: () => void
  applying: boolean
}) {
  const badge = STABILITY_BADGE[template.stability] ?? {
    label: template.stability,
    variant: 'neutral' as const,
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 p-4 transition-shadow hover:shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">{template.name}</h4>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Badge variant="outline">v{template.version}</Badge>
          </div>
          <p className="text-sm leading-6 text-gray-600">{template.description}</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-1">
          {template.eventTypes.map((et) => (
            <Badge key={et} variant="info">
              {OUTGOING_WEBHOOK_EVENT_METADATA[et]?.label ?? et}
            </Badge>
          ))}
        </div>

        {template.headerPresets.length > 0 ? (
          <div className="text-xs text-gray-500">
            <span className="font-medium">预设 header：</span>
            {template.headerPresets.map((hp) => `${hp.name}: ${hp.value}`).join('、')}
          </div>
        ) : null}

        {template.display.recommendedUse ? (
          <p className="text-xs text-gray-500">
            <span className="font-medium">推荐：</span>
            {template.display.recommendedUse}
          </p>
        ) : null}

        {template.display.limitations ? (
          <p className="text-xs text-warning">
            <span className="font-medium">限制：</span>
            {template.display.limitations}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={onApply} loading={applying}>
          <Copy className="h-3.5 w-3.5" />
          使用此模板创建
        </Button>
      </div>
    </div>
  )
}

export function OutgoingWebhookTemplatesPanel() {
  const canManage = usePermissions().can(OUTGOING_WEBHOOK_MANAGE_PERMISSION)
  const query = useOutgoingWebhookTemplates()
  const apply = useApplyOutgoingWebhookTemplate()
  const [selectedTemplate, setSelectedTemplate] = React.useState<OutgoingWebhookTemplateDto | null>(
    null,
  )
  const [applyForm, setApplyForm] = React.useState({
    name: '',
    targetUrl: '',
  })
  const [urlError, setUrlError] = React.useState<string | null>(null)

  const templates = query.data?.data ?? []

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

  async function handleApply(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTemplate) return
    const err = validateUrl(applyForm.targetUrl)
    setUrlError(err)
    if (err) return
    if (!applyForm.name.trim()) return

    await apply.mutateAsync({
      templateId: selectedTemplate.id,
      name: applyForm.name.trim(),
      targetUrl: applyForm.targetUrl.trim(),
    })

    setSelectedTemplate(null)
    setApplyForm({ name: '', targetUrl: '' })
  }

  if (query.isLoading) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <LayoutTemplate className="h-4 w-4 text-gray-700" />
          <h2 className="text-md font-semibold text-gray-900">出站 Webhook 模板</h2>
        </div>
        <div className="p-4">
          <div className="h-20 animate-pulse rounded-[var(--radius-lg)] bg-gray-100" />
        </div>
      </section>
    )
  }

  if (query.isError) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <LayoutTemplate className="h-4 w-4 text-gray-700" />
          <h2 className="text-md font-semibold text-gray-900">出站 Webhook 模板</h2>
        </div>
        <div className="p-4">
          <EmptyState
            icon={ShieldAlert}
            title="模板加载失败"
            description="请检查网络或稍后重试。"
          />
        </div>
      </section>
    )
  }

  if (templates.length === 0) {
    return null
  }

  return (
    <>
      <section className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <span className="rounded-[var(--radius-md)] bg-gray-100 p-2 text-gray-700">
            <LayoutTemplate className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-md font-semibold text-gray-900">出站 Webhook 模板</h2>
            <p className="mt-1 text-sm text-gray-600">
              使用内置模板快速创建出站 webhook 订阅。模板仅预设事件类型和推荐配置，不含敏感信息。
            </p>
          </div>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onApply={() => {
                if (!canManage) return
                setSelectedTemplate(template)
                setApplyForm({
                  name: `[${template.name}]`,
                  targetUrl: '',
                })
                setUrlError(null)
              }}
              applying={apply.isPending && apply.variables?.templateId === template.id}
            />
          ))}
        </div>
      </section>

      <Dialog
        open={!!selectedTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTemplate(null)
            setUrlError(null)
          }
        }}
      >
        <DialogContent>
          {selectedTemplate ? (
            <>
              <DialogHeader>
                <DialogTitle>从模板创建：{selectedTemplate.name}</DialogTitle>
                <DialogDescription>
                  填写目标 URL 和名称，系统将使用模板预设的事件类型创建订阅。
                  密钥将在创建完成后一次性展示。
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleApply} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">订阅名称</label>
                  <input
                    type="text"
                    className="w-full rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 py-2 text-sm"
                    placeholder="输入订阅名称"
                    value={applyForm.name}
                    onChange={(e) => setApplyForm({ ...applyForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">目标 URL</label>
                  <input
                    type="url"
                    className="w-full rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 py-2 text-sm"
                    placeholder="https://example.com/webhook"
                    value={applyForm.targetUrl}
                    onChange={(e) => {
                      setApplyForm({ ...applyForm, targetUrl: e.target.value })
                      setUrlError(null)
                    }}
                    required
                  />
                  {urlError ? <p className="text-xs text-danger">{urlError}</p> : null}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">
                    预设事件类型：
                    {selectedTemplate.eventTypes.map((et) => (
                      <Badge key={et} variant="info" className="ml-1">
                        {OUTGOING_WEBHOOK_EVENT_METADATA[et]?.label ?? et}
                      </Badge>
                    ))}
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelectedTemplate(null)
                      setUrlError(null)
                    }}
                  >
                    取消
                  </Button>
                  <Button variant="primary" type="submit" loading={apply.isPending}>
                    <Webhook className="h-4 w-4" />
                    创建订阅
                  </Button>
                </div>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
