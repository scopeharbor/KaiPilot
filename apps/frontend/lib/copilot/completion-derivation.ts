/**
 * v3-copilot-mentions-and-slash-commands —— / 命令补全派生纯函数。
 *
 * 从命令注册表与意图目录双来源派生 CommandDescriptor[]，
 * 去重、排序、过滤，提供确定性输出。
 * 复用 chip-derivation.ts 的双来源逻辑，但产出 CommandDescriptor 而非 ChipDescriptor。
 *
 * 本模块为纯函数，不依赖时钟、随机源与使用历史。
 */

import type {
  CommandDescriptor,
  CompletionAvailabilityKind,
  CompletionSortKey,
  CopilotSubIntentEntry,
} from '@aiproj/types'
import type { RegisteredCommand, CommandContext } from '../command-registry/types'

// ===========================================================================
// 输入类型
// ===========================================================================

/**
 * 命令派生上下文。
 */
export interface CommandDerivationContext {
  /** 当前路由上下文。 */
  commandContext: CommandContext
  /** 用户权限列表。 */
  permissions: string[]
  /** 当前 scope（如 'project', 'global', 'task'）。 */
  scope: string
  /** 能力是否启用（destination -> enabled）。 */
  enabledDestinations: Record<string, boolean>
  /** 授权门 destination 列表。 */
  authorizationGatedDestinations: string[]
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/**
 * 确定性排序键构造器（内部用）。
 */
function makeSortKey(
  relevanceTier: CompletionSortKey['relevanceTier'],
  impactSeverity: number,
  stableTieBreak: string,
): CompletionSortKey {
  return { relevanceTier, impactSeverity, stableTieBreak }
}

/**
 * 从命令注册表采集候选命令。
 */
function gatherFromCommandRegistry(
  commands: readonly RegisteredCommand[],
  ctx: CommandDerivationContext,
): CommandDescriptor[] {
  const candidates: CommandDescriptor[] = []

  for (const cmd of commands) {
    // 检查 when(ctx) 谓词
    if (cmd.when && !cmd.when(ctx.commandContext)) {
      continue
    }

    // 检查权限
    const hasPermission =
      cmd.requiresPermission?.every((perm) => ctx.permissions.includes(perm)) ?? true

    if (!hasPermission) {
      // not-permitted 命令应缺席，不泄露存在
      continue
    }

    // 确定可用性
    const availabilityKind = determineAvailability(cmd, ctx)

    // 确定相关性档：根据分组
    const relevanceTier = mapGroupToRelevanceTier(cmd.group)
    const impactSeverity = calculateImpactSeverity(relevanceTier, cmd.group)

    const descriptor: CommandDescriptor = {
      id: cmd.id,
      label: cmd.label,
      sourceKind: 'registered-command',
      group: cmd.group,
      description: cmd.label,
      requiredPermissions: cmd.requiresPermission ?? [],
      availabilityKind,
      hint: getAvailabilityHint(availabilityKind),
      fillText: `/${cmd.label}`,
      routingKey: cmd.id,
    }

    // 附加 sortKey 信息用于排序（通过 closure 捕获）
    ;(descriptor as CommandDescriptor & { _sortKey: CompletionSortKey })._sortKey = makeSortKey(
      relevanceTier,
      impactSeverity,
      cmd.id,
    )

    candidates.push(descriptor)
  }

  return candidates
}

/**
 * 从意图目录采集候选命令。
 */
function gatherFromIntentCatalog(
  subIntents: readonly CopilotSubIntentEntry[],
  ctx: CommandDerivationContext,
): CommandDescriptor[] {
  const candidates: CommandDescriptor[] = []

  for (const intent of subIntents) {
    // 检查权限
    const hasPermission = intent.requiredPermissions.every((perm) => ctx.permissions.includes(perm))

    if (!hasPermission) {
      // not-permitted 意图应缺席
      continue
    }

    // 检查 scope 匹配
    const matchesScope = intent.ruleDeclarations.some((rule) => {
      if (rule.routePatterns) {
        return rule.routePatterns.some((pattern) => ctx.commandContext.pathname.startsWith(pattern))
      }
      return false
    })

    if (!matchesScope && ctx.scope !== 'global') {
      continue
    }

    // 确定可用性
    const availabilityKind = determineIntentAvailability(intent, ctx)

    // 确定相关性档
    const relevanceTier = mapIntentClassToRelevanceTier(intent.intentClass)
    const impactSeverity = calculateIntentImpactSeverity(relevanceTier, intent.intentClass)

    const descriptor: CommandDescriptor = {
      id: intent.subIntentId,
      label: intent.label,
      sourceKind: 'intent-catalog',
      group: intent.intentClass,
      description: intent.label,
      requiredPermissions: intent.requiredPermissions,
      availabilityKind,
      hint: getAvailabilityHint(availabilityKind),
      fillText: `/${intent.label}`,
      routingKey: intent.subIntentId,
    }

    ;(descriptor as CommandDescriptor & { _sortKey: CompletionSortKey })._sortKey = makeSortKey(
      relevanceTier,
      impactSeverity,
      intent.subIntentId,
    )

    candidates.push(descriptor)
  }

  return candidates
}

/**
 * 确定命令的可用性。
 */
function determineAvailability(
  cmd: RegisteredCommand,
  ctx: CommandDerivationContext,
): CompletionAvailabilityKind {
  const enabled = ctx.enabledDestinations[cmd.id] ?? true
  if (!enabled) {
    return 'not-enabled'
  }

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
  ctx: CommandDerivationContext,
): CompletionAvailabilityKind {
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
function getAvailabilityHint(kind: CompletionAvailabilityKind): string | undefined {
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
function mapGroupToRelevanceTier(group: string): CompletionSortKey['relevanceTier'] {
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
function mapIntentClassToRelevanceTier(intentClass: string): CompletionSortKey['relevanceTier'] {
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
 * 计算影响严重度。
 */
function calculateImpactSeverity(
  relevanceTier: CompletionSortKey['relevanceTier'],
  group: string,
): number {
  const tierScore: Record<string, number> = {
    critical: 80,
    high: 60,
    medium: 40,
    low: 20,
  }
  const groupBonus = group === 'contextual' ? 10 : 0
  return (tierScore[relevanceTier] ?? 40) + groupBonus
}

/**
 * 计算意图影响严重度。
 */
function calculateIntentImpactSeverity(
  relevanceTier: CompletionSortKey['relevanceTier'],
  intentClass: string,
): number {
  const tierScore: Record<string, number> = {
    critical: 80,
    high: 60,
    medium: 40,
    low: 20,
  }
  const classBonus = intentClass === 'mutation' || intentClass === 'instruction' ? 10 : 0
  return (tierScore[relevanceTier] ?? 40) + classBonus
}

/**
 * 去重：同一有效目标按声明优先级择一。
 * 优先级：registered-command > intent-catalog
 */
function deduplicateByTarget(descriptors: CommandDescriptor[]): CommandDescriptor[] {
  const targetMap = new Map<string, CommandDescriptor>()

  for (const desc of descriptors) {
    const target = desc.routingKey
    const existing = targetMap.get(target)

    if (!existing) {
      targetMap.set(target, desc)
    } else {
      // registered-command 优先
      if (
        desc.sourceKind === 'registered-command' &&
        existing.sourceKind !== 'registered-command'
      ) {
        targetMap.set(target, desc)
      } else if (desc.sourceKind === existing.sourceKind) {
        // 来源相同按 sortKey 比较
        const aKey = getSortKey(desc)
        const bKey = getSortKey(existing)
        if (compareSortKeys(aKey, bKey) < 0) {
          targetMap.set(target, desc)
        }
      }
    }
  }

  return Array.from(targetMap.values())
}

/**
 * 获取 descriptor 的 sortKey（通过内部 _sortKey 属性）。
 */
function getSortKey(desc: CommandDescriptor): CompletionSortKey {
  return (
    (desc as CommandDescriptor & { _sortKey?: CompletionSortKey })._sortKey ?? {
      relevanceTier: 'medium',
      impactSeverity: 0,
      stableTieBreak: desc.id,
    }
  )
}

/**
 * 确定性排序：relevanceTier → impactSeverity → stableTieBreak。
 */
function compareSortKeys(a: CompletionSortKey, b: CompletionSortKey): number {
  const tierOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }
  const tierDiff = (tierOrder[a.relevanceTier] ?? 4) - (tierOrder[b.relevanceTier] ?? 4)
  if (tierDiff !== 0) return tierDiff

  const severityDiff = b.impactSeverity - a.impactSeverity
  if (severityDiff !== 0) return severityDiff

  return a.stableTieBreak.localeCompare(b.stableTieBreak)
}

function sortDeterministically(descriptors: CommandDescriptor[]): CommandDescriptor[] {
  return [...descriptors].sort((a, b) => compareSortKeys(getSortKey(a), getSortKey(b)))
}

/**
 * 清理内部 _sortKey 属性后输出纯净的 CommandDescriptor。
 */
function stripInternalKeys(descriptors: CommandDescriptor[]): CommandDescriptor[] {
  return descriptors.map((d) => {
    const { _sortKey, ...rest } = d as CommandDescriptor & { _sortKey?: CompletionSortKey }
    return rest as CommandDescriptor
  })
}

// ===========================================================================
// 主函数
// ===========================================================================

/**
 * 派生 / 命令：从命令注册表与意图目录双来源派生 CommandDescriptor[]，
 * 去重、排序、过滤。
 *
 * 可用性语义：
 * - 'not-permitted': 命令完全缺席（不泄露存在）
 * - 'not-enabled': 命令可见，带 hint 提示
 * - 'authorization-gated': 命令可见，带 hint 提示，点击不发外部请求
 *
 * @param commands 已注册命令列表
 * @param subIntents 意图目录子意图列表
 * @param ctx 派生上下文
 * @returns 派生出的命令描述符列表（已排序、过滤、去重）
 */
export function deriveCommands(
  commands: readonly RegisteredCommand[],
  subIntents: readonly CopilotSubIntentEntry[],
  ctx: CommandDerivationContext,
  permissions: string[] = ctx.permissions,
  enabledDestinations: Record<string, boolean> = ctx.enabledDestinations,
  authorizationGatedDestinations: string[] = ctx.authorizationGatedDestinations,
): readonly CommandDescriptor[] {
  // 合并上下文参数
  const effectiveCtx: CommandDerivationContext = {
    ...ctx,
    permissions,
    enabledDestinations,
    authorizationGatedDestinations,
  }

  // 1. 从两个来源采集候选
  const commandCandidates = gatherFromCommandRegistry(commands, effectiveCtx)
  const intentCandidates = gatherFromIntentCatalog(subIntents, effectiveCtx)

  // 2. 合并
  const allCandidates = [...commandCandidates, ...intentCandidates]

  // 3. 去重
  const deduplicated = deduplicateByTarget(allCandidates)

  // 4. 排序
  const sorted = sortDeterministically(deduplicated)

  // 5. 清理内部属性
  const clean = stripInternalKeys(sorted)

  return clean
}
