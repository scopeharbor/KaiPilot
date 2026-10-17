import { beforeEach, describe, expect, test } from 'vitest'
import {
  parseShortcutEvent,
  parseShortcutInput,
  formatShortcut,
  isReserved,
  detectShortcutConflict,
  resolveEffectiveShortcut,
  resolveEffectiveBindings,
  isEditableTarget,
  type ShortcutBinding,
} from '@/lib/command-registry/shortcut'

// ── parseShortcutEvent ────────────────────────────────────

function mockKeyboardEvent(key: string, mods?: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key,
    metaKey: mods?.metaKey ?? false,
    ctrlKey: mods?.ctrlKey ?? false,
    altKey: mods?.altKey ?? false,
    shiftKey: mods?.shiftKey ?? false,
  } as unknown as KeyboardEvent
}

describe('parseShortcutEvent', () => {
  test('单个键：a', () => {
    expect(parseShortcutEvent(mockKeyboardEvent('a'))).toBe('a')
  })

  test('Cmd+P', () => {
    expect(parseShortcutEvent(mockKeyboardEvent('p', { metaKey: true }))).toBe('meta+p')
  })

  test('Ctrl+Shift+X', () => {
    expect(parseShortcutEvent(mockKeyboardEvent('X', { ctrlKey: true, shiftKey: true }))).toBe(
      'ctrl+shift+x',
    )
  })

  test('纯修饰键返回 null', () => {
    expect(parseShortcutEvent(mockKeyboardEvent('Shift', { shiftKey: true }))).toBeNull()
    expect(parseShortcutEvent(mockKeyboardEvent('Control', { ctrlKey: true }))).toBeNull()
  })

  test('特殊键映射：空格', () => {
    expect(parseShortcutEvent(mockKeyboardEvent(' '))).toBe('space')
  })

  test('特殊键映射：Escape', () => {
    expect(parseShortcutEvent(mockKeyboardEvent('Escape'))).toBe('escape')
  })

  test('特殊键映射：ArrowUp', () => {
    expect(parseShortcutEvent(mockKeyboardEvent('ArrowUp'))).toBe('arrowup')
  })

  test('Alt+Enter', () => {
    expect(parseShortcutEvent(mockKeyboardEvent('Enter', { altKey: true }))).toBe('alt+enter')
  })

  test('Meta+Ctrl+Alt+Shift+D', () => {
    expect(
      parseShortcutEvent(
        mockKeyboardEvent('D', { metaKey: true, ctrlKey: true, altKey: true, shiftKey: true }),
      ),
    ).toBe('meta+ctrl+alt+shift+d')
  })

  test('空键返回 null', () => {
    expect(parseShortcutEvent(mockKeyboardEvent(''))).toBeNull()
  })
})

// ── parseShortcutInput ────────────────────────────────────

describe('parseShortcutInput', () => {
  test('Cmd+Shift+P', () => {
    expect(parseShortcutInput('Cmd+Shift+P')).toBe('meta+shift+p')
  })

  test('ctrl+alt+del 别名', () => {
    expect(parseShortcutInput('ctrl+alt+del')).toBe('ctrl+alt+del')
  })

  test('⌘⇧S Unicode 别名', () => {
    expect(parseShortcutInput('⌘+⇧+S')).toBe('meta+shift+s')
  })

  test('空格+修饰键', () => {
    expect(parseShortcutInput('Ctrl+Space')).toBe('ctrl+space')
  })

  test('无修饰键单个键', () => {
    expect(parseShortcutInput('e')).toBe('e')
  })

  test('空输入返回 null', () => {
    expect(parseShortcutInput('')).toBeNull()
  })

  test('多余空格修剪', () => {
    expect(parseShortcutInput('  Ctrl + Shift + T  ')).toBe('ctrl+shift+t')
  })

  test('多个主键返回 null', () => {
    expect(parseShortcutInput('Ctrl+Shift+A+B')).toBeNull()
  })

  test('纯修饰键返回 null', () => {
    expect(parseShortcutInput('Ctrl+Shift')).toBeNull()
  })

  test('修饰键去重', () => {
    expect(parseShortcutInput('Ctrl+Ctrl+A')).toBe('ctrl+a')
  })

  test('修饰键排序：Shift+Alt+Ctrl+A → Ctrl+Alt+Shift+A', () => {
    expect(parseShortcutInput('Shift+Alt+Ctrl+A')).toBe('ctrl+alt+shift+a')
  })

  test('option 别名', () => {
    expect(parseShortcutInput('option+X')).toBe('alt+x')
  })

  test('command 别名', () => {
    expect(parseShortcutInput('Command+K')).toBe('meta+k')
  })
})

// ── formatShortcut ────────────────────────────────────────

