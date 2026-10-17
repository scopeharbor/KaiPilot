'use client'

import * as React from 'react'
import { useRouter, usePathname, useParams, useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Command } from 'cmdk'
import { Check, ExternalLink, Search, Keyboard, ShieldAlert, Sparkles } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { useUiStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { isEnterpriseEntryVisible } from '@/lib/navigation'
import { useSearchSuggestions } from '@/hooks/use-search'
import { getEntityTypeLabel } from '@aiproj/types'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Dialog'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { setCommandRouter } from '@/lib/command-registry/router-bridge'
import { setCommandSettings } from '@/lib/command-registry/settings-bridge'
import { PluginCommandErrorBoundary } from '@/components/command-registry/PluginCommandExtension'
import {
  parseNaturalLanguageCommand,
  isNaturalLanguageCommandsEnabled,
  type NaturalLanguageCommandCandidate,
  type NaturalLanguageCommandResult,
} from '@/lib/command-palette-natural-language'
import {
  GROUP_ORDER,
  GROUP_LABEL,
  type CommandContext,
  type RegisteredCommand,
} from '@/lib/command-registry/types'
import { rankVisibleCommandsByFrecency } from '@/lib/command-registry/history'
import { useCommandHistoryStore } from '@/lib/command-registry/history-store'
// 快捷键管理依赖
import {
  useCustomShortcuts,
  useEffectiveShortcutDisplays,
  hasAnyCustomShortcut,
  resetAllCustomShortcuts,
  clearCustomShortcut,
  setCustomShortcut,
} from '@/lib/command-registry/use-custom-shortcuts'
import {
  parseShortcutEvent,
  detectShortcutConflict,
  resolveEffectiveBindings,
} from '@/lib/command-registry/shortcut'
import { shortcutOverrideStore } from '@/lib/command-registry/shortcut-store'
import { useCopilotStore } from '@/stores/copilot-store'
import {
  shouldOfferHandoff,
  createHandoffPayload,
  handoffHistoryId,
} from '@/lib/command-registry/bridge'
import { copilotToggleShortcut } from '@/lib/command-registry/built-in/copilot'
// 副作用 import：触发内置静态命令注册（navigation/theme/density）。
import '@/lib/command-registry/built-in'

interface CommandPaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const CommandPaletteContext = React.createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = React.useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error('useCommandPalette 必须在 <CommandPaletteProvider> 内使用')
  }
  return ctx
}

export interface CommandPaletteProviderProps {
  children: React.ReactNode
}

export function CommandPaletteProvider({ children }: CommandPaletteProviderProps) {
  const [open, setOpen] = React.useState(false)
  const value = React.useMemo<CommandPaletteContextValue>(
    () => ({ open, setOpen, toggle: () => setOpen((prev) => !prev) }),
    [open],
  )

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isMod = event.metaKey || event.ctrlKey
      if (isMod && !event.shiftKey && !event.altKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPaletteDialog open={open} onOpenChange={setOpen} />
    </CommandPaletteContext.Provider>
  )
}

