/**
 * streaming-evidence 测试 —— manifest validator、公共断言、scenario catalog。
 */

import { describe, it, expect } from 'vitest'
import {
  validateEvidenceManifest,
  assertNoDuplicateEventIds,
  assertMonotonicSequence,
  assertNoEventsAfterTerminal,
  assertUniqueTerminal,
  assertHeartbeatPayload,
  type EvidenceManifest,
} from './streaming-evidence'

function makeMinimalManifest(overrides: Partial<EvidenceManifest> = {}): EvidenceManifest {
  return {
    manifestVersion: '1.0',
    commit: 'abc123',
    dirtyState: false,
    environment: { nodeVersion: '20', os: 'win32', timestamp: '2026-07-20T00:00:00Z' },
    contractHash: 'contract_hash',
    catalogHash: 'catalog_hash',
    result: 'passed',
    scenarios: [],
    attachments: [],
    attempts: [],
    ...overrides,
  }
}

describe('validateEvidenceManifest', () => {
  it('完整 manifest 校验通过', () => {
    const manifest = makeMinimalManifest({
      scenarios: [
        {
          scenarioId: 's1',
          domain: 'ai-draft',
          browser: 'chromium',
          passed: true,
          errorSummary: null,
          durationMs: 100,
          attachmentRefs: [],
        },
      ],
      attachments: [
        {
          ref: 'ss1',
          path: '/tmp/ss1.png',
          hash: 'abcdef1234567890',
          type: 'screenshot',
          sizeBytes: 1000,
        },
      ],
    })
    const result = validateEvidenceManifest(manifest, 'abc123', 'catalog_hash', ['s1'])
    expect(result.valid).toBe(true)
  })

  it('commit 不匹配 → 不通过', () => {
    const manifest = makeMinimalManifest({ commit: 'wrong' })
    const result = validateEvidenceManifest(manifest, 'abc123', 'catalog_hash', [])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('commit 不匹配: expected abc123, got wrong')
  })

  it('必需场景缺失 → 不通过', () => {
    const manifest = makeMinimalManifest()
    const result = validateEvidenceManifest(manifest, 'abc123', 'catalog_hash', [
      'required_scenario',
    ])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('必需场景缺失: required_scenario')
  })

  it('附件 hash 无效 → 不通过', () => {
    const manifest = makeMinimalManifest({
      attachments: [
        { ref: 'bad', path: '/tmp/bad.png', hash: 'short', type: 'screenshot', sizeBytes: 100 },
      ],
    })
    const result = validateEvidenceManifest(manifest, 'abc123', 'catalog_hash', [])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('hash 无效'))).toBe(true)
  })
})

describe('assertNoDuplicateEventIds', () => {
  it('无重复', () => {
    expect(assertNoDuplicateEventIds(['a', 'b', 'c'])).toEqual([])
  })
  it('有重复', () => {
    const errs = assertNoDuplicateEventIds(['a', 'b', 'a'])
    expect(errs.length).toBeGreaterThan(0)
  })
})

describe('assertMonotonicSequence', () => {
  it('严格递增通过', () => {
    expect(assertMonotonicSequence([1, 2, 3])).toEqual([])
  })
  it('非单调', () => {
    expect(assertMonotonicSequence([1, 2, 2])).toHaveLength(1)
    expect(assertMonotonicSequence([3, 2, 1])).toHaveLength(2)
  })
})

describe('assertNoEventsAfterTerminal', () => {
  it('终态后无事件', () => {
    expect(assertNoEventsAfterTerminal(['started', 'completed'], ['completed', 'failed'])).toEqual(
      [],
    )
  })
  it('终态后有非 heartbeat 事件', () => {
    const errs = assertNoEventsAfterTerminal(
      ['started', 'completed', 'failed'],
      ['completed', 'failed'],
    )
    expect(errs).toHaveLength(1)
  })
})

describe('assertUniqueTerminal', () => {
  it('唯一终态', () => {
    expect(assertUniqueTerminal(['started', 'completed'], ['completed', 'failed'])).toEqual([])
  })
  it('多终态', () => {
    expect(assertUniqueTerminal(['completed', 'failed'], ['completed', 'failed'])).toHaveLength(1)
  })
})

describe('assertHeartbeatPayload', () => {
  it('空 payload 通过', () => {
    expect(assertHeartbeatPayload([{}])).toEqual([])
  })
  it('含语义字段', () => {
    const errs = assertHeartbeatPayload([{ progressPercent: 50 }] as any)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('progressPercent')
  })
})
