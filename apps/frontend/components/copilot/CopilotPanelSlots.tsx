'use client'

/**
 * v3-copilot-live-submission-channel —— 插槽容器（任务 7.2–7.9）。
 *
 * 把此前**造好却从未被挂载**的组件接到面板：模式标识、上下文芯片、澄清卡片、
 * 假设清单、未指明信息告警、建议收件箱、记忆视图。
 *
 * 数据来源纪律：
 * - 澄清项与假设条目来自**回合响应**（唯一来源），不在此处推导；
 * - 芯片来自既有 `deriveChips`（与斜杠命令同源派生）；
 * - 收件箱来自既有 `use-suggestion-inbox` hooks；
 * - 演示态（`mode === 'demonstration'`）下不渲染任何可确认动作（spec 红线）。
 *
 * 无内容时每个容器返回 null，插槽干净折叠（任务 7.9）。
 */

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useParams, useSearchParams, useRouter } from 'next/navigation'
import type {
  InboxEntryState,
  InboxMissingSource,
  CopilotAssumptionEntry,
  CopilotClarificationItem,
  CopilotAssumptionEntrySimple,
  RegisteredClarificationField,
  ChipDescriptor,
} from '@aiproj/types'
import { COPILOT_SUB_INTENT_REGISTRY } from '@aiproj/types'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { isEnterpriseEntryVisible } from '@/lib/navigation'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import type { RegisteredCommand } from '@/lib/command-registry/types'
import { useCopilotStore } from '@/stores/copilot-store'
import { deriveChips } from '@/lib/copilot/chip-derivation'
import { submitCopilotTurn } from '@/lib/copilot/submit'
import { ContextChip } from './ContextChip'
export { CopilotTurnActions } from './CopilotTurnActions'
import { AssumptionList } from './AssumptionList'
import { UnspecifiedInfoWarning } from './UnspecifiedInfoWarning'
import { ClarificationCard } from './ClarificationCard'
import { CopilotModeIndicator } from './CopilotModeIndicator'
import { SuggestionInbox } from './SuggestionInbox'
import { CopilotMemoryView } from './CopilotMemoryView'
import { useQuery } from '@tanstack/react-query'
import {
  useInboxAction,
  useInboxQuery,
  useInboxRefreshRunner,
  useUnreadCount,
} from '@/hooks/use-suggestion-inbox'
import { copilotMemoryApi, copilotMemoryKeys } from '@/lib/api/copilot-memory'

// ===========================================================================
// 形状映射（回合响应 → 组件契约）
// ===========================================================================

/**
 * 回合的精简假设条目 → 组件所需的完整假设条目。
 *
 * 显式映射而非断言：两侧字段集合不同（回合侧无 `assumptionId`/`usedDefault`/`editable`），
 * 断言会在任一侧演化时静默错位。
 */
export function toAssumptionEntry(simple: CopilotAssumptionEntrySimple): CopilotAssumptionEntry {
  return {
    assumptionId: simple.slotId,
    statement: simple.statement,
    source: simple.source,
    confidence: simple.confidence,
    // 回合层的假设条目均由默认值替换产生（见路由器 5.4）
    usedDefault: simple.source === 'default',
    needsConfirmation: simple.needsConfirmation,
    // 本增量不提供逐条编辑（编辑归属澄清 change 的自有通道）
    editable: false,
  }
}

/** 回合澄清项 → 澄清卡片的注册字段形状。 */
export function toClarificationField(
  item: CopilotClarificationItem,
  destination: string,
): RegisteredClarificationField {
  return {
    fieldId: item.slotId,
    destination,
    tier: item.tier,
    title: item.label,
    description: item.question,
    impactScope: [],
    questionType: item.quickOptions && item.quickOptions.length > 0 ? 'single_choice' : 'text',
    quickOptions: (item.quickOptions ?? []).map((option) => ({
      value: option,
      label: option,
    })),
    // 回合层只带 confidence，不带来源强度档；映射为「目录中位」——
    // 这是路由器 recommended 档默认值的实际来源，且是可解释的确定性取值。
    defaultValue: item.defaultValue
      ? {
          value: item.defaultValue.value,
          sourceStrength: 'catalog_median',
          reason: item.defaultValue.reason,
        }
      : undefined,
  }
}

