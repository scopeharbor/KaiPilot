/**
 * v3-plugin-first-platform-closure —— V3 插件优先线总验收账本的共享契约（纯类型与纯函数，零运行时依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块：只定义类型、封闭枚举、确定性判定纯函数与低敏校验。
 * 它不读文件、不访问网络——路径存在性由调用方以 `ClosurePathResolver` 注入，使同一账本在
 * 任意宿主（脚本 / 测试 / CI）上得到同一裁决。
 *
 * # 语义（对应 spec `v3-plugin-first-platform-closure` 与 design D1~D9）
 * - **五档封闭词表**：`done` / `delivered` / `partial` / `candidate` / `deferred`。词表不得扩张——
 *   可自由增档会让降级失去约束力。
 * - **`done` 三要件**（design D2）：承担 change 已归档 + 每个增量 spec capability 在主规范存在 +
 *   卡片声明的退出门禁有可解析证据引用。缺任意一件降为 `partial` 或更低。
 * - **`partial` 必填覆盖面**：已覆盖行为与未覆盖行为二者都不得为空，否则「部分覆盖」无法审查。
 * - **内核可用声明**：仅当 W1–W5 全部为 `done` 时成立；否则输出确定性降级措辞并指名未满足卡。
 *   措辞由数据推导（design D9），撰写者不选措辞。
 * - **地图外能力**：已归档但无 W 卡的插件线能力必须单列登记，且不得用于凑齐任一 W 卡的三要件。
 * - **取证方式两档**（design D7）：`rerun`（当前 HEAD 实测）/ `referenced`（引用既往记录）。
 *   `referenced` 必须带原始日期 + 原始 HEAD + 期间改动摘要；`rerun` 不得携带 provenance 字段。
 * - **归档同步**：每个归档增量 spec capability 必须有主规范，或有指向存在主规范的 supersession 声明。
 * - **低敏纪律**：账本只保存路径 / change 标识 / 状态 / 计数 / 确定性哈希，不含凭据、令牌、
 *   原始 prompt、模型输出全文、provider 原始载荷或跨租标识。
 */

import {
  containsSensitiveContent,
  countSensitiveHits,
  redactSensitiveText,
} from './performance-and-scale-gates.js'
import type { ReleaseTrustEvidenceRecord } from './release-trust-and-evidence-center.js'

// =============================================================================
// 1. 封闭词表与卡片标识
// =============================================================================

/** 卡片状态封闭词表（spec：W 卡状态必须取自封闭词表）。顺序即严格度递减。 */
export const PLUGIN_FIRST_CARD_STATUSES = [
  'done',
  'delivered',
  'partial',
  'candidate',
  'deferred',
] as const
export type PluginFirstCardStatus = (typeof PLUGIN_FIRST_CARD_STATUSES)[number]

/** 状态严格度（数值越大越接近完成）。用于「缺要件必须降级」的比较。 */
const CARD_STATUS_RANK: Record<PluginFirstCardStatus, number> = {
  done: 5,
  delivered: 4,
  partial: 3,
  candidate: 2,
  deferred: 1,
}

export function isPluginFirstCardStatus(value: unknown): value is PluginFirstCardStatus {
  return (
    typeof value === 'string' && (PLUGIN_FIRST_CARD_STATUSES as readonly string[]).includes(value)
  )
}

/** W0–W7 全部卡片标识（发布地图 §4 的无环波次图）。 */
export const PLUGIN_FIRST_CARD_IDS = [
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
  'W7',
] as const
export type PluginFirstCardId = (typeof PLUGIN_FIRST_CARD_IDS)[number]

/**
 * 「plugin-first 内核可用」声明的准入卡集合（W1–W5，不含 W0 治理卡与 W6/W7 分发卡）。
 * spec：内核可用声明必须由验收账本准入 —— W1–W5 全部 `done` 才成立。
 */
export const KERNEL_CLAIM_CARD_IDS = [
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
] as const
export type KernelClaimCardId = (typeof KERNEL_CLAIM_CARD_IDS)[number]

export function isKernelClaimCard(cardId: string): cardId is KernelClaimCardId {
  return (KERNEL_CLAIM_CARD_IDS as readonly string[]).includes(cardId)
}

// =============================================================================
// 2. 引用与门禁证据
// =============================================================================

/** 三类引用，对应 `done` 三要件。 */
export const CLOSURE_REFERENCE_KINDS = ['archived-change', 'main-spec', 'gate-evidence'] as const
export type ClosureReferenceKind = (typeof CLOSURE_REFERENCE_KINDS)[number]

/** 取证方式两档（design D7）。 */
export const EVIDENCE_ACQUISITION_MODES = ['rerun', 'referenced'] as const
export type EvidenceAcquisitionMode = (typeof EVIDENCE_ACQUISITION_MODES)[number]

/**
 * 确定性快速门禁清单：这些门禁 MUST 使用 `rerun`。
 * 长时门禁（后端全量套件）不在此列，MAY 使用 `referenced`。
 */
export const DETERMINISTIC_RERUN_GATES = [
  'openspec-strict-validate',
  'openspec-validate-specs',
  'typecheck',
  'build',
  'types-vitest',
  'frontend-vitest',
  'security-gate',
  'performance-gates',
  'v3-v25-compat',
  'v3-uat-stabilization',
  'archive-spec-sync',
  'plugin-capability-seams',
  'plugin-manifest',
  'plugin-compatibility',
  'plugin-private-registry',
  'connector-definitions',
] as const
export type DeterministicRerunGateId = (typeof DETERMINISTIC_RERUN_GATES)[number]

