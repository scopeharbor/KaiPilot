/**
 * v3-frontend-ai-usage-telemetry —— 前端 AI 使用事件 fixtures（测试共用）。
 *
 * 覆盖四态：完整会话、放弃、埋点关闭、发送失败。
 */
import type {
  FrontendTelemetryEvent,
  FrontendTelemetryPanelOpenEvent,
  FrontendTelemetryPanelCloseEvent,
  FrontendTelemetrySessionTurnEvent,
  FrontendTelemetryFirstQuestionIntentEvent,
  FrontendTelemetryAbandonmentEvent,
  FrontendTelemetryChipClickEvent,
  FrontendTelemetryActionClickEvent,
  FrontendTelemetryActionRejectEvent,
  FrontendTelemetryBatchRequest,
  FrontendTelemetryBatchResponse,
  FrontendTelemetryAggregationResult,
} from './frontend-ai-usage-telemetry.js'

// ===========================================================================
// 基础 fixtures
// ===========================================================================

/** 测试用组织 ID。 */
export const TEST_ORGANIZATION_ID = 'org-test-001'

/** 测试用会话 ID。 */
export const TEST_SESSION_ID = 'session-test-001'

/** 测试用时间戳。 */
export const TEST_TIMESTAMP = '2026-08-22T10:00:00.000Z'

// ===========================================================================
// 完整会话 fixtures
// ===========================================================================

/** 面板打开事件。 */
export const FIXTURE_PANEL_OPEN: FrontendTelemetryPanelOpenEvent = {
  eventKind: 'panel_open',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
}

/** 面板关闭事件（已提交）。 */
export const FIXTURE_PANEL_CLOSE_SUBMITTED: FrontendTelemetryPanelCloseEvent = {
  eventKind: 'panel_close',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  hasSubmitted: true,
}

/** 会话轮数事件。 */
export const FIXTURE_SESSION_TURN: FrontendTelemetrySessionTurnEvent = {
  eventKind: 'session_turn',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  turnCount: 1,
}

/** 首问意图类别事件。 */
export const FIXTURE_FIRST_QUESTION_INTENT: FrontendTelemetryFirstQuestionIntentEvent = {
  eventKind: 'first_question_intent',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  intentClass: 'query',
}

/** 芯片点击事件。 */
export const FIXTURE_CHIP_CLICK: FrontendTelemetryChipClickEvent = {
  eventKind: 'chip_click',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  chipId: 'chip-project-status',
  chipSource: 'intent-catalog',
}

/** 动作卡片点击事件。 */
export const FIXTURE_ACTION_CLICK: FrontendTelemetryActionClickEvent = {
  eventKind: 'action_click',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  actionId: 'action-create-task',
  actionLabel: '创建任务',
}

/** 动作卡片拒绝事件。 */
export const FIXTURE_ACTION_REJECT: FrontendTelemetryActionRejectEvent = {
  eventKind: 'action_reject',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  actionId: 'action-create-task',
  actionLabel: '创建任务',
}

/** 完整会话事件序列。 */
export const FIXTURE_COMPLETE_SESSION: readonly FrontendTelemetryEvent[] = [
  FIXTURE_PANEL_OPEN,
  FIXTURE_SESSION_TURN,
  FIXTURE_FIRST_QUESTION_INTENT,
  FIXTURE_CHIP_CLICK,
  FIXTURE_ACTION_CLICK,
  FIXTURE_PANEL_CLOSE_SUBMITTED,
]

// ===========================================================================
// 放弃 fixtures
// ===========================================================================

/** 面板关闭事件（未提交，放弃）。 */
export const FIXTURE_PANEL_CLOSE_ABANDONED: FrontendTelemetryPanelCloseEvent = {
  eventKind: 'panel_close',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  hasSubmitted: false,
}

/** 放弃事件。 */
export const FIXTURE_ABANDONMENT: FrontendTelemetryAbandonmentEvent = {
  eventKind: 'abandonment',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
}

/** 放弃会话事件序列。 */
export const FIXTURE_ABANDONMENT_SESSION: readonly FrontendTelemetryEvent[] = [
  FIXTURE_PANEL_OPEN,
  FIXTURE_PANEL_CLOSE_ABANDONED,
  FIXTURE_ABANDONMENT,
]

// ===========================================================================
// 埋点关闭 fixtures
// ===========================================================================

/** 埋点关闭状态下的事件序列（不应发送）。 */
export const FIXTURE_TELEMETRY_DISABLED_SESSION: readonly FrontendTelemetryEvent[] = [
  FIXTURE_PANEL_OPEN,
  FIXTURE_SESSION_TURN,
  FIXTURE_PANEL_CLOSE_SUBMITTED,
]

// ===========================================================================
// 发送失败 fixtures
// ===========================================================================

/** 批量发送请求。 */
export const FIXTURE_BATCH_REQUEST: FrontendTelemetryBatchRequest = {
  events: FIXTURE_COMPLETE_SESSION,
}

/** 批量发送成功响应。 */
export const FIXTURE_BATCH_RESPONSE_SUCCESS: FrontendTelemetryBatchResponse = {
  received: 6,
}

/** 批量发送失败响应（模拟网络错误）。 */
export const FIXTURE_BATCH_RESPONSE_FAILURE = null

// ===========================================================================
// 聚合 fixtures
// ===========================================================================

/** 聚合结果示例。 */
export const FIXTURE_AGGREGATION_RESULT: FrontendTelemetryAggregationResult = {
  openRate: 0.8,
  sessionLength: 3.5,
  firstQuestionDistribution: {
    query: 5,
    analysis: 3,
    generation: 2,
    mutation: 1,
    instruction: 1,
    meta: 0,
  },
  abandonmentRate: 0.2,
  chipClickDistribution: {
    'chip-project-status': 3,
    'chip-task-lookup': 2,
    'chip-risk-identification': 1,
  },
}

// ===========================================================================
// 敏感样本 fixtures
// ===========================================================================

/** 含用户输入文本的伪造事件。 */
export const FIXTURE_FORBIDDEN_USER_INPUT = {
  eventKind: 'panel_open',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  userInput: '用户输入的文本内容',
}

/** 含 token 的伪造事件。 */
export const FIXTURE_FORBIDDEN_TOKEN = {
  eventKind: 'panel_open',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  token: 'sk-1234567890abcdef',
}

/** 含 secret 的伪造事件。 */
export const FIXTURE_FORBIDDEN_SECRET = {
  eventKind: 'panel_open',
  timestamp: TEST_TIMESTAMP,
  sessionId: TEST_SESSION_ID,
  organizationId: TEST_ORGANIZATION_ID,
  secret: 'password: mysecretpassword',
}
