/**
 * v3-plugin-first-platform-closure 契约单测。
 *
 * 覆盖 spec 的全部场景：三要件判定、`partial` 覆盖面必填、声明准入与降级措辞、
 * 地图外能力登记、归档同步与 supersession、取证方式两档、低敏纪律。
 * 每个负例断言**具体失败原因**（ruleId + message 关键词），不只断言 fail。
 */
import { describe, expect, it } from 'vitest'
import {
  DETERMINISTIC_RERUN_GATES,
  KERNEL_CLAIM_ALLOWED_WORDING,
  KERNEL_CLAIM_CARD_IDS,
  PFC_RULE_IDS,
  PLUGIN_FIRST_CARD_STATUSES,
  compareRecordedClaim,
  detectClaimScopeEscalation,
  detectUnregisteredCapabilities,
  evaluateArchiveSync,
  evaluateCardCompletion,
  evaluateClosureLedger,
  evaluateKernelClaim,
  isKernelClaimCard,
  isPluginFirstCardStatus,
  sanitizeClosureSummary,
  scanLedgerLowSensitive,
  validateGateEvidence,
  validatePartialCoverage,
  type ClosureIssue,
} from './v3-plugin-first-platform-closure.js'
import {
  makeAllDoneCards,
  makeClaimMismatchLedger,
  makeDanglingReferenceLedger,
  makeDeterministicGateReferencedEvidence,
  makeDoneCard,
  makeFixtureResolver,
  makeInvalidSupersessionReport,
  makeMissingMainSpecLedger,
  makeOffMapMergedIntoCardLedger,
  makePartialCard,
  makePartialWithoutCoverageLedger,
  makePassingLedger,
  makeReferencedEvidence,
  makeReferencedWithoutProvenanceEvidence,
  makeRerunCarryingProvenanceEvidence,
  makeRerunEvidence,
  makeSensitiveLedger,
  makeStatusOutOfVocabularyLedger,
  makeSyncedArchiveReport,
  makeUnmergedArchiveReport,
} from './v3-plugin-first-platform-closure-fixtures.js'

const resolver = makeFixtureResolver()

function ruleIds(issues: readonly ClosureIssue[]): string[] {
  return issues.map((issue) => issue.ruleId)
}

describe('封闭词表', () => {
  it('五档取值被接受，词表外取值被拒', () => {
    for (const status of PLUGIN_FIRST_CARD_STATUSES) {
      expect(isPluginFirstCardStatus(status)).toBe(true)
    }
    expect(isPluginFirstCardStatus('archived')).toBe(false)
    expect(isPluginFirstCardStatus('proposed')).toBe(false)
    expect(PLUGIN_FIRST_CARD_STATUSES).toHaveLength(5)
  })

  it('内核准入卡集合是 W1–W5，不含 W0/W6/W7', () => {
    expect(isKernelClaimCard('W1')).toBe(true)
    expect(isKernelClaimCard('W5b')).toBe(true)
    expect(isKernelClaimCard('W0')).toBe(false)
    expect(isKernelClaimCard('W6')).toBe(false)
    expect(isKernelClaimCard('W7')).toBe(false)
    expect(KERNEL_CLAIM_CARD_IDS).toHaveLength(12)
  })
})