// ===========================================================================
// 插槽容器
// ===========================================================================

/** 模式标识（任务 7.2：兑现 CopilotModeIndicator 源码注释声明的集成）。 */
export function CopilotModeIndicatorSlot() {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const streaming = useCopilotStore((s) => s.streaming)
  const mode = pathname.startsWith('/projects/') ? 'project' : 'general_purpose'
  return (
    <div data-copilot-slot="modeIndicator" role="group" aria-label="Copilot 模式">
      <CopilotModeIndicator
        currentMode={mode}
        onModeChange={(next) => router.push(next === 'project' ? '/projects' : '/')}
        disabled={streaming}
      />
    </div>
  )
}

/** 上下文快捷芯片（任务 7.3）。 */
export function CopilotChipsSlot() {
  const pathname = usePathname() ?? '/'
  const params = useParams()
  const searchParams = useSearchParams()
  const { permissions } = usePermissions()
  const commandsMap = useCommandRegistryStore((s) => s.commands)
  const planTier = useAuthStore((s) => s.planTier)
  const superAdmin = useAuthStore(
    (s) => s.user?.isSuperAdmin || s.permissions.includes('system:admin'),
  )
  const streaming = useCopilotStore((s) => s.streaming)
  const [expanded, setExpanded] = React.useState(false)
  const [feedback, setFeedback] = React.useState<string | null>(null)

  const allCommands = React.useMemo<RegisteredCommand[]>(
    () =>
      Array.from(commandsMap.values()).filter(
        (cmd) =>
          (!cmd.enterpriseOnly || isEnterpriseEntryVisible(planTier, superAdmin)) &&
          !cmd.featureGate,
      ),
    [commandsMap, planTier, superAdmin],
  )

  const result = React.useMemo(
    () =>
      deriveChips(
        allCommands,
        COPILOT_SUB_INTENT_REGISTRY,
        {
          commandContext: {
            pathname,
            params: (params ?? {}) as Record<string, string | string[]>,
            searchParams: searchParams ?? new URLSearchParams(),
          },
          permissions: superAdmin
            ? [
                ...new Set([
                  ...allCommands.flatMap((c) => c.requiresPermission ?? []),
                  ...COPILOT_SUB_INTENT_REGISTRY.flatMap((i) => i.requiredPermissions),
                ]),
              ]
            : [...(permissions ?? [])],
          scope: pathname.startsWith('/projects/') ? 'project' : 'global',
          enabledDestinations: {},
          authorizationGatedDestinations: [],
        },
        expanded ? 100 : 6,
      ),
    [allCommands, pathname, params, searchParams, permissions, superAdmin, expanded],
  )

  function activateChip(chip: ChipDescriptor) {
    if (streaming) return
    setFeedback(null)
    try {
      if (chip.sourceKind === 'registered-command') {
        const command = useCommandRegistryStore.getState().commands.get(chip.id)
        const context = {
          pathname,
          params: (params ?? {}) as Record<string, string | string[]>,
          searchParams: searchParams ?? new URLSearchParams(),
        }
        const auth = useAuthStore.getState()
        if (
          !command ||
          command.requiresPermission?.some((p) => !auth.hasPermission(p)) ||
          (command.enterpriseOnly &&
            !isEnterpriseEntryVisible(
              auth.planTier,
              auth.user?.isSuperAdmin || auth.permissions.includes('system:admin'),
            )) ||
          command.featureGate ||
          (command.when && !command.when(context))
        ) {
          setFeedback('该操作当前不可用，请刷新后重试。')
          return
        }
        command.execute(context)
        setFeedback(`已打开${command.label}`)
      } else {
        const intent = COPILOT_SUB_INTENT_REGISTRY.find((i) => i.subIntentId === chip.id)
        if (
          !intent ||
          intent.requiredPermissions.some((p) => !useAuthStore.getState().hasPermission(p))
        )
          return
        const text = intent.examplePhrasings[0] ?? chip.label
        useCopilotStore.getState().setDraft(text)
        window.dispatchEvent(new Event('copilot:focus-input'))
        setFeedback('已填入输入框，可补充后发送。')
      }
    } catch {
      setFeedback('未能打开该操作，请重试。')
    }
  }

  if (result.chips.length === 0) return null

  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-copilot-slot="quickActionChips"
      role="group"
      aria-label="上下文快捷操作"
    >
      {result.chips.map((chip) => (
        <ContextChip key={chip.id} chip={chip} onClick={activateChip} disabled={streaming} />
      ))}
      {result.omittedCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
          className="rounded px-2 py-1 text-xs text-gray-600 focus-visible:outline focus-visible:outline-2"
        >
          更多操作（{result.omittedCount}）
        </button>
      )}
      {expanded && (
        <button
          type="button"
          aria-expanded
          onClick={() => setExpanded(false)}
          className="rounded px-2 py-1 text-xs text-gray-600"
        >
          收起操作
        </button>
      )}
      {feedback && (
        <p role="status" className="w-full text-xs text-gray-600">
          {feedback}
        </p>
      )}
    </div>
  )
}

