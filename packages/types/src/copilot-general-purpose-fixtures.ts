// @aiproj/types — Copilot 通用问答模式 fixtures
// v3-copilot-general-purpose-mode — 六态 fixtures（正常问答、配额耗尽、无权限、组织已关闭、时效性问题、切换清理）

import type {
  GeneralPurposeModeState,
  GeneralPurposeModeDecision,
  GeneralPurposeRequest,
  GeneralPurposeResponse,
} from './copilot-general-purpose.js'

// ---------------------------------------------------------------------------
// Fixture 辅助函数
// ---------------------------------------------------------------------------

function buildModeDecision(
  overrides: Partial<GeneralPurposeModeDecision> = {},
): GeneralPurposeModeDecision {
  return {
    isGeneralPurpose: true,
    boundaryResults: [
      'read_isolated',
      'write_forbidden',
      'memory_scope_filtered',
      'external_retrieval_blocked',
      'quota_sufficient',
    ],
    quotaStatus: 'sufficient',
    knowledgeLimitation: {
      noLiveLookupStated: false,
      uncertaintyStated: false,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 态 1：正常问答（happy path）
// ---------------------------------------------------------------------------

export function generalPurposeFixtureNormalQa(): {
  state: GeneralPurposeModeState
  decision: GeneralPurposeModeDecision
  request: GeneralPurposeRequest
  response: GeneralPurposeResponse
} {
  return {
    state: 'active',
    decision: buildModeDecision(),
    request: {
      message: '请帮我把下面这段话改写得更正式一些',
      sessionId: 'gp-session-normal-001',
      requestedCapability: 'rewrite',
    },
    response: {
      sessionId: 'gp-session-normal-001',
      messageId: 'gp-msg-normal-001',
      answer: '改写后的内容如下：……',
      capability: 'rewrite',
      knowledgeLimitation: {
        noLiveLookupStated: false,
        uncertaintyStated: false,
      },
      quotaStatus: 'sufficient',
      warnings: [],
      createdAt: '2026-08-17T00:00:00.000Z',
    },
  }
}

// ---------------------------------------------------------------------------
// 态 2：配额耗尽
// ---------------------------------------------------------------------------

export function generalPurposeFixtureQuotaExhausted(): {
  state: GeneralPurposeModeState
  decision: GeneralPurposeModeDecision
  response: GeneralPurposeResponse
} {
  return {
    state: 'active',
    decision: buildModeDecision({
      quotaStatus: 'exhausted',
      quotaExhaustionReason: 'daily_limit_reached',
      boundaryResults: [
        'read_isolated',
        'write_forbidden',
        'memory_scope_filtered',
        'external_retrieval_blocked',
        'quota_exhausted',
      ],
    }),
    response: {
      sessionId: 'gp-session-quota-001',
      messageId: 'gp-msg-quota-001',
      answer: '通用问答配额已达每日使用上限，请明日再试。',
      knowledgeLimitation: {
        noLiveLookupStated: false,
        uncertaintyStated: false,
      },
      quotaStatus: 'exhausted',
      quotaExhaustionReason: 'daily_limit_reached',
      warnings: ['配额已耗尽'],
      createdAt: '2026-08-17T00:00:00.000Z',
    },
  }
}

// ---------------------------------------------------------------------------
// 态 3：无权限（用户无 ai:trigger）
// ---------------------------------------------------------------------------

export function generalPurposeFixturePermissionMissing(): {
  state: GeneralPurposeModeState
  decision: GeneralPurposeModeDecision
} {
  return {
    state: 'entering',
    decision: buildModeDecision({
      quotaStatus: 'sufficient',
      boundaryResults: [
        'read_isolated',
        'write_forbidden',
        'memory_scope_filtered',
        'external_retrieval_blocked',
        'permission_missing',
      ],
    }),
  }
}

// ---------------------------------------------------------------------------
// 态 4：组织已关闭通用问答能力
// ---------------------------------------------------------------------------

export function generalPurposeFixtureCapabilityDisabled(): {
  state: GeneralPurposeModeState
  decision: GeneralPurposeModeDecision
} {
  return {
    state: 'entering',
    decision: buildModeDecision({
      quotaStatus: 'sufficient',
      boundaryResults: [
        'read_isolated',
        'write_forbidden',
        'memory_scope_filtered',
        'external_retrieval_blocked',
        'capability_disabled',
      ],
    }),
  }
}

// ---------------------------------------------------------------------------
// 态 5：时效性问题（需声明无实时检索）
// ---------------------------------------------------------------------------

export function generalPurposeFixtureTimelinessIssue(): {
  state: GeneralPurposeModeState
  decision: GeneralPurposeModeDecision
  request: GeneralPurposeRequest
  response: GeneralPurposeResponse
} {
  return {
    state: 'active',
    decision: buildModeDecision({
      knowledgeLimitation: {
        noLiveLookupStated: true,
        timelinessDisclaimer:
          '本回答基于模型知识，不包含实时外部检索结果。如需最新信息，请查阅官方来源。',
        knowledgeCutoffDisclaimer: '模型知识存在截止日期，可能不反映最新变化。',
        uncertaintyStated: false,
      },
    }),
    request: {
      message: '今天有什么重要的科技新闻？',
      sessionId: 'gp-session-time-001',
    },
    response: {
      sessionId: 'gp-session-time-001',
      messageId: 'gp-msg-time-001',
      answer:
        '由于本回答基于模型知识，不包含实时外部检索结果，无法提供今天的科技新闻。如需最新信息，请查阅官方新闻来源。',
      knowledgeLimitation: {
        noLiveLookupStated: true,
        timelinessDisclaimer:
          '本回答基于模型知识，不包含实时外部检索结果。如需最新信息，请查阅官方来源。',
        uncertaintyStated: false,
      },
      quotaStatus: 'sufficient',
      warnings: [],
      createdAt: '2026-08-17T00:00:00.000Z',
    },
  }
}

// ---------------------------------------------------------------------------
// 态 6：切换清理（双向上下文清理验证）
// ---------------------------------------------------------------------------

export function generalPurposeFixtureSwitchCleanup(): {
  /** 从项目 scope 切入通用模式时的清理验证数据。 */
  entering: {
    previousProjectContext: {
      projectId: string
      projectName: string
      projectTasks: readonly string[]
    }
    modeAfterSwitch: GeneralPurposeModeState
    decisionAfterSwitch: GeneralPurposeModeDecision
  }
  /** 从通用模式切回项目 scope 时的清理验证数据。 */
  leaving: {
    generalPurposeAnswers: readonly string[]
    /** 切回后这些通用回答不应被视为项目事实。 */
    projectFactsAfterSwitch: readonly string[]
  }
} {
  return {
    entering: {
      previousProjectContext: {
        projectId: 'proj-switch-001',
        projectName: '示例项目',
        projectTasks: ['任务A', '任务B'],
      },
      modeAfterSwitch: 'active',
      decisionAfterSwitch: buildModeDecision(),
    },
    leaving: {
      generalPurposeAnswers: ['敏捷和瀑布的区别在于……', '一般来说这类项目应该留20%缓冲'],
      projectFactsAfterSwitch: [],
    },
  }
}