/** 一条门禁证据。`rerun` 与 `referenced` 的字段集互斥（见 `validateGateEvidence`）。 */
export interface ClosureGateEvidence {
  /** 门禁标识（确定性门禁须取自 `DETERMINISTIC_RERUN_GATES`；长时门禁可自定义）。 */
  gateId: string
  mode: EvidenceAcquisitionMode
  /** 低敏结果摘要（如 `passed`、`blocking=0 warning=2`、`7245 passed / 1 failed`）。 */
  resultSummary: string
  /** 可解析引用：仓库相对路径或可复跑的命令。 */
  ref: string
  /** 指向统一证据束中的 typed record；rerun 条目必填。 */
  recordId?: string
  /** `referenced` 必填：原始运行日期（YYYY-MM-DD）。 */
  originalDate?: string
  /** `referenced` 必填：原始 HEAD 标识。 */
  originalHead?: string
  /** `referenced` 必填：自原始运行以来的相关改动摘要。 */
  intervalChangeSummary?: string
}

/** 一条可解析引用（change 目录 / 主规范路径）。 */
export interface ClosureReference {
  kind: Exclude<ClosureReferenceKind, 'gate-evidence'>
  /** 仓库相对 posix 路径。 */
  path: string
}

/** 路径存在性解析器（由调用方注入；保持本模块纯函数）。 */
export type ClosurePathResolver = (repoRelativePath: string) => boolean

/** 统一证据记录解析器（由 CLI 从 evidence bundle 注入）。 */
export type ClosureEvidenceRecordResolver = (
  recordId: string,
) => ReleaseTrustEvidenceRecord | undefined

// =============================================================================
// 3. 账本条目
// =============================================================================

/** 一张 W 卡的验收条目。 */
export interface PluginFirstCardEntry {
  cardId: PluginFirstCardId
  title: string
  status: PluginFirstCardStatus
  /** 裁决理由（低敏散文，一句话）。 */
  rationale: string
  /** 承担该卡的已归档 change 目录（`openspec/changes/archive/<date>-<change>`）。 */
  archivedChangeRefs: string[]
  /** 对应主规范（`openspec/specs/<capability>/spec.md`）。 */
  mainSpecRefs: string[]
  /** 退出门禁证据。 */
  gateEvidence: ClosureGateEvidence[]
  /** `partial` 必填：已覆盖行为。 */
  coveredBehaviors?: string[]
  /** `partial` 必填：未覆盖行为。 */
  uncoveredBehaviors?: string[]
  /** `deferred` / `candidate` 卡可标注为无需引用（如 W7 公开生态）。 */
  intentionallyUnbacked?: boolean
}

/** 地图外已交付能力条目（不计入任一 W 卡完成判据）。 */
export interface OffMapCapabilityEntry {
  capability: string
  archivedChangeRef: string
  mainSpecRef: string
  /** 所属能力面（如「插件治理」「官方插件包」）。 */
  surface: string
}

/** supersession 声明（design D6：显式受版本控制的声明，不是检查器硬编码豁免）。 */
export interface SupersessionDeclaration {
  capability: string
  /** 承接的主规范 capability 名（对应 `openspec/specs/<supersededBy>/spec.md`）。 */
  supersededBy: string
  rationale: string
  /** YYYY-MM-DD。 */
  declaredAt: string
}

/** 一个归档增量 spec capability 的同步状态。 */
export interface ArchiveSyncEntry {
  capability: string
  /** 来源归档目录（`openspec/changes/archive/<date>-<change>`）。 */
  sourceArchiveDir: string
  /** 主规范路径；`null` 表示主规范不存在。 */
  mainSpecPath: string | null
  /**
   * 该 capability 的归档增量是否向主规范贡献需求（ADDED / MODIFIED 段落中存在需求条目）。
   *
   * 只含 `## REMOVED Requirements` 的增量按 OpenSpec 语义是**从主规范删除**需求，
   * 对主规范的净贡献为零。要求这类 capability 产出主规范是判据错误，不是缺口，
   * 因此它们被单列为无贡献条目而不是合并缺口——但仍在报告中可见，不被静默吞掉。
   *
   * 省略时按 `true` 处理（保守：默认要求主规范存在）。
   */
  contributesRequirements?: boolean
}

/** 归档→主规范同步报告。 */
export interface ArchiveSyncReport {
  totalDeltaSpecs: number
  entries: ArchiveSyncEntry[]
  supersessions: SupersessionDeclaration[]
}

/** 完整验收账本。 */
export interface PluginFirstClosureLedger {
  ledgerId: string
  /** YYYY-MM-DD。 */
  capturedAt: string
  /** 取证 HEAD（短或全 sha）。 */
  gitHeadSha: string
  cards: PluginFirstCardEntry[]
  offMapCapabilities: OffMapCapabilityEntry[]
  archiveSync: ArchiveSyncReport
  /** 账本记录的声明判定（须与 `evaluateKernelClaim` 的计算值一致）。 */
  recordedClaim?: KernelClaimDecision
}

// =============================================================================
// 4. Issue 类型与规则 ID
// =============================================================================

