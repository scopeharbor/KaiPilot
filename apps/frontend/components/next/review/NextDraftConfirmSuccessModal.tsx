'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  BadgeCheck,
  Flag,
  GitBranch,
  Layers,
  ListChecks,
  ShieldAlert,
} from 'lucide-react'
import { clearDraftProgressCursor } from '@/lib/ai-draft/progress-cursor'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// 纯函数：审计回执时间戳（本地时间，可确定性单测）
// ---------------------------------------------------------------------------

/** 审计回执时间戳 → `YYYY-MM-DD HH:mm:ss`（本地时区，零依赖）。 */
export function formatAuditTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

// ---------------------------------------------------------------------------
// 组件：转正成功视窗
// ---------------------------------------------------------------------------

/** 5 项正式落库计数卡片（spec「转正成功呈现与项目主页导航」：WBS/任务/依赖/里程碑/风险）。 */
const CARD_ICONS = {
  wbsNodes: Layers,
  tasks: ListChecks,
  dependencies: GitBranch,
  milestones: Flag,
  risks: ShieldAlert,
} as const

const COUNT_CARDS: ReadonlyArray<{ key: keyof typeof CARD_ICONS; label: string }> = [
  { key: 'wbsNodes', label: 'WBS 节点' },
  { key: 'tasks', label: '任务' },
  { key: 'dependencies', label: '依赖关系' },
  { key: 'milestones', label: '里程碑' },
  { key: 'risks', label: '风险条目' },
]

/**
 * 转正成功视窗（design D7 / tasks 3.4 / spec「转正成功呈现与项目主页导航」）。
 *
 * - 暗黑仪器风成功视窗：绿色盾牌对勾 + 主标题「项目已正式转正落库」+ `#PROJ-{projectId}` 编号徽章；
 * - 5 卡片计数仪表盘（WBS/任务/依赖/里程碑/风险）消费 `confirmResponse.createdCounts`；
 * - 「进入项目主页」主行动：导航前调用 `clearDraftProgressCursor()` 清理本地恢复游标
 *   （防浏览器后退重复触发转正），导航至新轨项目空间 `/next/projects/:id`
 *   （v3-ui-next-project-space 已接管新轨单项目空间）；
 * - 底部发丝线审计回执（操作人/导入时间/事务标识）呼应服务端 `AI_DRAFT_CONFIRMED` 审计日志；
 * - 严格不展示未脱敏原始 Prompt 与完整草案 JSON（RL-12）。
 */
export function NextDraftConfirmSuccessModal() {
  const router = useRouter()
  const confirmResponse = useAiProjectDraftStore((state) => state.confirmResponse)
  const draft = useAiProjectDraftStore((state) => state.draft)
  const user = useAuthStore((state) => state.user)

  // 终态视窗：父层仅在 draftStatus === 'confirmed' 时挂载本弹层，故 open 跟随 confirmResponse。
  // 该视窗没有关闭路径（NextDraftReviewPanel 既有语义：成功视窗只走显式按钮行动，
  // ESC 不替代已完成的人工确认），故 canClose 恒假、onClose 不产生任何副作用。
  const successDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: successDialogRef,
    open: confirmResponse !== null,
    onClose: () => {
      /* 终态视窗无关闭动作 */
    },
    canClose: () => false,
  })

  if (confirmResponse === null) return null

  const projectId = confirmResponse.projectId
  const counts = confirmResponse.createdCounts
  const projectName = draft?.charter.title.value ?? '—'
  const operator = user?.fullName ?? user?.email ?? '—'
  const receivedAt = formatAuditTimestamp(new Date())

  function handleEnterProject() {
    clearDraftProgressCursor()
    router.push(`/next/projects/${projectId}`)
  }

  // 已转正的草案留在会话里会让 /next/create 一直回到这张视窗；再起一个就先清空。
  function handleStartAnother() {
    clearDraftProgressCursor()
    useAiProjectDraftStore.getState().restart()
    window.history.replaceState(null, '', window.location.pathname)
  }

  return (
    <div
      data-success-modal-backdrop
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="项目已正式转正落库"
        data-confirm-success-modal
        ref={successDialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] shadow-none"
      >
        <header className="flex flex-col items-center gap-2.5 border-b border-[var(--nx-border-hairline)] px-6 py-5 text-center">
          <span
            data-success-shield
            className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--nx-status-success)]/50"
            style={{ color: 'var(--nx-status-success)' }}
          >
            <BadgeCheck className="h-6 w-6" aria-hidden />
          </span>
          <h3 className="text-base font-semibold text-[var(--nx-text-primary)]">
            项目已正式转正落库
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span data-success-project-name className="text-sm text-[var(--nx-text-secondary)]">
              {projectName}
            </span>
            <span
              data-proj-number
              className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2 py-0.5 font-mono text-xs font-semibold text-[var(--nx-accent)]"
            >
              #PROJ-{projectId}
            </span>
          </div>
        </header>

        <div className="px-6 py-4">
          <p data-count-heading className="mb-2.5 text-xs text-[var(--nx-text-muted)]">
            正式落库实体计数
          </p>
          <div className="grid grid-cols-5 gap-2">
            {COUNT_CARDS.map((card) => {
              const Icon = CARD_ICONS[card.key]
              return (
                <div
                  key={card.key}
                  data-count-card
                  data-count-key={card.key}
                  className="flex flex-col items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 py-2.5"
                >
                  <Icon className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
                  <span
                    data-count-card-value
                    className="font-mono text-base font-semibold text-[var(--nx-text-primary)]"
                  >
                    {counts[card.key]}
                  </span>
                  <span className="text-[10px] text-[var(--nx-text-muted)]">{card.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <footer className="flex flex-col items-center gap-3 border-t border-[var(--nx-border-hairline)] px-6 py-4">
          <button
            type="button"
            data-enter-project
            onClick={handleEnterProject}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-6 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)]"
          >
            进入项目主页
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            data-start-another
            onClick={handleStartAnother}
            className="text-xs text-[var(--nx-text-secondary)] underline-offset-2 transition-colors hover:text-[var(--nx-text-primary)] hover:underline"
          >
            再起一个新项目
          </button>
          <p
            data-audit-receipt
            className="border-t border-[var(--nx-border-hairline)] pt-2.5 text-center text-[10px] leading-relaxed text-[var(--nx-text-muted)]"
          >
            {`操作人：${operator}｜导入时间：${receivedAt}｜事务标识：#PROJ-${projectId} 已记入组织审计日志`}
          </p>
        </footer>
      </div>
    </div>
  )
}

export default NextDraftConfirmSuccessModal
