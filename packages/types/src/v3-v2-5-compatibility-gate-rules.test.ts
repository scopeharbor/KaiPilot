import { describe, expect, it } from 'vitest'
import type { CompatibilityLedger } from './v3-v2-5-compatibility-gate.js'
import {
  CG_RULE_IDS,
  checkGraphFallbackDiscipline,
  checkSourcePriorityAndEvidence,
  containsSensitivePayload,
  detectAiConfirmationBypass,
  detectClosedGaReopen,
  detectHiddenPrerequisites,
  detectHistoricalPrdMisuse,
  detectUnauthorizedExternalActions,
  evaluateChangeCompatibility,
  makeFinding,
  sanitizeFindingSummary,
  type ChangeArtifactSnapshot,
} from './v3-v2-5-compatibility-gate-rules.js'

// ─── 迷你账本 fixture（自造，不依赖并行开发的 ledger 数据文件） ──────────────

const miniLedger: CompatibilityLedger = {
  ledgerVersion: '1.0',
  generatedAt: '2026-08-16',
  surfaces: [
    {
      surfaceId: 'ai-draft-live-sse-progress',
      label: 'AI 草案真实流式进度',
      status: 'verified-archived',
      sourceRefs: [
        { kind: 'openspec-spec', path: 'openspec/specs/streaming-progress-contract/spec.md' },
      ],
      allowedV3Consumption: ['consume-contract'],
      requiredVerification: ['focused SSE 测试须全绿'],
    },
  ],
  authorizationGates: [],
  apiRuntimeDecisions: [],
  redLines: [],
}

function makeSnapshot(changeName: string, ...contents: string[]): ChangeArtifactSnapshot {
  const names = ['proposal.md', 'design.md', 'tasks.md']
  return {
    changeName,
    artifacts: contents.map((content, index) => ({
      path: `openspec/changes/${changeName}/${names[index] ?? `extra-${index}.md`}`,
      content,
    })),
  }
}

function ruleIds(findings: { ruleId: string }[]): string[] {
  return findings.map((finding) => finding.ruleId)
}

// ─── 3.2：历史证据引用 vs 历史 PRD 当 mandate ────────────────────────────────

