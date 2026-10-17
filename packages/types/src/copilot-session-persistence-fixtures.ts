/**
 * v3-copilot-session-persistence —— 持久化 fixtures（六态）。
 *
 * 覆盖：新会话、多轮会话、已归档、已截断、续接中、幂等重复。
 * 全部使用确定性值，不调模型，不涉及真实 provider。
 */

import type {
  CopilotSessionPersistenceRecord,
  CopilotMessagePersistenceRecord,
  CopilotSessionExportPayload,
  CopilotResumeResult,
} from './copilot-session-persistence.js'

// ---------------------------------------------------------------------------
// 1. 新会话（空消息列表）
// ---------------------------------------------------------------------------

export function copilotSessionNewFixture(): CopilotSessionPersistenceRecord {
  return {
    dbId: 1,
    organizationId: 100,
    scope: 'project',
    attribution: { organizationId: '100', projectId: '200' },
    status: 'active',
    title: '新会话',
    archived: false,
    actorId: 1,
    sessionId: 'cps_test_001',
    idempotencyKey: 'ik_new_session_001',
    retentionExpiresAt: null,
    lastCleanupCheckAt: null,
    createdAt: new Date('2026-08-17T10:00:00Z'),
    updatedAt: new Date('2026-08-17T10:00:00Z'),
  }
}

export function copilotMessageNewSessionFixture(): CopilotMessagePersistenceRecord {
  return {
    dbId: 1,
    sessionDbId: 1,
    sessionId: 'cps_test_001',
    messageId: 'cpm_test_001',
    role: 'user',
    contentSummary: '帮我分析一下这个项目的风险',
    truncated: false,
    sourceRefs: [],
    routeDecisionId: null,
    actionId: null,
    warningCodes: [],
    degradedReason: null,
    costLedgerRef: null,
    sequence: 1,
    organizationId: 100,
    idempotencyKey: 'ik_msg_001',
    createdAt: new Date('2026-08-17T10:00:00Z'),
  }
}

// ---------------------------------------------------------------------------
// 2. 多轮会话（含多条消息）
// ---------------------------------------------------------------------------

export function copilotSessionMultiTurnFixture(): CopilotSessionPersistenceRecord {
  return {
    dbId: 2,
    organizationId: 100,
    scope: 'project',
    attribution: { organizationId: '100', projectId: '200' },
    status: 'active',
    title: '项目风险分析',
    archived: false,
    actorId: 1,
    sessionId: 'cps_test_002',
    idempotencyKey: 'ik_multi_turn_002',
    retentionExpiresAt: null,
    lastCleanupCheckAt: null,
    createdAt: new Date('2026-08-17T10:00:00Z'),
    updatedAt: new Date('2026-08-17T10:05:00Z'),
  }
}

export function copilotMessagesMultiTurnFixture(): CopilotMessagePersistenceRecord[] {
  return [
    {
      dbId: 2,
      sessionDbId: 2,
      sessionId: 'cps_test_002',
      messageId: 'cpm_test_002a',
      role: 'user',
      contentSummary: '帮我分析一下这个项目的风险',
      truncated: false,
      sourceRefs: [],
      routeDecisionId: null,
      actionId: null,
      warningCodes: [],
      degradedReason: null,
      costLedgerRef: null,
      sequence: 1,
      organizationId: 100,
      idempotencyKey: 'ik_multi_msg_001',
      createdAt: new Date('2026-08-17T10:00:00Z'),
    },
    {
      dbId: 3,
      sessionDbId: 2,
      sessionId: 'cps_test_002',
      messageId: 'cpm_test_002b',
      role: 'assistant',
      contentSummary: '根据项目数据分析，存在3个高风险项：进度延迟、资源不足、需求变更频繁',
      truncated: false,
      sourceRefs: ['source:risk:101', 'source:task:201'],
      routeDecisionId: 'cpr_test_002',
      actionId: null,
      warningCodes: [],
      degradedReason: null,
      costLedgerRef: 'ledger:attempt:001',
      sequence: 2,
      organizationId: 100,
      idempotencyKey: null,
      createdAt: new Date('2026-08-17T10:00:30Z'),
    },
    {
      dbId: 4,
      sessionDbId: 2,
      sessionId: 'cps_test_002',
      messageId: 'cpm_test_002c',
      role: 'user',
      contentSummary: '能不能给每个风险一个应对建议？',
      truncated: false,
      sourceRefs: [],
      routeDecisionId: null,
      actionId: null,
      warningCodes: [],
      degradedReason: null,
      costLedgerRef: null,
      sequence: 3,
      organizationId: 100,
      idempotencyKey: 'ik_multi_msg_003',
      createdAt: new Date('2026-08-17T10:05:00Z'),
    },
  ]
}

// ---------------------------------------------------------------------------
// 3. 已归档会话
// ---------------------------------------------------------------------------

export function copilotSessionArchivedFixture(): CopilotSessionPersistenceRecord {
  return {
    dbId: 3,
    organizationId: 100,
    scope: 'project',
    attribution: { organizationId: '100', projectId: '200' },
    status: 'archived',
    title: '已完成的风险分析',
    archived: true,
    actorId: 1,
    sessionId: 'cps_test_003',
    idempotencyKey: 'ik_archived_003',
    retentionExpiresAt: null,
    lastCleanupCheckAt: null,
    createdAt: new Date('2026-08-16T10:00:00Z'),
    updatedAt: new Date('2026-08-16T15:00:00Z'),
  }
}

// ---------------------------------------------------------------------------
// 4. 已截断消息
// ---------------------------------------------------------------------------

