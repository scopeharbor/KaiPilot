/**
 * command-registry/bridge 单元测试（v3-copilot-command-palette-bridge）。
 *
 * 覆盖：无命中判定、反向转交、不可用分类、历史条目区分。
 */
import { describe, expect, test } from 'vitest'
import { Plus, Search, Sparkles } from 'lucide-react'
import type { RegisteredCommand } from '@/lib/command-registry/types'
import {
  shouldOfferHandoff,
  createHandoffPayload,
  findReverseHandoffTargets,
  validateReverseHandoffTarget,
  classifyUnavailability,
  explainUnavailability,
  handoffHistoryId,
  isHandoffHistoryEntry,
  historyEntryKind,
  HANDOFF_HISTORY_PREFIX,
} from '@/lib/command-registry/bridge'

// ── 测试用命令集 ──────────────────────────────────────────────

const mockCommands: RegisteredCommand[] = [
  {
    id: 'nav./projects',
    label: '跳转到项目',
    icon: Search,
    group: 'navigation',
    effect: 'navigate',
    execute: () => {},
  },
  {
    id: 'theme.dark',
    label: '切换到深色模式',
    keywords: ['dark', 'theme'],
    icon: Search,
    group: 'theme',
    effect: 'ui-setting',
    execute: () => {},
  },
  {
    id: 'ctx.project.new-task',
    label: '新建任务',
    keywords: ['任务', '新建', 'task'],
    icon: Plus,
    group: 'contextual',
    effect: 'open-form',
    requiresPermission: ['task:create'],
    execute: () => {},
  },
  {
    id: 'copilot.toggle',
    label: '打开/关闭 AI Copilot',
    keywords: ['copilot', 'AI'],
    icon: Sparkles,
    group: 'custom',
    effect: 'ui-setting',
    execute: () => {},
  },
]