describe('V3 引用 V2.5 历史证据（spec: hidden V2.5 regressions）', () => {
  it('合法 V3 引用 V2.5 历史证据并通过三类 source priority 引用 → 无任何 finding', () => {
    const snapshot = makeSnapshot(
      'v3-legit-consumer',
      [
        '本 change 仅消费 V2.5 已交付的流式进度契约，不重开 GA。',
        '历史证据：根据 v2.5 release map 已交付记录，AI 流式进度已于 V2.5 GA 收口（仅作历史证据）。',
        'V3 基线：docs/v2-v3/planning/v3-development-baseline.md',
        '归档 spec：openspec/specs/streaming-progress-contract/spec.md',
      ].join('\n'),
    )
    const result = evaluateChangeCompatibility(snapshot, miniLedger)
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
  })

  it('把 V2.5 历史 PRD 当作当前 V3 mandate → CG-PRD-001 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-prd-mandate',
      '根据 docs/v2-v3/source-package/v2.5-v3-prd/compiler-prd.md 的要求，本 change 必须按该 PRD 实现 WebSocket 微服务。',
    )
    const findings = detectHistoricalPrdMisuse(snapshot)
    expect(ruleIds(findings)).toEqual([CG_RULE_IDS.historicalPrdMandate])
    expect(findings[0]?.severity).toBe('blocking')
    expect(findings[0]?.family).toBe('historical-prd-mandate')
  })

  it('历史 PRD 仅作历史证据引用 → 不违规', () => {
    const snapshot = makeSnapshot(
      'v3-prd-evidence',
      '历史 PRD 原文见 docs/v2-v3/source-package/v2.5-v3-prd/compiler-prd.md，仅作历史证据，不构成实现要求。',
    )
    expect(detectHistoricalPrdMisuse(snapshot)).toEqual([])
  })

  it('主张重建 V2.5 GA P0 且无缺陷证据 → CG-GA-001 blocking；附缺陷证据 → 豁免', () => {
    const noEvidence = makeSnapshot(
      'v3-reopen',
      'V2.5 GA P0 的流式进度未完成，本 change 需要重建该能力。',
    )
    const reopen = detectClosedGaReopen(noEvidence, miniLedger)
    expect(ruleIds(reopen)).toContain(CG_RULE_IDS.closedGaReopen)
    expect(reopen[0]?.severity).toBe('blocking')

    const withEvidence = makeSnapshot(
      'v3-reopen-with-defect',
      'V2.5 GA P0 的流式进度需要重建，依据缺陷 issue #123 与 focused 测试失败记录。',
    )
    expect(detectClosedGaReopen(withEvidence, miniLedger)).toEqual([])
  })

  it('声称 verified-archived 表面未交付且无缺陷证据 → CG-REG-001 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-regression-claim',
      'ai-draft-live-sse-progress 能力未交付，本 change 将补齐。',
    )
    const findings = detectClosedGaReopen(snapshot, miniLedger)
    expect(ruleIds(findings)).toContain(CG_RULE_IDS.unsupportedRegressionClaim)
  })

  it('隐藏基础设施前提 → CG-PRE-001 blocking；non-goal/延期/fallback 语境豁免', () => {
    const bad = makeSnapshot(
      'v3-hidden-prereq',
      '本 change 需要先部署 PostgreSQL 并依赖 Redis 作为前提。',
    )
    expect(ruleIds(detectHiddenPrerequisites(bad))).toEqual([CG_RULE_IDS.hiddenPrerequisite])

    const nonGoal = makeSnapshot('v3-non-goal', '本 change 不做容器化（non-goal），不引入 Docker。')
    expect(detectHiddenPrerequisites(nonGoal)).toEqual([])

    const fallback = makeSnapshot(
      'v3-redis-fallback',
      'Redis 不可用时 memory fallback 降级必须通过。',
    )
    expect(detectHiddenPrerequisites(fallback)).toEqual([])

    const deferred = makeSnapshot(
      'v3-deferred',
      '微服务化延期（deferred）到后续版本，不在本 change。',
    )
    expect(detectHiddenPrerequisites(deferred)).toEqual([])
  })
})

// ─── 3.3：source priority 证据完整性（warning） ─────────────────────────────

describe('source priority 证据完整性（spec: source priority and observation discipline）', () => {
  it('触及 V2.5 表面但三类证据引用缺失 → 三条 warning（非 blocking）', () => {
    const snapshot = makeSnapshot('v3-touches-v25', '本 change 调整 V2.5 时代的流式进度展示。')
    const findings = checkSourcePriorityAndEvidence(snapshot)
    expect(ruleIds(findings)).toEqual([
      CG_RULE_IDS.sourcePriorityV3Baseline,
      CG_RULE_IDS.sourcePriorityV25Baseline,
      CG_RULE_IDS.sourcePriorityArchiveSpec,
    ])
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true)
  })

  it('不触及 V2.5 表面 → 不产生 source priority warning', () => {
    const snapshot = makeSnapshot('v3-greenfield', '本 change 为全新 V3 能力，与历史版本无关。')
    expect(checkSourcePriorityAndEvidence(snapshot)).toEqual([])
  })
})

// ─── 3.4：图谱空结果 fallback 纪律 ──────────────────────────────────────────

