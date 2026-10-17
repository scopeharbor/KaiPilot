/**
 * 快捷键核心类型与帮助函数（spec command-palette / design.md D1）。
 *
 * 所有快捷键规范化、格式化、保留检测和冲突解析逻辑集中于此。
 * 纯函数，零外部依赖，可直接单元测试。
 */

/**
 * 规范化快捷键和弦。
 *
 * 修饰键按固定顺序排列：Meta/Ctrl → Shift → Alt（platform-aware: Mac 用 Meta, 其他用 Ctrl）
 * 主键小写
 * 分隔符统一用 `+`
 * 例：`"meta+shift+p"`、`"ctrl+alt+delete"`、`"escape"`
 */
export type ShortcutChord = string

/** 修饰键集合，用于规范化判定。 */
const MODIFIERS = ['meta', 'ctrl', 'alt', 'shift'] as const
type Modifier = (typeof MODIFIERS)[number]

/** 修饰键排序优先级（显示顺序）。 */
const MODIFIER_ORDER: Record<Modifier, number> = {
  meta: 0,
  ctrl: 1,
  alt: 2,
  shift: 3,
}

/** 从 KeyboardEvent.key 值映射到规范化修饰键名。 */
const KEY_TO_MODIFIER: Record<string, string> = {
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  meta: 'meta',
}

/** 从 KeyboardEvent 映射到规范化键名。 */
function eventKeyToNormalized(eventKey: string): string {
  const lower = eventKey.toLowerCase()
  const specialMap: Record<string, string> = {
    ' ': 'space',
    escape: 'escape',
    enter: 'enter',
    tab: 'tab',
    backspace: 'backspace',
    delete: 'delete',
    arrowup: 'arrowup',
    arrowdown: 'arrowdown',
    arrowleft: 'arrowleft',
    arrowright: 'arrowright',
    home: 'home',
    end: 'end',
    pageup: 'pageup',
    pagedown: 'pagedown',
  }
  return specialMap[lower] ?? lower
}

/** 是否是修饰键名。 */
function isModifierKey(key: string): boolean {
  return (MODIFIERS as readonly string[]).includes(key.toLowerCase())
}

/** 检查 KeyboardEvent.key 是否为修饰键原始值。 */
function isModifierEventKey(key: string): boolean {
  return key.toLowerCase() in KEY_TO_MODIFIER
}

/**
 * 从原生的 KeyboardEvent 按规范化为规范和弦字符串。
 * 返回 `null` 表示无法解析（例如纯修饰键按下）。
 */
export function parseShortcutEvent(event: KeyboardEvent): ShortcutChord | null {
  const key = eventKeyToNormalized(event.key)
  if (key === '' || isModifierEventKey(event.key) || isModifierKey(key)) return null

  const parts: string[] = []
  if (event.metaKey) parts.push('meta')
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key)

  return parts.join('+')
}

/** 已知的单键非字母数字键名（可无修饰键独立绑定）。 */
const KNOWN_SINGLE_KEYS = new Set([
  'space',
  'enter',
  'escape',
  'tab',
  'backspace',
  'delete',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'home',
  'end',
  'pageup',
  'pagedown',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
  'f13',
  'f14',
  'f15',
  'f16',
  'f17',
  'f18',
  'f19',
  'f20',
  'insert',
  'printscreen',
  'scrolllock',
  'pause',
  'capslock',
  'numlock',
])

/** 检查字符串是否为合法的单键名。 */
function isValidSingleKey(key: string): boolean {
  if (key.length === 1) return /^[a-z0-9]$/.test(key)
  return KNOWN_SINGLE_KEYS.has(key)
}

/**
 * 从用户输入字符串解析为规范和弦。
 * 支持格式："Cmd+Shift+P"、"ctrl+alt+del"、"Meta+Shift+S" 等。
 * 返回 `null` 表示无法解析。
 */
export function parseShortcutInput(input: string): ShortcutChord | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const parts = trimmed
    .split(/\+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0 || parts.length > 4) return null

  const mods: string[] = []
  const keys: string[] = []
  for (const p of parts) {
    const alias: Record<string, string> = {
      command: 'meta',
      cmd: 'meta',
      '\u2318': 'meta',
      control: 'ctrl',
      '\u2303': 'ctrl',
      option: 'alt',
      opt: 'alt',
      '\u2325': 'alt',
      '\u21e7': 'shift',
      shift: 'shift',
    }
    const resolved = alias[p] ?? p
    if ((MODIFIERS as readonly string[]).includes(resolved)) {
      mods.push(resolved)
    } else {
      keys.push(resolved)
    }
  }

  if (keys.length === 0 || keys.length > 1) return null

  // 无修饰键时只允许合法单键
  const mainKey = keys[0]!
  if (mods.length === 0 && !isValidSingleKey(mainKey)) return null

  const uniqueMods = [...new Set(mods)].sort(
    (a, b) => MODIFIER_ORDER[a as Modifier] - MODIFIER_ORDER[b as Modifier],
  )
  return [...uniqueMods, mainKey].join('+')
}

/**
 * 将规范和弦格式化为人类可读的显示文本。
 * Mac 用 ⌘⌥⇧ 符号，其他平台用 Ctrl+Alt+Shift 文字。
 */