describe('完成三要件（2.2）', () => {
  it('三要件齐备 → 允许 done', () => {
    const evaluation = evaluateCardCompletion(makeDoneCard('W1'), resolver)
    expect(evaluation.requisites).toEqual({
      archivedChangePresent: true,
      mainSpecsPresent: true,
      gateEvidencePresent: true,
    })
    expect(evaluation.maxAllowedStatus).toBe('done')
    expect(evaluation.missingClasses).toEqual([])
    expect(evaluation.issues).toEqual([])
  })

  it('主规范缺失 → 降级上限 partial，并指名缺失类别', () => {
    const card = makeDoneCard('W2a')
    card.mainSpecRefs = ['openspec/specs/missing-capability/spec.md']
    const evaluation = evaluateCardCompletion(card, resolver)
    expect(evaluation.requisites.mainSpecsPresent).toBe(false)
    expect(evaluation.maxAllowedStatus).toBe('partial')
    expect(evaluation.missingClasses).toContain('main-spec')
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.unresolvableReference)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.completionRequisiteUnmet)
    expect(evaluation.issues.some((i) => i.message.includes('主规范无法解析'))).toBe(true)
  })

  it('承担 change 引用为空 → 产出缺引用类别 issue', () => {
    const card = makeDoneCard('W3a')
    card.archivedChangeRefs = []
    const evaluation = evaluateCardCompletion(card, resolver)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.missingReferenceClass)
    expect(evaluation.missingClasses).toContain('archived-change')
  })

  it('承担 change 引用不在归档区 → 判为无法解析', () => {
    const card = makeDoneCard('W3a')
    card.archivedChangeRefs = ['openspec/changes/v3-still-active']
    const evaluation = evaluateCardCompletion(card, resolver)
    expect(evaluation.issues.some((i) => i.message.includes('不在归档区'))).toBe(true)
    expect(evaluation.maxAllowedStatus).toBe('partial')
  })

  it('门禁证据为空 → 第三件不成立', () => {
    const card = makeDoneCard('W4b')
    card.gateEvidence = []
    const evaluation = evaluateCardCompletion(card, resolver)
    expect(evaluation.requisites.gateEvidencePresent).toBe(false)
    expect(evaluation.missingClasses).toContain('gate-evidence')
  })

  it('状态越出封闭词表 → PFC-CARD-001', () => {
    const card = makeDoneCard('W4c')
    ;(card as { status: string }).status = 'archived'
    const evaluation = evaluateCardCompletion(card, resolver)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.statusOutOfVocabulary)
  })

  it('intentionallyUnbacked 的卡不参与三要件，上限为 deferred', () => {
    const card = makeDoneCard('W7')
    card.status = 'deferred'
    card.archivedChangeRefs = []
    card.mainSpecRefs = []
    card.gateEvidence = []
    card.intentionallyUnbacked = true
    const evaluation = evaluateCardCompletion(card, resolver)
    expect(evaluation.maxAllowedStatus).toBe('deferred')
    expect(evaluation.issues).toEqual([])
  })
})

describe('partial 覆盖面必填（2.3）', () => {
  it('覆盖面齐备 → 无 issue', () => {
    expect(validatePartialCoverage(makePartialCard('W3b'))).toEqual([])
  })

  it('缺已覆盖行为 → 具体报出缺哪一半', () => {
    const card = makePartialCard('W3b')
    card.coveredBehaviors = []
    const issues = validatePartialCoverage(card)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.ruleId).toBe(PFC_RULE_IDS.partialCoverageIncomplete)
    expect(issues[0]?.message).toContain('已覆盖行为')
  })

  it('缺未覆盖行为 → 具体报出缺哪一半', () => {
    const card = makePartialCard('W3c')
    card.uncoveredBehaviors = []
    const issues = validatePartialCoverage(card)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('未覆盖行为')
  })

  it('两半皆空 → 两条 issue', () => {
    const ledger = makePartialWithoutCoverageLedger()
    const card = ledger.cards.find((c) => c.cardId === 'W3b')!
    expect(validatePartialCoverage(card)).toHaveLength(2)
  })

  it('非 partial 状态不触发覆盖面校验', () => {
    expect(validatePartialCoverage(makeDoneCard('W1'))).toEqual([])
  })
})