describe('codebase-memory 空结果纪律（spec: observation discipline）', () => {
  it('空图谱结果当作「不存在」结论且无 fallback 说明 → CG-OBS-001 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-graph-absence',
      'codebase-memory 图谱返回空结果，因此认定该表面不存在，按缺失处理。',
    )
    const findings = checkGraphFallbackDiscipline(snapshot)
    expect(ruleIds(findings)).toEqual([CG_RULE_IDS.graphAbsenceConclusion])
    expect(findings[0]?.severity).toBe('blocking')
  })

  it('空图谱结果但记录直接 source fallback 说明 → 通过', () => {
    const snapshot = makeSnapshot(
      'v3-graph-fallback',
      'codebase-memory 图谱返回空结果，已采用直接 source 阅读作为 fallback 复核，未据此下不存在结论。',
    )
    expect(checkGraphFallbackDiscipline(snapshot)).toEqual([])
  })

  it('空图谱结果论述（无不存在结论）且缺 fallback 说明 → CG-OBS-002 warning', () => {
    const snapshot = makeSnapshot(
      'v3-graph-stale',
      '本次观察中 codebase-memory 图谱空结果，暂未深入。',
    )
    const findings = checkGraphFallbackDiscipline(snapshot)
    expect(ruleIds(findings)).toEqual([CG_RULE_IDS.graphMissingFallback])
    expect(findings[0]?.severity).toBe('warning')
  })
})

// ─── 3.6：外部动作授权门与 AI 人工确认边界 ──────────────────────────────────

describe('外部动作与 AI 确认边界（spec: external action and side-effect boundaries）', () => {
  it('未授权真实外部动作 → CG-EXT-001 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-unauthorized-ext',
      '本 change 将执行真实 OAuth token 交换并发送 webhook smoke 请求。',
    )
    const findings = detectUnauthorizedExternalActions(snapshot)
    expect(ruleIds(findings)).toEqual([CG_RULE_IDS.unauthorizedExternalAction])
    expect(findings[0]?.severity).toBe('blocking')
  })

  it('显式 non-goal / deferred / fixture-first 表述 → 不违规', () => {
    const nonGoal = makeSnapshot('v3-ext-non-goal', '本 change 不做真实 Webhook 外发（non-goal）。')
    expect(detectUnauthorizedExternalActions(nonGoal)).toEqual([])

    const deferred = makeSnapshot(
      'v3-ext-deferred',
      '真实模型评测延期（deferred）到后续 change，不在本 change 范围。',
    )
    expect(detectUnauthorizedExternalActions(deferred)).toEqual([])

    const fixtureFirst = makeSnapshot(
      'v3-ext-fixture',
      'fixture-first：webhook 外发 smoke 一律使用 fixture/mock 验证，不发送真实请求。',
    )
    expect(detectUnauthorizedExternalActions(fixtureFirst)).toEqual([])
  })

  it('工件内已声明用户明确授权 → 豁免', () => {
    const snapshot = makeSnapshot(
      'v3-ext-authorized',
      '授权记录：用户已对本 change 的真实 OAuth 令牌交换给予明确授权。',
      '执行真实 OAuth 令牌交换并记录结果。',
    )
    expect(detectUnauthorizedExternalActions(snapshot)).toEqual([])
  })

  it('AI 输出绕过人工确认直接落正式数据 → CG-AI-001 blocking', () => {
    const snapshot = makeSnapshot('v3-ai-bypass', 'AI 输出直接写入正式项目数据，无需人工确认。')
    const findings = detectAiConfirmationBypass(snapshot)
    expect(ruleIds(findings)).toEqual([CG_RULE_IDS.aiConfirmationBypass])
    expect(findings[0]?.severity).toBe('blocking')
  })

  it('AI 建议经预览差异与显式确认后由用户应用 → 不违规', () => {
    const snapshot = makeSnapshot(
      'v3-ai-safe',
      'AI 建议仅在 RBAC 校验、预览差异并显式确认后由用户应用，全程记录审计。',
    )
    expect(detectAiConfirmationBypass(snapshot)).toEqual([])
  })
})

// ─── 3.8：低敏输出红线 ──────────────────────────────────────────────────────

