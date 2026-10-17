/**
 * v3-copilot-context-chips —— 芯片派生纯函数。
 *
 * 从命令注册表与意图目录双来源派生芯片，去重、排序、过滤，提供确定性输出。
 * 本模块为纯函数，不依赖时钟、随机源与使用历史。
 */

import type {
  ChipDescriptor,
  ChipClickSemantics,
  ChipRelevanceTier,
  ChipAvailabilityKind,
  ChipEntityReference,
} from '@aiproj/types'
import type { RegisteredCommand, CommandContext } from '../command-registry/types'
import type { CopilotSubIntentEntry } from '@aiproj/types'

// ===========================================================================
// 输入类型
// ===========================================================================

/**
 * 芯片派生上下文。
 */
export interface ChipDerivationContext {
  /** 当前路由上下文。 */
  commandContext: CommandContext
  /** 用户权限列表。 */
  permissions: string[]
  /** 当前 scope（如 'project', 'global', 'task'）。 */
  scope: string
  /** 当前实体引用（可选）。 */
  entityRef?: ChipEntityReference
  /** 能力是否启用（destination -> enabled）。 */
  enabledDestinations: Record<string, boolean>
  /** 授权门 destination 列表。 */
  authorizationGatedDestinations: string[]
}

/**
 * 芯片派生结果。
 */
export interface ChipDerivationResult {
  /** 派生出的芯片列表（已排序、过滤、去重）。 */
  chips: readonly ChipDescriptor[]
  /** 可见上界。 */
  maxVisible: number
  /** 省略计数。 */
  omittedCount: number
}

// ===========================================================================
// 常量
// ===========================================================================

/** 默认最大可见芯片数。 */
const DEFAULT_MAX_VISIBLE = 6

// ===========================================================================
// 辅助函数
// ===========================================================================

/**
 * 从命令注册表采集候选芯片。
 */
function gatherFromCommandRegistry(
  commands: readonly RegisteredCommand[],
  ctx: ChipDerivationContext,
): ChipDescriptor[] {
  const candidates: ChipDescriptor[] = []

  for (const cmd of commands) {
    // 检查 when(ctx) 谓词
    if (cmd.when && !cmd.when(ctx.commandContext)) {
      continue
    }

    // 检查权限
    const hasPermission =
      cmd.requiresPermission?.every((perm) => ctx.permissions.includes(perm)) ?? true

    if (!hasPermission) {
      // 无权限芯片应缺席，不生成芯片
      continue
    }

    // 确定可用性
    const availabilityKind = determineAvailability(cmd, ctx)

    // 确定点击语义：根据 effect 类型
    const clickSemantics: ChipClickSemantics =
      cmd.effect === 'navigate' || cmd.effect === 'open-form' || cmd.effect === 'open-confirm'
        ? 'direct-execution'
        : 'populate-composer' // 理论上不应发生，因为 command effect 不含 write

    // 确定相关性档：根据分组
    const relevanceTier = mapGroupToRelevanceTier(cmd.group)

    // 构建芯片
    const chip: ChipDescriptor = {
      id: cmd.id,
      label: cmd.label,
      sourceKind: 'registered-command',
      clickSemantics,
      relevanceTier,
      impactSeverity: calculateImpactSeverity(relevanceTier, cmd.group),
      availabilityKind,
      hint: getAvailabilityHint(availabilityKind),
      destination: cmd.id, // 使用命令 ID 作为 destination
      requiredPermissions: cmd.requiresPermission ?? [],
      sortKey: {
        relevanceTier,
        impactSeverity: calculateImpactSeverity(relevanceTier, cmd.group),
        stableTieBreak: cmd.id,
      },
      entityRef: ctx.entityRef,
    }

    candidates.push(chip)
  }

  return candidates
}

/**
 * 从意图目录采集候选芯片。
 */
