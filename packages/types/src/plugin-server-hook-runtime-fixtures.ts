/**
 * plugin-server-hook-runtime-fixtures —— 服务端 hook 运行时契约测试夹具。
 * 包含合法负载、网络违规、平行重造负例、敏感信息负例等。
 */

import type {
  PluginServerHookQueryRequest,
  PluginServerHookQueryResult,
  PluginServerHookProposalRequest,
  PluginServerHookProposalResult,
  PluginServerHookRequestContext,
} from './plugin-server-hook-runtime.js'

// 1. 合法 query 负载
export const fixtureValidServerQueryPayload = {
  callbackHandle: 'fixture-query-callback',
  description: 'Fixture read-only query for pilot plugin',
  requiredPermissions: ['project:task:view'],
  visibilityFilter: { projectStatus: 'active' },
}

// 2. 合法 proposal 负载
export const fixtureValidServerProposalPayload = {
  callbackHandle: 'fixture-proposal-callback',
  description: 'Fixture command proposal for pilot plugin',
  requiredPermissions: ['project:task:update'],
  visibilityFilter: { projectStatus: 'active' },
  confirmationRequired: true,
}

// 3. 负例：字段越界（包含封闭字段集之外的字段）
export const fixtureFieldOutOfBoundsPayload = {
  callbackHandle: 'valid-handle',
  extraField: 'should be rejected',
  anotherField: 123,
}

// 4. 负例：网络违规（声明非 none 网络策略）
export const fixtureNetworkViolationPayload = {
  callbackHandle: 'valid-handle',
  networkPolicy: 'http', // 违反 networkPolicy: none
  description: 'This should be rejected',
}

// 5. 负例：平行重造违规（声明自有 RBAC）
export const fixtureParallelRbacRecreationPayload = {
  callbackHandle: 'valid-handle',
  rbac: { customRoles: ['admin'] }, // 违反平行重造阻断
  description: 'This should be rejected',
}

// 6. 负例：平行重造违规（声明事务提交）
export const fixtureParallelTransactionRecreationPayload = {
  callbackHandle: 'valid-handle',
  transaction: { commitOnSuccess: true }, // 违反平行重造阻断
  description: 'This should be rejected',
}

// 7. 负例：平行重造违规（声明审计写入）
export const fixtureParallelAuditRecreationPayload = {
  callbackHandle: 'valid-handle',
  auditLog: { writeEnabled: true }, // 违反平行重造阻断
  description: 'This should be rejected',
}

// 8. 负例：敏感材料（secret key）
export const fixtureServerHookSecretDetectedPayload = {
  callbackHandle: 'valid-handle',
  secret: 'sk-1234567890abcdef1234567890abcdef',
  description: 'This should be rejected',
}

// 9. 测试用请求上下文
export const fixtureRequestContext: PluginServerHookRequestContext = {
  organizationId: 1,
  projectId: 100,
  userId: 1001,
  userRoles: ['admin', 'project_manager'],
  requestedPermissions: ['project:task:view'],
  scope: 'project',
}

// 10. 测试用 query 请求
export const fixtureQueryRequest: PluginServerHookQueryRequest = {
  seamKey: 'server-query.readonly-provider',
  contributionKey: 'pilot-query',
  pluginId: 'pilot-plugin',
  pluginVersion: '1.0.0',
  context: fixtureRequestContext,
  payload: fixtureValidServerQueryPayload,
}

// 11. 测试用 query 结果
export const fixtureQueryResult: PluginServerHookQueryResult = {
  contributionKey: 'pilot-query',
  pluginId: 'pilot-plugin',
  data: { totalTasks: 42, completedTasks: 10 },
  advisory: true,
  source: 'pilot-plugin:pilot-query',
  timestamp: '2026-08-19T12:00:00.000Z',
}

// 12. 测试用 proposal 请求
export const fixtureProposalRequest: PluginServerHookProposalRequest = {
  seamKey: 'server-command-proposal.proposal-only',
  contributionKey: 'pilot-proposal',
  pluginId: 'pilot-plugin',
  pluginVersion: '1.0.0',
  context: fixtureRequestContext,
  payload: fixtureValidServerProposalPayload,
}

// 13. 测试用 proposal 结果
export const fixtureProposalResult: PluginServerHookProposalResult = {
  contributionKey: 'pilot-proposal',
  pluginId: 'pilot-plugin',
  proposal: {
    action: 'create_task',
    taskTitle: 'Automated task from pilot plugin',
    taskDescription: 'This is a fixture proposal',
  },
  summary: 'fixture-proposal-summary-hash',
  description: 'Fixture command proposal',
  source: 'pilot-plugin:pilot-proposal',
  timestamp: '2026-08-19T12:00:00.000Z',
}

// 14. 负例：空负载
export const fixtureEmptyPayload = {}

// 15. 负例：数组负载
export const fixtureArrayPayload = ['not', 'an', 'object']