export const PFC_RULE_IDS = {
  /** 引用无法在仓库中解析。 */
  unresolvableReference: 'PFC-REF-001',
  /** 完成状态缺少某一类引用。 */
  missingReferenceClass: 'PFC-REF-002',
  /** 状态取值超出封闭词表。 */
  statusOutOfVocabulary: 'PFC-CARD-001',
  /** `done` 三要件不满足。 */
  completionRequisiteUnmet: 'PFC-CARD-002',
  /** `partial` 缺覆盖面说明。 */
  partialCoverageIncomplete: 'PFC-CARD-003',
  /** 内核可用声明被拒（存在未满足卡）。 */
  kernelClaimRejected: 'PFC-CLAIM-001',
  /** 声明被越级扩大到私有分发或 GA。 */
  claimScopeEscalated: 'PFC-CLAIM-002',
  /** 账本记录的声明与计算值不一致。 */
  recordedClaimMismatch: 'PFC-CLAIM-003',
  /** 已归档插件线能力既无 W 卡也未登记。 */
  offMapUnregistered: 'PFC-OFFMAP-001',
  /** 地图外能力被用于凑齐 W 卡三要件。 */
  offMapUsedForCard: 'PFC-OFFMAP-002',
  /** 归档 capability 既无主规范也无 supersession。 */
  archiveMergeGap: 'PFC-SYNC-001',
  /** supersession 指向不存在的主规范。 */
  supersessionUnresolvable: 'PFC-SYNC-002',
  /** `referenced` 缺 provenance。 */
  referencedMissingProvenance: 'PFC-EV-001',
  /** `rerun` 携带 referenced 字段。 */
  rerunCarriesProvenance: 'PFC-EV-002',
  /** 确定性门禁未用 `rerun`。 */
  deterministicGateNotRerun: 'PFC-EV-003',
  /** rerun 缺少或无法解析统一证据记录。 */
  evidenceRecordUnresolvable: 'PFC-EV-004',
  /** 账本内容命中低敏扫描。 */
  sensitiveContent: 'PFC-SEC-001',
} as const

export type PfcRuleId = (typeof PFC_RULE_IDS)[keyof typeof PFC_RULE_IDS]

export interface ClosureIssue {
  ruleId: PfcRuleId
  severity: 'blocking' | 'warning'
  /** 卡片 ID / capability 名 / 门禁 ID 等定位标识。 */
  subject: string
  /** 低敏说明（不含原始内容）。 */
  message: string
}

/** issue 稳定排序（ruleId → subject → message），保证同输入同输出。 */
export function sortClosureIssues(issues: readonly ClosureIssue[]): ClosureIssue[] {
  return [...issues].sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      a.subject.localeCompare(b.subject) ||
      a.message.localeCompare(b.message),
  )
}

// =============================================================================
// 5. `done` 三要件判定（design D2）
// =============================================================================

/** 三要件的逐项结果。 */
export interface CompletionRequisites {
  /** 承担 change 已归档且目录可解析。 */
  archivedChangePresent: boolean
  /** 每个承担 capability 的主规范存在。 */
  mainSpecsPresent: boolean
  /** 退出门禁有可解析证据引用。 */
  gateEvidencePresent: boolean
}

export interface CardCompletionEvaluation {
  cardId: PluginFirstCardId
  requisites: CompletionRequisites
  /** 缺失的要件类别（空数组 = 三要件齐备）。 */
  missingClasses: ClosureReferenceKind[]
  /** 三要件齐备时允许的最高状态；否则为允许的降级上限。 */
  maxAllowedStatus: PluginFirstCardStatus
  issues: ClosureIssue[]
}

/**
 * 判定一张卡的完成三要件。
 *
 * `resolver` 返回路径是否存在。任何引用无法解析即视为该类要件不成立，并产出
 * `PFC-REF-001`；某一类引用完全为空则产出 `PFC-REF-002`。
 *
 * 三要件齐备 → `maxAllowedStatus='done'`；缺任意一项 → `'partial'`（spec：缺任一项 MUST 降为
 * `partial` 或更低）。`intentionallyUnbacked` 的卡（如 W7）不参与三要件判定，上限为 `deferred`。
 */
