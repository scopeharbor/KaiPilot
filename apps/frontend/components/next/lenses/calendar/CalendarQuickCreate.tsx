'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { tasksApi, type TaskPriority } from '@/lib/api/tasks'
import {
  calendarQuickCreateApi,
  type QuickCreateConflict,
  type QuickCreateField,
  type QuickCreateOptions,
  type QuickCreateSuggestion,
} from '@/lib/api/calendar-quick-create'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { VariantInput } from '@/components/locale/variant-field'
import { PRIORITY_LABELS } from './calendar-item-ui'

/**
 * 日历快速新建：一张小表单（任务 / 日期 / 负责人 / 工作包 / 优先级），AI 的建议以灰字预填。
 *
 * - 打开就请模型给建议；名称打字停顿后按打的内容重新建议。名称空着时灰字是 AI 建议的任务名，
 *   打了一部分时灰字接在后面补全；
 * - 每一栏的灰字按 Tab 采纳并跳到下一栏；没采纳的灰字不会被建立（Enter 只用你确认过的值）；
 * - 名称空着时 AI 给的几个备选用「换一个」轮换；一句话里有几件事时，可以「分成 N 条建立」；
 * - 冲突（过载、休假、非工作日、超出周期、跨里程碑、同名）按将要建立的值实时提示；
 * - Enter / 建立 = 人工确认，走正式建任务接口（审计记来源与 AI 补的字段）；建好后由日历给 5 秒撤销；
 * - 模型不可用时后端退回规则建议，卡片上用一句话说明。
 */
export interface CalendarQuickCreateProps {
  /** 建在哪个项目；null =「我的日历」，卡片里选项目（记住上次选的）。 */
  projectId: number | null
  /** 「我的日历」可选的项目（我是成员的）。 */
  projectChoices?: ReadonlyArray<{ id: number; name: string }>
  startDate: string
  endDate: string | null
  anchor: DOMRect | null
  onClose: () => void
  onCreated: (tasks: Array<{ id: number; name: string; projectId: number }>) => void
}

const LAST_PROJECT_KEY = 'aiproj.myCalendar.lastProject'

function rememberedProject(choices: ReadonlyArray<{ id: number }> | undefined): number | null {
  if (!choices || choices.length === 0) return null
  try {
    const saved = Number(window.localStorage.getItem(LAST_PROJECT_KEY))
    if (choices.some((choice) => choice.id === saved)) return saved
  } catch {
    // 存储不可用：用第一个
  }
  return choices[0]!.id
}

const PRIORITIES: TaskPriority[] = ['highest', 'high', 'medium', 'low', 'lowest']
/** 名称打字停顿多久后请模型重新建议（毫秒）。 */
export const QUICK_CREATE_AI_DEBOUNCE_MS = 900
const CARD_WIDTH = 440

/** 可以有灰字建议、按 Tab 采纳的栏位（按 Tab 的先后）。 */
type GhostField = 'name' | 'endDate' | 'assignee' | 'wbs' | 'priority'
const FIELD_ORDER: GhostField[] = ['name', 'endDate', 'assignee', 'wbs', 'priority']
/** 采纳的栏位 → 审计里的 AI 字段。 */
const AUDIT_FIELD: Record<GhostField, QuickCreateField> = {
  name: 'name',
  endDate: 'dates',
  assignee: 'assignee',
  wbs: 'wbs',
  priority: 'priority',
}

function cardStyle(anchor: DOMRect | null): CSSProperties {
  if (typeof window === 'undefined' || !anchor) {
    return { top: 96, left: '50%', transform: 'translateX(-50%)', width: CARD_WIDTH }
  }
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - CARD_WIDTH - 8))
  // 贴在格子日期下方（原地输入）；下方放不下就往上翻
  const top = anchor.top + 26
  if (window.innerHeight - top < 300) {
    return { bottom: Math.max(8, window.innerHeight - anchor.top + 4), left, width: CARD_WIDTH }
  }
  return { top, left, width: CARD_WIDTH }
}

