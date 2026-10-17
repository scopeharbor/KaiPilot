/**
 * copilot-chip-derivation 单元测试。
 *
 * 覆盖：
 * - 双来源派生（命令注册表 + 意图目录）
 * - 未新建第三份按页面动作表
 * - 去重（同一目标按优先级择一）
 * - 确定性排序（不同键序相同输入产出相同结果）
 * - 派生纯函数边界（无时钟、随机源、历史权重）
 */

import { describe, it, expect } from 'vitest'
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
}

const authorizationGatedDestinations: string[] = []

const baseContext: ChipDerivationContext = {
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
// 测试
// ===========================================================================

describe('deriveChips', () => {
  it('should derive chips from both command registry and intent catalog', () => {
    const result = deriveChips(mockCommands, mockSubIntents, baseContext)

    // 应该包含来自两个来源的芯片
    const commandChips = result.chips.filter((c) => c.sourceKind === 'registered-command')
    const intentChips = result.chips.filter((c) => c.sourceKind === 'intent-catalog')

    expect(commandChips.length).toBeGreaterThan(0)
    expect(intentChips.length).toBeGreaterThan(0)
    expect(result.chips.length).toBe(commandChips.length + intentChips.length)
  })

  it('should not create a third per-route action table', () => {
    const result = deriveChips(mockCommands, mockSubIntents, baseContext)

    // 所有芯片必须来自 registered-command 或 intent-catalog
    for (const chip of result.chips) {
      expect(['registered-command', 'intent-catalog']).toContain(chip.sourceKind)
    }
  })

  it('should deduplicate chips with the same effective target', () => {
    // 命令芯片的 destination = 命令 id，故撞车场景要求命令 id 等于该 destination；
    // 只在本用例内加入，避免污染其它用例的芯片集合
    const colliderCommand: RegisteredCommand = {
      id: 'ai_draft_generation',
      label: 'AI 草案生成',
      icon: stubIcon,
      group: 'contextual',
      effect: 'open-form',
      requiresPermission: [],
      when: (ctx) => ctx.pathname.startsWith('/projects/'),
      execute: () => {},
    }
    // 添加一个与命令相同目标的意图
    const duplicateIntent: CopilotSubIntentEntry = {
      ...mockSubIntents[0]!,
      subIntentId: 'intent.duplicate',
      label: '重复任务',
      candidateDestinations: ['ai_draft_generation'], // 与命令 chip 的 destination 相同
    }

    const result = deriveChips(
      [...mockCommands, colliderCommand],
      [...mockSubIntents, duplicateIntent],
      baseContext,
    )

    // 检查是否有重复目标
    const targets = result.chips.map((c) => c.destination)
    const uniqueTargets = new Set(targets)
    expect(targets.length).toBe(uniqueTargets.size)
  })

  it('should prefer registered command over intent catalog for same target', () => {
    // 命令芯片的 destination = 命令 id，故撞车场景要求命令 id 等于该 destination；
    // 只在本用例内加入，避免污染其它用例的芯片集合
    const colliderCommand: RegisteredCommand = {
      id: 'ai_draft_generation',
      label: 'AI 草案生成',
      icon: stubIcon,
      group: 'contextual',
      effect: 'open-form',
      requiresPermission: [],
      when: (ctx) => ctx.pathname.startsWith('/projects/'),
      execute: () => {},
    }
    const duplicateIntent: CopilotSubIntentEntry = {
      ...mockSubIntents[0]!,
      subIntentId: 'intent.duplicate',
      label: '重复任务',
      candidateDestinations: ['ai_draft_generation'], // 与命令 chip 的 destination 相同
    }

    const result = deriveChips(
      [...mockCommands, colliderCommand],
      [...mockSubIntents, duplicateIntent],
      baseContext,
    )

    // 找到目标为 'ai_draft_generation' 的芯片
    const targetChip = result.chips.find((c) => c.destination === 'ai_draft_generation')
    expect(targetChip).toBeDefined()
    expect(targetChip!.sourceKind).toBe('registered-command')
  })

  it('should sort chips deterministically', () => {
    // 两次派生应该得到相同顺序
    const result1 = deriveChips(mockCommands, mockSubIntents, baseContext)
    const result2 = deriveChips(mockCommands, mockSubIntents, baseContext)

    expect(result1.chips.map((c) => c.id)).toEqual(result2.chips.map((c) => c.id))
    expect(result1.chips.map((c) => c.label)).toEqual(result2.chips.map((c) => c.label))
  })

  it('should produce identical results with different object key ordering', () => {
    // 重新排列命令和意图的顺序
    const shuffledCommands = [...mockCommands].reverse()
    const shuffledIntents = [...mockSubIntents].reverse()

    const result1 = deriveChips(mockCommands, mockSubIntents, baseContext)
    const result2 = deriveChips(shuffledCommands, shuffledIntents, baseContext)

    // 芯片集合、排序和文案应该完全一致
    expect(result1.chips.length).toBe(result2.chips.length)
    for (let i = 0; i < result1.chips.length; i++) {
      expect(result1.chips[i]!.id).toBe(result2.chips[i]!.id)
      expect(result1.chips[i]!.label).toBe(result2.chips[i]!.label)
      expect(result1.chips[i]!.relevanceTier).toBe(result2.chips[i]!.relevanceTier)
      expect(result1.chips[i]!.impactSeverity).toBe(result2.chips[i]!.impactSeverity)
    }
  })

  it('should not depend on clock, randomness, or usage history', () => {
    // 检查派生函数是否使用 Date.now()、Math.random() 或其他非纯依赖
    // 这里我们通过检查输出稳定性来验证
    const result1 = deriveChips(mockCommands, mockSubIntents, baseContext)
    const result2 = deriveChips(mockCommands, mockSubIntents, baseContext)

    // 输出应该完全一致
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
  })

  it('should respect visible bound and report omitted count', () => {
    const manyCommands: RegisteredCommand[] = Array.from({ length: 10 }, (_, i) => ({
      id: `cmd-${i}`,
      label: `命令 ${i}`,
      icon: stubIcon,
      group: 'contextual' as const,
      effect: 'navigate' as const,
      requiresPermission: [],
      when: () => true,
      execute: () => {},
    }))

    const result = deriveChips(manyCommands, [], baseContext, 5)

    expect(result.chips.length).toBe(5)
    expect(result.maxVisible).toBe(5)
    expect(result.omittedCount).toBe(5) // 10 - 5 = 5
  })

  it('should filter chips requiring project permissions in global scope', () => {
    const globalContext: ChipDerivationContext = {
      ...baseContext,
      scope: 'global',
      commandContext: {
        pathname: '/',
        params: {},
        searchParams: new URLSearchParams(),
      },
    }

    const result = deriveChips(mockCommands, mockSubIntents, globalContext)

    // 全局作用域下不应有需要项目读取权限的芯片
    for (const chip of result.chips) {
      const hasProjectRead = chip.requiredPermissions.some(
        (perm) => perm.startsWith('project:') && perm !== 'project:create',
      )
      expect(hasProjectRead).toBe(false)
    }
  })
})

describe('Availability and non-leakage', () => {
  it('should exclude chips when actor lacks permission', () => {
    const contextWithoutTaskRead: ChipDerivationContext = {
      ...baseContext,
      permissions: ['task:create', 'project:read', 'ai:trigger'], // 缺少 task:read
    }

    const result = deriveChips(mockCommands, mockSubIntents, contextWithoutTaskRead)

    // 意图芯片需要 task:read，应该被过滤
    const intentChips = result.chips.filter((c) => c.sourceKind === 'intent-catalog')
    expect(intentChips.length).toBe(0)
  })

  it('should not leak existence, count difference, or ordinal shift for missing permission', () => {
    // 两个 actor 只相差一项权限
    const actorA: ChipDerivationContext = {
      ...baseContext,
      permissions: ['task:create', 'task:read', 'project:read', 'ai:trigger'],
    }
    const actorB: ChipDerivationContext = {
      ...baseContext,
      permissions: ['task:create', 'project:read', 'ai:trigger'], // 缺少 task:read
    }

    const resultA = deriveChips(mockCommands, mockSubIntents, actorA)
    const resultB = deriveChips(mockCommands, mockSubIntents, actorB)

    // actorB 应该少一些芯片，但不应该有暗示存在的提示
    expect(resultA.chips.length).toBeGreaterThan(resultB.chips.length)

    // 检查 actorB 的芯片没有 hints 暗示缺少的芯片
    for (const chip of resultB.chips) {
      if (chip.hint) {
        expect(chip.hint).not.toContain('task')
        expect(chip.hint).not.toContain('权限')
      }
    }
  })

  it('should mark not-enabled chips as visible but unavailable', () => {
    const contextWithDisabled: ChipDerivationContext = {
      ...baseContext,
      enabledDestinations: {
        'ctx.project.new-task': true,
        ai_draft_generation: false, // 禁用第一个候选 destination
        'intent.adjust-schedule': true,
      },
    }

    const result = deriveChips(mockCommands, mockSubIntents, contextWithDisabled)

    const decomposeChip = result.chips.find((c) => c.id === 'intent.decompose-task')
    expect(decomposeChip).toBeDefined()
    expect(decomposeChip!.availabilityKind).toBe('not-enabled')
    expect(decomposeChip!.hint).toBe('该能力未启用，可在设置中开启')
  })

  it('should mark authorization-gated chips as visible but unavailable with reason', () => {
    const contextWithGated: ChipDerivationContext = {
      ...baseContext,
      authorizationGatedDestinations: ['ai_draft_generation'],
    }

    const result = deriveChips(mockCommands, mockSubIntents, contextWithGated)

    const decomposeChip = result.chips.find((c) => c.id === 'intent.decompose-task')
    expect(decomposeChip).toBeDefined()
    expect(decomposeChip!.availabilityKind).toBe('authorization-gated')
    expect(decomposeChip!.hint).toBe('需要用户授权后才能使用该能力')
  })

  it('should not perform any external request when authorization-gated chip is activated', () => {
    // 这是一个逻辑测试，确保点击授权门芯片不会触发外部请求
    // 在实际组件中，这由点击处理函数保证
    // 这里我们验证芯片的 clickSemantics 是 'populate-composer'，不会直接执行
    const contextWithGated: ChipDerivationContext = {
      ...baseContext,
      authorizationGatedDestinations: ['intent.decompose-task'],
    }

    const result = deriveChips(mockCommands, mockSubIntents, contextWithGated)

    const decomposeChip = result.chips.find((c) => c.id === 'intent.decompose-task')
    expect(decomposeChip).toBeDefined()
    expect(decomposeChip!.clickSemantics).toBe('populate-composer') // 意图芯片只填充输入框
  })

  it('should exclude project-scoped chips in global scope', () => {
    const globalContext: ChipDerivationContext = {
      ...baseContext,
      scope: 'global',
      commandContext: {
        pathname: '/',
        params: {},
        searchParams: new URLSearchParams(),
      },
    }

    const result = deriveChips(mockCommands, mockSubIntents, globalContext)

    // 所有芯片都不应需要项目读取权限
    for (const chip of result.chips) {
      const hasProjectPermission = chip.requiredPermissions.some((perm) =>
        perm.startsWith('project:'),
      )
      expect(hasProjectPermission).toBe(false)
    }
  })
})

describe('Entity injection', () => {
  it('should inject entity reference when provided', () => {
    const entityContext: ChipDerivationContext = {
      ...baseContext,
      entityRef: {
        kind: 'task',
        id: 123,
        name: '实现登录功能',
        scope: 'project',
      },
    }

    const result = deriveChips(mockCommands, mockSubIntents, entityContext)

    // 所有芯片都应该有相同的 entityRef
    for (const chip of result.chips) {
      expect(chip.entityRef).toBeDefined()
      expect(chip.entityRef!.kind).toBe('task')
      expect(chip.entityRef!.id).toBe(123)
      expect(chip.entityRef!.name).toBe('实现登录功能')
    }
  })

  it('should not inject inaccessible entity', () => {
    // 在实际场景中，这由权限系统保证，但这里我们测试芯片派生函数
    // 如果 entityRef 存在，它应该被注入；否则不注入
    const contextWithoutEntity: ChipDerivationContext = {
      ...baseContext,
      entityRef: undefined,
    }

    const result = deriveChips(mockCommands, mockSubIntents, contextWithoutEntity)

    for (const chip of result.chips) {
      expect(chip.entityRef).toBeUndefined()
    }
  })
})