describe('声明准入判定（2.4）', () => {
  it('W1–W5 全 done → 允许声明，并列出 W6/W7 状态', () => {
    const decision = evaluateKernelClaim(makeAllDoneCards())
    expect(decision.allowed).toBe(true)
    expect(decision.wording).toContain(KERNEL_CLAIM_ALLOWED_WORDING)
    expect(decision.wording).toContain('W6=done')
    expect(decision.wording).toContain('W7=deferred')
    expect(decision.unmetCards).toEqual([])
    expect(decision.issues).toEqual([])
  })

  it('存在 partial 卡 → 拒绝声明，措辞指名未覆盖面', () => {
    const cards = makeAllDoneCards()
    const index = cards.findIndex((card) => card.cardId === 'W3b')
    cards[index] = makePartialCard('W3b')
    const decision = evaluateKernelClaim(cards)
    expect(decision.allowed).toBe(false)
    expect(decision.unmetCards.map((entry) => entry.cardId)).toEqual(['W3b'])
    expect(decision.wording).toContain('W3b(partial)')
    expect(decision.wording).toContain('执行隔离边界')
    expect(decision.wording).toContain('不得声明内核整体可用')
    expect(ruleIds(decision.issues)).toContain(PFC_RULE_IDS.kernelClaimRejected)
  })

  it('降级措辞同时给出已达成面，不是空结论', () => {
    const cards = makeAllDoneCards()
    cards[cards.findIndex((card) => card.cardId === 'W3c')] = makePartialCard('W3c')
    const decision = evaluateKernelClaim(cards)
    expect(decision.wording).toContain('已达成面：')
    expect(decision.wording).toContain('W1')
    expect(decision.wording).toContain('W2a')
  })

  it('账本缺少某张准入卡 → 按未满足处理，不默认通过', () => {
    const cards = makeAllDoneCards().filter((card) => card.cardId !== 'W5a')
    const decision = evaluateKernelClaim(cards)
    expect(decision.allowed).toBe(false)
    expect(decision.unmetCards[0]?.cardId).toBe('W5a')
    expect(decision.unmetCards[0]?.gap).toContain('缺少该卡条目')
  })

  it('单张卡通过不构成声明依据', () => {
    const decision = evaluateKernelClaim([makeDoneCard('W1')])
    expect(decision.allowed).toBe(false)
    expect(decision.unmetCards.length).toBe(KERNEL_CLAIM_CARD_IDS.length - 1)
  })

  it('声明被越级扩大为私有分发可用 → PFC-CLAIM-002', () => {
    const decision = evaluateKernelClaim(makeAllDoneCards())
    const issues = detectClaimScopeEscalation(decision, '内核可用，且组织私有分发可用。')
    expect(ruleIds(issues)).toContain(PFC_RULE_IDS.claimScopeEscalated)
    expect(issues.some((i) => i.message.includes('组织私有分发可用'))).toBe(true)
  })

  it('声明被越级扩大为 V3 GA 已达成 → PFC-CLAIM-002', () => {
    const decision = evaluateKernelClaim(makeAllDoneCards())
    const issues = detectClaimScopeEscalation(decision, 'V3 GA 已达成。')
    expect(issues.some((i) => i.message.includes('V3 GA 已达成'))).toBe(true)
  })

  it('判定为拒绝但措辞仍称内核可用 → 报冲突', () => {
    const cards = makeAllDoneCards()
    cards[cards.findIndex((card) => card.cardId === 'W3b')] = makePartialCard('W3b')
    const decision = evaluateKernelClaim(cards)
    const issues = detectClaimScopeEscalation(decision, 'V3 plugin-first 内核可用。')
    expect(issues.some((i) => i.message.includes('仍表述为内核可用'))).toBe(true)
  })

  it('合规的降级措辞本身不触发越级检测', () => {
    const cards = makeAllDoneCards()
    cards[cards.findIndex((card) => card.cardId === 'W3b')] = makePartialCard('W3b')
    const decision = evaluateKernelClaim(cards)
    expect(detectClaimScopeEscalation(decision, decision.wording)).toEqual([])
  })
})