export function formatShortcut(chord: ShortcutChord, platform: 'mac' | 'win' = 'win'): string {
  if (!chord) return ''

  const parts = chord.split('+')
  if (platform === 'mac') {
    const symMap: Record<string, string> = {
      meta: '\u2318',
      ctrl: '\u2303',
      alt: '\u2325',
      shift: '\u21e7',
    }
    return parts
      .map((p) => {
        const sym = symMap[p]
        if (sym) return sym
        if (p.length === 1) return p.toUpperCase()
        return p.charAt(0).toUpperCase() + p.slice(1)
      })
      .join('')
  }

  const labelMap: Record<string, string> = {
    meta: 'Win',
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
  }
  return parts.map((p) => labelMap[p] ?? p.charAt(0).toUpperCase() + p.slice(1)).join('+')
}

// ─── 保留快捷键定义 ─────────────────────────────────────────

/** 系统保留快捷键列表（浏览器/OS 级别，不可自定义）。 */
const RESERVED_CHORDS = new Set<string>([
  'meta+k',
  'ctrl+k',
  'f5',
  'ctrl+f5',
  'meta+f5',
  'ctrl+r',
  'meta+r',
  'ctrl+w',
  'meta+w',
  'ctrl+t',
  'meta+t',
  'ctrl+n',
  'meta+n',
  'ctrl+f',
  'meta+f',
  'ctrl+p',
  'meta+p',
  'ctrl+s',
  'meta+s',
  'ctrl+c',
  'meta+c',
  'ctrl+x',
  'meta+x',
  'ctrl+v',
  'meta+v',
  'ctrl+z',
  'meta+z',
  'ctrl+y',
  'meta+y',
  'ctrl+a',
  'meta+a',
  'ctrl+l',
  'meta+l',
  'ctrl+d',
  'meta+d',
  'ctrl+e',
  'meta+e',
  'ctrl+j',
  'meta+j',
  'ctrl+u',
  'meta+u',
  'ctrl+i',
  'meta+i',
  'ctrl+b',
  'meta+b',
  'ctrl+h',
  'meta+h',
  'ctrl+o',
  'meta+o',
  'f12',
  'ctrl+shift+i',
  'meta+alt+i',
  'meta+shift+i',
  'alt+d',
  'ctrl+tab',
  'ctrl+shift+tab',
  'meta+shift+]',
  'meta+shift+[',
])

/** 检查规范和弦是否为保留快捷键。 */
export function isReserved(chord: ShortcutChord): boolean {
  return RESERVED_CHORDS.has(chord)
}

// ─── 冲突检测 ──────────────────────────────────────────────

export interface ConflictResult {
  conflicted: boolean
  reason?: string
  conflictingCommandId?: string
}

export interface ShortcutBinding {
  commandId: string
  chord: ShortcutChord
}

/**
 * 检测候选快捷键是否与当前绑定或保留快捷键冲突。
 */
export function detectShortcutConflict(
  candidate: ShortcutChord,
  currentBindings: ShortcutBinding[],
  visibleCommands: Array<{ id: string; label: string }>,
): ConflictResult {
  if (isReserved(candidate)) {
    if (candidate === 'meta+k' || candidate === 'ctrl+k') {
      return {
        conflicted: true,
        reason:
          '\u300cCmd/Ctrl+K\u300d\u5df2\u4fdd\u7559\u4e3a\u547d\u4ee4\u9762\u677f\u5524\u8d77\u5feb\u6377\u952e',
      }
    }
    return {
      conflicted: true,
      reason:
        '\u8be5\u5feb\u6377\u952e\u5df2\u7531\u6d4f\u89c8\u5668\u6216\u7cfb\u7edf\u4fdd\u7559\uff0c\u4e0d\u53ef\u7ed1\u5b9a',
    }
  }

  const existing = currentBindings.find((b) => b.chord === candidate)
  if (existing) {
    const cmd = visibleCommands.find((c) => c.id === existing.commandId)
    const label = cmd?.label ?? existing.commandId
    return {
      conflicted: true,
      reason: '\u5feb\u6377\u952e\u5df2\u7ed1\u5b9a\u5230\u300c' + label + '\u300d',
      conflictingCommandId: existing.commandId,
    }
  }

  return { conflicted: false }
}

// ─── 有效快捷键解析 ────────────────────────────────────────

/**
 * 解析命令的有效快捷键。
 * 优先级：本地覆盖 → 可解析默认快捷键 → 无。
 */
export function resolveEffectiveShortcut(
  cmd: { id: string; shortcut?: string },
  localOverrides: Map<string, { chord: string }>,
): { binding: ShortcutChord | null; display: string } {
  const local = localOverrides.get(cmd.id)
  if (local) {
    return { binding: local.chord, display: local.chord }
  }

  if (cmd.shortcut) {
    const parsed = parseShortcutInput(cmd.shortcut)
    if (parsed) {
      return { binding: parsed, display: cmd.shortcut }
    }
    return { binding: null, display: cmd.shortcut }
  }

  return { binding: null, display: '' }
}

/**
 * 批量解析可见命令的有效快捷键，返回可查表。
 */
export function resolveEffectiveBindings(
  commands: Array<{ id: string; shortcut?: string }>,
  localOverrides: Map<string, { chord: string }>,
): ShortcutBinding[] {
  const bindings: ShortcutBinding[] = []
  for (const cmd of commands) {
    const local = localOverrides.get(cmd.id)
    if (local) {
      bindings.push({ commandId: cmd.id, chord: local.chord })
      continue
    }
    if (cmd.shortcut) {
      const parsed = parseShortcutInput(cmd.shortcut)
      if (parsed) {
        bindings.push({ commandId: cmd.id, chord: parsed })
      }
    }
  }
  return bindings
}

/** 判断键盘事件目标是否处于文本编辑上下文。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  const el = target as HTMLElement
  if (el.isContentEditable || el.contentEditable === 'true') return true
  if (target.closest('[cmdk-input]') || target.closest('[data-cmdk-input]')) return true
  return false
}