describe('低敏输出（spec: deterministic and low-sensitive output）', () => {
  it('containsSensitivePayload 识别关键词 / bearer / XML 断言 / 长 base64，且不误报普通文本', () => {
    expect(containsSensitivePayload('the prompt text')).toBe(true)
    expect(containsSensitivePayload('Authorization: Bearer abcdef123456')).toBe(true)
    expect(containsSensitivePayload('<saml:Assertion ID="x">')).toBe(true)
    expect(containsSensitivePayload(`payload ${'A'.repeat(48)}`)).toBe(true)
    expect(containsSensitivePayload('普通中文描述，流式进度已于 GA 收口。')).toBe(false)
  })

  it('sanitizeFindingSummary 把命中片段替换为 [REDACTED:<keyword>]', () => {
    expect(sanitizeFindingSummary('see Bearer abcdef1234567890 end')).toBe(
      'see [REDACTED:bearer-token] end',
    )
    expect(sanitizeFindingSummary('the prompt and the token')).toBe(
      'the [REDACTED:prompt] and the [REDACTED:token]',
    )
    const saml = sanitizeFindingSummary('<saml:Assertion ID="x">body</saml:Assertion>')
    expect(saml).not.toContain('<saml')
    expect(saml).toContain('[REDACTED:saml-assertion]')
    const longPayload = sanitizeFindingSummary(`key=${'a1'.repeat(30)}`)
    expect(longPayload).toBe('key=[REDACTED:payload]')
  })

  it('含 secret/token/Authorization/原始载荷的违规输入，finding 输出全部 redact 或不出现', () => {
    const snapshot = makeSnapshot(
      'v3-sensitive-input',
      '必须先部署 PostgreSQL，连接示例 Authorization: Bearer abcdef123456abcdef123456abcdef123456，原始 prompt 与模型输出如下。',
    )
    const findings = detectHiddenPrerequisites(snapshot)
    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      const serialized = `${finding.summary}|${finding.evidenceRefs.join('|')}`
      expect(serialized).not.toContain('Bearer')
      expect(serialized).not.toContain('abcdef')
      expect(serialized).not.toContain('prompt')
      expect(serialized).not.toContain('Authorization')
      expect(containsSensitivePayload(serialized)).toBe(false)
    }
  })

  it('makeFinding 强制 summary 脱敏且 evidenceRefs 去重排序', () => {
    const finding = makeFinding({
      ruleId: CG_RULE_IDS.hiddenPrerequisite,
      family: 'hidden-prerequisite',
      severity: 'blocking',
      subjectPath: 'openspec/changes/x/proposal.md',
      evidenceRefs: ['b.md:2', 'a.md:1', 'b.md:2'],
      summary: '泄漏 token 值',
    })
    expect(finding.evidenceRefs).toEqual(['a.md:1', 'b.md:2'])
    expect(finding.summary).toBe('泄漏 [REDACTED:token] 值')
  })
})

// ─── 3.8：确定性 ────────────────────────────────────────────────────────────

describe('确定性（spec: validation rerun）', () => {
  const richSnapshot = makeSnapshot(
    'v3-rich',
    [
      '根据 docs/v2-v3/source-package/v2.5-v3-prd/compiler-prd.md 的要求，必须按该 PRD 实现。',
      '本 change 需要先部署 PostgreSQL。',
      'codebase-memory 图谱返回空结果，因此认定该表面不存在。',
    ].join('\n'),
    'AI 输出直接写入正式项目数据，无需人工确认。',
    '本 change 将执行真实 OAuth token 交换。',
  )

  it('同一输入两次运行产出完全等价的 finding 序列', () => {
    const first = evaluateChangeCompatibility(richSnapshot, miniLedger)
    const second = evaluateChangeCompatibility(richSnapshot, miniLedger)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))

    const signature = first.findings.map(
      (finding) => `${finding.ruleId}|${finding.severity}|${finding.subjectPath}`,
    )
    expect(signature).toEqual(
      second.findings.map(
        (finding) => `${finding.ruleId}|${finding.severity}|${finding.subjectPath}`,
      ),
    )
    expect(first.ok).toBe(false)
    expect(first.blockingCount).toBeGreaterThan(0)
  })

  it('结果含稳定的 checkedSubjects 与计数', () => {
    const result = evaluateChangeCompatibility(richSnapshot, miniLedger)
    expect(result.checkedSubjects).toContain('v3-rich')
    expect(result.checkedSubjects).toContain('openspec/changes/v3-rich/proposal.md')
    expect(result.blockingCount + result.warningCount + result.infoCount).toBe(
      result.findings.length,
    )
  })
})

