'use client'

/**
 * v3-knowledge-memory-operating-layer —— Owning surface host（§6.1）。
 *
 * 4 个 surface 的封闭 mapping（编译期 + 运行时 fail-closed）：
 *   - knowledge_review         → `<KnowledgeReviewDrawer>`（既有 L1-L4 审查）
 *   - copilot_memory_governance→ `<CopilotMemoryGovernancePanel>`（既有 Copilot 记忆治理）
 *   - skill_knowledge_authoring→ `<SkillKnowledgeAuthoringPanel>`（既有 Skill 创作）
 *   - retrieval_observation_detail → `<RetrievalObservationDetailPanel>`（既有检索观测详情）
 *
 * 关键约束：
 * - 客户端 descriptor.enabled 不能被信任；本 host 显式调
 *   `useKnowledgeMemoryOperatingSurface` 取服务端权威 enabled 状态
 *   （§4.9 / §6.1）；
 * - unknown surface 渲染为低敏「不可用」态，不抛错（§5.13）；
 * - safe-return context 与 routeKey 不进入 URL，仅用于 props 传递。
 */
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import {
  describeOperatingError,
  useKnowledgeMemoryOperatingSurface,
} from '@/hooks/use-knowledge-memory-operating'
import {
  CopilotMemoryGovernanceSurface,
  KnowledgeReviewSurface,
  RetrievalObservationSurface,
  SkillKnowledgeAuthoringSurface,
  asRetrievalSignal,
  asSkillDraft,
} from './OwningSurfacePanels'
import type {
  KnowledgeMemoryOperatingDetail,
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingSurface,
  OperatingOwningSurfaceDescriptor,
} from '@aiproj/types'

const ALL_SURFACES: readonly KnowledgeMemoryOperatingSurface[] = [
  'knowledge_review',
  'copilot_memory_governance',
  'skill_knowledge_authoring',
  'retrieval_observation_detail',
]

const SURFACE_LABEL: Record<KnowledgeMemoryOperatingSurface, string> = {
  knowledge_review: '知识审查',
  copilot_memory_governance: 'Copilot 记忆治理',
  skill_knowledge_authoring: 'Skill 知识草稿',
  retrieval_observation_detail: '检索观测详情',
}

const SURFACE_DISABLE_REASON_LABEL: Record<string, string> = {
  plugin_disabled: '插件已停用',
  plugin_uninstalled: '插件已卸载',
  stale_base_version: '基线版本已过时',
  cross_tenant_reference: '跨租引用',
  inference_only: '记忆恒为 inference',
  eval_only: 'L3 仅供 Eval',
  missing_review_permission: '无审查权限',
  disabled_in_config: '配置禁用',
  unknown: '未知',
}

export function OwningSurfaceHost({
  detail,
  organizationId,
  onClose,
  onMutated,
}: {
  detail: KnowledgeMemoryOperatingDetail
  organizationId: number | null
  onClose: () => void
  /** owning 写入成功后回调；只做精确失效，不在本地把 attention 标成已解决。 */
  onMutated?: (surface: KnowledgeMemoryOperatingSurface) => void
}) {
  const surfaces = detail.surfaces
  const [active, setActive] = useState<KnowledgeMemoryOperatingSurface | null>(
    surfaces[0]?.surface ?? null,
  )

  const enabled = active !== null && surfaces.some((s) => s.surface === active && s.enabled)
  const scopeKey = `${detail.scopedRef.kind}:${detail.scopedRef.ref}:${active ?? 'none'}`

  return (
    <div className="space-y-3" data-testid="owning-surface-host">
      <SurfaceTabs surfaces={surfaces} active={active} onChange={setActive} />
      {active && enabled ? (
        <ActiveSurface
          key={scopeKey}
          item={detail.item}
          surface={active}
          organizationId={organizationId}
          onClose={onClose}
          onMutated={() => onMutated?.(active)}
        />
      ) : (
        <SurfaceUnavailable
          surface={active}
          descriptor={surfaces.find((s) => s.surface === active)}
        />
      )}
    </div>
  )
}

function SurfaceTabs({
  surfaces,
  active,
  onChange,
}: {
  surfaces: readonly OperatingOwningSurfaceDescriptor[]
  active: KnowledgeMemoryOperatingSurface | null
  onChange: (s: KnowledgeMemoryOperatingSurface) => void
}) {
  if (surfaces.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        此对象当前没有可用的 owning surface（可能被禁用、跨租或 L3 评估中）。
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="owning-surface-tabs">
      {ALL_SURFACES.map((s) => {
        const desc = surfaces.find((d) => d.surface === s)
        if (!desc) return null
        const isActive = active === s
        return (
          <button
            type="button"
            key={s}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(s)}
            className={`rounded border px-2 py-1 text-xs ${isActive ? 'border-primary bg-primary-50/40' : 'hover:bg-accent'}`}
          >
            {SURFACE_LABEL[s]}
            {desc.enabled ? null : <Badge variant="warning">disabled</Badge>}
          </button>
        )
      })}
    </div>
  )
}

