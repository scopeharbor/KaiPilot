'use client'

/**
 * v3-knowledge-memory-operating-layer —— Owning surface 接线组件（§6.3/§6.5/§6.7/§6.9）。
 *
 * 每个 surface 挂载**既有** owning 组件，运营层只做 prop 映射：
 *   - knowledge_review          → `KnowledgeReviewDrawer`（既有确认/转移入口）
 *   - copilot_memory_governance → `CopilotMemoryView` + 既有 `/ai/memory` 端点
 *   - skill_knowledge_authoring → `SkillKnowledgeAuthoringPanel`（既有 preview/commit）
 *   - retrieval_observation_detail → 只读观测投影（无 replay/repair 动作）
 *
 * 红线：
 * - 运营层**不复制**任何 confirm / transition / commit / delete 的状态机与权限判定，
 *   全部沿用 owning 组件与 owning API；
 * - 只传 scoped ref 与已由服务端解析出的 id，不传 callback/href/preview token；
 * - 任一 owning 组件抛错只污染自身边界，不影响运营队列。
 *
 * 注意：数据 prop **不能**叫 `ref`——React 把它当保留字，函数组件上会被丢弃并告警，
 * 组件里拿到的永远是 undefined。这里统一用 `scopedRefValue`。
 */
import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { KnowledgeReviewDrawer } from '@/components/knowledge/knowledge-review-drawer'
import { CopilotMemoryView } from '@/components/copilot/CopilotMemoryView'
import SkillKnowledgeAuthoringPanel from '@/components/compiler/skill-knowledge-authoring-panel'
import { copilotMemoryApi, copilotMemoryKeys } from '@/lib/api/copilot-memory'
import type {
  KnowledgeMemoryOperatingItem,
  RetrievalSignalOperatingProjection,
  SkillKnowledgeDraftOperatingProjection,
} from '@aiproj/types'

/** 从 `k-<id>` / `m-<id>` / `s-<id>` 取出数字 id；形态不符返回 null（fail closed）。 */
export function numericIdFromRef(scopedRefValue: string, prefix: 'k' | 'm' | 's'): number | null {
  const m = scopedRefValue.match(new RegExp(`^${prefix}-(\\d+)$`))
  return m ? Number(m[1]) : null
}

/**
 * 每个 owning 表面独立的错误边界。
 *
 * owning 组件抛错时只在本边界内退化为低敏提示，运营队列与其它 lane 不受影响
 * （spec：单一 surface 失败不得使整页伪装成 empty）。
 */
export class OwningSurfaceBoundary extends Component<
  { children: ReactNode; title: string },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // 刻意不记录 error.message：owning 组件的报错可能带正文/请求内容。
  }

  override render() {
    if (this.state.failed) {
      return (
        <Card>
          <CardContent>
            <div className="py-6 text-center text-sm space-y-2" data-testid="owning-surface-failed">
              <Badge variant="warning">owning 表面暂不可用</Badge>
              <div className="text-muted-foreground">
                {this.props.title} 加载失败。运营层不代为执行任何写入，请按既有流程重试。
              </div>
            </div>
          </CardContent>
        </Card>
      )
    }
    return <div data-testid="owning-surface-boundary">{this.props.children}</div>
  }
}

// ── knowledge_review ────────────────────────────────────────────────

/**
 * 挂载既有 `KnowledgeReviewDrawer`。
 * 确认/生命周期转移仍由该抽屉调用 owning API 完成，审计也归 owning capability。
 */
export function KnowledgeReviewSurface({
  scopedRefValue,
  onClose,
}: {
  scopedRefValue: string
  onClose: () => void
}) {
  const knowledgeId = numericIdFromRef(scopedRefValue, 'k')
  if (knowledgeId === null) {
    return <UnresolvableRef title="知识审查" />
  }
  return (
    <OwningSurfaceBoundary title="知识审查">
      <KnowledgeReviewDrawer knowledgeId={knowledgeId} open onClose={onClose} />
    </OwningSurfaceBoundary>
  )
}

// ── copilot_memory_governance ───────────────────────────────────────

/**
 * 挂载既有 `CopilotMemoryView`，并把动作接回既有 `/ai/memory` 端点。
 *
 * 只呈现当前 scopedRef 指向的那一条：运营层的入口是「处理这一条待办」，
 * 不是把整个记忆库搬过来。权限、审计、失效语义全部由 owning 端点执行。
 */