/** 澄清卡片（任务 7.4；数据取回合响应）。 */
export function CopilotClarificationSlot() {
  const turn = useCopilotStore((s) => s.turn)
  const currentRoute = usePathname()
  if (!turn || !turn.clarificationRequired || turn.clarificationItems.length === 0) return null

  const destination = turn.destinations[0]?.destination ?? 'unknown'

  // 澄清回调：把用户的选择作为新一轮输入直接提交。
  // 后端在 `clarificationRounds >= MAX` 时强制放行调真实 AI
  //（`copilot-intent-router.ts` evaluateSlotCompleteness 上界兜底），
  // 故连续回答/跳过最多 MAX 轮后必定到达 AI 回答分支，不会再卡死。
  function handleAnswer(_fieldId: string, value: string | number) {
    const text = String(value)
    useCopilotStore.getState().setDraft(text)
    void submitCopilotTurn({ text, mentions: [], currentRoute })
  }

  function handleSkip(_fieldId: string) {
    // 跳过也推进一轮：后端据 clarificationRounds 达到上界即放行。
    useCopilotStore.getState().clearDraft()
    void submitCopilotTurn({ text: '跳过此问题', mentions: [], currentRoute })
  }

  function handleUseDefault(fieldId: string, item: CopilotClarificationItem) {
    const defaultValue = item.defaultValue?.value
    if (defaultValue !== undefined && defaultValue !== null) {
      handleAnswer(fieldId, defaultValue)
    } else {
      handleSkip(fieldId)
    }
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-copilot-slot="clarification"
      role="group"
      aria-label="待澄清事项"
    >
      {turn.clarificationItems.map((item) => (
        <ClarificationCard
          key={item.slotId}
          field={toClarificationField(item, destination)}
          state="asked_pending"
          onAnswer={handleAnswer}
          onSkip={handleSkip}
          onUseDefault={(fieldId) => handleUseDefault(fieldId, item)}
        />
      ))}
    </div>
  )
}

