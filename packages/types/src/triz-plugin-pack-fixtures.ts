/**
 * triz-plugin-pack-fixtures —— V3 TRIZ 官方插件包测试夹具（正例/负例）。
 */
import {
  PLUGIN_TRIZ_PACK_ID,
  PLUGIN_TRIZ_PACK_VERSION,
  type TrizPluginPackOperationPayload,
} from './triz-plugin-pack.js'
export const VALID_TRIZ_PACK_CONTRIBUTIONS = [
  {
    contributionKey: 'triz-advisor-skill',
    seamKey: 'skill-adapter.skill-bundle',
    seamVersion: '1.0.0',
    payload: {
      skillKey: 'triz-advisor-core',
      skillVersion: '1.0.0',
      lifecycleRef: 'active',
      description: 'TRIZ 顾问核心 Skill 引用（宿主拥有 lifecycle）',
    },
  },
  {
    contributionKey: 'triz-technical-contradiction',
    seamKey: 'server-command-proposal.proposal-only',
    seamVersion: '1.0.0',
    payload: {
      callbackHandle: 'triz-technical-contradiction-proposal',
      description: '技术矛盾分析 proposal（仅建议，宿主事务）',
      requiredPermissions: ['com.aiproj.triz.technical.analyze'],
      visibilityFilter: {},
      confirmationRequired: true,
    },
  },
  {
    contributionKey: 'triz-physical-contradiction',
    seamKey: 'server-command-proposal.proposal-only',
    seamVersion: '1.0.0',
    payload: {
      callbackHandle: 'triz-physical-contradiction-proposal',
      description: '物理矛盾分析 proposal',
      requiredPermissions: ['com.aiproj.triz.physical.analyze'],
      visibilityFilter: {},
      confirmationRequired: true,
    },
  },
  {
    contributionKey: 'triz-evolution-trend',
    seamKey: 'server-query.readonly-provider',
    seamVersion: '1.0.0',
    payload: {
      callbackHandle: 'triz-evolution-trend-query',
      description: '进化趋势分析只读查询',
      requiredPermissions: ['com.aiproj.triz.evolution.analyze'],
      visibilityFilter: {},
    },
  },
  {
    contributionKey: 'triz-skill-layer-context',
    seamKey: 'compiler-contribution.context-contribution',
    seamVersion: '1.0.0',
    payload: {
      descriptor: 'triz-skill-layer-context',
      scope: 'project',
      targetStages: ['requirements_parsing', 'contradiction_detection'],
      advisory: true,
      contextScope: 'project',
      description: 'TRIZ Skill Layer 上下文贡献（advisory 只读）',
    },
  },
] as const
export const VALID_TRIZ_PACK_MANIFEST = {
  manifestSchemaVersion: '1.0',
  identity: {
    pluginId: PLUGIN_TRIZ_PACK_ID,
    name: 'TRIZ Pack',
    version: PLUGIN_TRIZ_PACK_VERSION,
    publisher: 'aiproj-official',
    description: '官方 TRIZ 顾问、矛盾分析与进化趋势插件包（宿主适配、仅建议、可撤销）',
  },
  provenance: { distribution: 'first-party' as const },
  compatibility: {
    hostContractVersion: '1.0',
    requiredSeams: [
      { seamKey: 'skill-adapter.skill-bundle', seamVersion: '1.0.0' },
      { seamKey: 'server-command-proposal.proposal-only', seamVersion: '1.0.0' },
      { seamKey: 'server-query.readonly-provider', seamVersion: '1.0.0' },
      { seamKey: 'compiler-contribution.context-contribution', seamVersion: '1.0.0' },
    ],
  },
  contributions: VALID_TRIZ_PACK_CONTRIBUTIONS.map((c) => ({
    contributionKey: c.contributionKey,
    seamKey: c.seamKey,
    seamVersion: c.seamVersion,
    entrypoint: { kind: 'json' as const, path: `contributions/${c.contributionKey}.json` },
    permissionRefs: [],
  })),
  permissions: [
    {
      permissionKey: 'com.aiproj.triz.assistant.submit',
      seamKey: 'server-command-proposal.proposal-only',
      scopeKind: 'organization' as const,
      resourceRef: 'project.triz_assistant',
      actionRef: 'submit',
      sideEffect: 'proposal' as const,
      confirmation: 'required' as const,
      network: 'none' as const,
      purpose: 'triz-assistant-submit-preview-only',
    },
  ],
}
export const VALID_TRIZ_OPERATION_PAYLOADS: Record<string, TrizPluginPackOperationPayload> = {
  assistant: {
    operation: 'triz.assistant.submit',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { message: '请分析项目的技术矛盾并给出 TRIZ 建议' },
    idempotencyKey: 'idem-assistant-001',
    enableAi: false,
  },
  technical: {
    operation: 'triz.technical_contradiction.analyze',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { userContext: '分析技术矛盾：性能与成本的平衡' },
    idempotencyKey: 'idem-technical-001',
  },
  physical: {
    operation: 'triz.physical_contradiction.analyze',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { userContext: '分析物理矛盾：同一资源在不同阶段的相反需求' },
    idempotencyKey: 'idem-physical-001',
  },
  evolution: {
    operation: 'triz.evolution_trend.analyze',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: {},
    idempotencyKey: 'idem-evolution-001',
  },
}
export const NEGATIVE_TRIZ_OPERATION_FIXTURES: Record<string, unknown> = {
  unknownOperation: {
    operation: 'triz.unknown.operation',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
  },
  arbitraryMethod: {
    operation: 'triz.assistant.submit; DROP TABLE triz_assistant_runs',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
  },
  crossTenant: {
    operation: 'triz.assistant.submit',
    organizationId: 999,
    projectId: 10,
    actorId: 100,
    input: { message: 'cross tenant' },
  },
  paramOutOfBoundsMessage: {
    operation: 'triz.assistant.submit',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { message: 'x'.repeat(5000) },
  },
  directWriteAttempt: {
    operation: 'triz.technical_contradiction.analyze',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { userContext: 'test', directWrite: true },
  },
  secretInInput: {
    operation: 'triz.assistant.submit',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { message: 'my token is sk-123456789012345678901234567890abcdef' },
  },
  sqlInjection: {
    operation: 'triz.assistant.submit',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { message: 'SELECT * FROM organizations WHERE id=1' },
  },
  unallowedField: {
    operation: 'triz.assistant.submit',
    organizationId: 1,
    projectId: 10,
    actorId: 100,
    input: { message: 'hi' },
    malformedExtraField: 'evil',
  },
}