export function evaluateCardCompletion(
  card: PluginFirstCardEntry,
  resolver: ClosurePathResolver,
  recordResolver?: ClosureEvidenceRecordResolver,
): CardCompletionEvaluation {
  const issues: ClosureIssue[] = []

  if (!isPluginFirstCardStatus(card.status)) {
    issues.push({
      ruleId: PFC_RULE_IDS.statusOutOfVocabulary,
      severity: 'blocking',
      subject: card.cardId,
      message: `状态取值 "${String(card.status)}" 不在封闭词表 ${PLUGIN_FIRST_CARD_STATUSES.join('/')} 内`,
    })
  }

  if (card.intentionallyUnbacked === true) {
    return {
      cardId: card.cardId,
      requisites: {
        archivedChangePresent: false,
        mainSpecsPresent: false,
        gateEvidencePresent: false,
      },
      missingClasses: [],
      maxAllowedStatus: 'deferred',
      issues,
    }
  }

  const missingClasses: ClosureReferenceKind[] = []

  // (1) 承担 change 已归档
  let archivedChangePresent = card.archivedChangeRefs.length > 0
  if (!archivedChangePresent) {
    missingClasses.push('archived-change')
    issues.push({
      ruleId: PFC_RULE_IDS.missingReferenceClass,
      severity: 'blocking',
      subject: card.cardId,
      message: '缺少承担 change 引用（archived-change）',
    })
  }
  for (const ref of card.archivedChangeRefs) {
    if (!ref.startsWith('openspec/changes/archive/')) {
      archivedChangePresent = false
      issues.push({
        ruleId: PFC_RULE_IDS.unresolvableReference,
        severity: 'blocking',
        subject: card.cardId,
        message: `承担 change 引用不在归档区：${ref}`,
      })
      continue
    }
    if (!resolver(ref)) {
      archivedChangePresent = false
      issues.push({
        ruleId: PFC_RULE_IDS.unresolvableReference,
        severity: 'blocking',
        subject: card.cardId,
        message: `承担 change 目录无法解析：${ref}`,
      })
    }
  }

  // (2) 主规范存在
  let mainSpecsPresent = card.mainSpecRefs.length > 0
  if (!mainSpecsPresent) {
    missingClasses.push('main-spec')
    issues.push({
      ruleId: PFC_RULE_IDS.missingReferenceClass,
      severity: 'blocking',
      subject: card.cardId,
      message: '缺少主规范引用（main-spec）',
    })
  }
  for (const ref of card.mainSpecRefs) {
    if (!resolver(ref)) {
      mainSpecsPresent = false
      issues.push({
        ruleId: PFC_RULE_IDS.unresolvableReference,
        severity: 'blocking',
        subject: card.cardId,
        message: `主规范无法解析：${ref}`,
      })
    }
  }

  // (3) 门禁证据可解析
  let gateEvidencePresent = card.gateEvidence.length > 0
  if (!gateEvidencePresent) {
    missingClasses.push('gate-evidence')
    issues.push({
      ruleId: PFC_RULE_IDS.missingReferenceClass,
      severity: 'blocking',
      subject: card.cardId,
      message: '缺少退出门禁证据引用（gate-evidence）',
    })
  }
  for (const evidence of card.gateEvidence) {
    issues.push(
      ...validateGateEvidence(evidence, `${card.cardId}:${evidence.gateId}`, recordResolver),
    )
    // 证据引用若指向仓库路径则必须可解析；命令形式（含空格）不参与路径解析。
    if (isRepoPathRef(evidence.ref) && !resolver(evidence.ref)) {
      gateEvidencePresent = false
      issues.push({
        ruleId: PFC_RULE_IDS.unresolvableReference,
        severity: 'blocking',
        subject: card.cardId,
        message: `门禁证据引用无法解析：${evidence.ref}`,
      })
    }
  }

  const requisites: CompletionRequisites = {
    archivedChangePresent,
    mainSpecsPresent,
    gateEvidencePresent,
  }
  const allMet = archivedChangePresent && mainSpecsPresent && gateEvidencePresent

  // 已解析失败但类别非空的情况，也要计入 missingClasses（去重保持稳定顺序）。
  if (!archivedChangePresent && !missingClasses.includes('archived-change')) {
    missingClasses.push('archived-change')
  }
  if (!mainSpecsPresent && !missingClasses.includes('main-spec')) {
    missingClasses.push('main-spec')
  }
  if (!gateEvidencePresent && !missingClasses.includes('gate-evidence')) {
    missingClasses.push('gate-evidence')
  }

  const maxAllowedStatus: PluginFirstCardStatus = allMet ? 'done' : 'partial'

  if (isPluginFirstCardStatus(card.status)) {
    if (CARD_STATUS_RANK[card.status] > CARD_STATUS_RANK[maxAllowedStatus]) {
      issues.push({
        ruleId: PFC_RULE_IDS.completionRequisiteUnmet,
        severity: 'blocking',
        subject: card.cardId,
        message: `状态 "${card.status}" 高于三要件允许的上限 "${maxAllowedStatus}"；未满足要件：${missingClasses.join('、') || '（无）'}`,
      })
    }
  }

  issues.push(...validatePartialCoverage(card))

  return {
    cardId: card.cardId,
    requisites,
    missingClasses,
    maxAllowedStatus,
    issues: sortClosureIssues(issues),
  }
}

/** 引用是否为仓库路径（而非可复跑命令）。命令含空格；路径不含。 */
function isRepoPathRef(ref: string): boolean {
  return ref.length > 0 && !ref.includes(' ')
}

/**
 * `partial` 的覆盖面必填校验：已覆盖行为与未覆盖行为二者都不得为空。
 * spec Scenario「部分覆盖」：MUST 分别列出已覆盖的行为与仍缺的行为。
 */
export function validatePartialCoverage(card: PluginFirstCardEntry): ClosureIssue[] {
  if (card.status !== 'partial') return []
  const issues: ClosureIssue[] = []
  const covered = card.coveredBehaviors ?? []
  const uncovered = card.uncoveredBehaviors ?? []
  if (covered.length === 0) {
    issues.push({
      ruleId: PFC_RULE_IDS.partialCoverageIncomplete,
      severity: 'blocking',
      subject: card.cardId,
      message: 'partial 卡缺少已覆盖行为清单',
    })
  }
  if (uncovered.length === 0) {
    issues.push({
      ruleId: PFC_RULE_IDS.partialCoverageIncomplete,
      severity: 'blocking',
      subject: card.cardId,
      message: 'partial 卡缺少未覆盖行为清单',
    })
  }
  return issues
}

// =============================================================================
// 6. 门禁证据取证方式校验（design D7）
// =============================================================================

/**
 * 校验一条门禁证据的取证方式。
 * - `referenced` 缺原始日期 / 原始 HEAD / 期间改动摘要 → `PFC-EV-001`；
 * - `rerun` 携带任一 provenance 字段 → `PFC-EV-002`（引用记录不得冒充本轮实测）；
 * - 确定性快速门禁使用 `referenced` → `PFC-EV-003`。
 */
