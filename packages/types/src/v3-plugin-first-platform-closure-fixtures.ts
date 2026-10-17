/**
 * v3-plugin-first-platform-closure-fixtures —— 插件优先线验收账本的确定性 fixture。
 *
 * 全部 fixture 为纯内存数据，配合 `makeFixtureResolver` 使用（不触碰文件系统）。
 * 正例 = 全绿账本；负例逐个对应 spec 的失败场景，供单测断言**具体失败原因**而非仅断言 fail。
 */

import type {
  ArchiveSyncReport,
  ClosureGateEvidence,
  ClosurePathResolver,
  OffMapCapabilityEntry,
  PluginFirstCardEntry,
  PluginFirstCardId,
  PluginFirstClosureLedger,
  SupersessionDeclaration,
} from './v3-plugin-first-platform-closure.js'
import { evaluateKernelClaim } from './v3-plugin-first-platform-closure.js'

/** fixture 的确定性捕获日期与 HEAD。 */
export const CLOSURE_FIXTURE_CAPTURED_AT = '2026-08-24'
export const CLOSURE_FIXTURE_HEAD = 'fixturehead0000'

/** 一个存在的归档目录（fixture 世界内）。 */
const FIXTURE_ARCHIVE = 'openspec/changes/archive/2026-08-01-fixture-change'
/** 一份存在的主规范（fixture 世界内）。 */
const FIXTURE_SPEC = 'openspec/specs/fixture-capability/spec.md'

/**
 * fixture 世界的路径解析器：所有以 `openspec/` 开头且不含 `missing` 的路径视为存在。
 * 这样负例只需在路径中写 `missing` 即可表达「无法解析」。
 */
export function makeFixtureResolver(extraPresent: readonly string[] = []): ClosurePathResolver {
  const extra = new Set(extraPresent)
  return (path: string) => {
    if (extra.has(path)) return true
    if (!path.startsWith('openspec/')) return false
    return !path.includes('missing')
  }
}

/** 一条合规的 rerun 门禁证据。 */
export function makeRerunEvidence(
  gateId = 'openspec-strict-validate',
  resultSummary = 'passed',
): ClosureGateEvidence {
  return {
    gateId,
    mode: 'rerun',
    resultSummary,
    ref: 'openspec/changes/archive/2026-08-01-fixture-change/tasks.md',
    recordId: `release-trust:fixture:${gateId}`,
  }
}

/** 一条合规的 referenced 门禁证据（provenance 齐全）。 */
export function makeReferencedEvidence(gateId = 'backend-full-suite'): ClosureGateEvidence {
  return {
    gateId,
    mode: 'referenced',
    resultSummary: '7245 passed / 1 failed / 27 todo / 2 skipped',
    ref: 'progress/current-focus.md',
    originalDate: '2026-08-23',
    originalHead: 'abcdef123456',
    intervalChangeSummary: '仅规划文档与契约改动，无产品代码 diff',
  }
}

/** 一张三要件齐备的 `done` 卡。 */
export function makeDoneCard(cardId: PluginFirstCardId): PluginFirstCardEntry {
  return {
    cardId,
    title: `${cardId} fixture 卡`,
    status: 'done',
    rationale: '承担 change 已归档、主规范齐备、退出门禁有可解析证据',
    archivedChangeRefs: [FIXTURE_ARCHIVE],
    mainSpecRefs: [FIXTURE_SPEC],
    gateEvidence: [makeRerunEvidence()],
  }
}

/** 一张覆盖面齐备的 `partial` 卡。 */
export function makePartialCard(cardId: PluginFirstCardId): PluginFirstCardEntry {
  return {
    cardId,
    title: `${cardId} fixture 卡`,
    status: 'partial',
    rationale: '只被既有 change 覆盖了一部分职责',
    archivedChangeRefs: [FIXTURE_ARCHIVE],
    mainSpecRefs: [FIXTURE_SPEC],
    gateEvidence: [makeRerunEvidence()],
    coveredBehaviors: ['崩溃降级'],
    uncoveredBehaviors: ['执行隔离边界', '威胁模型'],
  }
}