export function copilotMessageTruncatedFixture(): CopilotMessagePersistenceRecord {
  return {
    dbId: 5,
    sessionDbId: 2,
    sessionId: 'cps_test_002',
    messageId: 'cpm_test_004',
    role: 'assistant',
    contentSummary:
      '这是一个非常长的分析结果，包含了对项目各个方面的详细分析，包括进度、成本、质量、资源、风险等多个维度的评估。根据项目数据分析，存在3个高风险项：进度延迟、资源不足、需求变更频繁。建议采取以下措施：1）加强进度监控；2）增加资源投入；3）建立变更控制流程。此外，还需要关注以下中风险项……[已截断]',
    truncated: true,
    sourceRefs: ['source:risk:101', 'source:task:201', 'source:wbs:301'],
    routeDecisionId: 'cpr_test_004',
    actionId: null,
    warningCodes: ['CONTEXT_TRUNCATED'],
    degradedReason: null,
    costLedgerRef: 'ledger:attempt:002',
    sequence: 4,
    organizationId: 100,
    idempotencyKey: null,
    createdAt: new Date('2026-08-17T10:01:00Z'),
  }
}

// ---------------------------------------------------------------------------
// 5. 续接中会话（部分流式完成）
// ---------------------------------------------------------------------------

export function copilotSessionResumingFixture(): CopilotSessionPersistenceRecord {
  return {
    dbId: 4,
    organizationId: 100,
    scope: 'project',
    attribution: { organizationId: '100', projectId: '200' },
    status: 'active',
    title: '正在生成的分析',
    archived: false,
    actorId: 1,
    sessionId: 'cps_test_005',
    idempotencyKey: 'ik_resuming_005',
    retentionExpiresAt: null,
    lastCleanupCheckAt: null,
    createdAt: new Date('2026-08-17T10:00:00Z'),
    updatedAt: new Date('2026-08-17T10:02:00Z'),
  }
}

export function copilotResumeResultFixture(): CopilotResumeResult {
  return {
    resumable: true,
    resumeFromSequence: 3,
    cachedMessages: [
      {
        messageId: 'cpm_test_005a',
        role: 'user',
        contentSummary: '帮我生成一份项目周报',
        truncated: false,
        sourceRefs: [],
        warningCodes: [],
        degradedReason: null,
        sequence: 1,
        createdAt: '2026-08-17T10:00:00Z',
      },
      {
        messageId: 'cpm_test_005b',
        role: 'assistant',
        contentSummary: '正在生成项目周报，包含本周进度、下周计划、风险与问题……',
        truncated: false,
        sourceRefs: ['source:task:401'],
        warningCodes: [],
        degradedReason: null,
        sequence: 2,
        createdAt: '2026-08-17T10:00:30Z',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// 6. 幂等重复（同一派生键）
// ---------------------------------------------------------------------------

export function copilotSessionIdempotentDuplicateFixture(): {
  original: CopilotMessagePersistenceRecord
  duplicate: CopilotMessagePersistenceRecord
} {
  const now = new Date('2026-08-17T10:00:00Z')
  const base: CopilotMessagePersistenceRecord = {
    dbId: 6,
    sessionDbId: 2,
    sessionId: 'cps_test_002',
    messageId: 'cpm_test_006',
    role: 'user',
    contentSummary: '帮我看看这个任务的进度',
    truncated: false,
    sourceRefs: [],
    routeDecisionId: null,
    actionId: null,
    warningCodes: [],
    degradedReason: null,
    costLedgerRef: null,
    sequence: 5,
    organizationId: 100,
    idempotencyKey: 'ik_idempotent_006',
    createdAt: now,
  }
  return {
    original: base,
    duplicate: { ...base, dbId: 6 }, // 同一 dbId，幂等返回既有记录
  }
}

// ---------------------------------------------------------------------------
// 7. 导出载荷 fixture
// ---------------------------------------------------------------------------

export function copilotSessionExportPayloadFixture(): CopilotSessionExportPayload {
  return {
    sessionId: 'cps_test_002',
    scope: 'project',
    attribution: { organizationId: '100', projectId: '200' },
    status: 'active',
    title: '项目风险分析',
    archived: false,
    actorId: 1,
    createdAt: '2026-08-17T10:00:00Z',
    updatedAt: '2026-08-17T10:05:00Z',
    messages: [
      {
        messageId: 'cpm_test_002a',
        role: 'user',
        contentSummary: '帮我分析一下这个项目的风险',
        truncated: false,
        sourceRefs: [],
        warningCodes: [],
        degradedReason: null,
        sequence: 1,
        createdAt: '2026-08-17T10:00:00Z',
      },
      {
        messageId: 'cpm_test_002b',
        role: 'assistant',
        contentSummary: '根据项目数据分析，存在3个高风险项',
        truncated: false,
        sourceRefs: ['source:risk:101'],
        warningCodes: [],
        degradedReason: null,
        sequence: 2,
        createdAt: '2026-08-17T10:00:30Z',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// 8. 跨组织访问 fixture
// ---------------------------------------------------------------------------

export function copilotSessionCrossOrgFixture(): {
  session: CopilotSessionPersistenceRecord
  requestingOrgId: number
} {
  return {
    session: {
      dbId: 10,
      organizationId: 200, // 不同组织
      scope: 'project',
      attribution: { organizationId: '200', projectId: '300' },
      status: 'active',
      title: '另一个组织的会话',
      archived: false,
      actorId: 2,
      sessionId: 'cps_test_010',
      idempotencyKey: 'ik_crossorg_010',
      retentionExpiresAt: null,
      lastCleanupCheckAt: null,
      createdAt: new Date('2026-08-17T10:00:00Z'),
      updatedAt: new Date('2026-08-17T10:00:00Z'),
    },
    requestingOrgId: 100, // 请求者属于不同组织
  }
}