describe('shouldOfferHandoff', () => {
  test('空输入不转交', () => {
    const d = shouldOfferHandoff('', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('纯空白输入不转交', () => {
    const d = shouldOfferHandoff('   ', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('精确匹配 label 时不转交', () => {
    const d = shouldOfferHandoff('跳转到项目', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('精确匹配 id 时不转交', () => {
    const d = shouldOfferHandoff('nav./projects', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('模糊匹配 keyword 时不转交', () => {
    const d = shouldOfferHandoff('dark', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('模糊匹配 label 子串时不转交', () => {
    // "深色模式" 是 "切换到深色模式" 的子串，命中 theme.dark
    const d = shouldOfferHandoff('深色模式', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('无命中时转交', () => {
    const d = shouldOfferHandoff('把首页设计拆成子任务', mockCommands)
    expect(d.shouldHandoff).toBe(true)
    expect(d.reason).toBe('no-match')
  })

  test('部分模糊命中时不转交', () => {
    // "任务" 命中 ctx.project.new-task 的 keyword
    const d = shouldOfferHandoff('任务', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('形近命令的输入走命令而非转交', () => {
    // "copilot" 命中 copilot.toggle 的 keyword
    const d = shouldOfferHandoff('copilot', mockCommands)
    expect(d.shouldHandoff).toBe(false)
  })

  test('确定性：相同输入结果一致', () => {
    const d1 = shouldOfferHandoff('把首页设计拆成子任务', mockCommands)
    const d2 = shouldOfferHandoff('把首页设计拆成子任务', mockCommands)
    expect(d1.shouldHandoff).toBe(d2.shouldHandoff)
    expect(d1.reason).toBe(d2.reason)
  })

  test('可见命令为空时任何输入都转交', () => {
    const d = shouldOfferHandoff('hello', [])
    expect(d.shouldHandoff).toBe(true)
  })
})

describe('createHandoffPayload', () => {
  test('构造载荷', () => {
    const payload = createHandoffPayload('test input', '/projects/1')
    expect(payload.inputText).toBe('test input')
    expect(payload.routeContext).toBe('/projects/1')
    expect(payload.source).toBe('command-palette')
  })

  test('带实体引用', () => {
    const refs = [{ entityType: 'task', entityId: '1', label: 'Test' }]
    const payload = createHandoffPayload('test', '/test', refs)
    expect(payload.entityRefs).toHaveLength(1)
  })
})

describe('findReverseHandoffTargets', () => {
  test('导航意图产出导航目标', () => {
    const targets = findReverseHandoffTargets('跳转到项目', mockCommands)
    expect(targets.length).toBeGreaterThan(0)
    expect(targets[0]!.effect).toBe('navigate')
  })

  test('open-form 意图产出表单目标', () => {
    const targets = findReverseHandoffTargets('新建任务', mockCommands)
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.some((t) => t.effect === 'open-form')).toBe(true)
  })

  test('ui-setting 命令不作为反向目标', () => {
    const targets = findReverseHandoffTargets('切换到深色模式', mockCommands)
    // theme.dark 是 ui-setting：既不得出现在结果里，effect 也只可能是 navigate/open-form
    // （断言命令 id 而非 effect —— effect 联合类型本就不含 ui-setting，比较恒真无验证力）
    expect(targets.some((t) => t.commandId === 'theme.dark')).toBe(false)
    expect(targets.every((t) => t.effect === 'navigate' || t.effect === 'open-form')).toBe(true)
  })

  test('无匹配时返回空', () => {
    const targets = findReverseHandoffTargets('完全不相关的内容', mockCommands)
    expect(targets).toHaveLength(0)
  })
})

describe('validateReverseHandoffTarget', () => {
  test('navigation 目标合法', () => {
    const r = validateReverseHandoffTarget({
      commandId: 'nav./test',
      label: 'test',
      effect: 'navigate',
    })
    expect(r.valid).toBe(true)
  })

  test('open-form 目标合法', () => {
    const r = validateReverseHandoffTarget({
      commandId: 'ctx.test',
      label: 'test',
      effect: 'open-form',
    })
    expect(r.valid).toBe(true)
  })

  test('ui-setting 目标非法', () => {
    const r = validateReverseHandoffTarget({
      commandId: 'test',
      label: 'test',
      effect: 'ui-setting' as never,
    })
    expect(r.valid).toBe(false)
  })
})

describe('classifyUnavailability', () => {
  const cmd: RegisteredCommand = {
    id: 'test.cmd',
    label: 'Test',
    icon: Plus,
    group: 'contextual',
    effect: 'open-form',
    requiresPermission: ['admin'],
    execute: () => {},
  }

  test('有权限时返回 null', () => {
    expect(classifyUnavailability(cmd, ['admin'])).toBeNull()
  })

  test('无权限时返回 not-permitted', () => {
    expect(classifyUnavailability(cmd, ['user'])).toBe('not-permitted')
  })

  test('无权限要求时返回 null', () => {
    const cmdNoPerm: RegisteredCommand = {
      ...cmd,
      requiresPermission: undefined,
    }
    expect(classifyUnavailability(cmdNoPerm, [])).toBeNull()
  })
})

describe('explainUnavailability', () => {
  test('三种类别各自产出不同说明', () => {
    const perm = explainUnavailability('not-permitted')
    const enabled = explainUnavailability('not-enabled')
    const auth = explainUnavailability('authorization-gated')
    expect(perm.message).not.toBe(enabled.message)
    expect(enabled.message).not.toBe(auth.message)
    expect(perm.message).not.toBe(auth.message)
  })
})

describe('handoffHistoryId / isHandoffHistoryEntry / historyEntryKind', () => {
  test('handoffHistoryId 以前缀开头', () => {
    const id = handoffHistoryId('test input')
    expect(id.startsWith(HANDOFF_HISTORY_PREFIX)).toBe(true)
  })

  test('handoffHistoryId 截断长输入', () => {
    const longInput = 'a'.repeat(100)
    const id = handoffHistoryId(longInput)
    expect(id.length).toBeLessThan(HANDOFF_HISTORY_PREFIX.length + 100)
  })

  test('isHandoffHistoryEntry 识别转交条目', () => {
    expect(isHandoffHistoryEntry(HANDOFF_HISTORY_PREFIX + 'test')).toBe(true)
    expect(isHandoffHistoryEntry('nav./projects')).toBe(false)
  })

  test('historyEntryKind 区分转交与普通命令', () => {
    expect(historyEntryKind(HANDOFF_HISTORY_PREFIX + 'test')).toBe('handoff')
    expect(historyEntryKind('nav./projects')).toBe('command')
  })
})
