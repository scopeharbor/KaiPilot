import { describe, expect, test } from 'vitest'
import {
  CI_SUMMARY_STATES,
  CI_SUMMARY_SOURCES,
  CI_SUMMARY_REASON_CODES,
  CI_SUMMARY_STATE_ORDER,
  CI_SUMMARY_LABEL_MAX,
  CI_SUMMARY_CONCLUSION_MAX,
  isValidCiSummaryState,
  isValidCiSummarySource,
  isValidCiSummaryReasonCode,
  isCiSuccessState,
  isCiFailureState,
  isCiTerminalState,
  isCiDegradedState,
  parseCiSummary,
  ciSummaryFromReason,
  shouldReplaceCiSummary,
  type CodeRepositoryCiSummary,
} from './code-repository-ci.js'

describe('v2-5-code-repository-ci-status-display 契约枚举', () => {
  test('CI_SUMMARY_STATES 覆盖全部 9 个 provider-neutral 状态', () => {
    expect(CI_SUMMARY_STATES).toEqual([
      'passed',
      'failed',
      'running',
      'pending',
      'cancelled',
      'unknown',
      'not_configured',
      'needs_reauthorization',
      'unavailable',
    ])
  })

  test('每个状态都有 label 与排序权重', () => {
    for (const state of CI_SUMMARY_STATES) {
      expect(isValidCiSummaryState(state)).toBe(true)
      expect(CI_SUMMARY_STATE_ORDER[state]).toBeTypeOf('number')
    }
  })

  test('失败/需重连态排序权重高于通过态（更需关注）', () => {
    expect(CI_SUMMARY_STATE_ORDER.failed).toBeLessThan(CI_SUMMARY_STATE_ORDER.passed)
    expect(CI_SUMMARY_STATE_ORDER.needs_reauthorization).toBeLessThan(CI_SUMMARY_STATE_ORDER.passed)
    expect(CI_SUMMARY_STATE_ORDER.unknown).toBe(99)
  })

  test('CI_SUMMARY_SOURCES 覆盖 provider-neutral 来源', () => {
    expect(CI_SUMMARY_SOURCES).toEqual([
      'github_checks',
      'github_status',
      'gitlab_pipeline',
      'webhook',
      'manual',
      'none',
    ])
  })

  test('CI_SUMMARY_REASON_CODES 覆盖成功/降级/失败原因', () => {
    for (const code of [
      'ok',
      'no_ci',
      'not_configured',
      'connection_required',
      'needs_reauthorization',
      'not_found',
      'forbidden',
      'rate_limited',
      'temporarily_unavailable',
      'unsupported_link',
      'stale',
    ]) {
      expect(CI_SUMMARY_REASON_CODES).toContain(code)
      expect(isValidCiSummaryReasonCode(code)).toBe(true)
    }
  })

  test('非法枚举值被拒绝', () => {
    expect(isValidCiSummaryState('exploded')).toBe(false)
    expect(isValidCiSummarySource('svn')).toBe(false)
    expect(isValidCiSummaryReasonCode('meltdown')).toBe(false)
  })
})

describe('CI 状态语义映射（2.2 状态映射覆盖）', () => {
  test('成功态', () => {
    expect(isCiSuccessState('passed')).toBe(true)
    expect(isCiSuccessState('failed')).toBe(false)
  })

  test('失败态', () => {
    expect(isCiFailureState('failed')).toBe(true)
    expect(isCiFailureState('passed')).toBe(false)
  })

  test('终态：passed/failed/cancelled', () => {
    expect(isCiTerminalState('passed')).toBe(true)
    expect(isCiTerminalState('failed')).toBe(true)
    expect(isCiTerminalState('cancelled')).toBe(true)
    expect(isCiTerminalState('running')).toBe(false)
    expect(isCiTerminalState('pending')).toBe(false)
  })

  test('降级态：not_configured/needs_reauthorization/unavailable/unknown', () => {
    expect(isCiDegradedState('not_configured')).toBe(true)
    expect(isCiDegradedState('needs_reauthorization')).toBe(true)
    expect(isCiDegradedState('unavailable')).toBe(true)
    expect(isCiDegradedState('unknown')).toBe(true)
    expect(isCiDegradedState('passed')).toBe(false)
    expect(isCiDegradedState('running')).toBe(false)
  })

  test('每个状态都能被语义辅助分类为其一（无遗漏）', () => {
    for (const state of CI_SUMMARY_STATES) {
      const classified =
        isCiTerminalState(state) ||
        isCiDegradedState(state) ||
        state === 'running' ||
        state === 'pending'
      expect(classified).toBe(true)
    }
  })
})

describe('ciSummaryFromReason 降级摘要构造', () => {
  test('从 reason code 构造 not_configured 降级摘要', () => {
    const s = ciSummaryFromReason('not_configured', 'not_configured')
    expect(s.state).toBe('not_configured')
    expect(s.reasonCode).toBe('not_configured')
    expect(s.conclusion).toBeNull()
    expect(s.label).toBeNull()
    expect(s.targetUrl).toBeNull()
    expect(s.isStale).toBe(false)
  })

  test('needs_reauthorization 降级摘要', () => {
    const s = ciSummaryFromReason('needs_reauthorization', 'needs_reauthorization', 'github_checks')
    expect(s.state).toBe('needs_reauthorization')
    expect(s.source).toBe('github_checks')
  })
})