describe('记录声明与计算值一致性', () => {
  it('一致 → 无 issue', () => {
    const computed = evaluateKernelClaim(makeAllDoneCards())
    expect(compareRecordedClaim(computed, computed)).toEqual([])
  })

  it('未记录 → PFC-CLAIM-003', () => {
    const computed = evaluateKernelClaim(makeAllDoneCards())
    const issues = compareRecordedClaim(computed, undefined)
    expect(issues[0]?.ruleId).toBe(PFC_RULE_IDS.recordedClaimMismatch)
    expect(issues[0]?.message).toContain('未记录')
  })

  it('准入结论不一致 → 报出两个值', () => {
    const allowed = evaluateKernelClaim(makeAllDoneCards())
    const cards = makeAllDoneCards()
    cards[cards.findIndex((card) => card.cardId === 'W3b')] = makePartialCard('W3b')
    const rejected = evaluateKernelClaim(cards)
    const issues = compareRecordedClaim(rejected, allowed)
    expect(issues.some((i) => i.message.includes('(true)') && i.message.includes('(false)'))).toBe(
      true,
    )
  })

  it('措辞不一致 → 报「必须逐字取自账本」', () => {
    const computed = evaluateKernelClaim(makeAllDoneCards())
    const tampered = { ...computed, wording: '内核可用（撰写者自拟措辞）' }
    const issues = compareRecordedClaim(computed, tampered)
    expect(issues.some((i) => i.message.includes('逐字取自账本'))).toBe(true)
  })
})

describe('地图外能力登记（2.5）', () => {
  it('合规账本无 off-map issue', () => {
    const evaluation = evaluateClosureLedger(makePassingLedger(), resolver)
    expect(ruleIds(evaluation.issues)).not.toContain(PFC_RULE_IDS.offMapUsedForCard)
  })

  it('地图外能力被用于凑齐 W 卡 → PFC-OFFMAP-002', () => {
    const evaluation = evaluateClosureLedger(makeOffMapMergedIntoCardLedger(), resolver)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.offMapUsedForCard)
    expect(
      evaluation.issues.some((i) => i.message.includes('须先经显式修改发布地图的 change')),
    ).toBe(true)
  })

  it('已归档插件线能力既无 W 卡也未登记 → PFC-OFFMAP-001', () => {
    const issues = detectUnregisteredCapabilities(makePassingLedger(), [
      { capability: 'fixture-forgotten', mainSpecRef: 'openspec/specs/fixture-forgotten/spec.md' },
    ])
    expect(ruleIds(issues)).toContain(PFC_RULE_IDS.offMapUnregistered)
    expect(issues[0]?.subject).toBe('fixture-forgotten')
  })

  it('已登记的地图外能力不再报未登记', () => {
    const issues = detectUnregisteredCapabilities(makePassingLedger(), [
      { capability: 'fixture-off-map', mainSpecRef: 'openspec/specs/fixture-off-map/spec.md' },
    ])
    expect(issues).toEqual([])
  })
})