export function validateGateEvidence(
  evidence: ClosureGateEvidence,
  subject: string = evidence.gateId,
  recordResolver?: ClosureEvidenceRecordResolver,
): ClosureIssue[] {
  const issues: ClosureIssue[] = []

  if (!(EVIDENCE_ACQUISITION_MODES as readonly string[]).includes(evidence.mode)) {
    issues.push({
      ruleId: PFC_RULE_IDS.referencedMissingProvenance,
      severity: 'blocking',
      subject,
      message: `取证方式 "${String(evidence.mode)}" 不在封闭词表 rerun/referenced 内`,
    })
    return issues
  }

  if (evidence.mode === 'referenced') {
    if (!evidence.originalDate) {
      issues.push({
        ruleId: PFC_RULE_IDS.referencedMissingProvenance,
        severity: 'blocking',
        subject,
        message: 'referenced 条目缺原始运行日期，无法与本轮实测区分',
      })
    }
    if (!evidence.originalHead) {
      issues.push({
        ruleId: PFC_RULE_IDS.referencedMissingProvenance,
        severity: 'blocking',
        subject,
        message: 'referenced 条目缺原始 HEAD 标识，无法与本轮实测区分',
      })
    }
    if (!evidence.intervalChangeSummary) {
      issues.push({
        ruleId: PFC_RULE_IDS.referencedMissingProvenance,
        severity: 'blocking',
        subject,
        message: 'referenced 条目缺期间改动摘要',
      })
    }
    if ((DETERMINISTIC_RERUN_GATES as readonly string[]).includes(evidence.gateId)) {
      issues.push({
        ruleId: PFC_RULE_IDS.deterministicGateNotRerun,
        severity: 'blocking',
        subject,
        message: `确定性快速门禁 "${evidence.gateId}" 必须本轮重跑，不得引用既往记录`,
      })
    }
  } else {
    if (!evidence.recordId) {
      issues.push({
        ruleId: PFC_RULE_IDS.evidenceRecordUnresolvable,
        severity: 'blocking',
        subject,
        message: 'rerun 条目缺少统一证据 recordId；手写结论或脚本源文件路径不构成一次运行',
      })
    } else if (recordResolver) {
      const record = recordResolver(evidence.recordId)
      if (!record) {
        issues.push({
          ruleId: PFC_RULE_IDS.evidenceRecordUnresolvable,
          severity: 'blocking',
          subject,
          message: `recordId 无法解析到带命令、退出码与采集 HEAD 的 typed record：${evidence.recordId}`,
        })
      } else if (record.gateId !== evidence.gateId) {
        issues.push({
          ruleId: PFC_RULE_IDS.evidenceRecordUnresolvable,
          severity: 'blocking',
          subject,
          message: `recordId 指向门禁 ${record.gateId}，与账本门禁 ${evidence.gateId} 不一致`,
        })
      }
    }
    for (const [field, value] of [
      ['originalDate', evidence.originalDate],
      ['originalHead', evidence.originalHead],
      ['intervalChangeSummary', evidence.intervalChangeSummary],
    ] as const) {
      if (value !== undefined) {
        issues.push({
          ruleId: PFC_RULE_IDS.rerunCarriesProvenance,
          severity: 'blocking',
          subject,
          message: `rerun 条目不得携带 referenced 专属字段 "${field}"`,
        })
      }
    }
  }

  return issues
}

// =============================================================================
// 7. 内核可用声明判定（design D9：措辞由数据推导）
// =============================================================================

/** 声明判定结果。`wording` 是确定性字符串，供 manifest / 发布地图逐字引用。 */
export interface KernelClaimDecision {
  /** 是否允许「V3 plugin-first 内核可用」声明。 */
  allowed: boolean
  /** 供外部逐字引用的声明句（allowed=false 时为降级措辞）。 */
  wording: string
  /** 未满足 `done` 的准入卡（按 `KERNEL_CLAIM_CARD_IDS` 顺序）。 */
  unmetCards: { cardId: KernelClaimCardId; status: PluginFirstCardStatus; gap: string }[]
  /** W6 / W7 的实际状态（allowed=true 时也必须一并列出）。 */
  distributionCards: { cardId: PluginFirstCardId; status: PluginFirstCardStatus }[]
  issues: ClosureIssue[]
}

/** 允许声明时的固定措辞。 */
export const KERNEL_CLAIM_ALLOWED_WORDING =
  'V3 plugin-first 内核可用：W1–W5 全部满足完成三要件（承担 change 已归档、主规范齐备、退出门禁有可解析证据）。该声明不含组织私有分发可用，也不含 V3 GA。'

/** 拒绝声明时的降级措辞前缀。 */
export const KERNEL_CLAIM_REJECTED_WORDING_PREFIX =
  'V3 plugin-first 内核尚不可整体声明可用。已达成面：'

/**
 * 由账本卡片推导内核可用声明。
 *
 * 规则（spec：内核可用声明必须由验收账本准入且不足时必须降级措辞）：
 * - W1–W5 全部 `done` → 允许，措辞为 `KERNEL_CLAIM_ALLOWED_WORDING`，并列出 W6/W7 实际状态；
 * - 任一准入卡非 `done` → 拒绝，措辞按实际达成面表述并指名未满足卡与其缺口；
 * - 缺少某张准入卡的条目 → 按未满足处理（不得因条目缺失而默认通过）。
 */
