/**
 * completion-derivation 单元测试。
 *
 * 覆盖：
 * - 双来源派生（命令注册表 + 意图目录）产出 CommandDescriptor[]
 * - 与 chip derivation 产出相同的可用性语义（task 4.3）
 * - Slash command 有 fillText 格式为 /routingKey（task 4.4/4.5）
 * - Authorization-gated 命令不触发外部请求（task 4.8）
 * - 确定性：相同输入 → 相同输出（task 6.1/6.2）
 * - 无 recency weighting（task 6.3/6.4）
 * - 三类不可用性正确处理（task 4.7）
 */

import { describe, it, expect } from 'vitest'
import { deriveCommands, type CommandDerivationContext } from '../lib/copilot/completion-derivation'
import { deriveChips, type ChipDerivationContext } from '../lib/copilot/chip-derivation'
import type { RegisteredCommand, CommandContext } from '../lib/command-registry/types'
import type { CopilotSubIntentEntry } from '@aiproj/types'

// ===========================================================================
// 测试数据
// ===========================================================================

// 图标字段类型为 LucideIcon；测试不渲染图标，用空组件桩替代（避免 any）。
const stubIcon = (() => null) as unknown as RegisteredCommand['icon']

// ===========================================================================
// 测试数据
// ===========================================================================

const commandContext: CommandContext = {
  pathname: '/projects/123',
  params: { id: '123' },
  searchParams: new URLSearchParams(),
}

const permissions = ['task:create', 'task:read', 'project:read', 'project:write', 'ai:trigger']

const enabledDestinations: Record<string, boolean> = {
  'ctx.project.new-task': true,
  'intent.decompose-task': true,
  'intent.adjust-schedule': true,
  'web-search': false,
}

const authorizationGatedDestinations: string[] = ['gitlab-sync']

const baseContext: CommandDerivationContext = {
  commandContext,
  permissions,
  scope: 'project',
  enabledDestinations,
  authorizationGatedDestinations,
}

const mockCommands: RegisteredCommand[] = [
  {
    id: 'ctx.project.new-task',
    label: '新建任务',
    icon: stubIcon,
    group: 'contextual',
    effect: 'open-form',
    requiresPermission: ['task:create'],
    when: (ctx) => ctx.pathname.startsWith('/projects/'),
    execute: () => {},
  },
  {
    id: 'nav.dashboard',
    label: '仪表盘',
    icon: stubIcon,
    group: 'navigation',
    effect: 'navigate',
    requiresPermission: [],
    when: () => true,
    execute: () => {},
  },
  {
    id: 'web-search',
    label: '网络搜索',
    icon: stubIcon,
    group: 'search',
    effect: 'open-form',
    requiresPermission: [],
    when: () => true,
    execute: () => {},
  },
  {
    id: 'gitlab-sync',
    label: 'GitLab 同步',
    icon: stubIcon,
    group: 'contextual',
    effect: 'open-form',
    requiresPermission: ['project:admin'],
    when: () => true,
    execute: () => {},
  },
]