/** 假设清单（任务 7.5；数据取回合响应）。 */
export function CopilotAssumptionsSlot() {
  const turn = useCopilotStore((s) => s.turn)
  const demoAssumptions = useCopilotStore((s) => s.demoAssumptions)

  const assumptions: readonly CopilotAssumptionEntry[] = React.useMemo(() => {
    if (turn) return turn.assumptionEntries.map(toAssumptionEntry)
    return demoAssumptions
  }, [turn, demoAssumptions])

  if (assumptions.length === 0) return null

  return (
    <div data-copilot-slot="assumptions" role="group" aria-label="本轮假设清单">
      <AssumptionList assumptions={assumptions} />
    </div>
  )
}

/** 未指明信息告警（任务 7.6）。 */
export function CopilotUnspecifiedInfoSlot() {
  const turn = useCopilotStore((s) => s.turn)
  const demoAssumptions = useCopilotStore((s) => s.demoAssumptions)

  const assumptions: readonly CopilotAssumptionEntry[] = React.useMemo(() => {
    if (turn) return turn.assumptionEntries.map(toAssumptionEntry)
    return demoAssumptions
  }, [turn, demoAssumptions])

  const unspecified = assumptions.filter((entry) => entry.usedDefault)
  if (unspecified.length === 0) return null

  return (
    <div data-copilot-slot="unspecifiedInfoWarning" role="group" aria-label="未指明信息提示">
      <UnspecifiedInfoWarning assumptions={unspecified} />
    </div>
  )
}

/**
 * 建议收件箱插槽（任务 7.7）。
 *
 * 数据取既有 `use-suggestion-inbox` hooks；组件此前生产引用为 0。
 * 演示态不渲染——收件箱的采纳会走动作边界，演示态不得提供可确认动作。
 *
 * 查询 hooks 放在展开后才挂载的子组件里：`useInboxQuery` 没有 enabled 开关，
 * 若在本容器里调用，折叠状态也会发请求。
 */
export function CopilotSuggestionInboxSlot() {
  const mode = useCopilotStore((s) => s.mode)
  const pathname = usePathname() ?? '/'
  const projectMatch = /^\/projects\/(\d+)/.exec(pathname)
  const projectId = projectMatch ? Number(projectMatch[1]) : undefined
  const [expanded, setExpanded] = React.useState(false)

  if (mode !== 'live') return null

  return (
    <div data-copilot-slot="suggestionInbox" role="group" aria-label="建议收件箱">
      <button
        type="button"
        data-copilot-inbox-toggle
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-border px-2 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50"
      >
        <span>AI 建议收件箱</span>
      </button>
      {expanded && <SuggestionInboxBody projectId={projectId} />}
    </div>
  )
}

function inboxErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : '未知错误'
}

type InboxNotice =
  | { kind: 'error'; text: string }
  | { kind: 'adopted'; sessionId: string | undefined }
  | { kind: 'refreshed'; text: string }

