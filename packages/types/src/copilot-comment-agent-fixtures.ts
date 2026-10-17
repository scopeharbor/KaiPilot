/**
 * v3-copilot-comment-thread-agent —— 评论区 Agent 身份 fixtures。
 *
 * 覆盖五态：有权提及、无权提及、跨组织、长串截断、回复失败。
 */

import type { CopilotMentionEntry, ThreadContextForTurn, MentionCandidate } from './comment.js'

// Inline constants to avoid cross-module resolution issues in vitest
const COPILOT_AGENT_ID = -1
const COPILOT_AGENT_NAME = 'Copilot'
const COPILOT_COMMENT_SENSITIVE_SAMPLES = [
  'sk-ant-api03-',
  'Bearer eyJhbGciOi',
  'password=secret123',
  'apiKey: "ghp_"',
  'Authorization: Basic',
  'SELECT * FROM users WHERE',
  'curl -H "Authorization"',
] as const

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const AGENT_COMMENT_ORG_1 = 1
export const AGENT_COMMENT_ORG_2 = 2
export const AGENT_COMMENT_PROJECT_100 = 100
export const AGENT_COMMENT_PROJECT_200 = 200
export const AGENT_COMMENT_USER_ALICE = 10
export const AGENT_COMMENT_USER_BOB = 11
export const AGENT_COMMENT_USER_CHARLIE = 12
export const AGENT_COMMENT_THREAD_500 = 500
export const AGENT_COMMENT_THREAD_600 = 600

// ---------------------------------------------------------------------------
// Copilot 提及候选条目
// ---------------------------------------------------------------------------

/** 标准 Copilot 提及候选条目 */
export const COPILOT_MENTION_ENTRY: CopilotMentionEntry = {
  userId: COPILOT_AGENT_ID,
  fullName: COPILOT_AGENT_NAME,
  email: '',
  avatarUrl: null,
  authorType: 'agent',
}

/** 与真人用户混合的提及候选列表（有权场景） */
export const MENTION_CANDIDATES_WITH_COPILOT: MentionCandidate[] = [
  {
    userId: AGENT_COMMENT_USER_ALICE,
    fullName: 'Alice',
    email: 'alice@example.com',
    avatarUrl: null,
  },
  { userId: AGENT_COMMENT_USER_BOB, fullName: 'Bob', email: 'bob@example.com', avatarUrl: null },
  {
    userId: COPILOT_AGENT_ID,
    fullName: COPILOT_AGENT_NAME,
    email: '',
    avatarUrl: null,
    authorType: 'agent',
  } as MentionCandidate,
]

/** 不含 Copilot 的提及候选列表（无权场景） */
export const MENTION_CANDIDATES_WITHOUT_COPILOT: MentionCandidate[] = [
  {
    userId: AGENT_COMMENT_USER_ALICE,
    fullName: 'Alice',
    email: 'alice@example.com',
    avatarUrl: null,
  },
  { userId: AGENT_COMMENT_USER_BOB, fullName: 'Bob', email: 'bob@example.com', avatarUrl: null },
]

// ---------------------------------------------------------------------------
// 讨论串上下文 fixtures
// ---------------------------------------------------------------------------

/** 正常讨论串上下文（未截断） */
export const THREAD_CONTEXT_NORMAL: ThreadContextForTurn = {
  entityRef: 'task:1042',
  summaries: [
    {
      commentId: 1,
      authorName: 'Alice',
      bodyExcerpt: '这个依赖是不是有问题？',
      createdAt: '2026-08-18T10:00:00Z',
    },
    {
      commentId: 2,
      authorName: 'Bob',
      bodyExcerpt: '看起来还行，但需要确认版本兼容性。',
      createdAt: '2026-08-18T10:05:00Z',
    },
  ],
  truncated: false,
  contextBytesUsed: 200,
  contextBytesLimit: 8192,
}

/** 被截断的长讨论串上下文 */
export const THREAD_CONTEXT_TRUNCATED: ThreadContextForTurn = {
  entityRef: 'task:1042',
  summaries: Array.from({ length: 50 }, (_, i) => ({
    commentId: i + 1,
    authorName: i % 2 === 0 ? 'Alice' : 'Bob',
    bodyExcerpt: `评论 ${i + 1} 的内容摘要，讨论关于任务的进展和问题。`,
    createdAt: `2026-08-18T${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i * 10) % 60).padStart(2, '0')}:00Z`,
  })),
  truncated: true,
  contextBytesUsed: 8192,
  contextBytesLimit: 8192,
}

// ---------------------------------------------------------------------------
// 权限边界 fixtures
// ---------------------------------------------------------------------------

/** 无权场景：用户无权访问的讨论串 */
export const THREAD_CONTEXT_FORBIDDEN: ThreadContextForTurn = {
  entityRef: 'task:9999',
  summaries: [],
  truncated: false,
  contextBytesUsed: 0,
  contextBytesLimit: 8192,
}

// ---------------------------------------------------------------------------
// 跨组织 fixtures
// ---------------------------------------------------------------------------

/** 跨组织讨论串上下文（组织 2 的串） */
export const THREAD_CONTEXT_CROSS_ORG: ThreadContextForTurn = {
  entityRef: 'task:2001',
  summaries: [
    {
      commentId: 100,
      authorName: 'External',
      bodyExcerpt: '跨组织评论内容。',
      createdAt: '2026-08-18T10:00:00Z',
    },
  ],
  truncated: false,
  contextBytesUsed: 100,
  contextBytesLimit: 8192,
}

// ---------------------------------------------------------------------------
// 回复失败 fixtures
// ---------------------------------------------------------------------------

/** 模拟回合端点失败响应 */
export const TURN_ENDPOINT_FAILURE = {
  error: {
    code: 'AI_SERVICE_ERROR',
    message: '模型服务暂时不可用',
  },
}

// ---------------------------------------------------------------------------
// 敏感样本（用于禁存约束负例测试）
// ---------------------------------------------------------------------------

export const COPILOT_COMMENT_FIXTURE_SENSITIVE_SAMPLES = COPILOT_COMMENT_SENSITIVE_SAMPLES

/**
 * 生成包含敏感样本的模拟上下文文本。
 */
export function makeContextWithSensitiveSample(sample: string): string {
  return `这是讨论串上下文。包含一些正常内容。${sample}还有更多正常内容。`
}

/**
 * 验证上下文是否不含敏感样本。
 */
export function contextContainsSensitive(text: string): string | null {
  for (const sample of COPILOT_COMMENT_SENSITIVE_SAMPLES) {
    if (text.includes(sample)) return sample
  }
  return null
}