// ─── 回归：真实 change 文档的误报语料（2026-08-16 apply 期间发现并修复） ─────

describe('回归：门禁自身文档与否定/元描述语料不得误报 blocking', () => {
  it('proposal Why 段的风险描述（reopen already-closed GA decisions）→ 零 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-meta-proposal',
      '## Why\n\nV2.5 GA has been closed and V3 work is now active, but V3 changes can still accidentally reinterpret V2.5 historical PRD material, reopen already-closed GA decisions, or introduce hidden prerequisites that weaken the delivered V2.5 surface.',
    )
    const findings = evaluateChangeCompatibility(snapshot, miniLedger).findings
    expect(findings.filter((finding) => finding.severity === 'blocking')).toEqual([])
  })

  it('design Non-Goals 的整句否定（No V2.5 feature reimplementation, no reopening ...）→ 零 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-meta-design',
      '## Goals / Non-Goals\n\n**Non-Goals:**\n\n- No V2.5 feature reimplementation, no V2.5 GA rebaseline and no modification to existing V2.5 normative requirements.\n- No `/api/v2|/api/v3` migration, microservice split, container/private deployment work, PostgreSQL cutover, Kafka, VectorDB, forced Redis or framework replacement.',
    )
    const findings = evaluateChangeCompatibility(snapshot, miniLedger).findings
    expect(findings.filter((finding) => finding.severity === 'blocking')).toEqual([])
  })

  it('tasks 边界确认句（does not require ... /api/v2, Docker ...）→ 零 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-meta-tasks',
      '## 1. Observation\n\n- [ ] 1.6 Confirm implementation does not require runtime product API changes, database migrations, `/api/v2|/api/v3`, Docker/containerization, microservices, PostgreSQL, Redis, Kafka, VectorDB, real providers or real model calls.',
    )
    expect(detectHiddenPrerequisites(snapshot)).toEqual([])
  })

  it('spec Scenario 元描述（**WHEN** a V3 change uses old PRD text to require /api/v2 ...）→ 零 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-meta-spec',
      '#### Scenario: V3 change treats historical PRD text as current mandate\n- **WHEN** a V3 change uses old V2.5 PRD text to require `/api/v2`, WebSocket microservices, containerization, software code apply, strong external infrastructure or real provider calls as hidden implementation prerequisites\n- **THEN** the compatibility gate MUST produce a blocking finding unless the change explicitly scopes that work through a separate approved V3 capability',
    )
    const findings = evaluateChangeCompatibility(snapshot, miniLedger).findings
    expect(findings.filter((finding) => finding.severity === 'blocking')).toEqual([])
  })

  it('对照：真正的重开主张（无缺陷证据）仍被 CG-GA-001 blocking', () => {
    const snapshot = makeSnapshot(
      'v3-real-reopen',
      '## What Changes\n\n本 change 将重新实现 V2.5 的 AI 草案流式进度，因为该能力从未真正交付，需要重建 SSE 进度链路。',
    )
    const findings = detectClosedGaReopen(snapshot, miniLedger)
    expect(ruleIds(findings)).toContain(CG_RULE_IDS.closedGaReopen)
    expect(findings[0]?.severity).toBe('blocking')
  })
})
