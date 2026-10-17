/**
 * v3-copilot-mentions-and-slash-commands —— 补全 Fixtures。
 *
 * 覆盖八态：提及命中、提及零结果、权限缺失、跨组织排除、
 * 命令命中、未启用命令、授权门命令、删除引用。
 *
 * 所有 fixture 为确定性常量，零运行时依赖。
 */

import type {
  MentionReference,
  CompletionMentionCandidate,
  CommandDescriptor,
  CommandCandidate,
  CompletionCandidate,
  CompletionResult,
  CompletionSortKey,
  InputCompletionState,
  CompletionQuerySummary,
  CompletionSelectionRecord,
} from './copilot-input-completion.js'

// ===========================================================================
// 共享排序键
// ===========================================================================

const SORT_KEY_CRITICAL_MENTION: CompletionSortKey = {
  relevanceTier: 'critical',
  impactSeverity: 90,
  stableTieBreak: 'fixture-mention-critical-001',
}

const SORT_KEY_CRITICAL_COMMAND: CompletionSortKey = {
  relevanceTier: 'critical',
  impactSeverity: 90,
  stableTieBreak: 'fixture-command-critical-001',
}

const SORT_KEY_HIGH: CompletionSortKey = {
  relevanceTier: 'high',
  impactSeverity: 70,
  stableTieBreak: 'fixture-high-001',
}

const SORT_KEY_MEDIUM: CompletionSortKey = {
  relevanceTier: 'medium',
  impactSeverity: 50,
  stableTieBreak: 'fixture-medium-001',
}

// ===========================================================================
// 态 1：提及命中
// ===========================================================================

export const FIXTURE_MENTION_REFERENCE: MentionReference = {
  entityType: 'task',
  entityId: 1042,
  label: '首页设计（T-1042）',
  organizationId: 1,
  projectId: 100,
}

export const FIXTURE_MENTION_CANDIDATE_HIT: CompletionMentionCandidate = {
  kind: 'mention',
  entityType: 'task',
  entityId: 1042,
  label: '首页设计（T-1042）',
  summary: '完成首页 UI 设计稿',
  projectId: 100,
  sortKey: SORT_KEY_CRITICAL_MENTION,
}

export const FIXTURE_MENTION_RESULT_HIT: CompletionResult = {
  kind: 'mention',
  candidates: [FIXTURE_MENTION_CANDIDATE_HIT],
  count: 1,
  truncated: false,
}

// ===========================================================================
// 态 2：提及零结果
// ===========================================================================

export const FIXTURE_MENTION_RESULT_EMPTY: CompletionResult = {
  kind: 'mention',
  candidates: [],
  count: 0,
  truncated: false,
}

// ===========================================================================
// 态 3：权限缺失（不可访问实体缺席——fixture 仅记录查询摘要）
// ===========================================================================

export const FIXTURE_MENTION_QUERY_NO_PERM: CompletionQuerySummary = {
  kind: 'mention',
  prefixLength: 3,
  candidateCount: 2, // 与有权限 actor 相同的计数，证明无泄露
  triggerOffset: 0,
}

// ===========================================================================
// 态 4：跨组织排除（fixture 仅记录查询摘要）
// ===========================================================================

export const FIXTURE_MENTION_QUERY_CROSS_ORG: CompletionQuerySummary = {
  kind: 'mention',
  prefixLength: 5,
  candidateCount: 0, // 跨组织实体零出现
  triggerOffset: 0,
}

// ===========================================================================
// 态 5：命令命中
// ===========================================================================

export const FIXTURE_COMMAND_DESCRIPTOR_HIT: CommandDescriptor = {
  id: 'intent.decompose-task',
  label: '拆解任务',
  sourceKind: 'intent-catalog',
  group: 'contextual',
  description: '将复杂任务拆解为可执行的子任务',
  requiredPermissions: ['task:create'],
  availabilityKind: 'available',
  fillText: '/拆解任务',
  routingKey: 'decompose-task',
}

export const FIXTURE_COMMAND_CANDIDATE_HIT: CommandCandidate = {
  kind: 'command',
  descriptor: FIXTURE_COMMAND_DESCRIPTOR_HIT,
  sortKey: SORT_KEY_CRITICAL_COMMAND,
}

export const FIXTURE_COMMAND_RESULT_HIT: CompletionResult = {
  kind: 'command',
  candidates: [FIXTURE_COMMAND_CANDIDATE_HIT],
  count: 1,
  truncated: false,
}

// ===========================================================================
// 态 6：未启用命令
// ===========================================================================

export const FIXTURE_COMMAND_DESCRIPTOR_NOT_ENABLED: CommandDescriptor = {
  id: 'command.web-search',
  label: '网络搜索',
  sourceKind: 'registered-command',
  group: 'search',
  description: '在互联网上搜索相关信息',
  requiredPermissions: [],
  availabilityKind: 'not-enabled',
  hint: '该能力未启用，可在设置中开启',
  fillText: '/网络搜索',
  routingKey: 'web-search',
}

export const FIXTURE_COMMAND_CANDIDATE_NOT_ENABLED: CommandCandidate = {
  kind: 'command',
  descriptor: FIXTURE_COMMAND_DESCRIPTOR_NOT_ENABLED,
  sortKey: SORT_KEY_HIGH,
}