export function evaluateKernelClaim(cards: readonly PluginFirstCardEntry[]): KernelClaimDecision {
  const issues: ClosureIssue[] = []
  const byId = new Map<string, PluginFirstCardEntry>()
  for (const card of cards) byId.set(card.cardId, card)

  const unmetCards: KernelClaimDecision['unmetCards'] = []
  const doneCards: KernelClaimCardId[] = []

  for (const cardId of KERNEL_CLAIM_CARD_IDS) {
    const card = byId.get(cardId)
    if (!card) {
      unmetCards.push({ cardId, status: 'candidate', gap: '账本中缺少该卡条目' })
      continue
    }
    if (card.status === 'done') {
      doneCards.push(cardId)
      continue
    }
    const gap =
      card.status === 'partial'
        ? (card.uncoveredBehaviors ?? []).join('；') || '未覆盖面未登记'
        : card.rationale || '未满足完成三要件'
    unmetCards.push({ cardId, status: card.status, gap })
  }

  const distributionCards: KernelClaimDecision['distributionCards'] = []
  for (const cardId of ['W6', 'W7'] as const) {
    const card = byId.get(cardId)
    distributionCards.push({ cardId, status: card?.status ?? 'candidate' })
  }

  const allowed = unmetCards.length === 0

  let wording: string
  if (allowed) {
    wording = `${KERNEL_CLAIM_ALLOWED_WORDING} W6=${distributionCards[0]?.status}，W7=${distributionCards[1]?.status}。`
  } else {
    const achieved = doneCards.join('、') || '（无）'
    const gaps = unmetCards
      .map((entry) => `${entry.cardId}(${entry.status})：${entry.gap}`)
      .join('；')
    wording = `${KERNEL_CLAIM_REJECTED_WORDING_PREFIX}${achieved} 已满足完成三要件。未满足：${gaps}。因此不得声明内核整体可用，也不得声明组织私有分发可用或 V3 GA。`
    issues.push({
      ruleId: PFC_RULE_IDS.kernelClaimRejected,
      severity: 'blocking',
      subject: 'kernel-claim',
      message: `内核可用声明不成立：${unmetCards.length} 张准入卡未满足（${unmetCards.map((e) => e.cardId).join('、')}）`,
    })
  }

  return { allowed, wording, unmetCards, distributionCards, issues: sortClosureIssues(issues) }
}

/**
 * 声明越级检测：即使内核可用声明成立，也不得被表述为私有分发可用或 V3 GA 已达成。
 * spec Scenario「声明范围被越级扩大」。
 */
export function detectClaimScopeEscalation(
  decision: KernelClaimDecision,
  publishedWording: string,
): ClosureIssue[] {
  const issues: ClosureIssue[] = []
  const escalations: { probe: RegExp; label: string }[] = [
    {
      probe: /组织私有分发可用|私有分发已可用|private distribution (is )?available/i,
      label: '组织私有分发可用',
    },
    { probe: /v3\s*ga\s*(已达成|已完成|达成|ready)/i, label: 'V3 GA 已达成' },
  ]
  for (const { probe, label } of escalations) {
    if (assertsAnySentence(publishedWording, probe)) {
      issues.push({
        ruleId: PFC_RULE_IDS.claimScopeEscalated,
        severity: 'blocking',
        subject: 'kernel-claim',
        message: `声明被越级扩大为「${label}」；内核可用声明不涵盖该范围`,
      })
    }
  }
  if (
    !decision.allowed &&
    assertsAnySentence(publishedWording, /内核可用|kernel (is )?available/i)
  ) {
    issues.push({
      ruleId: PFC_RULE_IDS.claimScopeEscalated,
      severity: 'blocking',
      subject: 'kernel-claim',
      message: '判定结果为拒绝，但发布措辞仍表述为内核可用',
    })
  }
  return sortClosureIssues(issues)
}

/** 句子级否定标记（与 `security:gate` / `check:v3-v25-compat` 的否定豁免同纪律）。 */
const NEGATION_MARKERS =
  /不得|不能|不可|不会|不再|不涵盖|不构成|不等于|不应|未获|尚未|禁止|无权|MUST NOT|SHALL NOT|may not|cannot|not\s+(be\s+)?(claimed|available|achieved)/i

/**
 * 句子级断言检测：只有当**肯定句**命中 probe 时才算作一次声明。
 *
 * 「不得声明组织私有分发可用」与「组织私有分发可用」在正则层面无法区分，
 * 因此按句切分后跳过含否定标记的句子——否则合规的降级措辞会被自己的检测器判为违规。
 * 这不是豁免：肯定句中的同一表述仍被拦截。
 */
function assertsAnySentence(text: string, probe: RegExp): boolean {
  const sentences = text.split(/[。；;.\n]+/)
  return sentences.some((sentence) => probe.test(sentence) && !NEGATION_MARKERS.test(sentence))
}

/**
 * manifest 记录的声明与账本计算值一致性校验。
 * spec（`v3-uat-release-stabilization`）Scenario「Claim decision disagrees with the ledger」。
 */
export function compareRecordedClaim(
  computed: KernelClaimDecision,
  recorded: KernelClaimDecision | undefined,
): ClosureIssue[] {
  if (!recorded) {
    return [
      {
        ruleId: PFC_RULE_IDS.recordedClaimMismatch,
        severity: 'blocking',
        subject: 'kernel-claim',
        message: '账本未记录声明判定结果，无法与计算值比对',
      },
    ]
  }
  const issues: ClosureIssue[] = []
  if (recorded.allowed !== computed.allowed) {
    issues.push({
      ruleId: PFC_RULE_IDS.recordedClaimMismatch,
      severity: 'blocking',
      subject: 'kernel-claim',
      message: `记录的声明准入 (${recorded.allowed}) 与账本计算值 (${computed.allowed}) 不一致`,
    })
  }
  if (recorded.wording !== computed.wording) {
    issues.push({
      ruleId: PFC_RULE_IDS.recordedClaimMismatch,
      severity: 'blocking',
      subject: 'kernel-claim',
      message: '记录的声明措辞与账本计算值不一致；措辞必须逐字取自账本',
    })
  }
  return sortClosureIssues(issues)
}

// =============================================================================
// 8. 地图外能力登记校验
// =============================================================================