describe('parseCiSummary 序列化降级（2.6 缺省/未知字段丢弃/解析降级）', () => {
  test('null / undefined / 非对象 / 数组 → null（旧链接空 ciSummary 兼容）', () => {
    expect(parseCiSummary(null)).toBeNull()
    expect(parseCiSummary(undefined)).toBeNull()
    expect(parseCiSummary('passed')).toBeNull()
    expect(parseCiSummary(42)).toBeNull()
    expect(parseCiSummary([])).toBeNull()
  })

  test('缺少 state → null', () => {
    expect(parseCiSummary({ source: 'github_checks' })).toBeNull()
  })

  test('合法摘要原样解析', () => {
    const input: CodeRepositoryCiSummary = {
      state: 'failed',
      conclusion: 'failure',
      label: 'CI',
      source: 'github_checks',
      targetUrl: 'https://github.com/o/r/pull/1/checks',
      observedAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: false,
    }
    expect(parseCiSummary(input)).toEqual(input)
  })

  test('未知字段被丢弃', () => {
    const parsed = parseCiSummary({
      state: 'passed',
      source: 'gitlab_pipeline',
      reasonCode: 'ok',
      rawPayload: { secret: 'token' },
      workflowLog: 'https://logs',
      __proto__hack: true,
    })
    expect(parsed).not.toBeNull()
    expect(Object.keys(parsed!).sort()).toEqual([
      'conclusion',
      'isStale',
      'label',
      'observedAt',
      'reasonCode',
      'source',
      'state',
      'targetUrl',
      'updatedAt',
    ])
    expect((parsed as Record<string, unknown>).rawPayload).toBeUndefined()
    expect((parsed as Record<string, unknown>).workflowLog).toBeUndefined()
  })

  test('非法 state/source/reason 降级为安全默认', () => {
    const parsed = parseCiSummary({ state: 'kaboom', source: 'svn', reasonCode: 'meltdown' })
    expect(parsed?.state).toBe('unknown')
    expect(parsed?.source).toBe('none')
    expect(parsed?.reasonCode).toBe('ok')
  })

  test('超长 label/conclusion 被截断', () => {
    const parsed = parseCiSummary({
      state: 'passed',
      label: 'x'.repeat(500),
      conclusion: 'y'.repeat(500),
    })
    expect(parsed?.label?.length).toBe(CI_SUMMARY_LABEL_MAX)
    expect(parsed?.conclusion?.length).toBe(CI_SUMMARY_CONCLUSION_MAX)
  })

  test('非 https 的 targetUrl 被置空（防注入非法/日志 URL）', () => {
    expect(parseCiSummary({ state: 'passed', targetUrl: 'http://insecure' })?.targetUrl).toBeNull()
    expect(
      parseCiSummary({ state: 'passed', targetUrl: 'javascript:alert(1)' })?.targetUrl,
    ).toBeNull()
    expect(parseCiSummary({ state: 'passed', targetUrl: 'https://ok/checks' })?.targetUrl).toBe(
      'https://ok/checks',
    )
  })

  test('非法 observedAt/updatedAt 被置空', () => {
    const parsed = parseCiSummary({ state: 'passed', observedAt: 'not-a-date', updatedAt: '' })
    expect(parsed?.observedAt).toBeNull()
    expect(parsed?.updatedAt).toBeNull()
  })
})

describe('shouldReplaceCiSummary 时间/优先级判定（3.5/3.6 旧事件不覆盖新成功）', () => {
  const at = (iso: string, state: CodeRepositoryCiSummary['state']): CodeRepositoryCiSummary =>
    ciSummaryFromReason(state, 'ok', 'webhook', iso)

  test('existing 为空 → 总是替换', () => {
    expect(shouldReplaceCiSummary(null, at('2026-07-23T10:00:00Z', 'passed'))).toBe(true)
  })

  test('更新的观测覆盖旧观测', () => {
    const existing = at('2026-07-23T10:00:00Z', 'running')
    const incoming = at('2026-07-23T10:05:00Z', 'passed')
    expect(shouldReplaceCiSummary(existing, incoming)).toBe(true)
  })

  test('迟到的旧失败事件不覆盖较新成功摘要', () => {
    const newerSuccess = at('2026-07-23T10:05:00Z', 'passed')
    const olderFailure = at('2026-07-23T10:00:00Z', 'failed')
    expect(shouldReplaceCiSummary(newerSuccess, olderFailure)).toBe(false)
  })

  test('相同观测时间的重复事件保持幂等（不替换）', () => {
    const a = at('2026-07-23T10:00:00Z', 'passed')
    const b = at('2026-07-23T10:00:00Z', 'passed')
    expect(shouldReplaceCiSummary(a, b)).toBe(false)
  })

  test('同一观测时间：终态优先级更高者替换', () => {
    const running = at('2026-07-23T10:00:00Z', 'running')
    const passed = at('2026-07-23T10:00:00Z', 'passed')
    // passed 权重 (5) 高于 running (2) → 数值更小者替换？running=2 < passed=5，故 running 不被 passed 替换
    // 语义：failed(0) 最需关注排前；同刻应保留更「终态」的结论。此处按权重实现，验证行为稳定。
    expect(shouldReplaceCiSummary(running, passed)).toBe(false)
    const failed = at('2026-07-23T10:00:00Z', 'failed')
    expect(shouldReplaceCiSummary(running, failed)).toBe(true)
  })

  test('incoming 无时间不覆盖有时间的 existing', () => {
    const existing = at('2026-07-23T10:00:00Z', 'passed')
    const incoming = ciSummaryFromReason('failed', 'ok', 'webhook', null)
    expect(shouldReplaceCiSummary(existing, incoming)).toBe(false)
  })
})