describe('取证方式两档（2.6）', () => {
  it('rerun 合规条目无 issue', () => {
    expect(validateGateEvidence(makeRerunEvidence())).toEqual([])
  })

  it('rerun 缺 recordId → 拒绝手写结论或脚本源路径', () => {
    const evidence = { ...makeRerunEvidence(), recordId: undefined }
    const issues = validateGateEvidence(evidence)
    expect(ruleIds(issues)).toContain(PFC_RULE_IDS.evidenceRecordUnresolvable)
    expect(issues[0]?.message).toContain('recordId')
  })

  it('recordId 无法解析到 typed record → 失败并指名 recordId', () => {
    const evidence = makeRerunEvidence()
    const issues = validateGateEvidence(evidence, evidence.gateId, () => undefined)
    expect(ruleIds(issues)).toContain(PFC_RULE_IDS.evidenceRecordUnresolvable)
    expect(issues[0]?.message).toContain(evidence.recordId)
  })

  it('referenced provenance 齐全无 issue', () => {
    expect(validateGateEvidence(makeReferencedEvidence())).toEqual([])
  })

  it('referenced 缺原始日期与 HEAD → 逐项报出', () => {
    const issues = validateGateEvidence(makeReferencedWithoutProvenanceEvidence())
    expect(issues.every((i) => i.ruleId === PFC_RULE_IDS.referencedMissingProvenance)).toBe(true)
    expect(issues.some((i) => i.message.includes('原始运行日期'))).toBe(true)
    expect(issues.some((i) => i.message.includes('原始 HEAD 标识'))).toBe(true)
    expect(issues.some((i) => i.message.includes('期间改动摘要'))).toBe(true)
  })

  it('rerun 携带 referenced 专属字段 → PFC-EV-002 逐字段报出', () => {
    const issues = validateGateEvidence(makeRerunCarryingProvenanceEvidence())
    expect(issues.every((i) => i.ruleId === PFC_RULE_IDS.rerunCarriesProvenance)).toBe(true)
    expect(issues.some((i) => i.message.includes('originalDate'))).toBe(true)
    expect(issues.some((i) => i.message.includes('originalHead'))).toBe(true)
  })

  it('确定性快速门禁用 referenced → PFC-EV-003', () => {
    const issues = validateGateEvidence(makeDeterministicGateReferencedEvidence())
    expect(ruleIds(issues)).toContain(PFC_RULE_IDS.deterministicGateNotRerun)
    expect(issues.some((i) => i.message.includes('必须本轮重跑'))).toBe(true)
  })

  it('长时门禁允许 referenced（不在确定性清单内）', () => {
    expect(DETERMINISTIC_RERUN_GATES).not.toContain('backend-full-suite')
    expect(validateGateEvidence(makeReferencedEvidence('backend-full-suite'))).toEqual([])
  })

  it('取证方式取值越界 → 被拒', () => {
    const issues = validateGateEvidence({
      gateId: 'typecheck',
      mode: 'assumed' as unknown as 'rerun',
      resultSummary: 'passed',
      ref: 'openspec/specs/fixture-capability/spec.md',
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('不在封闭词表')
  })
})

describe('归档同步与 supersession（2.7）', () => {
  it('主规范齐备或有有效 supersession → 同步', () => {
    const evaluation = evaluateArchiveSync(makeSyncedArchiveReport(), resolver)
    expect(evaluation.synchronized).toBe(true)
    expect(evaluation.unresolvedGaps).toEqual([])
    expect(evaluation.supersededCapabilities.map((s) => s.capability)).toEqual(['fixture-renamed'])
  })

  it('存在未合并增量 spec → PFC-SYNC-001 并指名来源归档目录', () => {
    const evaluation = evaluateArchiveSync(makeUnmergedArchiveReport(), resolver)
    expect(evaluation.synchronized).toBe(false)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.archiveMergeGap)
    expect(evaluation.issues.some((i) => i.subject === 'fixture-never-merged')).toBe(true)
    expect(evaluation.issues.some((i) => i.message.includes('2026-08-18-fixture-batch'))).toBe(true)
    expect(evaluation.unresolvedGaps.map((g) => g.capability)).toEqual(['fixture-never-merged'])
  })

  it('supersession 指向不存在的主规范 → 判为无效声明而非豁免', () => {
    const evaluation = evaluateArchiveSync(makeInvalidSupersessionReport(), resolver)
    expect(evaluation.synchronized).toBe(false)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.supersessionUnresolvable)
    expect(evaluation.issues.some((i) => i.message.includes('不作为豁免'))).toBe(true)
    expect(evaluation.unresolvedGaps).toHaveLength(1)
  })

  it('supersession 声明的 capability 不在归档清单中 → 悬空声明被报出', () => {
    const evaluation = evaluateArchiveSync(
      {
        totalDeltaSpecs: 1,
        entries: [
          {
            capability: 'fixture-capability',
            sourceArchiveDir: 'openspec/changes/archive/2026-08-01-fixture-change',
            mainSpecPath: 'openspec/specs/fixture-capability/spec.md',
          },
        ],
        supersessions: [
          {
            capability: 'fixture-ghost',
            supersededBy: 'fixture-capability',
            rationale: '悬空声明',
            declaredAt: '2026-08-24',
          },
        ],
      },
      resolver,
    )
    expect(evaluation.issues.some((i) => i.subject === 'fixture-ghost')).toBe(true)
  })
})