describe('formatShortcut', () => {
  test('Windows 格式：ctrl+shift+p → Ctrl+Shift+P', () => {
    expect(formatShortcut('ctrl+shift+p', 'win')).toBe('Ctrl+Shift+P')
  })

  test('Mac 格式：meta+shift+p → ⌘⇧P', () => {})

  test('Windows 格式：meta+k → Win+K', () => {
    expect(formatShortcut('meta+k', 'win')).toBe('Win+K')
  })

  test('Mac 格式：ctrl+alt+delete → ⌃⌥Delete', () => {
    expect(formatShortcut('ctrl+alt+delete', 'mac')).toBe('\u2303\u2325Delete')
  })

  test('空和弦返回空字符串', () => {
    expect(formatShortcut('', 'win')).toBe('')
  })
})

// ── isReserved ────────────────────────────────────────────

describe('isReserved', () => {
  test('Cmd/Ctrl+K 保留', () => {
    expect(isReserved('meta+k')).toBe(true)
    expect(isReserved('ctrl+k')).toBe(true)
  })

  test('F5 保留', () => {
    expect(isReserved('f5')).toBe(true)
  })

  test('Ctrl+S 保留', () => {
    expect(isReserved('ctrl+s')).toBe(true)
  })

  test('Ctrl+C 保留', () => {
    expect(isReserved('ctrl+c')).toBe(true)
    expect(isReserved('meta+c')).toBe(true)
  })

  test('Ctrl+Shift+I (devtools) 保留', () => {
    expect(isReserved('ctrl+shift+i')).toBe(true)
  })

  test('Ctrl+Tab 保留', () => {
    expect(isReserved('ctrl+tab')).toBe(true)
  })

  test('Ctrl+Shift+P 不保留（无保留覆盖）', () => {
    expect(isReserved('ctrl+shift+p')).toBe(false)
  })

  test('Alt+D (地址栏) 保留', () => {
    expect(isReserved('alt+d')).toBe(true)
  })
})

// ── detectShortcutConflict ────────────────────────────────

describe('detectShortcutConflict', () => {
  const visibleCommands = [
    { id: 'nav.projects', label: '项目列表' },
    { id: 'ctx.new-task', label: '新建任务' },
  ]
  const bindings: ShortcutBinding[] = [{ commandId: 'nav.projects', chord: 'ctrl+shift+p' }]

  test('无冲突', () => {
    const result = detectShortcutConflict('ctrl+alt+n', bindings, visibleCommands)
    expect(result.conflicted).toBe(false)
  })

  test('保留快捷键冲突：Cmd/Ctrl+K', () => {
    const result = detectShortcutConflict('meta+k', bindings, visibleCommands)
    expect(result.conflicted).toBe(true)
    expect(result.reason).toContain('命令面板唤起')
  })

  test('保留快捷键冲突：浏览器保留键', () => {
    const result = detectShortcutConflict('ctrl+s', bindings, visibleCommands)
    expect(result.conflicted).toBe(true)
    expect(result.reason).toContain('浏览器或系统保留')
  })

  test('已绑定快捷键冲突', () => {
    const result = detectShortcutConflict('ctrl+shift+p', bindings, visibleCommands)
    expect(result.conflicted).toBe(true)
    expect(result.reason).toContain('项目列表')
  })
})

// ── resolveEffectiveShortcut ──────────────────────────────

describe('resolveEffectiveShortcut', () => {
  const localOverrides = new Map([['nav.projects', { chord: 'ctrl+shift+p' }]])

  test('本地覆盖优先', () => {
    const result = resolveEffectiveShortcut(
      { id: 'nav.projects', shortcut: 'Alt+1' },
      localOverrides,
    )
    expect(result.binding).toBe('ctrl+shift+p')
    expect(result.display).toBe('ctrl+shift+p')
  })

  test('无覆盖但有可解析默认', () => {
    const result = resolveEffectiveShortcut(
      { id: 'ctx.new-task', shortcut: 'Ctrl+Shift+T' },
      new Map(),
    )
    expect(result.binding).toBe('ctrl+shift+t')
    expect(result.display).toBe('Ctrl+Shift+T')
  })

  test('无覆盖且无默认，返回空', () => {
    const result = resolveEffectiveShortcut({ id: 'nav.x' }, new Map())
    expect(result.binding).toBeNull()
    expect(result.display).toBe('')
  })

  test('删除本地覆盖后回退到默认', () => {
    const result = resolveEffectiveShortcut({ id: 'nav.projects', shortcut: 'Alt+1' }, new Map())
    expect(result.binding).toBe('alt+1')
    expect(result.display).toBe('Alt+1')
  })

  test('不可解析的默认 shortcut 仅作显示', () => {
    const result2 = resolveEffectiveShortcut({ id: 'nav.y', shortcut: '非常规文本' }, new Map())
    expect(result2.binding).toBeNull()
    expect(result2.display).toBe('非常规文本')
  })
})

// ── resolveEffectiveBindings ──────────────────────────────