// ===========================================================================
// 态 7：授权门命令
// ===========================================================================

export const FIXTURE_COMMAND_DESCRIPTOR_AUTH_GATED: CommandDescriptor = {
  id: 'command.gitlab-sync',
  label: 'GitLab 同步',
  sourceKind: 'registered-command',
  group: 'contextual',
  description: '将项目变更同步到 GitLab 仓库',
  requiredPermissions: ['project:admin'],
  availabilityKind: 'authorization-gated',
  hint: '需要用户授权后才能使用该能力',
  fillText: '/GitLab 同步',
  routingKey: 'gitlab-sync',
}

export const FIXTURE_COMMAND_CANDIDATE_AUTH_GATED: CommandCandidate = {
  kind: 'command',
  descriptor: FIXTURE_COMMAND_DESCRIPTOR_AUTH_GATED,
  sortKey: SORT_KEY_MEDIUM,
}

export const FIXTURE_COMMAND_RESULT_AUTH_GATED: CompletionResult = {
  kind: 'command',
  candidates: [FIXTURE_COMMAND_CANDIDATE_AUTH_GATED],
  count: 1,
  truncated: false,
}

// ===========================================================================
// 态 8：删除引用（提交前孤儿引用被清除）
// ===========================================================================

export const FIXTURE_DANGLING_REFERENCE: MentionReference = {
  entityType: 'task',
  entityId: 9999,
  label: '已删除的任务',
  organizationId: 1,
}

export const FIXTURE_SUBMISSION_WITH_DANGLING_REF: {
  text: string
  mentions: readonly MentionReference[]
} = {
  text: '帮我分析一下这个项目', // 原提及文本已删除
  mentions: [FIXTURE_DANGLING_REFERENCE], // 孤儿引用——提交前应被清除
}

// ===========================================================================
// 混合候选列表（用于排序与确定性测试）
// ===========================================================================

export const FIXTURE_MIXED_CANDIDATES: readonly CompletionCandidate[] = [
  FIXTURE_COMMAND_CANDIDATE_NOT_ENABLED,
  FIXTURE_MENTION_CANDIDATE_HIT,
  FIXTURE_COMMAND_CANDIDATE_HIT,
  FIXTURE_COMMAND_CANDIDATE_AUTH_GATED,
]

/**
 * 排序后期望顺序：critical commands → critical mentions → high commands → medium commands
 * （同档按 stableTieBreak 字典序：'fixture-command-critical-001' < 'fixture-mention-critical-001'）
 */
export const FIXTURE_SORTED_CANDIDATES_EXPECTED: readonly CompletionCandidate[] = [
  FIXTURE_COMMAND_CANDIDATE_HIT, // command critical
  FIXTURE_MENTION_CANDIDATE_HIT, // mention critical
  FIXTURE_COMMAND_CANDIDATE_NOT_ENABLED, // command high
  FIXTURE_COMMAND_CANDIDATE_AUTH_GATED, // command medium
]

// ===========================================================================
// 输入状态 Fixtures
// ===========================================================================

export const FIXTURE_INPUT_STATE_MENTION: InputCompletionState = {
  active: true,
  kind: 'mention',
  prefix: '首页',
  selectedIndex: 0,
  candidates: [FIXTURE_MENTION_CANDIDATE_HIT],
  triggerOffset: 5,
}

export const FIXTURE_INPUT_STATE_COMMAND: InputCompletionState = {
  active: true,
  kind: 'command',
  prefix: '拆',
  selectedIndex: 0,
  candidates: [FIXTURE_COMMAND_CANDIDATE_HIT],
  triggerOffset: 0,
}

export const FIXTURE_INPUT_STATE_INACTIVE: InputCompletionState = {
  active: false,
  kind: null,
  prefix: '',
  selectedIndex: -1,
  candidates: [],
  triggerOffset: 0,
}

// ===========================================================================
// 选择记录 Fixtures
// ===========================================================================

export const FIXTURE_SELECTION_RECORD_MENTION: CompletionSelectionRecord = {
  kind: 'mention',
  candidateId: 'mention:task:1042',
  ordinal: 0,
  availabilityKind: 'available',
}

export const FIXTURE_SELECTION_RECORD_COMMAND: CompletionSelectionRecord = {
  kind: 'command',
  candidateId: 'cmd:intent.decompose-task',
  ordinal: 0,
  availabilityKind: 'available',
}

// ===========================================================================
// 非泄露测试用 Fixtures（两个 actor 仅差一项权限）
// ===========================================================================

export const FIXTURE_ACTOR_WITH_PERM = {
  userId: 1,
  permissions: ['task:read', 'task:create', 'project:read'],
}

export const FIXTURE_ACTOR_WITHOUT_PERM = {
  userId: 2,
  permissions: ['task:read', 'project:read'], // 缺少 task:create
}

/**
 * 两个 actor 输入相同前缀后期望得到相同的候选数与排序。
 * 不可访问的 task:create 目标应缺席，且不得通过计数差或位次移动泄露。
 */
export const FIXTURE_NON_LEAKAGE_EXPECTED_COUNT = 1 // 两者都只看到 task:read 的结果