const mockSubIntents: CopilotSubIntentEntry[] = [
  {
    subIntentId: 'intent.decompose-task',
    intentClass: 'mutation',
    label: '拆解当前任务',
    examplePhrasings: ['拆解任务'],
    requiredSlots: [],
    optionalSlots: [],
    candidateDestinations: ['ai_draft_generation'],
    requiredPermissions: ['task:read', 'ai:trigger'],
    ruleDeclarations: [
      { ruleId: 'test', strength: 'route_context', routePatterns: ['/projects/'] },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: '1.0.0',
  },
  {
    subIntentId: 'intent.adjust-schedule',
    intentClass: 'instruction',
    label: '调整排期',
    examplePhrasings: ['调整排期'],
    requiredSlots: [],
    optionalSlots: [],
    candidateDestinations: ['gantt_what_if'],
    requiredPermissions: ['project:write', 'ai:trigger'],
    ruleDeclarations: [
      { ruleId: 'test', strength: 'route_context', routePatterns: ['/projects/'] },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: '1.0.0',
  },
]

// ===========================================================================
// 辅助函数
// ===========================================================================

function makeChipContext(): ChipDerivationContext {
  return {
    commandContext,
    permissions,
    scope: 'project',
    enabledDestinations,
    authorizationGatedDestinations,
  }
}

// ===========================================================================
// 测试
// ===========================================================================

describe('deriveCommands', () => {
  it('应从命令注册表和意图目录双来源派生命令', () => {
    const result = deriveCommands(mockCommands, mockSubIntents, baseContext)

    const commandDescs = result.filter((d) => d.sourceKind === 'registered-command')
    const intentDescs = result.filter((d) => d.sourceKind === 'intent-catalog')

    expect(commandDescs.length).toBeGreaterThan(0)
    expect(intentDescs.length).toBeGreaterThan(0)
    expect(result.length).toBe(commandDescs.length + intentDescs.length)
  })

  it('应产出 CommandDescriptor[] 而非 ChipDescriptor[]', () => {
    const result = deriveCommands(mockCommands, mockSubIntents, baseContext)

    for (const desc of result) {
      expect(desc).toHaveProperty('id')
      expect(desc).toHaveProperty('label')
      expect(desc).toHaveProperty('sourceKind')
      expect(desc).toHaveProperty('group')
      expect(desc).toHaveProperty('description')
      expect(desc).toHaveProperty('requiredPermissions')
      expect(desc).toHaveProperty('availabilityKind')
      expect(desc).toHaveProperty('fillText')
      expect(desc).toHaveProperty('routingKey')
      // CommandDescriptor 不应有 ChipDescriptor 特有的字段
      expect(desc).not.toHaveProperty('clickSemantics')
      expect(desc).not.toHaveProperty('destination')
    }
  })

  it('无权限的命令应完全缺席（不泄露存在）', () => {
    const restrictedPerms = ['task:read'] // 缺少 task:create, project:write 等
    const ctx: CommandDerivationContext = {
      ...baseContext,
      permissions: restrictedPerms,
    }

    const result = deriveCommands(mockCommands, mockSubIntents, ctx)

    // 'ctx.project.new-task' 需要 task:create，应缺席
    expect(result.find((d) => d.id === 'ctx.project.new-task')).toBeUndefined()
    // 'intent.adjust-schedule' 需要 project:write，应缺席
    expect(result.find((d) => d.id === 'intent.adjust-schedule')).toBeUndefined()
  })

  it('未启用的命令应可见且有 hint', () => {
    const result = deriveCommands(mockCommands, mockSubIntents, baseContext)

    const webSearch = result.find((d) => d.id === 'web-search')
    expect(webSearch).toBeDefined()
    expect(webSearch!.availabilityKind).toBe('not-enabled')
    expect(webSearch!.hint).toBe('该能力未启用，可在设置中开启')
  })

  it('授权门命令应可见且有 hint', () => {
    // gitlab-sync 需要 project:admin 权限，当前用户没有
    // 所以它会因为权限检查而缺席
    // 需要给用户 project:admin 权限才能看到它
    const ctxWithAdmin: CommandDerivationContext = {
      ...baseContext,
      permissions: [...permissions, 'project:admin'],
    }

    const result = deriveCommands(mockCommands, mockSubIntents, ctxWithAdmin)

    const gitlabSync = result.find((d) => d.id === 'gitlab-sync')
    expect(gitlabSync).toBeDefined()
    expect(gitlabSync!.availabilityKind).toBe('authorization-gated')
    expect(gitlabSync!.hint).toBe('需要用户授权后才能使用该能力')
  })

  it('fillText 格式应为 /routingKey', () => {
    const result = deriveCommands(mockCommands, mockSubIntents, baseContext)

    for (const desc of result) {
      expect(desc.fillText).toMatch(/^\/.+/)
      // fillText 应以斜杠开头
      expect(desc.fillText.startsWith('/')).toBe(true)
    }
  })

  it('与 chip derivation 产出相同的可用性语义', () => {
    const chipCtx = makeChipContext()
    const chips = deriveChips(mockCommands, mockSubIntents, chipCtx)
    const cmds = deriveCommands(mockCommands, mockSubIntents, baseContext)

    // 对于每个芯片，应该有对应可用性的命令
    for (const chip of chips.chips) {
      const matchingCmd = cmds.find((c) => c.id === chip.id)
      if (matchingCmd) {
        expect(matchingCmd.availabilityKind).toBe(chip.availabilityKind)
      }
    }
  })

  it('确定性：相同输入多次调用产出相同结果', () => {
    const result1 = deriveCommands(mockCommands, mockSubIntents, baseContext)
    const result2 = deriveCommands(mockCommands, mockSubIntents, baseContext)
    const result3 = deriveCommands(mockCommands, mockSubIntents, baseContext)

    expect(result1).toEqual(result2)
    expect(result2).toEqual(result3)
  })

  it('确定性：不同键序的相同输入产出相同结果', () => {
    const reversedCommands = [...mockCommands].reverse()
    const reversedIntents = [...mockSubIntents].reverse()

    const result1 = deriveCommands(mockCommands, mockSubIntents, baseContext)
    const result2 = deriveCommands(reversedCommands, reversedIntents, baseContext)

    // 排序后应相同
    const sortById = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    const sorted1 = [...result1].sort(sortById)
    const sorted2 = [...result2].sort(sortById)

    expect(sorted1).toEqual(sorted2)
  })

  it('无 recency weighting：结果不随调用顺序变化', () => {
    // 第一次调用
    const result1 = deriveCommands(mockCommands, mockSubIntents, baseContext)
    // 第二次调用（模拟"更近"的调用）
    const result2 = deriveCommands(mockCommands, mockSubIntents, baseContext)

    // 排序键不应包含任何时间或使用频率信息
    expect(result1).toEqual(result2)
  })

  it('排序应按 relevanceTier → impactSeverity → stableTieBreak', () => {
    const result = deriveCommands(mockCommands, mockSubIntents, baseContext)

    // 验证排序：contextual > navigation > search
    const ids = result.map((d) => d.id)
    const contextualIdx = ids.indexOf('ctx.project.new-task')
    const navigationIdx = ids.indexOf('nav.dashboard')

    // contextual (critical) 应排在 navigation (high) 前面
    expect(contextualIdx).toBeLessThan(navigationIdx)
  })

  it('when(ctx) 返回 false 的命令应被过滤', () => {
    const ctxOutside: CommandDerivationContext = {
      ...baseContext,
      commandContext: {
        pathname: '/dashboard',
        params: {},
        searchParams: new URLSearchParams(),
      },
    }

    const result = deriveCommands(mockCommands, mockSubIntents, ctxOutside)

    // 'ctx.project.new-task' 的 when 要求 pathname 以 /projects/ 开头
    expect(result.find((d) => d.id === 'ctx.project.new-task')).toBeUndefined()
  })

  it('去重：同一 routingKey 按来源优先级保留', () => {
    // 创建一个与意图相同 routingKey 的命令
    const cmdWithSameRouting: RegisteredCommand[] = [
      ...mockCommands,
      {
        id: 'intent.decompose-task',
        label: '命令版拆解',
        icon: stubIcon,
        group: 'contextual',
        effect: 'open-form',
        requiresPermission: ['task:read', 'ai:trigger'],
        execute: () => {},
      },
    ]

    const result = deriveCommands(cmdWithSameRouting, mockSubIntents, baseContext)

    // 同一 routingKey 应只有一个
    const decomposeEntries = result.filter((d) => d.routingKey === 'intent.decompose-task')
    expect(decomposeEntries).toHaveLength(1)
    // registered-command 应优先
    expect(decomposeEntries[0]!.sourceKind).toBe('registered-command')
  })
})

// ===========================================================================
// 芯片与斜杠列表的可用性一致性（任务 6.8）
// ===========================================================================
//
// 上面那条「与 chip derivation 产出相同的可用性语义」用了 `if (matchingCmd)` 包裹断言：
// 一旦两侧 id 一个都对不上，循环体从不执行，测试**空过**。它也只查单向（芯片→命令），
// 命令侧多出或少掉的可用性差异查不出来。本组按任务 6.8 的原话——「对同一上下文产出
// 一致可用性」——做三件事：先证匹配集非空，再双向逐条比对，最后证三类可用性都被覆盖到。
describe('芯片与斜杠列表对同一上下文产出一致可用性（6.8）', () => {
  /** 同一份上下文喂两个派生函数；芯片侧放开可见上界，避免上界成为差异来源。 */
  function deriveBoth(permissions: string[]) {
    const chipCtx: ChipDerivationContext = { ...makeChipContext(), permissions }
    const cmdCtx: CommandDerivationContext = { ...baseContext, permissions }
    return {
      chips: deriveChips(mockCommands, mockSubIntents, chipCtx, 999).chips,
      cmds: deriveCommands(mockCommands, mockSubIntents, cmdCtx),
    }
  }

  const withAdmin = [...permissions, 'project:admin']

  it('两侧的 id 匹配集非空（守住空过）', () => {
    const { chips, cmds } = deriveBoth(withAdmin)
    const cmdIds = new Set(cmds.map((c) => c.id))
    const matched = chips.filter((chip) => cmdIds.has(chip.id))
    expect(chips.length).toBeGreaterThan(0)
    expect(cmds.length).toBeGreaterThan(0)
    expect(matched.length).toBeGreaterThan(0)
  })

  it('芯片侧的每一项都能在斜杠列表里找到，且可用性逐条相同', () => {
    const { chips, cmds } = deriveBoth(withAdmin)
    const byId = new Map(cmds.map((c) => [c.id, c]))
    for (const chip of chips) {
      const cmd = byId.get(chip.id)
      // 芯片能出现而斜杠列表没有，等于同一上下文两处结论不一致
      expect(cmd, `芯片 ${chip.id} 在斜杠列表中缺席`).toBeDefined()
      expect(cmd!.availabilityKind, `${chip.id} 可用性不一致`).toBe(chip.availabilityKind)
    }
  })

  it('斜杠列表侧凡在芯片作用域内的项，可用性也与芯片相同（反向）', () => {
    const { chips, cmds } = deriveBoth(withAdmin)
    const chipById = new Map(chips.map((c) => [c.id, c]))
    // 芯片会按 scope 过滤掉全局项，故只反向校验两侧都存在的部分；
    // 但「都存在时必须一致」是双向的硬约束。
    const overlap = cmds.filter((c) => chipById.has(c.id))
    expect(overlap.length).toBeGreaterThan(0)
    for (const cmd of overlap) {
      expect(cmd.availabilityKind).toBe(chipById.get(cmd.id)!.availabilityKind)
    }
  })

  it('无权限项在两侧同时缺席（不泄露存在）', () => {
    // 不给 project:admin：gitlab-sync 应在两侧都查不到，而不是一侧灰显一侧消失
    const { chips, cmds } = deriveBoth(permissions)
    expect(chips.some((c) => c.id === 'gitlab-sync')).toBe(false)
    expect(cmds.some((c) => c.id === 'gitlab-sync')).toBe(false)
  })

  it('三类可用性都在两侧出现且取值相同', () => {
    const { chips, cmds } = deriveBoth(withAdmin)
    const chipKinds = new Set(chips.map((c) => c.availabilityKind))
    const cmdKinds = new Set(
      cmds.filter((c) => chips.some((h) => h.id === c.id)).map((c) => c.availabilityKind),
    )
    // 夹具刻意覆盖三态：available / not-enabled(web-search) / authorization-gated(gitlab-sync)
    expect(chipKinds.has('available')).toBe(true)
    expect(chipKinds.has('not-enabled')).toBe(true)
    expect(chipKinds.has('authorization-gated')).toBe(true)
    expect([...cmdKinds].sort()).toEqual([...chipKinds].sort())
  })
})
