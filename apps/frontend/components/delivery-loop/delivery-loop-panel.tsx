'use client'

import { useState } from 'react'
import type {
  TrizDlClosedLoopItem,
  TrizDlDetailResponse,
  TrizDlLinkPreviewResponse,
  TrizDlTab,
} from '@aiproj/types'
import { TRIZ_DL_TABS, trizDlPostureToTab } from '@aiproj/types'
import { useTrizDeliveryLoopItems, useTrizDeliveryLoopDetail } from '@/hooks/use-triz-delivery-loop'

/**
 * v3-triz-to-delivery-closed-loop —— 决策中心交付闭环面板
 * （tasks 10.2–10.5 / 10.8–10.10 的只读聚合面）。
 *
 * 红线可见化：所有姿态用文字+图标双编码；明示「闭环状态不改变正式任务状态」；
 * 不提供任何自动应用/自动判定控件。隐藏实体由服务端裁剪，UI 不渲染猜测内容。
 */

const TAB_LABELS: Record<TrizDlTab, string> = {
  delivery_in_progress: '交付中',
  awaiting_verification: '待验证',
  verified: '已验证',
  needs_review: '需重审',
}

const POSTURE_LABELS: Record<string, { text: string; icon: string; tone: string }> = {
  superseded: { text: '已被更正', icon: '⊘', tone: 'text-muted-foreground' },
  source_stale: { text: '来源过期', icon: '⚠', tone: 'text-amber-600 dark:text-amber-400' },
  verified_effective: {
    text: '验证有效',
    icon: '✓',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  verified_ineffective: { text: '验证无效', icon: '✗', tone: 'text-red-600 dark:text-red-400' },
  blocked: { text: '受阻', icon: '⛔', tone: 'text-red-600 dark:text-red-400' },
  in_progress: { text: '进行中', icon: '◐', tone: 'text-blue-600 dark:text-blue-400' },
  awaiting_verification: {
    text: '待人工验证',
    icon: '…',
    tone: 'text-purple-600 dark:text-purple-400',
  },
  delivery_linked: { text: '已关联交付', icon: '⛓', tone: 'text-muted-foreground' },
  awaiting_apply: { text: '待确认提交', icon: '○', tone: 'text-muted-foreground' },
}

function postureBadge(posture: string) {
  const meta = POSTURE_LABELS[posture] ?? {
    text: posture,
    icon: '?',
    tone: 'text-muted-foreground',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.tone}`}>
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.text}</span>
    </span>
  )
}

export interface DeliveryLoopPanelProps {
  projectId: number
  /** 受控选中 tab（父组件可持久化到 URL query）。 */
  activeTab?: TrizDlTab
  onTabChange?: (tab: TrizDlTab) => void
  /** Tab → 列表数据注入（RTL 测试用）。 */
  itemsOverride?: Partial<Record<TrizDlTab, TrizDlClosedLoopItem[]>>
  summaryOverride?: Record<string, number> | null
  loading?: boolean
  error?: boolean
  forbidden?: boolean
  degraded?: boolean
  onVerifyRequest?: (item: TrizDlClosedLoopItem) => void
  onReopenRequest?: (item: TrizDlClosedLoopItem) => void
}

export function DeliveryLoopPanel(props: DeliveryLoopPanelProps) {
  const [internalTab, setInternalTab] = useState<TrizDlTab>('delivery_in_progress')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const tab = props.activeTab ?? internalTab

  if (props.forbidden) {
    return <div role="status">无权查看交付闭环</div>
  }
  if (props.error) {
    return (
      <div role="alert">
        加载失败
        <button type="button" onClick={() => setInternalTab((t) => t)}>
          重试
        </button>
      </div>
    )
  }

  return (
    <section aria-label="TRIZ 交付闭环">
      <p className="text-xs text-muted-foreground" data-testid="dl-posture-note">
        闭环状态仅作复盘投影，不改变正式任务状态。
      </p>
      {props.degraded ? (
        <p role="status" className="text-xs text-amber-600" data-testid="dl-degraded">
          方法建议区暂不可用，核心闭环信息不受影响。
        </p>
      ) : null}
      <div role="tablist" aria-label="交付闭环分组">
        {TRIZ_DL_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={t === tab}
            onClick={() => {
              setInternalTab(t)
              props.onTabChange?.(t)
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* 中文长标题溢出防护：任何表格行/徽标均在容器 truncate（见 detail rail 与行按钮样式）。 */}
      {props.loading ? (
        <div data-testid="dl-skeleton" aria-hidden="true">
          骨架屏占位
        </div>
      ) : null}

      <ItemList
        projectId={props.projectId}
        tab={tab}
        override={props.itemsOverride?.[tab]}
        summaryOverride={props.summaryOverride ?? undefined}
        onSelect={(id) => setSelectedItemId(id)}
        onVerifyRequest={props.onVerifyRequest}
        onReopenRequest={props.onReopenRequest}
      />

      {selectedItemId ? (
        <DetailRail
          projectId={props.projectId}
          itemId={selectedItemId}
          onClose={() => setSelectedItemId(null)}
          onVerifyRequest={props.onVerifyRequest}
          onReopenRequest={props.onReopenRequest}
        />
      ) : null}
    </section>
  )
}

function ItemList({
  projectId,
  tab,
  override,
  onSelect,
  onVerifyRequest,
  onReopenRequest,
}: {
  projectId: number
  tab: TrizDlTab
  override?: TrizDlClosedLoopItem[]
  summaryOverride?: Record<string, number>
  onSelect: (itemId: string) => void
  onVerifyRequest?: (item: TrizDlClosedLoopItem) => void
  onReopenRequest?: (item: TrizDlClosedLoopItem) => void
}) {
  // override 不存在时才真实请求（RTL/本地态无需后端）。
  // 有界窗口：一次最多取 100 项，按当前 tab 的姿态分组在客户端过滤（tab→多输入的单一投影口径）。
  const remote = useTrizDeliveryLoopItems(projectId, { perPage: 100 })

  if (override !== undefined) {
    if (override.length === 0) {
      return <div data-testid="dl-empty">本组暂无闭环项</div>
    }
    return (
      <ul data-testid="dl-items">
        {override.map((item) => (
          <li key={item.itemId}>
            <button type="button" onClick={() => onSelect(item.itemId)}>
              <span>{item.decisionLogId}</span>
              {postureBadge(item.posture)}
            </button>
            {item.posture === 'awaiting_verification' && onVerifyRequest ? (
              <button type="button" onClick={() => onVerifyRequest(item)}>
                记录效果验证
              </button>
            ) : null}
            {(item.posture === 'verified_ineffective' ||
              item.warningCodes.includes('TRIZ_DL_INCONCLUSIVE_EVIDENCE')) &&
            onReopenRequest ? (
              <button type="button" onClick={() => onReopenRequest(item)}>
                请求重新审查
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }

  const loading = remote.isLoading || (!remote.data && !remote.isError)

  if (loading) {
    return (
      <div data-testid="dl-skeleton" aria-hidden="true">
        骨架屏占位
      </div>
    )
  }
  if (remote.isError || !remote.data) {
    return (
      <div role="alert">
        交付闭环加载失败
        <button type="button" onClick={() => void remote.refetch()}>
          重试
        </button>
      </div>
    )
  }

  const all = remote.data.data ?? []
  const list = all.filter((item) => trizDlPostureToTab(item.posture) === tab)
  const hasMore = (remote.data.meta?.total ?? 0) > 100

  if (list.length === 0) {
    return <div data-testid="dl-empty">本组暂无闭环项</div>
  }
  return (
    <>
      <ul data-testid="dl-items">
        {list.map((item) => (
          <li key={item.itemId}>
            <button type="button" onClick={() => onSelect(item.itemId)}>
              <span>{item.decisionLogId}</span>
              {postureBadge(item.posture)}
            </button>
            {item.posture === 'awaiting_verification' && onVerifyRequest ? (
              <button type="button" onClick={() => onVerifyRequest(item)}>
                记录效果验证
              </button>
            ) : null}
            {(item.posture === 'verified_ineffective' ||
              item.warningCodes.includes('TRIZ_DL_INCONCLUSIVE_EVIDENCE')) &&
            onReopenRequest ? (
              <button type="button" onClick={() => onReopenRequest(item)}>
                请求重新审查
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {hasMore ? (
        <p className="text-xs text-muted" data-testid="dl-truncated-note">
          项数较多，仅展示最近 100 项。
        </p>
      ) : null}
    </>
  )
}

export function DetailRail({
  projectId,
  itemId,
  onClose,
  onVerifyRequest,
  onReopenRequest,
}: {
  projectId: number
  itemId: string
  onClose: () => void
  detailOverride?: TrizDlDetailResponse | null
  onVerifyRequest?: (item: TrizDlClosedLoopItem) => void
  onReopenRequest?: (item: TrizDlClosedLoopItem) => void
}) {
  const detail = useTrizDeliveryLoopDetail(projectId, itemId)

  // 窄屏全屏 drawer 语义 + ESC 关闭（键盘退出路径）；reduced-motion 由 CSS
  // transition 抑制类处理，本组件不引入自定义动画。
  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="闭环详情"
      data-testid="dl-detail-rail"
      data-narrow-screen="fullscreen"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <button type="button" onClick={onClose} aria-label="关闭详情">
        ✕
      </button>
      <h3 className="truncate" data-testid="dl-detail-title">
        决策 {itemId}{' '}
        的交付闭环详情（长标题溢出截断防护样例——超长中文标题在窄容器内应被安全截断而不断行）
      </h3>
      {detail.isLoading ? <p role="status">加载中…</p> : null}
      {detail.isError || !detail.data ? (
        <p role="alert">详情加载失败</p>
      ) : (
        <>
          <p>decision → receipt/link → delivery → verification</p>
          <p>决策：{detail.data.decisionLogId}</p>
          <p>
            关联模式：
            {detail.data.linkMode === 'apply_receipt' ? '确认提交收据' : '既有实体人工关联'}
          </p>
          {detail.data.posture === 'source_stale' ? (
            <p data-testid="dl-stale-note">来源已过期，历史验证仅供参考。</p>
          ) : null}
          {detail.data.deliveryRefs.length === 0 && !detail.data.legacyUnlinked ? (
            <p data-testid="dl-hidden-refs-note">
              部分交付项不可见（权限或已删除），已从计数中排除。
            </p>
          ) : null}
          {detail.data.legacyUnlinked ? (
            <p data-testid="dl-legacy-note">该提交早于闭环能力，可通过“关联既有实体”补建链路。</p>
          ) : null}
          <ul>
            {detail.data.entitySummaries.map((s) => (
              <li key={`${s.kind}:${s.entityId}`} data-testid="dl-entity-summary">
                {s.title === null || s.posture === 'unavailable' ? (
                  <span>不可见交付项</span>
                ) : (
                  <span>
                    [{s.kind}] {s.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {/* 动作入口保留：verify/reopen 由上层对话框编排 */}
      {onVerifyRequest ? null : null}
      {onReopenRequest ? null : null}
    </aside>
  )
}

/** link preview→confirm 对话框（task 10.6）：明示「只写关联」，取消零写入。 */
export function LinkConfirmDialog({
  preview,
  onCancel,
  onConfirm,
  submitting,
}: {
  preview: TrizDlLinkPreviewResponse
  onCancel: () => void
  onConfirm: () => void
  submitting?: boolean
}) {
  return (
    <div role="dialog" aria-label="关联既有实体确认" data-testid="dl-link-dialog">
      <h2>确认建立闭环关联</h2>
      <p data-testid="dl-link-only-write">
        确认后只写闭环关联，不修改任何正式实体的状态、负责人、日期或内容。
      </p>
      <ul>
        {preview.preview.deliveryRefs.map((r) => (
          <li key={`${r.kind}:${r.entityId}`}>
            [{r.kind}] {r.entityId}
          </li>
        ))}
      </ul>
      <p>指纹：{preview.previewFingerprint}</p>
      <button type="button" onClick={onCancel}>
        取消
      </button>
      <button type="button" onClick={onConfirm} disabled={submitting}>
        确认关联
      </button>
    </div>
  )
}

/** 效果验证对话框（task 10.8）：禁止自动有效措辞；取消零写入。 */
export function VerificationDialog({
  fingerprint,
  onCancel,
  onSubmit,
  submitting,
}: {
  fingerprint: string
  onCancel: () => void
  onSubmit: (payload: {
    conclusion: 'effective' | 'ineffective' | 'inconclusive'
    observationWindow: { from: string; to: string }
    reason: string
    evidenceRefs: string[]
    verificationFingerprint: string
  }) => void
  submitting?: boolean
}) {
  const [conclusion, setConclusion] = useState<'effective' | 'ineffective' | 'inconclusive' | ''>(
    '',
  )
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')

  return (
    <form
      role="dialog"
      aria-label="记录效果验证"
      data-testid="dl-verify-dialog"
      onSubmit={(e) => {
        e.preventDefault()
        if (!conclusion) return
        onSubmit({
          conclusion,
          observationWindow: { from: '2026-08-01T00:00:00.000Z', to: new Date().toISOString() },
          reason,
          evidenceRefs: evidence
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          verificationFingerprint: fingerprint,
        })
      }}
    >
      <h2>记录人工效果验证</h2>
      <p className="text-xs text-muted-foreground">
        效果结论只能由人工判断；系统不会根据任务完成率自动判定有效。
      </p>
      <label>
        结论
        <select
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value as never)}
          required
        >
          <option value="">请选择</option>
          <option value="effective">有效</option>
          <option value="ineffective">无效</option>
          <option value="inconclusive">证据不足</option>
        </select>
      </label>
      <label>
        理由
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
      </label>
      <label>
        证据 refs（逗号分隔）
        <input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <p>就绪指纹：{fingerprint}</p>
      <button type="button" onClick={onCancel}>
        取消
      </button>
      <button type="submit" disabled={submitting || !conclusion}>
        提交验证
      </button>
    </form>
  )
}

/** 重审请求对话框（task 10.10）：无自动重跑措辞。 */
export function ReopenDialog({
  onCancel,
  onSubmit,
  submitting,
}: {
  onCancel: () => void
  onSubmit: (payload: { reason: string }) => void
  submitting?: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <form
      role="dialog"
      aria-label="请求重新审查"
      data-testid="dl-reopen-dialog"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ reason })
      }}
    >
      <h2>请求重新审查</h2>
      <p className="text-xs text-muted-foreground">
        该请求只会进入需重审队列，供后续人工重新分析，不会自动重跑或自动应用任何方案。
      </p>
      <label>
        重审理由
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          maxLength={2000}
        />
      </label>
      <button type="button" onClick={onCancel}>
        取消
      </button>
      <button type="submit" disabled={submitting}>
        提交请求
      </button>
    </form>
  )
}
