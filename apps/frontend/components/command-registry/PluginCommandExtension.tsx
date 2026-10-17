/**
 * PluginCommandExtension.tsx —— Plugin command extension for Command Palette.
 *
 * - Renders plugin commands in fixed extension group with source label (task 6.1)
 * - Reuses existing search, keyboard, shortcuts, MRU/frecency, runCommand (task 6.1)
 * - No second panel or history (task 6.1)
 * - Error isolation: single plugin failure doesn't affect others (task 6.3)
 * - Accessibility: focus, keyboard, screen reader, error live region (task 6.5)
 * - Theme/density: uses host tokens only (task 6.7)
 */

'use client'

import * as React from 'react'
import type { RegisteredCommand } from '../../lib/command-registry/types'
import { useCommandRegistryStore } from '../../lib/command-registry/store'

// =============================================================================
// 1. Plugin command extension group
// =============================================================================

/**
 * Plugin command group label (fixed extension group).
 */
const PLUGIN_GROUP_LABEL = '插件'

/**
 * Error boundary for plugin command isolation.
 * Single plugin failure doesn't affect other plugins or core commands.
 * v3-command-palette-plugin-action-pack：导出给主面板「插件能力」分组复用。
 */
export class PluginCommandErrorBoundary extends React.Component<
  { children: React.ReactNode; ownerKey: string; onError?: (ownerKey: string) => void },
  { hasError: boolean; error?: Error }
> {
  constructor(props: {
    children: React.ReactNode
    ownerKey: string
    onError?: (ownerKey: string) => void
  }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[plugin-command] Extension error for owner "${this.props.ownerKey}":`,
      error,
      errorInfo,
    )
    // Notify parent to remove this owner's commands
    this.props.onError?.(this.props.ownerKey)
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground px-2 py-1">
          插件命令加载失败，请稍后重试
        </div>
      )
    }
    return this.props.children
  }
}

// =============================================================================
// 2. Plugin command item component
// =============================================================================

interface PluginCommandItemProps {
  command: RegisteredCommand
  ownerKey?: string
  sourceLabel?: string
  onSelect: (command: RegisteredCommand) => void
}

/**
 * Single plugin command item in the Command Palette.
 * Uses host design tokens, keyboard semantics, and screen reader labels.
 */
function PluginCommandItem({ command, ownerKey, sourceLabel, onSelect }: PluginCommandItemProps) {
  const Icon = command.icon

  return (
    <div
      role="option"
      aria-selected={false}
      aria-label={`${command.label}${sourceLabel ? ` (${sourceLabel})` : ''}`}
      tabIndex={-1}
      className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground outline-none"
      onClick={() => onSelect(command)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(command)
        }
      }}
      data-command-id={command.id}
      data-owner-key={ownerKey}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{command.label}</span>
      {sourceLabel && (
        <span className="text-xs text-muted-foreground truncate max-w-[100px]" aria-hidden="true">
          {sourceLabel}
        </span>
      )}
      {command.effect && (
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          {command.effect === 'navigate'
            ? '导航'
            : command.effect === 'open-form'
              ? '表单'
              : '确认'}
        </span>
      )}
    </div>
  )
}

// =============================================================================
// 3. Plugin command extension renderer
// =============================================================================

interface PluginCommandExtensionProps {
  /** Plugin commands grouped by owner key. */
  pluginCommands: Map<string, RegisteredCommand[]>
  /** Owner metadata for source labels. */
  ownerLabels: Map<string, string>
  /** Callback when a command is selected. */
  onSelect: (command: RegisteredCommand) => void
  /** Callback when an owner's commands should be removed due to error. */
  onOwnerError?: (ownerKey: string) => void
}

/**
 * Renders plugin commands in the Command Palette extension group.
 * Each owner's commands are wrapped in an error boundary.
 */
export function PluginCommandExtension({
  pluginCommands,
  ownerLabels,
  onSelect,
  onOwnerError,
}: PluginCommandExtensionProps) {
  if (pluginCommands.size === 0) return null

  return (
    <div role="group" aria-label={PLUGIN_GROUP_LABEL}>
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
        {PLUGIN_GROUP_LABEL}
      </div>
      {Array.from(pluginCommands.entries()).map(([ownerKey, commands]) => (
        <PluginCommandErrorBoundary key={ownerKey} ownerKey={ownerKey} onError={onOwnerError}>
          <div role="group" aria-label={`插件 ${ownerLabels.get(ownerKey) ?? ownerKey}`}>
            {commands.map((cmd) => (
              <PluginCommandItem
                key={cmd.id}
                command={cmd}
                ownerKey={ownerKey}
                sourceLabel={ownerLabels.get(ownerKey)}
                onSelect={onSelect}
              />
            ))}
          </div>
        </PluginCommandErrorBoundary>
      ))}
    </div>
  )
}

// =============================================================================
// 4. Hook to extract plugin commands from store
// =============================================================================

/**
 * Hook that extracts plugin commands from the command store,
 * grouped by owner key, with source labels.
 */
export function usePluginCommands() {
  const ownerMeta = useCommandRegistryStore((s) => s.ownerMeta)
  const commands = useCommandRegistryStore((s) => s.commands)

  return React.useMemo(() => {
    const pluginCommands = new Map<string, RegisteredCommand[]>()
    const ownerLabels = new Map<string, string>()

    for (const [id, meta] of ownerMeta) {
      if (meta.sourceKind !== 'plugin-ui-command') continue

      const cmd = commands.get(id)
      if (!cmd) continue

      const existing = pluginCommands.get(meta.ownerKey) ?? []
      existing.push(cmd)
      pluginCommands.set(meta.ownerKey, existing)

      // Set owner label (use ownerKey as fallback)
      if (!ownerLabels.has(meta.ownerKey)) {
        ownerLabels.set(meta.ownerKey, meta.ownerKey)
      }
    }

    return { pluginCommands, ownerLabels }
  }, [ownerMeta, commands])
}
