/**
 * plugin-server-hook-pilot-fixtures —— 第一方 pilot 插件交付物夹具。
 * manifest + 一条 server-query 贡献 + 一条 server-command-proposal 贡献，
 * 全部 networkPolicy: none，确定性实现，零外部副作用。
 */

export const PILOT_PLUGIN_ID = 'com.aiproj.pilot-hook-demo'
export const PILOT_PLUGIN_VERSION = '1.0.0'

/**
 * Pilot 插件 manifest（含 server-query 与 server-command-proposal 两条贡献声明）
 */
export const PILOT_PLUGIN_MANIFEST = {
  schemaVersion: '1.0',
  pluginId: PILOT_PLUGIN_ID,
  version: PILOT_PLUGIN_VERSION,
  title: 'AIPROJ Pilot Hook Demo',
  description:
    '第一方 pilot 插件：验证 server-query 与 server-command-proposal 两条 hook 接缝的端到端消费。',
  author: 'AIPROJ Core Team',
  license: 'MIT',
  compatibility: {
    hostVersion: '>=3.0.0',
    requiredSeams: [
      { seamKey: 'server-query.readonly-provider', version: '1.0.0' },
      { seamKey: 'server-command-proposal.proposal-only', version: '1.0.0' },
    ],
  },
  contributions: [
    {
      contributionKey: 'pilot-query-stats',
      seamKey: 'server-query.readonly-provider',
      seamVersion: '1.0.0',
      title: 'Pilot 只读统计查询',
      payload: {
        callbackHandle: 'pilot-query-stats-callback',
        description: '返回项目任务统计的只读聚合（fixture 数据）',
        requiredPermissions: ['project:view'],
      },
    },
    {
      contributionKey: 'pilot-proposal-create-task',
      seamKey: 'server-command-proposal.proposal-only',
      seamVersion: '1.0.0',
      title: 'Pilot 命令提案：创建任务',
      payload: {
        callbackHandle: 'pilot-proposal-create-task-callback',
        description: '产出创建任务的命令提案（fixture 提案，不直接执行）',
        requiredPermissions: ['project:task:create'],
        confirmationRequired: true,
      },
    },
  ],
  permissions: [
    {
      permissionKey: 'project:view',
      seamKey: 'server-query.readonly-provider',
      sideEffect: 'read-only',
      network: 'none',
      purpose: '读取项目任务统计',
    },
    {
      permissionKey: 'project:task:create',
      seamKey: 'server-command-proposal.proposal-only',
      sideEffect: 'write',
      network: 'none',
      purpose: '产出创建任务的命令提案',
    },
  ],
  distribution: {
    visibility: 'private',
    registry: 'builtin',
  },
}

/**
 * Pilot 插件 query 回调的确定性实现（fixture 数据）
 */
export const PILOT_QUERY_CALLBACK_RESULT = {
  totalTasks: 42,
  completedTasks: 10,
  inProgressTasks: 15,
  pendingTasks: 17,
  completionRate: 0.238,
  generatedAt: '2026-08-19T12:00:00.000Z',
}

/**
 * Pilot 插件 proposal 回调的确定性实现（fixture 提案）
 */
export const PILOT_PROPOSAL_CALLBACK_RESULT = {
  action: 'create_task',
  taskTitle: '[Pilot Plugin] 自动创建的示例任务',
  taskDescription:
    '此任务由 pilot 插件通过 server-command-proposal hook 产出，需经核心确认通道显式确认后方可执行。',
  taskPriority: 'medium',
  estimatedHours: 2,
}

/** Provider calls counter for zero-external-call assertion */
let providerCallCount = 0

export function getProviderCallCount(): number {
  return providerCallCount
}

export function resetProviderCallCount(): void {
  providerCallCount = 0
}
