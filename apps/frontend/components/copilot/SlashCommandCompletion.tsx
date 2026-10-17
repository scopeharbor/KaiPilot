'use client'

import * as React from 'react'
import type { CommandDescriptor } from '@aiproj/types'
import { DEFAULT_MAX_CANDIDATES } from '@aiproj/types'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

// ===========================================================================
// 类型
// ===========================================================================

interface SlashCommandCompletionProps {
  /** 可用命令列表（已派生、排序、过滤）。 */
  commands: readonly CommandDescriptor[]
  /** 选中命令时的回调。 */
  onSelect: (cmd: CommandDescriptor) => void
  /** 最大候选数。 */
  maxCandidates?: number
  /** 当前激活状态。 */
  active: boolean
  /** / 后输入的前缀。 */
  prefix: string
  /** 取消补全的回调。 */
  onCancel: () => void
}

// ===========================================================================
// 分组中文名
// ===========================================================================

const GROUP_LABELS: Record<string, string> = {
  contextual: '快捷操作',
  navigation: '跳转页面',
  search: '搜索建议',
  theme: '主题',
  density: '密度',
  custom: '更多',
  mutation: '数据操作',
  instruction: '指令',
  generation: '生成',
  query: '查询',
  analysis: '分析',
  meta: '元操作',
}

const GROUP_ORDER = [
  'contextual',
  'navigation',
  'search',
  'mutation',
  'instruction',
  'generation',
  'query',
  'analysis',
  'theme',
  'density',
  'meta',
  'custom',
]

// ===========================================================================
// 可用性 Badge
// ===========================================================================

function AvailabilityBadge({ kind, hint }: { kind: string; hint?: string }) {
  if (kind === 'available') return null

  let label = ''
  let className = ''

  switch (kind) {
    case 'not-enabled':
      label = '未启用'
      className = 'bg-yellow-50 text-yellow-700 border-yellow-200'
      break
    case 'authorization-gated':
      label = '需授权'
      className = 'bg-orange-50 text-orange-700 border-orange-200'
      break
    case 'not-permitted':
      label = '无权限'
      className = 'bg-red-50 text-red-700 border-red-200'
      break
    default:
      return null
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium',
        className,
      )}
      title={hint}
    >
      {label}
    </span>
  )
}

// ===========================================================================
// 组件
// ===========================================================================

export function SlashCommandCompletion({
  commands,
  onSelect,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  active,
  prefix,
  onCancel,
}: SlashCommandCompletionProps) {
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)

  // 按前缀过滤命令
  const filteredCommands = React.useMemo(() => {
    if (!prefix) return commands
    const lowerPrefix = prefix.toLowerCase()
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lowerPrefix) ||
        cmd.id.toLowerCase().includes(lowerPrefix) ||
        cmd.routingKey.toLowerCase().includes(lowerPrefix),
    )
  }, [commands, prefix])

  // 分组
  const groupedCommands = React.useMemo(() => {
    const groups = new Map<string, CommandDescriptor[]>()
    for (const cmd of filteredCommands) {
      const group = cmd.group
      const existing = groups.get(group)
      if (existing) {
        existing.push(cmd)
      } else {
        groups.set(group, [cmd])
      }
    }

    // 按 GROUP_ORDER 排序分组
    const sortedGroups: Array<{ group: string; commands: CommandDescriptor[] }> = []
    const seen = new Set<string>()

    for (const g of GROUP_ORDER) {
      if (groups.has(g)) {
        sortedGroups.push({ group: g, commands: groups.get(g)! })
        seen.add(g)
      }
    }

    // 追加未在 GROUP_ORDER 中的分组
    for (const [g, cmds] of groups) {
      if (!seen.has(g)) {
        sortedGroups.push({ group: g, commands: cmds })
      }
    }

    return sortedGroups
  }, [filteredCommands])

  // 扁平化用于键盘导航
  const flatCommands = React.useMemo(() => {
    return groupedCommands.flatMap((g) => g.commands).slice(0, maxCandidates)
  }, [groupedCommands, maxCandidates])

  // 重置选中索引
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [prefix])

  // 键盘导航
  React.useEffect(() => {
    if (!active) return

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % Math.max(flatCommands.length, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev <= 0 ? Math.max(flatCommands.length - 1, 0) : prev - 1))
          break
        case 'Enter':
          if (
            flatCommands.length > 0 &&
            selectedIndex >= 0 &&
            selectedIndex < flatCommands.length
          ) {
            e.preventDefault()
            const cmd = flatCommands[selectedIndex]!
            // authorization-gated 命令点击不发外部请求
            if (cmd.availabilityKind === 'authorization-gated') {
              // 仅填充文本，不触发外部请求
              onSelect(cmd)
            } else {
              onSelect(cmd)
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          onCancel()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [active, flatCommands, selectedIndex, onCancel, onSelect])

  // 自动滚动到选中项
  React.useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.querySelector(`[data-cmd-index="${selectedIndex}"]`)
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (!active) return null

  // 无前缀时显示「你可以这样问」
  const showSuggestions = !prefix

  // 真正没有命令时
  if (flatCommands.length === 0 && !showSuggestions) {
    return (
      <div
        ref={listRef}
        role="listbox"
        aria-label="斜杠命令候选"
        className={cn(
          'absolute bottom-full left-0 z-50 mb-1 w-full max-h-60 overflow-y-auto',
          'rounded-[var(--radius-md)] border border-border bg-surface shadow-lg',
        )}
      >
        <div className="px-3 py-2 text-sm text-gray-400">没有可用的命令</div>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="斜杠命令候选"
      aria-activedescendant={
        selectedIndex >= 0 && selectedIndex < flatCommands.length
          ? `slash-cmd-option-${selectedIndex}`
          : undefined
      }
      className={cn(
        'absolute bottom-full left-0 z-50 mb-1 w-full max-h-60 overflow-y-auto',
        'rounded-[var(--radius-md)] border border-border bg-surface shadow-lg',
      )}
    >
      {showSuggestions && (
        <div className="border-b border-border px-3 py-1.5">
          <span className="text-[11px] font-medium text-gray-400">你可以这样问</span>
        </div>
      )}

      {groupedCommands.map((group) => {
        const visibleCmds = group.commands.slice(
          0,
          showSuggestions ? Math.min(3, group.commands.length) : group.commands.length,
        )

        if (visibleCmds.length === 0) return null

        return (
          <div key={group.group} role="group" aria-label={GROUP_LABELS[group.group] ?? group.group}>
            {!showSuggestions && (
              <div className="border-b border-border px-3 py-1.5">
                <span className="text-[11px] font-medium text-gray-400">
                  {GROUP_LABELS[group.group] ?? group.group}
                </span>
              </div>
            )}

            {visibleCmds.map((cmd) => {
              const globalIndex = flatCommands.indexOf(cmd)
              return (
                <button
                  key={cmd.id}
                  id={`slash-cmd-option-${globalIndex}`}
                  role="option"
                  aria-selected={globalIndex === selectedIndex}
                  data-cmd-index={globalIndex}
                  type="button"
                  onClick={() => onSelect(cmd)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    globalIndex === selectedIndex
                      ? 'bg-[var(--primary-50)] text-[var(--primary-600)]'
                      : 'hover:bg-gray-50',
                    focusRing,
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{cmd.label}</span>
                      <AvailabilityBadge kind={cmd.availabilityKind} hint={cmd.hint} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-400">{cmd.description}</div>
                  </div>

                  <span className="shrink-0 text-[10px] text-gray-300">
                    {cmd.sourceKind === 'intent-catalog' ? 'AI' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
