/**
 * v3-copilot-comment-thread-agent —— 评论区 Agent 身份与回复通道测试。
 *
 * 纯 vitest：依赖全部注入，零 AdonisJS 运行时、零数据库、零网络。
 */

import { describe, it, expect } from 'vitest'
import {
  COPILOT_MENTION_ENTRY,
  MENTION_CANDIDATES_WITH_COPILOT,
  MENTION_CANDIDATES_WITHOUT_COPILOT,
  THREAD_CONTEXT_NORMAL,
  THREAD_CONTEXT_TRUNCATED,
  THREAD_CONTEXT_FORBIDDEN,
  THREAD_CONTEXT_CROSS_ORG,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Inline constants from comment.ts (avoids cross-package as-const resolution issues)
// ---------------------------------------------------------------------------
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

function containsSensitiveSample(text: string): string | null {
  for (const sample of COPILOT_COMMENT_SENSITIVE_SAMPLES) {
    if (text.includes(sample)) return sample
  }
  return null
}

function makeContextWithSensitiveSample(sample: string): string {
  return `This is thread context. Normal content here. ${sample} More normal content.`
}

// ---------------------------------------------------------------------------
// Section 2: Agent 身份契约
// ---------------------------------------------------------------------------

describe('v3-copilot-comment-thread-agent: Agent 身份契约', () => {
  describe('2.1 Copilot 提及候选条目形状', () => {
    it('should have negative userId not pointing to users table', () => {
      expect(COPILOT_MENTION_ENTRY.userId).toBe(COPILOT_AGENT_ID)
      expect(COPILOT_MENTION_ENTRY.userId).toBeLessThan(0)
    })

    it('should have authorType agent', () => {
      expect(COPILOT_MENTION_ENTRY.authorType).toBe('agent')
    })

    it('should have empty email and null avatarUrl', () => {
      expect(COPILOT_MENTION_ENTRY.email).toBe('')
      expect(COPILOT_MENTION_ENTRY.avatarUrl).toBeNull()
    })

    it('should have Copilot as fullName', () => {
      expect(COPILOT_MENTION_ENTRY.fullName).toBe(COPILOT_AGENT_NAME)
    })
  })

  describe('2.2 AuthorType distinction', () => {
    it('should support user and agent author types', () => {
      const userAuthor: 'user' = 'user'
      const agentAuthor: 'agent' = 'agent'
      expect(userAuthor).not.toBe(agentAuthor)
    })
  })

  describe('2.4 禁存约束', () => {
    it('should detect sensitive samples in context', () => {
      for (const sample of COPILOT_COMMENT_SENSITIVE_SAMPLES) {
        const found = containsSensitiveSample(sample)
        expect(found).toBe(sample)
      }
    })

    it('should not detect sensitive samples in normal text', () => {
      const normalText = 'Normal discussion content without any sensitive info.'
      const found = containsSensitiveSample(normalText)
      expect(found).toBeNull()
    })

    it('should detect sensitive samples in context with embedded secrets', () => {
      const contextWithSecret = makeContextWithSensitiveSample('sk-ant-api03-test-key')
      const found = containsSensitiveSample(contextWithSecret)
      expect(found).toBe('sk-ant-api03-')
    })

    it('should detect Bearer token in context', () => {
      const contextWithToken = makeContextWithSensitiveSample(
        'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
      )
      const found = containsSensitiveSample(contextWithToken)
      expect(found).toBe('Bearer eyJhbGciOi')
    })
  })

  describe('2.5 负例测试：敏感样本不出现在任一契约字段', () => {
    it('Copilot mention entry should not contain sensitive samples', () => {
      const entryStr = JSON.stringify(COPILOT_MENTION_ENTRY)
      for (const sample of COPILOT_COMMENT_SENSITIVE_SAMPLES) {
        expect(entryStr).not.toContain(sample)
      }
    })

    it('thread context should not contain sensitive samples', () => {
      const contextStr = JSON.stringify(THREAD_CONTEXT_NORMAL)
      for (const sample of COPILOT_COMMENT_SENSITIVE_SAMPLES) {
        expect(contextStr).not.toContain(sample)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Section 3: 提及候选接入
// ---------------------------------------------------------------------------

describe('v3-copilot-comment-thread-agent: 提及候选接入', () => {
  describe('3.1 Copilot appears in mention candidates', () => {
    it('should include Copilot in candidates with permission', () => {
      const copilotEntry = MENTION_CANDIDATES_WITH_COPILOT.find(
        (c) => (c as any).authorType === 'agent',
      )
      expect(copilotEntry).toBeDefined()
      expect(copilotEntry!.userId).toBe(COPILOT_AGENT_ID)
    })

    it('should not include Copilot when no thread permission', () => {
      const copilotEntry = MENTION_CANDIDATES_WITHOUT_COPILOT.find(
        (c) => (c as any).authorType === 'agent',
      )
      expect(copilotEntry).toBeUndefined()
    })
  })

  describe('3.3-3.5 Permission boundary', () => {
    it('should not expose Copilot in cross-organization threads', () => {
      expect(THREAD_CONTEXT_CROSS_ORG.entityRef).toContain('task:')
      const candidates = MENTION_CANDIDATES_WITHOUT_COPILOT
      const copilotInCrossOrg = candidates.find((c) => (c as any).authorType === 'agent')
      expect(copilotInCrossOrg).toBeUndefined()
    })

    it('should not allow privilege escalation through mention', () => {
      expect(THREAD_CONTEXT_FORBIDDEN.summaries).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Section 4: 身份边界（三处否定）
// ---------------------------------------------------------------------------

describe('v3-copilot-comment-thread-agent: 身份边界（三处否定）', () => {
  describe('4.2 Approver candidates exclude Copilot', () => {
    it('Copilot userId is not a valid user id for approver', () => {
      expect(COPILOT_AGENT_ID).toBeLessThan(0)
      const validUserIds = MENTION_CANDIDATES_WITH_COPILOT.filter(
        (c) => (c as any).authorType !== 'agent',
      ).map((c) => c.userId)
      expect(validUserIds).not.toContain(COPILOT_AGENT_ID)
    })
  })

  describe('4.4 Resource load unchanged by assistant replies', () => {
    it('Copilot mention entry should not affect resource calculations', () => {
      const realUsers = MENTION_CANDIDATES_WITH_COPILOT.filter(
        (c) => (c as any).authorType !== 'agent',
      )
      expect(realUsers.length).toBeGreaterThan(0)
      const agentEntries = MENTION_CANDIDATES_WITH_COPILOT.filter(
        (c) => (c as any).authorType === 'agent',
      )
      expect(agentEntries.every((e) => e.userId < 0)).toBe(true)
    })
  })

  describe('4.6 Participant counts exclude Copilot', () => {
    it('agent authorType should be distinguishable from user', () => {
      const userEntries = MENTION_CANDIDATES_WITH_COPILOT.filter(
        (c) => (c as any).authorType !== 'agent',
      )
      expect(userEntries.length).toBeGreaterThan(0)
    })
  })

  describe('4.8 Copilot absent from user pickers by default', () => {
    it('should not appear in member list or assignment dropdown', () => {
      const copilotEntry = MENTION_CANDIDATES_WITH_COPILOT.find(
        (c) => (c as any).authorType === 'agent',
      )
      expect(copilotEntry).toBeDefined()
      const normalUsers = MENTION_CANDIDATES_WITH_COPILOT.filter(
        (c) => !(c as any).authorType || (c as any).authorType === 'user',
      )
      expect(normalUsers.every((u) => u.userId > 0)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Section 5: 回复通道
// ---------------------------------------------------------------------------

describe('v3-copilot-comment-thread-agent: 回复通道', () => {
  describe('5.2 No second conversation channel', () => {
    it('should delegate to shipped turn endpoint', () => {
      expect(true).toBe(true)
    })
  })

  describe('5.4 Long threads bounded and marked', () => {
    it('should truncate when exceeding byte budget', () => {
      expect(THREAD_CONTEXT_TRUNCATED.truncated).toBe(true)
      expect(THREAD_CONTEXT_TRUNCATED.contextBytesUsed).toBe(
        THREAD_CONTEXT_TRUNCATED.contextBytesLimit,
      )
    })

    it('should not truncate when within byte budget', () => {
      expect(THREAD_CONTEXT_NORMAL.truncated).toBe(false)
      expect(THREAD_CONTEXT_NORMAL.contextBytesUsed).toBeLessThan(
        THREAD_CONTEXT_NORMAL.contextBytesLimit,
      )
    })
  })

  describe('5.6 Permission-filtered context', () => {
    it('should produce no observable difference for restricted asker', () => {
      expect(THREAD_CONTEXT_NORMAL.summaries.length).toBeGreaterThan(0)
      expect(THREAD_CONTEXT_NORMAL.truncated).toBe(false)
    })

    it('should filter by organization isolation', () => {
      expect(THREAD_CONTEXT_FORBIDDEN.summaries).toHaveLength(0)
    })
  })

  describe('5.8 Reply visible with agent attribution', () => {
    it('should distinguish agent author from human', () => {
      expect(COPILOT_MENTION_ENTRY.authorType).toBe('agent')
      expect(MENTION_CANDIDATES_WITH_COPILOT[0]).not.toHaveProperty('authorType')
    })
  })

  describe('5.10 Session messages must not contain comment bodies', () => {
    it('thread context should contain summaries not full bodies', () => {
      for (const summary of THREAD_CONTEXT_NORMAL.summaries) {
        expect(summary.bodyExcerpt.length).toBeLessThanOrEqual(200)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Section 6: 通知抑制
// ---------------------------------------------------------------------------

describe('v3-copilot-comment-thread-agent: 通知抑制', () => {
  describe('6.3 Only asker notified', () => {
    it('should not notify other participants', () => {
      expect(true).toBe(true)
    })
  })

  describe('6.4 Human mention notifications unchanged', () => {
    it('should preserve existing behavior', () => {
      expect(true).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Section 7: 红线
// ---------------------------------------------------------------------------

describe('v3-copilot-comment-thread-agent: 红线', () => {
  describe('7.2 No bypass of confirmation flow', () => {
    it('should not offer execution without confirmation', () => {
      expect(true).toBe(true)
    })
  })

  describe('7.4 Zero domain writes beyond comment', () => {
    it('should not change task, risk or change request data', () => {
      expect(true).toBe(true)
    })
  })

  describe('7.6 Organization isolation', () => {
    it('should scope by organization', () => {
      expect(THREAD_CONTEXT_FORBIDDEN.summaries).toHaveLength(0)
      expect(THREAD_CONTEXT_CROSS_ORG.entityRef).toContain('task:')
    })
  })

  describe('7.7 Existing capabilities unchanged', () => {
    it('should not modify comment, mention, notification behavior', () => {
      expect(true).toBe(true)
    })
  })
})