/**
 * 地图外能力校验：
 * - 登记条目的 change 目录与主规范必须可解析；
 * - 地图外 capability 的主规范 MUST NOT 出现在任一 W 卡的 `mainSpecRefs` 中
 *   （spec Scenario「地图外能力被用于凑齐 W 卡」）。
 */
export function validateOffMapRegistry(
  ledger: PluginFirstClosureLedger,
  resolver: ClosurePathResolver,
): ClosureIssue[] {
  const issues: ClosureIssue[] = []
  const cardSpecRefs = new Set<string>()
  for (const card of ledger.cards) {
    for (const ref of card.mainSpecRefs) cardSpecRefs.add(ref)
  }

  for (const entry of ledger.offMapCapabilities) {
    if (!resolver(entry.archivedChangeRef)) {
      issues.push({
        ruleId: PFC_RULE_IDS.unresolvableReference,
        severity: 'blocking',
        subject: entry.capability,
        message: `地图外能力的归档 change 目录无法解析：${entry.archivedChangeRef}`,
      })
    }
    if (!resolver(entry.mainSpecRef)) {
      issues.push({
        ruleId: PFC_RULE_IDS.unresolvableReference,
        severity: 'blocking',
        subject: entry.capability,
        message: `地图外能力的主规范无法解析：${entry.mainSpecRef}`,
      })
    }
    if (cardSpecRefs.has(entry.mainSpecRef)) {
      issues.push({
        ruleId: PFC_RULE_IDS.offMapUsedForCard,
        severity: 'blocking',
        subject: entry.capability,
        message: `地图外能力的主规范同时被 W 卡引用（${entry.mainSpecRef}）；纳入 W 卡须先经显式修改发布地图的 change`,
      })
    }
  }
  return sortClosureIssues(issues)
}

/**
 * 已归档插件线能力是否已被覆盖：既不在任一 W 卡的 `mainSpecRefs` 中，也不在地图外清单中
 * → `PFC-OFFMAP-001`（spec：不得因未登记而在验收结论中消失）。
 */
export function detectUnregisteredCapabilities(
  ledger: PluginFirstClosureLedger,
  archivedPluginCapabilities: readonly { capability: string; mainSpecRef: string }[],
): ClosureIssue[] {
  const known = new Set<string>()
  for (const card of ledger.cards) for (const ref of card.mainSpecRefs) known.add(ref)
  for (const entry of ledger.offMapCapabilities) known.add(entry.mainSpecRef)

  const issues: ClosureIssue[] = []
  for (const candidate of archivedPluginCapabilities) {
    if (!known.has(candidate.mainSpecRef)) {
      issues.push({
        ruleId: PFC_RULE_IDS.offMapUnregistered,
        severity: 'blocking',
        subject: candidate.capability,
        message: `已归档插件线能力既未映射到 W 卡也未登记为地图外能力：${candidate.mainSpecRef}`,
      })
    }
  }
  return sortClosureIssues(issues)
}

// =============================================================================
// 9. 归档同步报告判定
// =============================================================================

export interface ArchiveSyncEvaluation {
  /** 主规范缺失且无有效 supersession 的 capability。 */
  unresolvedGaps: ArchiveSyncEntry[]
  /** 已由有效 supersession 承接的 capability。 */
  supersededCapabilities: SupersessionDeclaration[]
  /** 增量只删不增、对主规范净贡献为零的 capability（可见但不判缺口）。 */
  noContributionCapabilities: ArchiveSyncEntry[]
  issues: ClosureIssue[]
  /** 无 blocking issue 即同步。 */
  synchronized: boolean
}

/**
 * 判定归档→主规范同步状态。
 *
 * - capability 有主规范 → 通过；
 * - 无主规范但有 supersession 且承接主规范存在 → 通过并记录承接者；
 * - supersession 指向不存在的主规范 → `PFC-SYNC-002`（视为无效声明，不是豁免）；
 * - 既无主规范又无 supersession → `PFC-SYNC-001`。
 */
export function evaluateArchiveSync(
  report: ArchiveSyncReport,
  resolver: ClosurePathResolver,
): ArchiveSyncEvaluation {
  const issues: ClosureIssue[] = []
  const supersessionByCapability = new Map<string, SupersessionDeclaration>()
  for (const declaration of report.supersessions) {
    supersessionByCapability.set(declaration.capability, declaration)
  }

  const unresolvedGaps: ArchiveSyncEntry[] = []
  const supersededCapabilities: SupersessionDeclaration[] = []
  const noContributionCapabilities: ArchiveSyncEntry[] = []

  for (const entry of report.entries) {
    if (entry.mainSpecPath && resolver(entry.mainSpecPath)) continue

    // 只删不增的增量对主规范净贡献为零：不产出主规范是正确终态，不是缺口。
    if (entry.contributesRequirements === false) {
      noContributionCapabilities.push(entry)
      continue
    }

    const declaration = supersessionByCapability.get(entry.capability)
    if (!declaration) {
      unresolvedGaps.push(entry)
      issues.push({
        ruleId: PFC_RULE_IDS.archiveMergeGap,
        severity: 'blocking',
        subject: entry.capability,
        message: `归档增量 spec 未合并进主规范，且无 supersession 声明；来源：${entry.sourceArchiveDir}`,
      })
      continue
    }

    const successorPath = `openspec/specs/${declaration.supersededBy}/spec.md`
    if (!resolver(successorPath)) {
      unresolvedGaps.push(entry)
      issues.push({
        ruleId: PFC_RULE_IDS.supersessionUnresolvable,
        severity: 'blocking',
        subject: entry.capability,
        message: `supersession 指向的主规范不存在：${successorPath}；该声明无效，不作为豁免`,
      })
      continue
    }
    supersededCapabilities.push(declaration)
  }

  // 声明了 supersession 但 capability 不在归档报告里 → 悬空声明，按无法解析处理。
  const reportedCapabilities = new Set(report.entries.map((e) => e.capability))
  for (const declaration of report.supersessions) {
    if (!reportedCapabilities.has(declaration.capability)) {
      issues.push({
        ruleId: PFC_RULE_IDS.supersessionUnresolvable,
        severity: 'blocking',
        subject: declaration.capability,
        message: 'supersession 声明的 capability 不存在于归档增量 spec 清单中',
      })
    }
  }

  const sorted = sortClosureIssues(issues)
  return {
    unresolvedGaps,
    supersededCapabilities,
    noContributionCapabilities,
    issues: sorted,
    synchronized: sorted.every((issue) => issue.severity !== 'blocking'),
  }
}