describe('低敏纪律（2.8）', () => {
  it('合规账本通过二次扫描', () => {
    expect(scanLedgerLowSensitive(makePassingLedger())).toEqual([])
  })

  it('账本含凭据类文本 → PFC-SEC-001，且不回显命中内容', () => {
    const issues = scanLedgerLowSensitive(makeSensitiveLedger())
    expect(ruleIds(issues)).toContain(PFC_RULE_IDS.sensitiveContent)
    for (const issue of issues) {
      expect(issue.message).not.toContain('sk-live-')
      expect(issue.message).not.toContain('Bearer')
    }
  })

  it('sanitizeClosureSummary 移除敏感值', () => {
    const sanitized = sanitizeClosureSummary(
      'Authorization: Bearer sk-live-0123456789abcdef0123456789abcdef',
    )
    expect(sanitized).not.toContain('sk-live-0123456789abcdef0123456789abcdef')
  })
})

describe('账本整体校验（确定性）', () => {
  it('全绿账本 consistent', () => {
    const evaluation = evaluateClosureLedger(makePassingLedger(), resolver)
    expect(evaluation.blockingCount).toBe(0)
    expect(evaluation.consistent).toBe(true)
    expect(evaluation.claim.allowed).toBe(true)
  })

  it('主规范缺失账本 → 不 consistent 并指名 capability 路径', () => {
    const evaluation = evaluateClosureLedger(makeMissingMainSpecLedger(), resolver)
    expect(evaluation.consistent).toBe(false)
    expect(
      evaluation.issues.some((i) =>
        i.message.includes('openspec/specs/missing-capability/spec.md'),
      ),
    ).toBe(true)
  })

  it('悬空引用账本 → 报出无法解析的 change 目录', () => {
    const evaluation = evaluateClosureLedger(makeDanglingReferenceLedger(), resolver)
    expect(evaluation.consistent).toBe(false)
    expect(evaluation.issues.some((i) => i.message.includes('2026-08-01-missing-change'))).toBe(
      true,
    )
  })

  it('状态越界账本 → 报 PFC-CARD-001', () => {
    const evaluation = evaluateClosureLedger(makeStatusOutOfVocabularyLedger(), resolver)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.statusOutOfVocabulary)
  })

  it('记录声明与计算值不一致 → PFC-CLAIM-003 计入 blocking', () => {
    const evaluation = evaluateClosureLedger(makeClaimMismatchLedger(), resolver)
    expect(ruleIds(evaluation.issues)).toContain(PFC_RULE_IDS.recordedClaimMismatch)
    expect(evaluation.consistent).toBe(false)
  })

  it('声明被拒本身不使账本判为不自洽（降级是设计内输出）', () => {
    const ledger = makePassingLedger()
    const index = ledger.cards.findIndex((card) => card.cardId === 'W3b')
    ledger.cards[index] = makePartialCard('W3b')
    ledger.recordedClaim = evaluateKernelClaim(ledger.cards)
    const evaluation = evaluateClosureLedger(ledger, resolver)
    expect(evaluation.claim.allowed).toBe(false)
    expect(ruleIds(evaluation.issues)).not.toContain(PFC_RULE_IDS.kernelClaimRejected)
    expect(evaluation.consistent).toBe(true)
  })

  it('同一输入两次求值产出相同 issue 序列（确定性）', () => {
    const ledger = makeMissingMainSpecLedger()
    const first = evaluateClosureLedger(ledger, resolver)
    const second = evaluateClosureLedger(ledger, resolver)
    expect(JSON.stringify(first.issues)).toBe(JSON.stringify(second.issues))
  })
})