function ActiveSurface({
  item,
  surface,
  organizationId,
  onClose,
  onMutated,
}: {
  item: KnowledgeMemoryOperatingItem
  surface: KnowledgeMemoryOperatingSurface
  organizationId: number | null
  onClose: () => void
  onMutated?: () => void
}) {
  // 关键：服务端权威 enabled 复核（§4.9 / §6.1）—— 客户端 descriptor 不能伪造
  const { data, isLoading, error } = useKnowledgeMemoryOperatingSurface({
    organizationId,
    kind: item.kind,
    ref: item.scopedRef.ref,
    surface,
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex justify-center py-8" aria-label="surface-loading">
            <LoadingSpinner />
          </div>
        </CardContent>
      </Card>
    )
  }
  if (error) {
    const e = describeOperatingError(error)
    return (
      <Card>
        <CardContent>
          <div className="text-sm py-6 text-center space-y-2">
            <Badge variant="danger">{e.code}</Badge>
            <div className="text-muted-foreground">{e.message}</div>
            <Button size="sm" variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }
  if (!data?.data) {
    return <SurfaceUnavailable surface={surface} descriptor={null} />
  }
  if (!data.data.enabled) {
    return (
      <SurfaceUnavailable
        surface={surface}
        descriptor={{
          ...data.data,
          enabled: false,
          disableReason: data.data.disableReason ?? 'unknown',
        }}
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{SURFACE_LABEL[surface]}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.data.safeReturnContext}（authority: {data.data.authorityOwner}）
        </p>
      </CardHeader>
      <CardContent>
        <SurfaceBody item={item} surface={surface} onClose={onClose} onMutated={onMutated} />
      </CardContent>
    </Card>
  )
}

function SurfaceBody({
  item,
  surface,
  onClose,
  onMutated,
}: {
  item: KnowledgeMemoryOperatingItem
  surface: KnowledgeMemoryOperatingSurface
  onClose: () => void
  onMutated?: () => void
}) {
  // 编译期封闭 mapping：四个 surface 各挂既有 owning 组件；
  // kind 与 surface 不匹配时 fail closed，不「尽量渲染点什么」。
  if (surface === 'knowledge_review') {
    if (item.kind !== 'knowledge_item') return <SurfaceMismatch />
    return <KnowledgeReviewSurface scopedRefValue={item.scopedRef.ref} onClose={onClose} />
  }
  if (surface === 'copilot_memory_governance') {
    if (item.kind !== 'copilot_memory') return <SurfaceMismatch />
    return (
      <CopilotMemoryGovernanceSurface
        owningEntryRef={item.owningEntryRef}
        onClose={onClose}
        onMutated={onMutated}
      />
    )
  }
  if (surface === 'skill_knowledge_authoring') {
    const draft = asSkillDraft(item)
    if (!draft) return <SurfaceMismatch />
    return <SkillKnowledgeAuthoringSurface item={draft} onClose={onClose} />
  }
  if (surface === 'retrieval_observation_detail') {
    const signal = asRetrievalSignal(item)
    if (!signal) return <SurfaceMismatch />
    return <RetrievalObservationSurface item={signal} onClose={onClose} />
  }
  // 封闭词表之外的 surface 一律不渲染（§6.1 unknown surface fail closed）
  return <SurfaceMismatch />
}

function SurfaceMismatch() {
  return (
    <Card>
      <CardContent>
        <div className="py-6 text-center text-sm space-y-2" data-testid="surface-mismatch">
          <Badge variant="warning">不可用</Badge>
          <div className="text-muted-foreground">
            该对象类型与请求的 owning 表面不匹配，已按 fail-closed 处理。
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SurfaceUnavailable({
  surface,
  descriptor,
}: {
  surface: KnowledgeMemoryOperatingSurface | null
  descriptor: OperatingOwningSurfaceDescriptor | null | undefined
}) {
  if (!surface) {
    return (
      <Card>
        <CardContent>
          <div className="text-sm py-6 text-muted-foreground text-center">
            未选择 owning surface。
          </div>
        </CardContent>
      </Card>
    )
  }
  const reason = descriptor?.disableReason ?? 'unknown'
  return (
    <Card>
      <CardContent>
        <div className="text-sm py-6 text-center space-y-2" data-testid="surface-unavailable">
          <Badge variant="warning">不可用</Badge>
          <div className="text-muted-foreground">
            {SURFACE_LABEL[surface]} 当前不可用：
            {SURFACE_DISABLE_REASON_LABEL[reason] ?? reason}。
          </div>
          <p className="text-[10px] text-muted-foreground">
            运营层不绕过此限制；请按既有流程在 owning capability 内重试。
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