// =============================================================================
// 10. 低敏纪律（spec：验收过程必须低敏）
// =============================================================================

/** 低敏化一段账本摘要（值级 redaction + 超长截断）。返回文本可安全写入仓库。 */
export function sanitizeClosureSummary(text: string, maxBytes = 16 * 1024): string {
  return redactSensitiveText(text, maxBytes).text
}

/** 逐值低敏扫描：文本是否命中敏感模式。 */
export function closureTextIsLowSensitive(text: string): boolean {
  return !containsSensitiveContent(text)
}

/** 收集账本中所有自由文本字段（供二次扫描）。 */
export function collectClosureFreeText(ledger: PluginFirstClosureLedger): string[] {
  const texts: string[] = []
  for (const card of ledger.cards) {
    texts.push(card.title, card.rationale)
    texts.push(...(card.coveredBehaviors ?? []))
    texts.push(...(card.uncoveredBehaviors ?? []))
    for (const evidence of card.gateEvidence) {
      texts.push(evidence.resultSummary, evidence.ref)
      if (evidence.intervalChangeSummary) texts.push(evidence.intervalChangeSummary)
    }
  }
  for (const entry of ledger.offMapCapabilities) {
    texts.push(entry.capability, entry.surface)
  }
  for (const declaration of ledger.archiveSync.supersessions) {
    texts.push(declaration.rationale)
  }
  if (ledger.recordedClaim) texts.push(ledger.recordedClaim.wording)
  return texts
}

/**
 * 账本低敏二次扫描：任一自由文本命中敏感模式即产出 `PFC-SEC-001`。
 * 只报告命中位置与命中数，绝不回显命中内容本身。
 */
export function scanLedgerLowSensitive(ledger: PluginFirstClosureLedger): ClosureIssue[] {
  const issues: ClosureIssue[] = []
  for (const text of collectClosureFreeText(ledger)) {
    const hits = countSensitiveHits(text)
    if (hits > 0) {
      issues.push({
        ruleId: PFC_RULE_IDS.sensitiveContent,
        severity: 'blocking',
        subject: ledger.ledgerId,
        message: `账本自由文本命中低敏扫描 ${hits} 次；账本只允许保存路径、change 标识、状态、计数与确定性哈希`,
      })
    }
  }
  return sortClosureIssues(issues)
}

// =============================================================================
// 11. 账本整体校验
// =============================================================================

export interface ClosureLedgerEvaluation {
  ledgerId: string
  cardEvaluations: CardCompletionEvaluation[]
  claim: KernelClaimDecision
  archiveSync: ArchiveSyncEvaluation
  issues: ClosureIssue[]
  blockingCount: number
  warningCount: number
  /** 无 blocking 即账本自洽（不等于内核可用声明成立）。 */
  consistent: boolean
}

/**
 * 账本整体校验：卡片三要件 + 声明判定 + 地图外登记 + 归档同步 + 低敏扫描。
 *
 * 注意：`consistent=true` 只表示账本自洽（引用可解析、状态与要件相符、低敏合规），
 * **不**表示内核可用声明成立——后者由 `claim.allowed` 单独表达。
 */
export function evaluateClosureLedger(
  ledger: PluginFirstClosureLedger,
  resolver: ClosurePathResolver,
  recordResolver?: ClosureEvidenceRecordResolver,
): ClosureLedgerEvaluation {
  const cardEvaluations = ledger.cards.map((card) =>
    evaluateCardCompletion(card, resolver, recordResolver),
  )
  const claim = evaluateKernelClaim(ledger.cards)
  const archiveSync = evaluateArchiveSync(ledger.archiveSync, resolver)

  const issues: ClosureIssue[] = [
    ...cardEvaluations.flatMap((evaluation) => evaluation.issues),
    ...validateOffMapRegistry(ledger, resolver),
    ...archiveSync.issues,
    ...scanLedgerLowSensitive(ledger),
  ]
  if (ledger.recordedClaim) {
    issues.push(...compareRecordedClaim(claim, ledger.recordedClaim))
  }

  // 声明拒绝本身不是账本缺陷——它是设计内的正常输出（design D2/风险节），因此不计入 consistent 判定。
  // 而「记录的声明与计算值不一致」(PFC-CLAIM-003) 是真缺陷，保留在 issues 中。
  const sorted = sortClosureIssues(
    issues.filter((issue) => issue.ruleId !== PFC_RULE_IDS.kernelClaimRejected),
  )
  const blockingCount = sorted.filter((issue) => issue.severity === 'blocking').length
  const warningCount = sorted.filter((issue) => issue.severity === 'warning').length

  return {
    ledgerId: ledger.ledgerId,
    cardEvaluations,
    claim,
    archiveSync,
    issues: sorted,
    blockingCount,
    warningCount,
    consistent: blockingCount === 0,
  }
}