/** W0–W7 全部为 `done`（W7 例外：显式无引用的 `deferred`）。 */
export function makeAllDoneCards(): PluginFirstCardEntry[] {
  const ids: PluginFirstCardId[] = [
    'W0',
    'W1',
    'W2a',
    'W2b',
    'W3a',
    'W3b',
    'W3c',
    'W3d',
    'W4a',
    'W4b',
    'W4c',
    'W5a',
    'W5b',
    'W6',
  ]
  const cards = ids.map((id) => makeDoneCard(id))
  cards.push({
    cardId: 'W7',
    title: 'W7 公开生态',
    status: 'deferred',
    rationale: '公开插件市场明确延期；需用户明确授权后另立范围',
    archivedChangeRefs: [],
    mainSpecRefs: [],
    gateEvidence: [],
    intentionallyUnbacked: true,
  })
  return cards
}

/** 一份全绿的归档同步报告。 */
export function makeSyncedArchiveReport(): ArchiveSyncReport {
  return {
    totalDeltaSpecs: 3,
    entries: [
      {
        capability: 'fixture-capability',
        sourceArchiveDir: FIXTURE_ARCHIVE,
        mainSpecPath: FIXTURE_SPEC,
      },
      {
        capability: 'fixture-renamed',
        sourceArchiveDir: FIXTURE_ARCHIVE,
        mainSpecPath: null,
      },
    ],
    supersessions: [makeValidSupersession()],
  }
}

export function makeValidSupersession(): SupersessionDeclaration {
  return {
    capability: 'fixture-renamed',
    supersededBy: 'fixture-capability',
    rationale: '同一能力在归档后改名，需求已逐条并入承接主规范',
    declaredAt: CLOSURE_FIXTURE_CAPTURED_AT,
  }
}

export function makeOffMapEntries(): OffMapCapabilityEntry[] {
  return [
    {
      capability: 'fixture-off-map',
      archivedChangeRef: FIXTURE_ARCHIVE,
      mainSpecRef: 'openspec/specs/fixture-off-map/spec.md',
      surface: '插件治理',
    },
  ]
}

/** 基础账本（全绿）。 */
export function makePassingLedger(): PluginFirstClosureLedger {
  const cards = makeAllDoneCards()
  const ledger: PluginFirstClosureLedger = {
    ledgerId: 'v3-plugin-first-closure-fixture',
    capturedAt: CLOSURE_FIXTURE_CAPTURED_AT,
    gitHeadSha: CLOSURE_FIXTURE_HEAD,
    cards,
    offMapCapabilities: makeOffMapEntries(),
    archiveSync: makeSyncedArchiveReport(),
  }
  ledger.recordedClaim = evaluateKernelClaim(cards)
  return ledger
}

// ── 负例 ────────────────────────────────────────────────────────────────────

/** 负例：某卡标 `done` 但主规范缺失（三要件第二件不成立）。 */
export function makeMissingMainSpecLedger(): PluginFirstClosureLedger {
  const ledger = makePassingLedger()
  const target = ledger.cards.find((card) => card.cardId === 'W2a')
  if (target) target.mainSpecRefs = ['openspec/specs/missing-capability/spec.md']
  ledger.recordedClaim = evaluateKernelClaim(ledger.cards)
  return ledger
}

/** 负例：承担 change 引用指向不存在的归档目录（悬空引用）。 */
export function makeDanglingReferenceLedger(): PluginFirstClosureLedger {
  const ledger = makePassingLedger()
  const target = ledger.cards.find((card) => card.cardId === 'W3a')
  if (target) target.archivedChangeRefs = ['openspec/changes/archive/2026-08-01-missing-change']
  ledger.recordedClaim = evaluateKernelClaim(ledger.cards)
  return ledger
}

/** 负例：状态取值越出封闭词表。 */
export function makeStatusOutOfVocabularyLedger(): PluginFirstClosureLedger {
  const ledger = makePassingLedger()
  const target = ledger.cards.find((card) => card.cardId === 'W4c')
  // 故意注入词表外取值（模拟发布地图里出现的 `archived`）。
  if (target) (target as { status: string }).status = 'archived'
  return ledger
}

