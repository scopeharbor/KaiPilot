/**
 * plugin-event-subscription-contract-fixtures —— 事件订阅契约测试夹具
 * （纯声明式本机数据，无网络/无执行语义）。
 */

import {
  PLUGIN_EVENT_ENVELOPE_SCHEMA_VERSION,
  PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
  type NormalizedPluginEventSubscriptionPayload,
  type PluginEventEnvelope,
  type PluginEventResponse,
  type PluginEventSubscriptionDeclaration,
} from './plugin-event-subscription-contract.js'

/** 合法 pilot 订阅声明（project.task.updated@1.0.0）。 */
export function makeValidSubscriptionDeclaration(
  overrides?: Partial<PluginEventSubscriptionDeclaration>,
): PluginEventSubscriptionDeclaration {
  return {
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    responseKinds: ['observation'],
    filter: { op: 'eq', field: 'entityAction', value: 'updated' },
    ...overrides,
  }
}

/** 合法 manifest contribution 负载。 */
export function makeValidSubscriptionPayload(
  subscriptions?: PluginEventSubscriptionDeclaration[],
): Record<string, unknown> {
  return {
    subscriptions: subscriptions ?? [makeValidSubscriptionDeclaration()],
  }
}

/** 合法 observation 响应。 */
export function makeObservationResponse(deliveryIdentity: string): PluginEventResponse {
  return {
    schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
    kind: 'observation',
    deliveryIdentity,
    observation: { note: '任务更新已观察，无建议' },
  }
}

/** 合法 advisory-draft 响应。 */
export function makeAdvisoryDraftResponse(deliveryIdentity: string): PluginEventResponse {
  return {
    schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
    kind: 'advisory-draft',
    deliveryIdentity,
    advisoryDraft: { title: '建议拆分长任务', body: '检测到状态多次回退，建议拆分该任务。' },
  }
}

/** 合法 action-proposal 响应（只含宿主可验证的三字段）。 */
export function makeActionProposalResponse(deliveryIdentity: string): PluginEventResponse {
  return {
    schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
    kind: 'action-proposal',
    deliveryIdentity,
    actionProposal: {
      proposalKey: 'split-task-proposal.v1',
      title: '提案：将任务拆分为两段',
      summary: '基于变更频率观察，建议拆分以降低阻塞风险。',
    },
  }
}

/** 直接写入类恶意响应样例（校验必须拒绝）。 */
export function makeDirectWriteResponse(deliveryIdentity: string): Record<string, unknown> {
  return {
    schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
    kind: 'observation',
    deliveryIdentity,
    execute: { writeTask: true },
  }
}

/** 递归工作流类响应样例。 */
export function makeRecursiveResponse(deliveryIdentity: string): Record<string, unknown> {
  return {
    schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
    kind: 'observation',
    deliveryIdentity,
    triggerEvent: 'project.task.updated',
    workflow: 'auto-chain',
  }
}

/** 外部动作类响应样例。 */
export function makeExternalActionResponse(deliveryIdentity: string): Record<string, unknown> {
  return {
    schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
    kind: 'observation',
    deliveryIdentity,
    webhookUrl: 'https://evil.example/hook',
  }
}

/** 归一化负载样例（供后端 delivery host 测试复用）。 */
export function makeNormalizedSubscriptionFixture(): NormalizedPluginEventSubscriptionPayload {
  return {
    subscriptions: [
      {
        eventType: 'project.task.updated',
        eventVersion: '1.0.0',
        responseKinds: ['observation', 'action-proposal'],
        filterNodes: [{ op: 'eq', field: 'entityAction', value: 'updated' }],
        subscriptionDigest: 'fixturedigest',
      },
    ],
    payloadDigest: 'fixturepayload',
  }
}

/** envelope 样例（allowlist 投影）。 */
export function makeEnvelopeFixture(eventId: string): PluginEventEnvelope {
  return {
    schemaVersion: PLUGIN_EVENT_ENVELOPE_SCHEMA_VERSION,
    eventId,
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    occurredAt: '2026-08-24T00:00:00.000Z',
    organizationId: 1,
    projectId: 10,
    projection: { entityAction: 'updated', changedFields: 'status' },
    provenance: { sourceFamily: 'project-activity', producerRef: 'audit-bypass' },
  }
}
