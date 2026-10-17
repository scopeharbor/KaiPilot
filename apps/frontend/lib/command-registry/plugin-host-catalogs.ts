/**
 * plugin-host-catalogs.ts —— Core-owned presentation & action catalogs
 * for plugin UI command extension pilot.
 *
 * - Presentation catalog: icon keys, fixed extension group, source labels.
 * - Action catalog: navigate / open-form / open-confirm with host handlers.
 * - Both catalogs are core-owned and versioned.
 * - Plugin data is only consumed as restricted display input.
 */

import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  AlertTriangle,
  Archive,
  Circle,
  HelpCircle,
  FileText,
  CheckCircle,
  Settings,
  Users,
  FolderOpen,
  Calendar,
  LayoutDashboard,
  GanttChart,
  List,
  Kanban,
  Search,
  Shield,
  Brain,
} from 'lucide-react'

// =============================================================================
// 1. Presentation Catalog
// =============================================================================

/** Allowed icon keys for plugin commands. */
export const PLUGIN_PRESENTATION_ICONS: Record<string, LucideIcon> = {
  BarChart3,
  AlertTriangle,
  Archive,
  Circle,
  HelpCircle,
  FileText,
  CheckCircle,
  Settings,
  Users,
  FolderOpen,
  Calendar,
  LayoutDashboard,
  GanttChart,
  List,
  Kanban,
  Search,
  Shield,
  Brain,
}

/** Fallback icon for unknown icon keys. */
export const PLUGIN_FALLBACK_ICON = Circle

/** Extension group label for plugin commands. */
export const PLUGIN_COMMAND_GROUP = 'custom' as const

/** Source label prefix for plugin commands. */
export const PLUGIN_SOURCE_LABEL_PREFIX = '插件'

/**
 * Resolve an icon key to a Lucide icon component.
 * Returns fallback icon for unknown keys.
 */
export function resolvePluginIcon(iconKey: string): LucideIcon {
  return PLUGIN_PRESENTATION_ICONS[iconKey] ?? PLUGIN_FALLBACK_ICON
}

/**
 * Validate that an icon key is in the presentation catalog.
 */
export function isValidPluginIconKey(iconKey: string): boolean {
  return iconKey in PLUGIN_PRESENTATION_ICONS
}

// =============================================================================
// 2. Action Catalog
// =============================================================================

/** Action handler context (passed to execute). */
export interface PluginActionContext {
  /** Current pathname. */
  pathname: string
  /** Route params. */
  params: Record<string, string | string[]>
  /** Search params. */
  searchParams: URLSearchParams
}

/** Action catalog entry. */
export interface PluginActionEntry {
  /** Action key (must match contribution's actionKey). */
  actionKey: string
  /**
   * Action kind。
   * v3-command-palette-plugin-action-pack 新增 `open-plugin-action-preview`：
   * 写入型入口唯一允许的 kind——宿主只打开宿主生成的 action preview，
   * 在 RegisteredCommand 层映射为确认类副作用（open-confirm 语义：只开界面，不落库）。
   */
  kind: 'navigate' | 'open-form' | 'open-confirm' | 'open-plugin-action-preview'
  /** Human-readable effect description. */
  effect: string
  /** Required host permission for this action. */
  requiredPermission?: string
  /** Allowed scope for action params. */
  allowedParamKeys: string[]
  /** Safe failure message. */
  failureMessage: string
}

/** Host action catalog (core-owned, versioned). */
export const PLUGIN_ACTION_CATALOG: Record<string, PluginActionEntry> = {
  navigate: {
    actionKey: 'navigate',
    kind: 'navigate',
    effect: '导航到指定页面',
    allowedParamKeys: ['route'],
    failureMessage: '导航目标不可用',
  },
  'open-form': {
    actionKey: 'open-form',
    kind: 'open-form',
    effect: '打开表单页面',
    requiredPermission: 'form:open',
    allowedParamKeys: ['formId'],
    failureMessage: '表单不可用',
  },
  'open-confirm': {
    actionKey: 'open-confirm',
    kind: 'open-confirm',
    effect: '打开确认对话框',
    requiredPermission: 'confirm:open',
    allowedParamKeys: ['confirmId'],
    failureMessage: '确认对话框不可用',
  },
  'open-plugin-action-preview': {
    actionKey: 'open-plugin-action-preview',
    kind: 'open-plugin-action-preview',
    effect: '打开插件动作预览（正式写入前必须经宿主确认边界）',
    requiredPermission: 'preview:open',
    allowedParamKeys: ['actionRef'],
    failureMessage: '插件动作预览不可用',
  },
}

/**
 * Resolve an action key to its catalog entry.
 * Returns undefined for unknown action keys.
 */
export function resolvePluginAction(actionKey: string): PluginActionEntry | undefined {
  return PLUGIN_ACTION_CATALOG[actionKey]
}

/**
 * Validate that an action key is in the action catalog.
 */
export function isValidPluginActionKey(actionKey: string): boolean {
  return actionKey in PLUGIN_ACTION_CATALOG
}

/**
 * Validate action params against the catalog entry.
 * Returns blocking findings for invalid params.
 */
export function validateActionParams(actionKey: string, params: Record<string, string>): string[] {
  const entry = PLUGIN_ACTION_CATALOG[actionKey]
  if (!entry) return [`unknown-action:${actionKey}`]

  const errors: string[] = []
  const paramKeys = Object.keys(params)

  // Check for unknown param keys
  for (const key of paramKeys) {
    if (!entry.allowedParamKeys.includes(key)) {
      errors.push(`unexpected-param:${key}`)
    }
  }

  // Check for missing required params
  if (actionKey === 'navigate' && !params.route) {
    errors.push('missing-param:route')
  }
  if (actionKey === 'open-form' && !params.formId) {
    errors.push('missing-param:formId')
  }
  if (actionKey === 'open-confirm' && !params.confirmId) {
    errors.push('missing-param:confirmId')
  }
  if (actionKey === 'open-plugin-action-preview' && !params.actionRef) {
    errors.push('missing-param:actionRef')
  }

  // Check for dangerous URL patterns
  for (const [key, value] of Object.entries(params)) {
    if (/^javascript:/i.test(value) || /^data:/i.test(value)) {
      errors.push(`dangerous-url:${key}`)
    }
  }

  return errors
}