// 灰字建议比一般次要文字再淡一些，和你确认过的值一眼分开
const GHOST = 'text-[var(--nx-text-muted)]/55'

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] items-center gap-2 text-xs">
      <span className="text-[var(--nx-text-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function CalendarQuickCreate({
  projectId: fixedProjectId,
  projectChoices,
  startDate: initialStart,
  endDate: initialEnd,
  anchor,
  onClose,
  onCreated,
}: CalendarQuickCreateProps) {
  const mobile = useMobileWorkspace()
  const queryClient = useQueryClient()
  const [chosenProjectId, setChosenProjectId] = useState<number | null>(() =>
    fixedProjectId === null ? rememberedProject(projectChoices) : null,
  )
  // 0 = 还没有可建任务的项目（不发请求）
  const projectId = fixedProjectId ?? chosenProjectId ?? 0
  const dragged = initialEnd !== null && initialEnd !== initialStart

  // 你确认过的值（自己填的或 Tab 采纳的）；undefined = 还没定，可能显示灰字建议
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(initialStart)
  const [endDate, setEndDate] = useState<string | undefined>(dragged ? initialEnd! : undefined)
  const [assigneeId, setAssigneeId] = useState<number | null | undefined>(undefined)
  const [wbsNodeId, setWbsNodeId] = useState<number | null | undefined>(undefined)
  const [priority, setPriority] = useState<TaskPriority | undefined>(undefined)
  /** Tab 采纳过的栏位（审计：AI 补的字段）。 */
  const [accepted, setAccepted] = useState<GhostField[]>([])

  const [suggestions, setSuggestions] = useState<QuickCreateSuggestion[]>([])
  const [choice, setChoice] = useState(0)
  const [options, setOptions] = useState<QuickCreateOptions>({ members: [], workPackages: [] })
  const [source, setSource] = useState<'ai' | 'rules' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [aiPending, setAiPending] = useState(false)
  const [conflicts, setConflicts] = useState<QuickCreateConflict[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [style] = useState(() => cardStyle(anchor))

  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!mobile) return
    const viewport = window.visualViewport
    const update = () => {
      cardRef.current?.style.setProperty(
        '--calendar-mobile-height',
        `${viewport?.height ?? window.innerHeight}px`,
      )
      cardRef.current?.style.setProperty('--calendar-mobile-top', `${viewport?.offsetTop ?? 0}px`)
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [mobile])
  const fieldRefs = useRef<Partial<Record<GhostField | 'submit', HTMLElement | null>>>({})
  /** 采纳名称灰字会改名称：这一次不用再请模型。 */
  const skipQueryForRef = useRef<string | null>(null)

  const suggestion = suggestions[choice] ?? null
  const typed = name.trim()

  // 请模型建议：打开时立即请；名称变了停顿后再请（采纳灰字导致的变化不请）
  useEffect(() => {
    if (projectId === 0) return
    if (skipQueryForRef.current !== null && skipQueryForRef.current === name) {
      skipQueryForRef.current = null
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        setAiPending(true)
        calendarQuickCreateApi
          .suggest(
            projectId,
            { startDate, ...(dragged ? { endDate: initialEnd! } : {}), text: typed },
            controller.signal,
          )
          .then((result) => {
            if (controller.signal.aborted) return
            setSuggestions(result.tasks)
            setChoice(0)
            setOptions(result.options)
            setSource(result.source)
            setNote(result.note)
          })
          .catch(() => undefined)
          .finally(() => {
            if (!controller.signal.aborted) setAiPending(false)
          })
      },
      typed ? QUICK_CREATE_AI_DEBOUNCE_MS : 0,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // startDate 改了不必重请：日期由你定，建议只影响其余栏位
  }, [typed, projectId])

  // 各栏的灰字建议（还没定的栏位才显示）
  const ghost = {
    name: suggestion && suggestion.name !== name ? suggestion.name : null,
    endDate:
      endDate === undefined && suggestion && suggestion.endDate >= startDate
        ? suggestion.endDate
        : null,
    assignee: assigneeId === undefined && suggestion?.assigneeId ? suggestion.assigneeId : null,
    wbs: wbsNodeId === undefined && suggestion?.wbsNodeId ? suggestion.wbsNodeId : null,
    priority: priority === undefined && suggestion ? suggestion.priority : null,
  }
  // 名称灰字：空着时整句做占位；打了开头时接在后面补全；不是同一句时在下面给出
  const nameSuffix =
    ghost.name && typed && ghost.name.startsWith(name) ? ghost.name.slice(name.length) : ''
  const nameAlt = ghost.name && typed && !ghost.name.startsWith(name) ? ghost.name : null

  const pending = (field: GhostField) => {
    if (field === 'name') return ghost.name !== null
    if (field === 'endDate') return ghost.endDate !== null
    if (field === 'assignee') return ghost.assignee !== null
    if (field === 'wbs') return ghost.wbs !== null
    return ghost.priority !== null
  }

  const accept = (field: GhostField) => {
    if (!suggestion) return
    if (field === 'name') {
      skipQueryForRef.current = suggestion.name
      setName(suggestion.name)
    }
    if (field === 'endDate') setEndDate(suggestion.endDate)
    if (field === 'assignee') setAssigneeId(suggestion.assigneeId)
    if (field === 'wbs') setWbsNodeId(suggestion.wbsNodeId)
    if (field === 'priority') setPriority(suggestion.priority)
    setAccepted((list) => (list.includes(field) ? list : [...list, field]))
  }

  /** 自己改了某栏：不再算 AI 补的。 */
  const ownEdit = (field: GhostField) =>
    setAccepted((list) => list.filter((item) => item !== field))

  const focusNext = (field: GhostField) => {
    const next = FIELD_ORDER[FIELD_ORDER.indexOf(field) + 1]
    ;(fieldRefs.current[next ?? 'submit'] ?? fieldRefs.current.submit)?.focus()
  }

  /** Tab：这一栏有灰字就采纳并跳到下一栏；没有灰字照常跳。 */
  const onTab = (field: GhostField) => (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab' || event.shiftKey || !pending(field)) return
    event.preventDefault()
    accept(field)
    focusNext(field)
  }

  // 将要建立的值（只用确认过的；没采纳的灰字不算）
  const effective = {
    name: typed,
    startDate,
    endDate: endDate ?? startDate,
    assigneeId: assigneeId ?? null,
    wbsNodeId: wbsNodeId ?? null,
    priority: priority ?? ('medium' as TaskPriority),
  }

  // 按将要建立的值重算冲突（不调用模型）
  const conflictKey = JSON.stringify([
    projectId,
    effective.name,
    effective.startDate,
    effective.endDate,
    effective.assigneeId,
  ])
  useEffect(() => {
    if (projectId === 0 || !effective.name) {
      setConflicts([])
      return
    }
    let stale = false
    const timer = window.setTimeout(() => {
      calendarQuickCreateApi
        .check(projectId, initialStart, [
          {
            name: effective.name,
            startDate: effective.startDate,
            endDate: effective.endDate,
            assigneeId: effective.assigneeId,
          },
        ])
        .then(({ conflicts: list }) => {
          if (!stale) setConflicts(list[0] ?? [])
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [conflictKey])

  const createTasks = async (
    list: Array<{
      name: string
      startDate: string
      endDate: string
      assigneeId: number | null
      wbsNodeId: number | null
      priority: TaskPriority
      aiFields: QuickCreateField[]
    }>,
  ) => {
    if (creating || projectId === 0 || list.length === 0) return
    setCreating(true)
    setError(null)
    const created: Array<{ id: number; name: string; projectId: number }> = []
    try {
      for (const item of list) {
        const task = await tasksApi.create(projectId, {
          name: item.name,
          startDate: item.startDate,
          endDate: item.endDate,
          priority: item.priority,
          ...(item.assigneeId ? { assigneeId: item.assigneeId } : {}),
          ...(item.wbsNodeId ? { wbsNodeId: item.wbsNodeId } : {}),
          customFields: { source: 'calendar-quick-create', aiFields: item.aiFields },
        })
        created.push({ id: task.id, name: task.name, projectId })
      }
    } catch (failure) {
      const message = (failure as { message?: unknown } | null)?.message
      setError(typeof message === 'string' && message ? message : '建立失败，请稍后再试')
    } finally {
      setCreating(false)
    }
    if (created.length > 0) {
      void invalidateTaskQueries(queryClient, projectId)
      onCreated(created)
    }
  }

  const create = () => {
    if (!effective.name) {
      setError(
        ghost.name
          ? mobile
            ? '请采纳建议或输入任务名'
            : '请写任务名，或采纳灰字建议'
          : '先写任务名',
      )
      return
    }
    void createTasks([{ ...effective, aiFields: accepted.map((field) => AUDIT_FIELD[field]) }])
  }

  // 一句话里有几件事：按 AI 的拆法一起建（你点了才建）
  const splitInto = typed && suggestions.length > 1 ? suggestions : null
  const createSplit = () =>
    splitInto &&
    void createTasks(
      splitInto.map((item) => ({
        name: item.name,
        startDate: item.startDate,
        endDate: item.endDate,
        assigneeId: item.assigneeId,
        wbsNodeId: item.wbsNodeId,
        priority: item.priority,
        aiFields: item.aiFields,
      })),
    )

  // 点卡片外面：还没填东西才关（避免误触丢掉输入）
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (cardRef.current?.contains(event.target as Node)) return
      if (!typed && accepted.length === 0) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [typed, accepted.length, onClose])

  const memberOptions = useMemo(
    () =>
      options.members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}（手上 {member.activeTasks} 件）
        </option>
      )),
    [options.members],
  )

  const card = (
    <div
      ref={cardRef}
      // 卡片挂在 body 上：带上新轨令牌作用域，颜色与深 / 浅色主题才生效
      data-next-track
      data-calendar-quick-create
      data-start-date={initialStart}
      data-end-date={initialEnd ?? undefined}
      role="dialog"
      aria-label="快速新建任务"
      style={
        mobile
          ? {
              left: 0,
              right: 0,
              top: 'var(--calendar-mobile-top, 0px)',
              bottom: 'auto',
              width: '100%',
              height: 'var(--calendar-mobile-height, 100dvh)',
              maxHeight: 'none',
              transform: 'none',
              borderRadius: 0,
            }
          : style
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
      className="fixed z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--nx-text-secondary)]">新建任务</span>
        <button
          type="button"
          aria-label="取消"
          onClick={onClose}
          className="rounded p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
        {fixedProjectId === null ? (
          <FieldRow label="项目">
            <select
              data-quick-create-project
              aria-label="建在哪个项目"
              value={chosenProjectId ?? ''}
              onChange={(event) => {
                const next = Number(event.target.value)
                setChosenProjectId(next)
                setSuggestions([])
                setAssigneeId(undefined)
                setWbsNodeId(undefined)
                try {
                  window.localStorage.setItem(LAST_PROJECT_KEY, String(next))
                } catch {
                  // 存储不可用：只是不记住
                }
              }}
              className="w-full bg-transparent text-[var(--nx-text-primary)] outline-none"
            >
              {(projectChoices ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FieldRow>
        ) : null}

        {projectId === 0 ? (
          <p data-quick-create-no-project className="text-xs text-[var(--nx-text-muted)]">
            你还没有加入任何项目，加入项目后才能在日历上新建任务。
          </p>
        ) : (
          <>
            <FieldRow label="任务">
              <div className="relative">
                {/* 灰字补全：与输入框同字体同位置叠在下面 */}
                {nameSuffix ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-0 py-1 text-sm"
                  >
                    <span className="invisible">{name}</span>
                    <span data-ghost="name" className={GHOST}>
                      {nameSuffix}
                    </span>
                  </div>
                ) : null}
                <VariantInput
                  ref={(element) => {
                    fieldRefs.current.name = element
                  }}
                  data-quick-create-name
                  autoFocus={!mobile}
                  aria-label="任务名"
                  value={name}
                  placeholder={
                    ghost.name && !typed
                      ? ghost.name
                      : aiPending
                        ? 'AI 正在想…（也可以直接输入）'
                        : '要做什么'
                  }
                  data-ghost-placeholder={ghost.name && !typed ? 'true' : undefined}
                  onValueChange={(value) => {
                    setName(value)
                    ownEdit('name')
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    onTab('name')(event)
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      create()
                    }
                  }}
                  className="relative w-full bg-transparent py-1 text-sm text-[var(--nx-text-primary)] outline-none placeholder:text-[var(--nx-text-muted)]/55"
                />
              </div>
              {nameAlt ? (
                <p data-quick-create-name-alt className={`mt-0.5 truncate text-[11px] ${GHOST}`}>
                  建议：{nameAlt}
                </p>
              ) : null}
            </FieldRow>

            <FieldRow label="日期">
              <div data-quick-create-dates className="flex items-center gap-1.5">
                <input
                  type="date"
                  data-quick-create-start
                  aria-label="开始日期"
                  value={startDate}
                  onChange={(event) => {
                    if (!event.target.value) return
                    setStartDate(event.target.value)
                    if (endDate && endDate < event.target.value) setEndDate(event.target.value)
                  }}
                  className="bg-transparent text-[var(--nx-text-primary)] outline-none"
                />
                <span className="text-[var(--nx-text-muted)]">至</span>
                <input
                  ref={(element) => {
                    fieldRefs.current.endDate = element
                  }}
                  type="date"
                  data-quick-create-end
                  data-ghost={ghost.endDate ? 'true' : undefined}
                  aria-label="截止日期"
                  min={startDate}
                  value={endDate ?? ghost.endDate ?? startDate}
                  onChange={(event) => {
                    if (!event.target.value) return
                    setEndDate(event.target.value < startDate ? startDate : event.target.value)
                    ownEdit('endDate')
                  }}
                  onKeyDown={onTab('endDate')}
                  className={cn(
                    'bg-transparent outline-none',
                    ghost.endDate ? GHOST : 'text-[var(--nx-text-primary)]',
                  )}
                />
              </div>
            </FieldRow>

            <FieldRow label="负责人">
              <select
                ref={(element) => {
                  fieldRefs.current.assignee = element
                }}
                data-quick-create-assignee
                data-ghost={ghost.assignee ? 'true' : undefined}
                aria-label="负责人"
                value={assigneeId ?? ghost.assignee ?? ''}
                onChange={(event) => {
                  setAssigneeId(event.target.value ? Number(event.target.value) : null)
                  ownEdit('assignee')
                }}
                onKeyDown={onTab('assignee')}
                className={cn(
                  'w-full bg-transparent outline-none',
                  ghost.assignee ? GHOST : 'text-[var(--nx-text-primary)]',
                )}
              >
                <option value="">未指派</option>
                {memberOptions}
              </select>
              {ghost.assignee && suggestion?.assigneeReason ? (
                <p
                  data-quick-create-reason
                  className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]"
                >
                  {suggestion.assigneeReason}
                </p>
              ) : null}
            </FieldRow>

            <FieldRow label="工作包">
              <select
                ref={(element) => {
                  fieldRefs.current.wbs = element
                }}
                data-quick-create-wbs
                data-ghost={ghost.wbs ? 'true' : undefined}
                aria-label="工作包"
                value={wbsNodeId ?? ghost.wbs ?? ''}
                onChange={(event) => {
                  setWbsNodeId(event.target.value ? Number(event.target.value) : null)
                  ownEdit('wbs')
                }}
                onKeyDown={onTab('wbs')}
                className={cn(
                  'w-full bg-transparent outline-none',
                  ghost.wbs ? GHOST : 'text-[var(--nx-text-primary)]',
                )}
              >
                <option value="">不归属工作包</option>
                {options.workPackages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="优先级">
              <select
                ref={(element) => {
                  fieldRefs.current.priority = element
                }}
                data-quick-create-priority
                data-ghost={ghost.priority ? 'true' : undefined}
                aria-label="优先级"
                value={priority ?? ghost.priority ?? 'medium'}
                onChange={(event) => {
                  setPriority(event.target.value as TaskPriority)
                  ownEdit('priority')
                }}
                onKeyDown={onTab('priority')}
                className={cn(
                  'w-full bg-transparent outline-none',
                  ghost.priority ? GHOST : 'text-[var(--nx-text-primary)]',
                )}
              >
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </FieldRow>

            {mobile && FIELD_ORDER.some(pending) ? (
              <button
                type="button"
                data-quick-create-accept
                onClick={() => FIELD_ORDER.filter(pending).forEach(accept)}
                className="min-h-11 w-full rounded-lg border border-[var(--nx-border-focus)] px-3 text-sm text-[var(--nx-accent)]"
              >
                采纳灰字建议
              </button>
            ) : null}
            {!typed && suggestions.length > 1 ? (
              <button
                type="button"
                data-quick-create-next-idea
                onClick={() => setChoice((index) => (index + 1) % suggestions.length)}
                className="text-[11px] text-[var(--nx-text-muted)] underline-offset-2 hover:text-[var(--nx-space-cyan)] hover:underline"
              >
                换一个建议（{choice + 1}/{suggestions.length}）
              </button>
            ) : null}

            {splitInto ? (
              <div data-quick-create-split className="text-[11px] text-[var(--nx-text-muted)]">
                AI 看这是 {splitInto.length} 件事：{splitInto.map((item) => item.name).join('；')}
                <button
                  type="button"
                  onClick={createSplit}
                  disabled={creating}
                  className="ml-1.5 text-[var(--nx-space-cyan)] hover:underline disabled:opacity-40"
                >
                  分成 {splitInto.length} 条建立
                </button>
              </div>
            ) : null}

            {conflicts.length > 0 ? (
              <ul data-quick-create-conflicts className="space-y-0.5">
                {conflicts.map((conflict) => (
                  <li
                    key={conflict.code}
                    data-conflict={conflict.code}
                    className="flex items-center gap-1 text-[11px] text-[var(--nx-status-warning)]"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                    {conflict.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {source === 'rules' && note ? (
              <p data-quick-create-note className="text-[11px] text-[var(--nx-text-muted)]">
                {note}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-[var(--nx-status-danger)]">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-3 py-1.5 pb-[max(6px,env(safe-area-inset-bottom))]">
        <span
          data-quick-create-status
          className="flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)]"
        >
          {aiPending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              AI 正在建议
            </>
          ) : mobile ? (
            '灰字为建议，可点选采纳'
          ) : (
            '灰字是 AI 建议，Enter 建立'
          )}
        </span>
        <button
          ref={(element) => {
            fieldRefs.current.submit = element
          }}
          type="button"
          data-quick-create-submit
          disabled={creating || projectId === 0}
          onClick={create}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--nx-accent)] px-3 text-xs font-medium text-[var(--nx-bg-0)] disabled:opacity-40"
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          建立
        </button>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? card : createPortal(card, document.body)
}

export default CalendarQuickCreate
