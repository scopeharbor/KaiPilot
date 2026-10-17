/**
 * v3-compiler-hook-plugin-pilot —— Pilot 插件确定性回调实现（task 4.2）。
 *
 * 两条贡献的确定性回调（核心进程内注册表句柄），零外部调用可断言。
 * - server-query.readonly-provider：返回 fixture 只读聚合数据。
 * - server-command-proposal.proposal-only：返回 fixture 命令提案。
 */
import {
  PILOT_QUERY_CALLBACK_RESULT,
  PILOT_PROPOSAL_CALLBACK_RESULT,
  type PluginServerHookQueryRequest,
  type PluginServerHookQueryResult,
  type PluginServerHookProposalRequest,
  type PluginServerHookProposalResult,
} from '@aiproj/types'
import {
  registerServerHookCallback,
  unregisterServerHookCallback,
} from '#services/plugin_server_hook_invocation_service'

/** Provider calls counter for zero-external-call assertion */
let providerCallCount = 0

export function getProviderCallCount(): number {
  return providerCallCount
}

export function resetProviderCallCount(): void {
  providerCallCount = 0
}

/**
 * 确定性 query 回调：返回 fixture 只读聚合数据（零外部调用）
 */
async function pilotQueryCallback(
  request: PluginServerHookQueryRequest,
): Promise<PluginServerHookQueryResult> {
  providerCallCount++

  return {
    contributionKey: request.contributionKey,
    pluginId: request.pluginId,
    data: { ...PILOT_QUERY_CALLBACK_RESULT },
    advisory: true,
    source: `${request.pluginId}:${request.contributionKey}`,
    timestamp: new Date().toISOString(),
  }
}

/**
 * 确定性 proposal 回调：返回 fixture 命令提案（零外部调用）
 */
async function pilotProposalCallback(
  request: PluginServerHookProposalRequest,
): Promise<PluginServerHookProposalResult> {
  providerCallCount++

  const proposal = { ...PILOT_PROPOSAL_CALLBACK_RESULT } as Record<string, unknown>
  // 确定性摘要（基于规范化负载 hash）
  const sortedKeys = Object.keys(proposal).sort()
  const canonical = sortedKeys.map((key) => `${key}:${JSON.stringify(proposal[key])}`).join('|')

  // 简化的确定性 hash（FNV-1a）
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  const summary = hash.toString(16).padStart(8, '0')

  return {
    contributionKey: request.contributionKey,
    pluginId: request.pluginId,
    proposal: proposal as PluginServerHookProposalResult['proposal'],
    summary,
    description: 'Pilot 插件产出的创建任务命令提案（fixture）',
    source: `${request.pluginId}:${request.contributionKey}`,
    timestamp: new Date().toISOString(),
  }
}

/**
 * 注册 pilot 插件的确定性回调到进程内注册表。
 * 在应用启动时调用一次即可。
 */
export function registerPilotPluginCallbacks(): void {
  registerServerHookCallback(
    'pilot-query-stats-callback',
    pilotQueryCallback as (
      request: PluginServerHookQueryRequest | PluginServerHookProposalRequest,
    ) => Promise<PluginServerHookQueryResult | PluginServerHookProposalResult>,
  )
  registerServerHookCallback(
    'pilot-proposal-create-task-callback',
    pilotProposalCallback as (
      request: PluginServerHookQueryRequest | PluginServerHookProposalRequest,
    ) => Promise<PluginServerHookQueryResult | PluginServerHookProposalResult>,
  )
}

/**
 * 注销 pilot 插件的确定性回调。
 */
export function unregisterPilotPluginCallbacks(): void {
  unregisterServerHookCallback('pilot-query-stats-callback')
  unregisterServerHookCallback('pilot-proposal-create-task-callback')
}