/** 负例：`partial` 卡缺覆盖面说明。 */
export function makePartialWithoutCoverageLedger(): PluginFirstClosureLedger {
  const ledger = makePassingLedger()
  const index = ledger.cards.findIndex((card) => card.cardId === 'W3b')
  if (index >= 0) {
    ledger.cards[index] = {
      ...makePartialCard('W3b'),
      coveredBehaviors: [],
      uncoveredBehaviors: [],
    }
  }
  ledger.recordedClaim = evaluateKernelClaim(ledger.cards)
  return ledger
}

/** 负例：`referenced` 条目缺 provenance。 */
export function makeReferencedWithoutProvenanceEvidence(): ClosureGateEvidence {
  return {
    gateId: 'backend-full-suite',
    mode: 'referenced',
    resultSummary: '7245 passed / 1 failed',
    ref: 'progress/current-focus.md',
  }
}

/** 负例：`rerun` 条目携带 referenced 专属字段。 */
export function makeRerunCarryingProvenanceEvidence(): ClosureGateEvidence {
  return {
    gateId: 'typecheck',
    mode: 'rerun',
    resultSummary: 'passed',
    ref: 'openspec/changes/archive/2026-08-01-fixture-change/tasks.md',
    recordId: 'release-trust:fixture:typecheck',
    originalDate: '2026-08-23',
    originalHead: 'abcdef123456',
  }
}

/** 负例：确定性快速门禁用了 `referenced`。 */
export function makeDeterministicGateReferencedEvidence(): ClosureGateEvidence {
  return {
    gateId: 'build',
    mode: 'referenced',
    resultSummary: 'passed',
    ref: 'progress/completed.md',
    originalDate: '2026-08-23',
    originalHead: 'abcdef123456',
    intervalChangeSummary: '无产品代码改动',
  }
}

/** 负例：supersession 指向不存在的主规范。 */
export function makeInvalidSupersessionReport(): ArchiveSyncReport {
  return {
    totalDeltaSpecs: 2,
    entries: [
      {
        capability: 'fixture-renamed',
        sourceArchiveDir: FIXTURE_ARCHIVE,
        mainSpecPath: null,
      },
    ],
    supersessions: [
      {
        capability: 'fixture-renamed',
        supersededBy: 'missing-successor',
        rationale: '声称由一个并不存在的主规范承接',
        declaredAt: CLOSURE_FIXTURE_CAPTURED_AT,
      },
    ],
  }
}

/** 负例：存在未合并的增量 spec（既无主规范也无 supersession）。 */
export function makeUnmergedArchiveReport(): ArchiveSyncReport {
  return {
    totalDeltaSpecs: 2,
    entries: [
      {
        capability: 'fixture-capability',
        sourceArchiveDir: FIXTURE_ARCHIVE,
        mainSpecPath: FIXTURE_SPEC,
      },
      {
        capability: 'fixture-never-merged',
        sourceArchiveDir: 'openspec/changes/archive/2026-08-18-fixture-batch',
        mainSpecPath: null,
      },
    ],
    supersessions: [],
  }
}

/** 负例：地图外能力的主规范同时被 W 卡引用（就地归并）。 */
export function makeOffMapMergedIntoCardLedger(): PluginFirstClosureLedger {
  const ledger = makePassingLedger()
  const target = ledger.cards.find((card) => card.cardId === 'W6')
  if (target) target.mainSpecRefs = ['openspec/specs/fixture-off-map/spec.md']
  ledger.recordedClaim = evaluateKernelClaim(ledger.cards)
  return ledger
}

/** 负例：账本记录的声明与计算值不一致。 */
export function makeClaimMismatchLedger(): PluginFirstClosureLedger {
  const ledger = makePassingLedger()
  const index = ledger.cards.findIndex((card) => card.cardId === 'W3c')
  if (index >= 0) ledger.cards[index] = makePartialCard('W3c')
  // 故意保留「全 done」时算出的 recordedClaim，制造与计算值的不一致。
  return ledger
}

/** 负例：账本自由文本命中低敏扫描。 */
export function makeSensitiveLedger(): PluginFirstClosureLedger {
  const ledger = makePassingLedger()
  const target = ledger.cards.find((card) => card.cardId === 'W1')
  if (target) {
    target.rationale = 'Authorization: Bearer sk-live-0123456789abcdef0123456789abcdef'
  }
  return ledger
}