function SuggestionInboxBody({ projectId }: { projectId?: number }) {
  const [filterState, setFilterState] = React.useState<InboxEntryState | 'all'>('all')
  const [missingSources, setMissingSources] = React.useState<InboxMissingSource[]>([])
  const [notice, setNotice] = React.useState<InboxNotice | null>(null)
  // 列表一次取满（后端单页上限 100），筛选在前端按状态做，标签上的计数才与列表一致。
  const query = useInboxQuery({ projectId, perPage: 100 })
  const unread = useUnreadCount(projectId)
  const { mutateAsync: runAction } = useInboxAction()
  const { refresh: runRefresh, refreshing } = useInboxRefreshRunner()
  const unreadCount = unread.data ?? 0

  // 收件箱条目只由聚合写入：不刷新就永远是空的。进入项目后展开时自动聚合一次。
  const doRefresh = React.useCallback(async () => {
    if (projectId === undefined) return
    try {
      const result = await runRefresh(projectId)
      setMissingSources(result.missingSources ?? [])
      setNotice({
        kind: 'refreshed',
        text: `已聚合 ${result.aggregated} 条（新增 ${result.created}，过期 ${result.expired}）`,
      })
    } catch (error) {
      setNotice({ kind: 'error', text: `刷新失败：${inboxErrorMessage(error)}` })
    }
  }, [projectId, runRefresh])

  const autoRefreshedFor = React.useRef<number | undefined>(undefined)
  React.useEffect(() => {
    if (projectId === undefined || autoRefreshedFor.current === projectId) return
    autoRefreshedFor.current = projectId
    void doRefresh()
  }, [projectId, doRefresh])

  const perform = async (entryId: string, action: 'mark_read' | 'adopt' | 'dismiss') => {
    try {
      const result = await runAction({ entryId, action })
      if (action === 'adopt') setNotice({ kind: 'adopted', sessionId: result.previewSessionId })
    } catch (error) {
      setNotice({ kind: 'error', text: `操作失败：${inboxErrorMessage(error)}` })
    }
  }

  const loadError = query.error ? `加载失败：${inboxErrorMessage(query.error)}` : null

  return (
    <SuggestionInbox
      entries={[...(query.data?.entries ?? [])]}
      missingSources={missingSources}
      unreadCount={unreadCount}
      loading={query.isLoading || refreshing}
      filterState={filterState}
      onFilterChange={setFilterState}
      onAdopt={(entryId) => perform(entryId, 'adopt')}
      onDismiss={(entryId) => perform(entryId, 'dismiss')}
      onMarkRead={(entryId) => void perform(entryId, 'mark_read')}
      onRefresh={() => void doRefresh()}
      refreshDisabledReason={
        projectId === undefined ? '进入具体项目页面后才能刷新聚合该项目的建议。' : undefined
      }
      notice={
        loadError ? (
          <p role="alert" className="text-red-600" data-inbox-notice="error">
            {loadError}
          </p>
        ) : notice?.kind === 'error' ? (
          <p role="alert" className="text-red-600" data-inbox-notice="error">
            {notice.text}
          </p>
        ) : notice?.kind === 'adopted' ? (
          <p data-inbox-notice="adopted">
            已采纳，已生成待审查草案（不会自动改动项目数据，变更需在草案中补充并确认）。
            {notice.sessionId && (
              <Link href={`/draft-layer/${notice.sessionId}`} className="ml-1 underline">
                打开草案审查
              </Link>
            )}
          </p>
        ) : notice?.kind === 'refreshed' ? (
          <p className="text-muted-foreground" data-inbox-notice="refreshed">
            {notice.text}
          </p>
        ) : null
      }
    />
  )
}

/**
 * 记忆视图插槽（任务 7.8）。
 *
 * 其归属 change 已归档并交付了组件与后端八端点，但缺前端客户端，组件从未可达。
 * 本插槽接上 `copilotMemoryApi`；演示态不渲染（记忆是真实持久化数据）。
 */
export function CopilotMemoryViewSlot() {
  const mode = useCopilotStore((s) => s.mode)
  const [expanded, setExpanded] = React.useState(false)

  // 演示态在**调用任何查询 hook 之前**返回，故演示态渲染不需要 QueryClient，
  // 也不会发起请求（既有面板测试无需 provider 即可继续通过）。
  if (mode !== 'live') return null

  return (
    <div data-copilot-slot="memoryView" role="group" aria-label="Copilot 记忆">
      <button
        type="button"
        data-copilot-memory-toggle
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-border px-2 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50"
      >
        <span>Copilot 记得什么</span>
      </button>
      {expanded && <MemoryViewBody />}
    </div>
  )
}

function MemoryViewBody() {
  const pathname = usePathname() ?? '/'
  const projectMatch = /^\/projects\/(\d+)/.exec(pathname)
  const projectId = projectMatch ? Number(projectMatch[1]) : undefined

  const query = useQuery({
    queryKey: copilotMemoryKeys.list({ projectId }),
    queryFn: () => copilotMemoryApi.list({ projectId }),
  })

  return <CopilotMemoryView memories={query.data ?? []} loading={query.isLoading} />
}