interface CommandPaletteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function CommandPaletteDialog({ open, onOpenChange }: CommandPaletteDialogProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const searchParams = useSearchParams()
  const { canAny } = usePermissions()
  const planTier = useAuthStore((s) => s.planTier)
  const isSuperAdmin = useAuthStore((s) => Boolean(s.user?.isSuperAdmin))
  const { theme, setTheme } = useTheme()
  const density = useUiStore((state) => state.density)
  const setDensity = useUiStore((state) => state.setDensity)

  const [showShortcutManager, setShowShortcutManager] = React.useState(false)

  React.useEffect(() => {
    setCommandRouter(router)
    setCommandSettings({
      setTheme: (t) => setTheme(t),
      setDensity,
    })
    return () => {
      setCommandRouter(null)
      setCommandSettings(null)
    }
  }, [router, setTheme, setDensity])

  const [search, setSearch] = React.useState('')
  React.useEffect(() => {
    if (!open) {
      setSearch('')
      setShowShortcutManager(false)
    }
  }, [open])

  const { data: suggestionsData } = useSearchSuggestions(search.trim().length >= 2 ? search : '')

  const commandsMap = useCommandRegistryStore((s) => s.commands)
  const allCommands = React.useMemo<RegisteredCommand[]>(
    () => Array.from(commandsMap.values()),
    [commandsMap],
  )
  // 功能开关就绪表：带 featureGate 的命令只在对应开关就绪时进入面板（个人版没有带开关的命令）
  const featureGatesReady: Partial<Record<string, boolean>> = {}
  const releaseTrustReady = Boolean(featureGatesReady['release-trust'])

  const ctx: CommandContext = React.useMemo<CommandContext>(
    () => ({
      pathname: pathname ?? '/',
      params: (params ?? {}) as Record<string, string | string[]>,
      searchParams: searchParams ?? new URLSearchParams(),
    }),
    [pathname, params, searchParams],
  )

  const visibleCommands = React.useMemo<RegisteredCommand[]>(() => {
    return allCommands.filter((cmd) => {
      // 企业能力入口：free（或缺失/未知）套餐不进入面板——个人免费组织不出企业界面。
      if (cmd.enterpriseOnly && !isEnterpriseEntryVisible(planTier, isSuperAdmin)) return false
      if (cmd.featureGate === 'release-trust' && !releaseTrustReady) return false
      if (cmd.requiresPermission && cmd.requiresPermission.length > 0) {
        if (!canAny(cmd.requiresPermission)) return false
      }
      if (cmd.when && !cmd.when(ctx)) return false
      return true
    })
  }, [allCommands, canAny, ctx, isSuperAdmin, planTier, releaseTrustReady])

  // 本地 MRU/frecency：只对「当前可见」的注册命令评分（design.md D3 安全不变量），
  // 无历史时 promoted 为空数组，面板渲染与既有 registry 驱动版本完全一致。
  const commandHistory = useCommandHistoryStore((s) => s.history)
  const promoted = React.useMemo(
    () => rankVisibleCommandsByFrecency(visibleCommands, commandHistory, Date.now()),
    [visibleCommands, commandHistory],
  )
  const visibleById = React.useMemo(() => {
    const map = new Map<string, RegisteredCommand>()
    for (const cmd of visibleCommands) map.set(cmd.id, cmd)
    return map
  }, [visibleCommands])

  const trimmedSearch = search.trim()
  const showSearchGroup = trimmedSearch.length >= 2
  const suggestions = suggestionsData?.data?.slice(0, 5) ?? []

  // 自然语言候选（design.md D1/D2）：只消费已过滤的 visibleCommands，
  // feature-off 或输入过短时不解析，面板回到 registry/search/theme/density 旧行为。
  const nlEnabled = isNaturalLanguageCommandsEnabled()
  const nlResult: NaturalLanguageCommandResult | null = React.useMemo(
    () =>
      nlEnabled && trimmedSearch.length >= 2
        ? parseNaturalLanguageCommand(trimmedSearch, visibleCommands, ctx)
        : null,
    [nlEnabled, trimmedSearch, visibleCommands, ctx],
  )
  const nlCandidates = nlResult && nlResult.strategy !== 'empty' ? nlResult.candidates : []

  // ── 转交判定（v3-copilot-command-palette-bridge） ──
  // 仅当面板有非空输入时才判定；空输入不提示转交。
  const handoffDecision = React.useMemo(
    () =>
      trimmedSearch.length > 0
        ? shouldOfferHandoff(trimmedSearch, visibleCommands)
        : { shouldHandoff: false as const },
    [trimmedSearch, visibleCommands],
  )

  // Copilot 快捷键（从注册表读取，不硬编码，spec「chord 从注册表读取」）
  const copilotShortcut = React.useMemo(() => copilotToggleShortcut(), [])

  /** 执行转交：关闭面板、打开 Copilot、填入输入、记录历史。 */
  function executeHandoff() {
    if (!handoffDecision.shouldHandoff) return
    // 关闭命令面板
    onOpenChange(false)
    // 构造转交载荷（携带原文、路由上下文）
    const payload = createHandoffPayload(trimmedSearch, ctx.pathname)
    // 打开 Copilot 面板
    const copilotState = useCopilotStore.getState()
    copilotState.setOpen(true)
    // 填入输入（用户不必重输，spec）
    copilotState.setDraft(payload.inputText)
    // 记录转交到历史（可区分条目，spec）
    const historyId = handoffHistoryId(trimmedSearch)
    useCommandHistoryStore.getState().recordUsage(historyId)
    // 焦点在 Copilot 面板打开后自动落入输入区（CopilotSidebarPanel 的 useEffect）
  }

  function runCommand(cmd: RegisteredCommand) {
    onOpenChange(false)
    // 只记录注册表内的真实命令；搜索建议伪命令（search.*）不在注册表，
    // 天然不被记录，原始搜索关键词永不写入本地历史（低敏边界，design.md D2）。
    // 快捷键触发走同一 runCommand 路径，同样计入使用历史。
    if (useCommandRegistryStore.getState().commands.has(cmd.id)) {
      useCommandHistoryStore.getState().recordUsage(cmd.id)
    }
    window.setTimeout(() => cmd.execute(ctx), 0)
  }

  // 全局快捷键监听
  useCustomShortcuts({ visibleCommands, runCommand })

  const grouped = React.useMemo(() => {
    // 已推广的命令从原分组去重（design.md D5）：避免 cmdk 出现两个相同 value 的项，
    // 也让「最近使用」成为唯一入口，键盘导航不重复。
    const promotedIds = new Set(promoted.map((p) => p.id))
    const byGroup = new Map<string, RegisteredCommand[]>()
    for (const cmd of visibleCommands) {
      if (promotedIds.has(cmd.id)) continue
      const list = byGroup.get(cmd.group) ?? []
      list.push(cmd)
      byGroup.set(cmd.group, list)
    }
    const ordered: Array<{ group: string; label: string; commands: RegisteredCommand[] }> = []
    for (const g of GROUP_ORDER) {
      const list = byGroup.get(g)
      if (list && list.length > 0) ordered.push({ group: g, label: GROUP_LABEL[g], commands: list })
    }
    // 自然语言「智能建议」运行时分组（design.md D4）：插在「快捷操作」之后、
    // 「跳转页面」之前；无候选时不出现，不影响既有分组排序。
    if (nlCandidates.length > 0) {
      const navIdx = ordered.findIndex((g) => g.group === 'navigation')
      let insertAt = navIdx
      if (insertAt < 0) {
        const ctxIdx = ordered.findIndex((g) => g.group === 'contextual')
        insertAt = ctxIdx >= 0 ? ctxIdx + 1 : 0
      }
      ordered.splice(insertAt, 0, { group: 'nl-suggest', label: '智能建议', commands: [] })
    }
    if (showSearchGroup) {
      const searchIdx = ordered.findIndex((g) => g.group === 'search')
      const insertAt = searchIdx >= 0 ? searchIdx : ordered.findIndex((g) => g.group === 'theme')
      ordered.splice(insertAt < 0 ? ordered.length : insertAt, 0, {
        group: 'search',
        label: GROUP_LABEL.search,
        commands: [],
      })
    }
    return ordered
  }, [visibleCommands, showSearchGroup, promoted, nlCandidates])

  function isActiveSetting(cmd: RegisteredCommand): boolean {
    if (cmd.group === 'theme') {
      if (cmd.id === 'theme.light') return theme === 'light'
      if (cmd.id === 'theme.dark') return theme === 'dark'
      if (cmd.id === 'theme.system') return theme === 'system'
    }
    if (cmd.group === 'density') {
      if (cmd.id === 'density.comfortable') return density === 'comfortable'
      if (cmd.id === 'density.compact') return density === 'compact'
    }
    return false
  }

  /** 渲染单条命令项（「最近使用」推广区与原分组共用，保证行结构/图标/选中态一致）。 */
  function renderCommandItem(cmd: RegisteredCommand) {
    const Icon = cmd.icon
    const value = cmd.label + ' ' + (cmd.keywords?.join(' ') ?? '')
    const navHref = cmd.group === 'navigation' ? cmd.id.replace(/^nav\./, '') : null
    return (
      <Command.Item
        key={cmd.id}
        value={value}
        onSelect={() => runCommand(cmd)}
        className={commandItemClass}
      >
        <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
        <span className="flex-1 truncate">{cmd.label}</span>
        {cmd.shortcut ? (
          <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-border bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            {cmd.shortcut}
          </kbd>
        ) : null}
        {navHref ? <span className="text-xs text-gray-400">{navHref}</span> : null}
        {isActiveSetting(cmd) ? <Check className="h-4 w-4 text-primary-500" aria-hidden /> : null}
      </Command.Item>
    )
  }

  /**
   * 渲染插件命令项（「插件能力」分组，v3-command-palette-plugin-action-pack）。
   * 与通用项结构一致，附来源徽标与动作提示；键盘/屏幕阅读器语义沿用 cmdk。
   */
  function renderPluginCommandItem(cmd: RegisteredCommand) {
    const Icon = cmd.icon
    const value = cmd.label + ' 插件 ' + (cmd.keywords?.join(' ') ?? '')
    return (
      <Command.Item
        key={cmd.id}
        value={value}
        onSelect={() => runCommand(cmd)}
        className={commandItemClass}
        aria-label={`${cmd.label}（插件）`}
      >
        <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
        <span className="flex-1 truncate">{cmd.label}</span>
        <span
          className="shrink-0 rounded-[var(--radius-sm)] border border-border bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
          aria-hidden
        >
          插件
        </span>
        <span className="shrink-0 text-xs text-gray-400" aria-hidden>
          {pluginEffectHint(cmd.effect)}
        </span>
      </Command.Item>
    )
  }

  /**
   * 渲染自然语言候选项（design.md D4）。
   * 可执行候选复用既有 `runCommand(cmd)`，不新增自然语言专用写入路径（design.md D3）；
   * 阻断候选不可选中，只展示原因。value 内联当前输入，保证 cmdk 过滤不会把候选隐藏。
   */
  function renderNlCandidate(candidate: NaturalLanguageCommandCandidate, index: number) {
    const value = `智能建议 ${search} ${candidate.commandId ?? 'blocked-' + index} ${candidate.label} ${candidate.reason} ${candidate.previewText}`
    if (!candidate.command) {
      return (
        <Command.Item
          key={`nl-blocked-${index}`}
          value={value}
          disabled
          className={cn(commandItemClass, 'opacity-70')}
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span className="flex-1 truncate">
            <span className="block truncate">{candidate.label}</span>
            <span className="block truncate text-xs text-gray-400">
              {candidate.reason}，{candidate.previewText}
            </span>
          </span>
          <span className="shrink-0 text-xs text-amber-600">不可直接执行</span>
        </Command.Item>
      )
    }
    const cmd = candidate.command
    const Icon = cmd.icon
    return (
      <Command.Item
        key={`nl-${cmd.id}`}
        value={value}
        onSelect={() => runCommand(cmd)}
        className={commandItemClass}
      >
        <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
        <span className="flex-1 truncate">
          <span className="block truncate">{cmd.label}</span>
          <span className="block truncate text-xs text-gray-400">
            {candidate.reason}，{candidate.previewText}
          </span>
        </span>
        {candidate.requiresReview ? (
          <span className="shrink-0 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            需人工确认
          </span>
        ) : null}
      </Command.Item>
    )
  }

  // 快捷键管理界面
  if (showShortcutManager) {
    return (
      <CommandPaletteShortcutManager
        visibleCommands={visibleCommands}
        onBack={() => setShowShortcutManager(false)}
        onOpenChange={onOpenChange}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          'top-[10vh] left-1/2 -translate-x-1/2 translate-y-0',
          'w-[calc(100vw-2rem)] max-w-[640px] gap-0 p-0',
          'rounded-[var(--radius-lg)] z-[var(--z-command-palette)]',
        )}
      >
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">
          按上下键在命令列表中移动，按回车执行，按 Esc 关闭。
        </DialogDescription>
        <Command label="命令面板" shouldFilter className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="输入命令或搜索页面…"
              className={cn(
                'h-12 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-placeholder',
                focusRing,
              )}
            />
            <kbd className="hidden shrink-0 rounded-[var(--radius-sm)] border border-border bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 md:inline">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-1">
            {/* 空结果态转交入口（v3-copilot-command-palette-bridge）：
                仅当有非空输入且 handoffDecision.shouldHandoff 为 true 时显示。
                否则显示既有空状态文案。禁止静默自动转交（design.md D1）。 */}
            <Command.Empty className="px-4 py-8 text-center text-sm text-gray-500">
              {handoffDecision.shouldHandoff ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-gray-600">没有找到匹配的命令</p>
                  <button
                    type="button"
                    onClick={executeHandoff}
                    data-copilot-handoff-entry
                    aria-label={`将「${trimmedSearch}」交给 AI Copilot 处理`}
                    className={cn(
                      'flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-4 py-2.5',
                      'bg-gradient-to-r from-primary-50 to-ai/5 text-sm text-gray-700',
                      'hover:border-primary-300 hover:bg-primary-50 transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                    )}
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-primary-500" aria-hidden />
                    <span className="flex-1 text-left">交给 AI Copilot 处理</span>
                    <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-border bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                      {copilotShortcut}
                    </kbd>
                  </button>
                  <p className="text-xs text-gray-400">
                    或按{' '}
                    <kbd className="rounded-[var(--radius-sm)] border border-border bg-gray-50 px-1 py-0.5 text-[10px]">
                      {copilotShortcut}
                    </kbd>{' '}
                    直接打开 Copilot
                  </p>
                </div>
              ) : (
                '没有找到匹配的命令，可尝试高级搜索或换一种说法'
              )}
            </Command.Empty>

            {/* 「最近使用」推广区：仅当有可见的评分命令时渲染；无历史时不出现，
                面板保持既有 registry 驱动分组展示（design.md D5）。 */}
            {promoted.length > 0 && (
              <Command.Group heading="最近使用" className={commandGroupClass}>
                {promoted.map((p) => renderCommandItem(visibleById.get(p.id)!))}
              </Command.Group>
            )}

            {grouped.map((grp) => (
              <Command.Group key={grp.group} heading={grp.label} className={commandGroupClass}>
                {grp.group === 'nl-suggest' ? (
                  nlCandidates.map((candidate, index) => renderNlCandidate(candidate, index))
                ) : grp.group === 'search' ? (
                  <>
                    <Command.Item
                      value={'\u9ad8\u7ea7\u641c\u7d22 ' + search}
                      onSelect={() =>
                        runCommand({
                          id: 'search.advanced',
                          label: '\u641c\u7d22 "' + trimmedSearch + '"',
                          icon: Search,
                          group: 'search',
                          effect: 'navigate',
                          execute: () =>
                            router.push('/search?q=' + encodeURIComponent(trimmedSearch)),
                        } as RegisteredCommand)
                      }
                      className={commandItemClass}
                    >
                      <Search className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                      <span className="flex-1">{'\u641c\u7d22 "' + trimmedSearch + '"'}</span>
                      <ExternalLink className="h-3 w-3 text-gray-400" aria-hidden />
                    </Command.Item>
                    {suggestions.map((s) => (
                      <Command.Item
                        key={'' + s.entityType + '-' + s.entityId}
                        value={s.title + ' ' + s.entityType}
                        onSelect={() =>
                          runCommand({
                            id: 'search.suggest.' + s.entityType + '-' + s.entityId,
                            label: s.title,
                            icon: Search,
                            group: 'search',
                            effect: 'navigate',
                            execute: () => router.push(s.target),
                          } as RegisteredCommand)
                        }
                        className={commandItemClass}
                      >
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 shrink-0">
                          {getEntityTypeLabel(s.entityType).charAt(0)}
                        </span>
                        <span className="flex-1 truncate">{s.title}</span>
                        <span className="text-xs text-gray-400">
                          {getEntityTypeLabel(s.entityType)}
                        </span>
                      </Command.Item>
                    ))}
                  </>
                ) : grp.group === 'plugin' ? (
                  /* 插件能力分组（v3-command-palette-plugin-action-pack）：
                     错误边界隔离——单插件故障不影响面板打开与核心命令。 */
                  <PluginCommandErrorBoundary ownerKey="__palette_plugin_group__">
                    {grp.commands.map((cmd) => renderPluginCommandItem(cmd))}
                  </PluginCommandErrorBoundary>
                ) : (
                  grp.commands.map((cmd) => renderCommandItem(cmd))
                )}
              </Command.Group>
            ))}
          </Command.List>

          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => setShowShortcutManager(true)}
              className={cn(
                'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5',
                'text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                'transition-colors',
              )}
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
              <span>{'\u7ba1\u7406\u5feb\u6377\u952e\u2026'}</span>
              <kbd className="ml-auto rounded-[var(--radius-sm)] border border-border bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
                {'\u81ea\u5b9a\u4e49'}
              </kbd>
            </button>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

// ── 快捷键管理界面 ─────────────────────────────────────────

interface CommandPaletteShortcutManagerProps {
  visibleCommands: RegisteredCommand[]
  onBack: () => void
  onOpenChange: (open: boolean) => void
}

function CommandPaletteShortcutManager({
  visibleCommands,
  onBack,
  onOpenChange,
}: CommandPaletteShortcutManagerProps) {
  const [capturingId, setCapturingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [, forceUpdate] = React.useState(0)

  const effectiveShortcuts = useEffectiveShortcutDisplays(visibleCommands)

  function startCapture(commandId: string) {
    setCapturingId(commandId)
    setError(null)
  }

  function handleCaptureKeyDown(event: React.KeyboardEvent) {
    if (!capturingId) return
    event.preventDefault()
    event.stopPropagation()

    const chord = parseShortcutEvent(event.nativeEvent)
    if (!chord) return

    const localOverrides = shortcutOverrideStore.getAll()
    const currentBindings = resolveEffectiveBindings(visibleCommands, localOverrides)
    const filteredBindings = currentBindings.filter((b) => b.commandId !== capturingId)

    const result = detectShortcutConflict(chord, filteredBindings, visibleCommands)
    if (result.conflicted) {
      setError(result.reason ?? '\u5feb\u6377\u952e\u51b2\u7a81')
      return
    }

    setCustomShortcut(capturingId, chord)
    setCapturingId(null)
    setError(null)
    forceUpdate((n) => n + 1)
  }

  function handleClear(commandId: string) {
    clearCustomShortcut(commandId)
    forceUpdate((n) => n + 1)
  }

  function handleResetAll() {
    resetAllCustomShortcuts()
    forceUpdate((n) => n + 1)
  }

  const hasCustom = hasAnyCustomShortcut()

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          'top-[10vh] left-1/2 -translate-x-1/2 translate-y-0',
          'w-[calc(100vw-2rem)] max-w-[640px] gap-0 p-0',
          'rounded-[var(--radius-lg)] z-[var(--z-command-palette)]',
        )}
      >
        <DialogTitle className="sr-only">{'\u7ba1\u7406\u5feb\u6377\u952e'}</DialogTitle>
        <DialogDescription className="sr-only">
          {
            '\u4e3a\u5f53\u524d\u53ef\u89c1\u7684\u547d\u4ee4\u8bbe\u7f6e\u81ea\u5b9a\u4e49\u5feb\u6377\u952e\u3002\u70b9\u51fb\u547d\u4ee4\u884c\u540e\u6309\u952e\u76d8\u7ec4\u5408\u952e\uff0c\u51b2\u7a81\u6216\u4fdd\u7559\u5feb\u6377\u952e\u4f1a\u88ab\u62e6\u622a\u3002'
          }
        </DialogDescription>

        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            <span aria-hidden>{'\u2190'}</span>
            <span>{'\u8fd4\u56de\u547d\u4ee4\u9762\u677f'}</span>
          </button>
          <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
            {'\u7ba1\u7406\u5feb\u6377\u952e'}
          </span>
          <div className="w-16" />
        </div>

        <div
          className="max-h-[55vh] overflow-y-auto p-1"
          onKeyDown={capturingId ? handleCaptureKeyDown : undefined}
          tabIndex={capturingId ? 0 : undefined}
        >
          {capturingId && (
            <div className="mx-2 mb-2 rounded-[var(--radius-sm)] bg-primary-50 px-3 py-2 text-xs text-primary-700">
              {
                '\u6309\u952e\u76d8\u7ec4\u5408\u952e\u6765\u8bbe\u7f6e\u5feb\u6377\u952e\u2026 \u6309 Esc \u53d6\u6d88'
              }
              {error && <span className="ml-2 text-red-600">{'\uff08' + error + '\uff09'}</span>}
            </div>
          )}

          {visibleCommands.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {'\u5f53\u524d\u6ca1\u6709\u53ef\u89c1\u547d\u4ee4'}
            </div>
          )}

          {visibleCommands.map((cmd) => {
            const shortcut = effectiveShortcuts.get(cmd.id)
            const Icon = cmd.icon
            return (
              <div
                key={cmd.id}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-gray-700"
              >
                <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                <span className="flex-1 truncate">{cmd.label}</span>

                {capturingId === cmd.id ? (
                  <span className="text-xs text-primary-600 animate-pulse">
                    {'\u7b49\u5f85\u6309\u952e\u2026'}
                  </span>
                ) : (
                  <>
                    {shortcut ? (
                      <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-border bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        {shortcut.display}
                      </kbd>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startCapture(cmd.id)}
                      className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title={'\u4e3a\u300c' + cmd.label + '\u300d\u8bbe\u7f6e\u5feb\u6377\u952e'}
                    >
                      {'\u8bbe\u7f6e'}
                    </button>
                    {shortcut?.isCustom && (
                      <button
                        type="button"
                        onClick={() => handleClear(cmd.id)}
                        className="shrink-0 text-[10px] text-red-400 hover:text-red-600 transition-colors"
                        title={
                          '\u6e05\u9664\u300c' +
                          cmd.label +
                          '\u300d\u7684\u81ea\u5b9a\u4e49\u5feb\u6377\u952e'
                        }
                      >
                        {'\u6e05\u9664'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-[10px] text-gray-400">
            {hasCustom
              ? '\u5df2\u8bbe\u7f6e\u81ea\u5b9a\u4e49\u5feb\u6377\u952e'
              : '\u672a\u8bbe\u7f6e\u81ea\u5b9a\u4e49\u5feb\u6377\u952e'}
          </span>
          {hasCustom && (
            <button
              type="button"
              onClick={handleResetAll}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 transition-colors"
            >
              {'\u91cd\u7f6e\u5168\u90e8'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const commandGroupClass = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2',
  '[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider',
  '[&_[cmdk-group-heading]]:text-gray-400',
)

/** 插件命令动作提示（低敏展示；写入型入口显示「预览」——preview ≠ 提交）。 */
function pluginEffectHint(effect: RegisteredCommand['effect']): string {
  switch (effect) {
    case 'navigate':
      return '导航'
    case 'open-form':
      return '表单'
    case 'open-confirm':
      return '确认'
    case 'ui-setting':
      return '设置'
    default:
      return ''
  }
}

const commandItemClass = cn(
  'flex cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-gray-700',
  'data-[selected=true]:bg-primary-50 data-[selected=true]:text-primary-700',
  '[&_svg]:h-4 [&_svg]:w-4',
)