function gatherFromIntentCatalog(
  subIntents: readonly CopilotSubIntentEntry[],
  ctx: ChipDerivationContext,
): ChipDescriptor[] {
  const candidates: ChipDescriptor[] = []

  for (const intent of subIntents) {
    // 检查权限
    const hasPermission = intent.requiredPermissions.every((perm) => ctx.permissions.includes(perm))

    if (!hasPermission) {
      continue
    }

    // 检查 scope 匹配（简化版：根据 routePatterns）
    const matchesScope = intent.ruleDeclarations.some((rule) => {
      if (rule.routePatterns) {
        return rule.routePatterns.some((pattern) => ctx.commandContext.pathname.startsWith(pattern))
      }
      return false
    })

    if (!matchesScope && ctx.scope !== 'global') {
      // 如果 scope 不匹配且不是全局，跳过
      continue
    }

    // 确定可用性
    const availabilityKind = determineIntentAvailability(intent, ctx)

    // 意图芯片总是填充输入框
    const clickSemantics: ChipClickSemantics = 'populate-composer'

    // 确定相关性档：根据 intentClass
    const relevanceTier = mapIntentClassToRelevanceTier(intent.intentClass)

    // 构建芯片
    const chip: ChipDescriptor = {
      id: intent.subIntentId,
      label: intent.label,
      sourceKind: 'intent-catalog',
      clickSemantics,
      relevanceTier,
      impactSeverity: calculateIntentImpactSeverity(relevanceTier, intent.intentClass),
      availabilityKind,
      hint: getAvailabilityHint(availabilityKind),
      destination: intent.candidateDestinations[0] ?? intent.subIntentId,
      requiredPermissions: intent.requiredPermissions,
      sortKey: {
        relevanceTier,
        impactSeverity: calculateIntentImpactSeverity(relevanceTier, intent.intentClass),
        stableTieBreak: intent.subIntentId,
      },
      entityRef: ctx.entityRef,
    }

    candidates.push(chip)
  }

  return candidates
}

/**
 * 确定命令的可用性。
 */
function determineAvailability(
  cmd: RegisteredCommand,
  ctx: ChipDerivationContext,
): ChipAvailabilityKind {
  // 检查是否启用
  const enabled = ctx.enabledDestinations[cmd.id] ?? true
  if (!enabled) {
    return 'not-enabled'
  }

  // 检查是否授权门
  if (ctx.authorizationGatedDestinations.includes(cmd.id)) {
    return 'authorization-gated'
  }

  return 'available'
}

/**
 * 确定意图的可用性。
 */
function determineIntentAvailability(
  intent: CopilotSubIntentEntry,
  ctx: ChipDerivationContext,
): ChipAvailabilityKind {
  // 检查候选 destination 是否启用
  const firstDestination = intent.candidateDestinations[0]
  if (firstDestination) {
    const enabled = ctx.enabledDestinations[firstDestination] ?? true
    if (!enabled) {
      return 'not-enabled'
    }
    if (ctx.authorizationGatedDestinations.includes(firstDestination)) {
      return 'authorization-gated'
    }
  }

  return 'available'
}

/**
 * 获取可用性提示。
 */
function getAvailabilityHint(kind: ChipAvailabilityKind): string | undefined {
  switch (kind) {
    case 'not-enabled':
      return '该能力未启用，可在设置中开启'
    case 'authorization-gated':
      return '需要用户授权后才能使用该能力'
    default:
      return undefined
  }
}

/**
 * 将命令分组映射到相关性档。
 */
function mapGroupToRelevanceTier(group: string): ChipRelevanceTier {
  switch (group) {
    case 'contextual':
      return 'critical'
    case 'navigation':
      return 'high'
    case 'search':
      return 'medium'
    case 'theme':
    case 'density':
    case 'custom':
      return 'low'
    default:
      return 'medium'
  }
}

/**
 * 将意图分类映射到相关性档。
 */
function mapIntentClassToRelevanceTier(intentClass: string): ChipRelevanceTier {
  switch (intentClass) {
    case 'mutation':
    case 'instruction':
      return 'critical'
    case 'generation':
      return 'high'
    case 'query':
    case 'analysis':
      return 'medium'
    case 'meta':
      return 'low'
    default:
      return 'medium'
  }
}

/**
 * 计算影响严重度（数值）。
 */
function calculateImpactSeverity(relevanceTier: ChipRelevanceTier, group: string): number {
  const tierScore = {
    critical: 80,
    high: 60,
    medium: 40,
    low: 20,
  }
  const groupBonus = group === 'contextual' ? 10 : 0
  return tierScore[relevanceTier] + groupBonus
}

/**
 * 计算意图影响严重度。
 */