export function CopilotMemoryGovernanceSurface({
  owningEntryRef,
  onClose,
  onMutated,
}: {
  /** owning `/ai/memory` 用的 entryId；由服务端投影给出，不在前端从 scopedRef 反推。 */
  owningEntryRef: string
  onClose: () => void
  onMutated?: () => void
}) {
  const queryClient = useQueryClient()
  const params = {}
  const list = useQuery({
    queryKey: copilotMemoryKeys.list(params),
    queryFn: () => copilotMemoryApi.list(params),
  })

  const afterMutation = () => {
    queryClient.invalidateQueries({ queryKey: copilotMemoryKeys.all })
    // 权威状态变了才通知运营层重算 attention——不是打开面板就算已处理。
    onMutated?.()
  }
  const confirm = useMutation({
    mutationFn: (entryId: string) => copilotMemoryApi.confirm(entryId),
    onSuccess: afterMutation,
  })
  const ignore = useMutation({
    mutationFn: (entryId: string) => copilotMemoryApi.ignore(entryId),
    onSuccess: afterMutation,
  })
  const invalidate = useMutation({
    mutationFn: (entryId: string) => copilotMemoryApi.invalidate(entryId),
    onSuccess: afterMutation,
  })
  const remove = useMutation({
    mutationFn: (entryId: string) => copilotMemoryApi.remove(entryId),
    onSuccess: afterMutation,
  })

  if (list.isLoading) {
    return <SurfaceLoading label="记忆治理" />
  }

  // 只呈现本条待办对应的记忆。owning 列表里找不到 = 已删除/已失权：
  // 如实显示不可用，不退回到「展示整个记忆库」。
  const memories = (list.data ?? []).filter((m) => m.id === owningEntryRef)
  if (memories.length === 0) {
    return <UnresolvableRef title="Copilot 记忆治理" />
  }

  return (
    <OwningSurfaceBoundary title="Copilot 记忆治理">
      <CopilotMemoryView
        memories={memories}
        loading={false}
        onConfirm={(id) => confirm.mutate(id)}
        onIgnore={(id) => ignore.mutate(id)}
        onInvalidate={(id) => invalidate.mutate(id)}
        onDelete={(id) => remove.mutate(id)}
      />
      <CloseRow onClose={onClose} />
    </OwningSurfaceBoundary>
  )
}

// ── skill_knowledge_authoring ───────────────────────────────────────

/**
 * 挂载既有 `SkillKnowledgeAuthoringPanel`。
 *
 * 面板要的是 **skillId**，而运营 scopedRef 是 draft id——所以取服务端投影里的
 * `skillId`，不在前端从 draft ref 反推。base 过期时面板自身要求重新 preview，
 * 运营层不代改草稿。
 */
export function SkillKnowledgeAuthoringSurface({
  item,
  onClose,
}: {
  item: SkillKnowledgeDraftOperatingProjection
  onClose: () => void
}) {
  return (
    <OwningSurfaceBoundary title="Skill 知识草稿">
      {item.baseStale && (
        <div className="mb-2 text-xs" data-testid="skill-base-stale-notice">
          <Badge variant="warning">base 版本已过时</Badge>
          <span className="ml-2 text-muted-foreground">
            需在 owning 流程内重新 preview 后才能 commit；运营层不改写草稿。
          </span>
        </div>
      )}
      <SkillKnowledgeAuthoringPanel skillId={item.skillId} enabled />
      <CloseRow onClose={onClose} />
    </OwningSurfaceBoundary>
  )
}

// ── retrieval_observation_detail ────────────────────────────────────

/**
 * 检索观测只读详情。
 *
 * 只渲染服务端已聚合好的窗口/覆盖度/计数/范围/降级；**没有**重放、补采样或
 * 修复动作——打开或刷新本表面不得触发任何检索、模型或网络调用。
 */
export function RetrievalObservationSurface({
  item,
  onClose,
}: {
  item: RetrievalSignalOperatingProjection
  onClose: () => void
}) {
  const rows: readonly { label: string; value: string }[] = [
    { label: '来源类型', value: item.retrievalKind },
    { label: '查询类别', value: item.queryCategory },
    { label: '窗口起', value: item.windowStart },
    { label: '窗口止', value: item.windowEnd },
    { label: '样本数', value: String(item.sampleCount) },
    { label: '零结果率', value: `${Math.round(item.zeroResultRate * 100)}%` },
    { label: '被截断', value: item.truncated ? '是' : '否' },
    { label: '权限排除计数', value: String(item.permissionExcludedCount) },
    { label: '降级', value: item.degraded ? '是' : '否' },
  ]
  return (
    <OwningSurfaceBoundary title="检索观测详情">
      <div className="space-y-2" data-testid="retrieval-observation-surface">
        <p className="text-xs text-muted-foreground">
          只读观测聚合。零结果只代表这段窗口内没有命中，**不代表组织里没有该类内容**；
          本表面不发起检索、不重放查询、不做自动修复。
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {rows.map((r) => (
            <React.Fragment key={r.label}>
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd>{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
        <CloseRow onClose={onClose} />
      </div>
    </OwningSurfaceBoundary>
  )
}

// ── 共用小件 ────────────────────────────────────────────────────────

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-3">
      <button type="button" className="text-xs text-primary underline" onClick={onClose}>
        关闭并返回队列
      </button>
    </div>
  )
}

function SurfaceLoading({ label }: { label: string }) {
  return (
    <Card>
      <CardContent>
        <div className="flex justify-center py-8" aria-label={`${label}-loading`}>
          <LoadingSpinner />
        </div>
      </CardContent>
    </Card>
  )
}

function UnresolvableRef({ title }: { title: string }) {
  return (
    <Card>
      <CardContent>
        <div className="py-6 text-center text-sm space-y-2" data-testid="surface-unresolvable-ref">
          <Badge variant="warning">对象不可用</Badge>
          <div className="text-muted-foreground">
            {title} 无法解析该对象（可能已删除、失权或不再 current）。
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** 运营 item 的窄化辅助（host 用来给 surface 传对的 variant）。 */
export function asSkillDraft(
  item: KnowledgeMemoryOperatingItem,
): SkillKnowledgeDraftOperatingProjection | null {
  return item.kind === 'skill_knowledge_draft' ? item : null
}

export function asRetrievalSignal(
  item: KnowledgeMemoryOperatingItem,
): RetrievalSignalOperatingProjection | null {
  return item.kind === 'retrieval_signal' ? item : null
}