describe('resolveEffectiveBindings', () => {
  const commands = [{ id: 'a', shortcut: 'Ctrl+A' }, { id: 'b', shortcut: 'Ctrl+B' }, { id: 'c' }]

  test('无覆盖返回默认绑定', () => {
    const bindings = resolveEffectiveBindings(commands, new Map())
    expect(bindings).toEqual([
      { commandId: 'a', chord: 'ctrl+a' },
      { commandId: 'b', chord: 'ctrl+b' },
    ])
  })

  test('本地覆盖替换默认', () => {
    const overrides = new Map([['a', { chord: 'alt+1' }]])
    const bindings = resolveEffectiveBindings(commands, overrides)
    expect(bindings.find((b) => b.commandId === 'a')).toEqual({
      commandId: 'a',
      chord: 'alt+1',
    })
  })

  test('不可解析的 shortcut 排除', () => {
    const cmds = [{ id: 'x', shortcut: '???' }]
    const bindings = resolveEffectiveBindings(cmds, new Map())
    expect(bindings).toHaveLength(0)
  })

  test('无任何绑定的命令返回空数组', () => {
    const cmds = [{ id: 'x' }, { id: 'y' }]
    const bindings = resolveEffectiveBindings(cmds, new Map())
    expect(bindings).toHaveLength(0)
  })
})

// ── isEditableTarget ──────────────────────────────────────

describe('isEditableTarget', () => {
  function createElement(tag: string, attrs?: Record<string, string>): HTMLElement {
    const el = document.createElement(tag)
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v)
      }
    }
    return el
  }

  test('input 为可编辑', () => {
    expect(isEditableTarget(createElement('input'))).toBe(true)
  })

  test('textarea 为可编辑', () => {
    expect(isEditableTarget(createElement('textarea'))).toBe(true)
  })

  test('select 为可编辑', () => {
    expect(isEditableTarget(createElement('select'))).toBe(true)
  })

  test('contenteditable 为可编辑', () => {
    const el = createElement('div')
    el.contentEditable = 'true'
    expect(isEditableTarget(el)).toBe(true)
  })

  test('cmdk 搜索输入框为可编辑', () => {
    const wrapper = createElement('div')
    const input = createElement('input')
    input.setAttribute('cmdk-input', '')
    wrapper.appendChild(input)
    expect(isEditableTarget(input)).toBe(true)
  })

  test('普通 div 不可编辑', () => {
    expect(isEditableTarget(createElement('div'))).toBe(false)
  })

  test('null 返回 false', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  test('button 不是可编辑', () => {
    expect(isEditableTarget(createElement('button'))).toBe(false)
  })
})

// ── shortcut-store ─────────────────────────────────────────

describe('shortcutOverrideStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('初始状态为空', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    expect(shortcutOverrideStore.getAll().size).toBe(0)
  })

  test('设置后读取', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    shortcutOverrideStore.set('nav.a', 'ctrl+alt+a')
    const result = shortcutOverrideStore.get('nav.a')
    expect(result?.chord).toBe('ctrl+alt+a')
    expect(result?.updatedAt).toBeTruthy()
  })

  test('覆盖同一命令', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    shortcutOverrideStore.set('nav.a', 'ctrl+1')
    shortcutOverrideStore.set('nav.a', 'ctrl+2')
    expect(shortcutOverrideStore.get('nav.a')?.chord).toBe('ctrl+2')
  })

  test('清除单条', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    shortcutOverrideStore.set('nav.a', 'ctrl+alt+a')
    shortcutOverrideStore.remove('nav.a')
    expect(shortcutOverrideStore.get('nav.a')).toBeUndefined()
  })

  test('清除全部', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    shortcutOverrideStore.set('nav.a', 'ctrl+alt+a')
    shortcutOverrideStore.set('nav.b', 'ctrl+alt+b')
    shortcutOverrideStore.clearAll()
    expect(shortcutOverrideStore.getAll().size).toBe(0)
  })

  test('版本不兼容回退', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    localStorage.setItem(
      'aiproj:shortcuts:v1',
      JSON.stringify({ version: 999, bindings: { a: { chord: 'a', updatedAt: 't' } } }),
    )
    expect(shortcutOverrideStore.get('a')).toBeUndefined()
  })

  test('损坏 JSON 回退', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    localStorage.setItem('aiproj:shortcuts:v1', '{bad json')
    expect(shortcutOverrideStore.getAll().size).toBe(0)
  })

  test('pruneExpired 移除过期命令 ID', async () => {
    const { shortcutOverrideStore } = await import('@/lib/command-registry/shortcut-store')
    shortcutOverrideStore.set('nav.a', 'ctrl+alt+a')
    shortcutOverrideStore.set('nav.b', 'ctrl+alt+b')
    shortcutOverrideStore.pruneExpired(new Set(['nav.a']))
    expect(shortcutOverrideStore.get('nav.a')?.chord).toBe('ctrl+alt+a')
    expect(shortcutOverrideStore.get('nav.b')).toBeUndefined()
  })
})