function calculateIntentImpactSeverity(
  relevanceTier: ChipRelevanceTier,
  intentClass: string,
): number {
  const tierScore = {
    critical: 80,
    high: 60,
    medium: 40,
    low: 20,
  }
  const classBonus = intentClass === 'mutation' || intentClass === 'instruction' ? 10 : 0
  return tierScore[relevanceTier] + classBonus
}

/**
 * 去重：同一有效目标按声明优先级择一。
 * 优先级：registered-command > intent-catalog
 */
function deduplicateByTarget(chips: ChipDescriptor[]): ChipDescriptor[] {
  const targetMap = new Map<string, ChipDescriptor>()

  for (const chip of chips) {
    const target = chip.destination
    const existing = targetMap.get(target)

    if (!existing) {
      targetMap.set(target, chip)
    } else {
      // 按来源优先级：registered-command 优先
      if (
        chip.sourceKind === 'registered-command' &&
        existing.sourceKind !== 'registered-command'
      ) {
        targetMap.set(target, chip)
      }
      // 如果来源相同，按相关性档优先级
      else if (chip.sourceKind === existing.sourceKind) {
        const tierOrder: Record<ChipRelevanceTier, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        }
        if (tierOrder[chip.relevanceTier] < tierOrder[existing.relevanceTier]) {
          targetMap.set(target, chip)
        }
      }
    }
  }

  return Array.from(targetMap.values())
}

/**
 * 确定性排序：相关性档 → impactScope severity → 稳定破平局键。
 */
function sortDeterministically(chips: ChipDescriptor[]): ChipDescriptor[] {
  return [...chips].sort((a, b) => {
    // 按 relevanceTier 降序
    const tierOrder: Record<ChipRelevanceTier, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }
    const tierDiff = tierOrder[a.relevanceTier] - tierOrder[b.relevanceTier]
    if (tierDiff !== 0) return tierDiff

    // 按 impactSeverity 降序
    const severityDiff = b.impactSeverity - a.impactSeverity
    if (severityDiff !== 0) return severityDiff

    // 按 stableTieBreak 升序（字典序）
    return a.sortKey.stableTieBreak.localeCompare(b.sortKey.stableTieBreak)
  })
}

/**
 * 过滤全局作用域：项目类芯片缺席而非灰显。
 */
function filterGlobalScope(chips: ChipDescriptor[], scope: string): ChipDescriptor[] {
  if (scope !== 'global') return chips

  // 全局作用域下，过滤掉需要项目数据的芯片
  // 简化版：根据 requiredPermissions 是否包含项目相关权限
  return chips.filter((chip) => {
    // 如果芯片需要项目读取权限，则缺席
    return !chip.requiredPermissions.some(
      (perm) => perm.startsWith('project:') && perm !== 'project:create',
    )
  })
}

// ===========================================================================
// 主函数
// ===========================================================================

/**
 * 派生芯片：从命令注册表与意图目录双来源派生，去重、排序、过滤。
 *
 * @param commands 已注册命令列表
 * @param subIntents 意图目录子意图列表
 * @param ctx 派生上下文
 * @param maxVisible 最大可见芯片数
 * @returns 派生结果
 */
export function deriveChips(
  commands: readonly RegisteredCommand[],
  subIntents: readonly CopilotSubIntentEntry[],
  ctx: ChipDerivationContext,
  maxVisible: number = DEFAULT_MAX_VISIBLE,
): ChipDerivationResult {
  // 1. 从两个来源采集候选
  const commandCandidates = gatherFromCommandRegistry(commands, ctx)
  const intentCandidates = gatherFromIntentCatalog(subIntents, ctx)

  // 2. 合并
  const allCandidates = [...commandCandidates, ...intentCandidates]

  // 3. 去重
  const deduplicated = deduplicateByTarget(allCandidates)

  // 4. 排序
  const sorted = sortDeterministically(deduplicated)

  // 5. 过滤全局作用域
  const filtered = filterGlobalScope(sorted, ctx.scope)

  // 6. 应用可见上界
  const visible = filtered.slice(0, maxVisible)
  const omittedCount = Math.max(0, filtered.length - maxVisible)

  return {
    chips: visible,
    maxVisible,
    omittedCount,
  }
}
