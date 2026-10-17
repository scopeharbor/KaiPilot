/**
 * V3 发布信任与证据中心共享契约。
 *
 * 本模块只归一化跨门禁证据与裁决，不复制任何门禁的判据、阈值或词表。
 * 证据正文不入束，只保存可复跑 provenance、低敏摘要与输出摘要哈希。
 */

import { DETERMINISTIC_RERUN_GATES } from './v3-plugin-first-platform-closure.js'

export const RELEASE_TRUST_EVIDENCE_MODES = ['rerun', 'referenced'] as const
export type ReleaseTrustEvidenceMode = (typeof RELEASE_TRUST_EVIDENCE_MODES)[number]

export const RELEASE_TRUST_GATE_KINDS = ['deterministic-fast', 'long-running'] as const
export type ReleaseTrustGateKind = (typeof RELEASE_TRUST_GATE_KINDS)[number]

export const RELEASE_TRUST_SUMMARY_SOURCES = ['json', 'process'] as const
export type ReleaseTrustSummarySource = (typeof RELEASE_TRUST_SUMMARY_SOURCES)[number]

export const TRUST_DECISIONS = ['releasable', 'blocked', 'stale', 'insufficient-evidence'] as const
export type TrustDecision = (typeof TRUST_DECISIONS)[number]

export const TRUST_DECISION_WORDING: Readonly<Record<TrustDecision, string>> = {
  releasable: '全部已注册门禁均有当前 HEAD 上的有效证据，且没有阻断项。',
  blocked: '至少一个已注册门禁存在阻断级结果，当前不得放行。',
  stale: '全部门禁均有证据且没有阻断项，但至少一条证据采集自旧 HEAD。',
  'insufficient-evidence': '至少一个已注册门禁缺少有效证据，当前证据不足以作出放行裁决。',
}

export type ReleaseTrustSummarySelector = Readonly<{
  source: ReleaseTrustSummarySource
  /** JSON dotted paths；process 来源只允许 `exitCode`。 */
  fields: readonly string[]
}>

export interface ReleaseTrustGateRegistryEntry {
  gateId: string
  /** 可直接交给本机进程执行器的 argv；首项必须是 `pnpm`。 */
  command: readonly string[]
  kind: ReleaseTrustGateKind
  summarySelector: ReleaseTrustSummarySelector
}

interface ReleaseTrustEvidenceRecordBase {
  recordId: string
  gateId: string
  command: string
  exitCode: number
  startedAt: string
  finishedAt: string
  collectedHead: string
  outputDigest: string
  /** 必须由采集器按 registry selector 派生，调用方没有自由文本写入口。 */
  resultSummary: string
}

export interface ReleaseTrustRerunEvidenceRecord extends ReleaseTrustEvidenceRecordBase {
  mode: 'rerun'
  originalDate?: never
  originalHead?: never
  intervalChangeSummary?: never
}

export interface ReleaseTrustReferencedEvidenceRecord extends ReleaseTrustEvidenceRecordBase {
  mode: 'referenced'
  originalDate: string
  originalHead: string
  intervalChangeSummary: string
}

export type ReleaseTrustEvidenceRecord =
  ReleaseTrustRerunEvidenceRecord | ReleaseTrustReferencedEvidenceRecord

export interface ReleaseTrustEvidenceBundle {
  bundleId: string
  collectedHead: string
  capturedAt: string
  records: readonly ReleaseTrustEvidenceRecord[]
}

export type ReleaseTrustFindingSeverity = 'blocking' | 'warning'

export interface ReleaseTrustFinding {
  code: string
  severity: ReleaseTrustFindingSeverity
  gateId?: string
  field?: string
  message: string
}

export interface ReleaseTrustDriftEntry {
  gateId: string
  recordId: string
  collectedHead: string
  currentHead: string
  severity: ReleaseTrustFindingSeverity
  intervalChangeSummary: string
}

export interface ReleaseTrustEvaluation {
  decision: TrustDecision
  wording: string
  blockedGateIds: readonly string[]
  missingGateIds: readonly string[]
  staleGateIds: readonly string[]
  findings: readonly ReleaseTrustFinding[]
}

const processSelector = (): ReleaseTrustSummarySelector => ({
  source: 'process',
  fields: ['exitCode'],
})

const jsonSelector = (...fields: string[]): ReleaseTrustSummarySelector => ({
  source: 'json',
  fields,
})

const seededRegistry: readonly ReleaseTrustGateRegistryEntry[] = [
  {
    gateId: 'openspec-strict-validate',
    command: [
      'pnpm',
      'exec',
      'openspec-cn',
      'validate',
      'v3-release-trust-and-evidence-center',
      '--strict',
    ],
    kind: 'deterministic-fast',
    summarySelector: processSelector(),
  },
  {
    gateId: 'openspec-validate-specs',
    command: ['pnpm', 'exec', 'openspec-cn', 'validate', '--specs'],
    kind: 'deterministic-fast',
    summarySelector: processSelector(),
  },
  {
    gateId: 'typecheck',
    command: ['pnpm', 'typecheck'],
    kind: 'long-running',
    summarySelector: processSelector(),
  },
  {
    gateId: 'build',
    command: ['pnpm', 'build'],
    kind: 'long-running',
    summarySelector: processSelector(),
  },
  {
    gateId: 'types-vitest',
    command: ['pnpm', '--filter', '@aiproj/types', 'test'],
    kind: 'long-running',
    summarySelector: processSelector(),
  },
  {
    gateId: 'frontend-vitest',
    command: ['pnpm', '--filter', '@aiproj/frontend', 'test'],
    kind: 'long-running',
    summarySelector: processSelector(),
  },
  {
    gateId: 'security-gate',
    command: [
      'pnpm',
      'exec',
      'tsx',
      'scripts/security-penetration-gate.ts',
      '--change',
      'v3-release-trust-and-evidence-center',
      '--json',
    ],
    kind: 'long-running',
    summarySelector: jsonSelector('status', 'findings.length', 'degraded'),
  },
  {
    gateId: 'performance-gates',
    command: ['pnpm', 'exec', 'tsx', 'scripts/performance-scale-gates.ts', '--json'],
    kind: 'long-running',
    summarySelector: jsonSelector('status', 'gates.length', 'metricSummaries.length'),
  },
  {
    gateId: 'v3-v25-compat',
    command: [
      'pnpm',
      'exec',
      'tsx',
      'scripts/check-v3-v25-compatibility.ts',
      '--change',
      'openspec/changes/v3-release-trust-and-evidence-center',
      '--format',
      'json',
    ],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('ok', 'blockingCount', 'warningCount'),
  },
  {
    gateId: 'v3-uat-stabilization',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-v3-uat-stabilization.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('status', 'blockingCount', 'warningCount'),
  },
  {
    gateId: 'archive-spec-sync',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-archive-spec-sync.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('status', 'gapCount'),
  },
  {
    gateId: 'plugin-capability-seams',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-plugin-capability-seams.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('status', 'entryCount', 'findings.length'),
  },
  {
    gateId: 'plugin-manifest',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-plugin-manifest.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('blockingCount', 'warningCount', 'invalidCount'),
  },
  {
    gateId: 'plugin-compatibility',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-plugin-compatibility-matrix.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('verdict', 'reasonCodes.length'),
  },
  {
    gateId: 'plugin-private-registry',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-plugin-private-registry.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('summary.blocking', 'summary.warning', 'summary.total'),
  },
  {
    gateId: 'connector-definitions',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-connector-definitions.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('blockingCount', 'warningCount', 'invalidCount'),
  },
] as const

const seedIds = new Set<string>(DETERMINISTIC_RERUN_GATES)
if (seededRegistry.length !== DETERMINISTIC_RERUN_GATES.length) {
  throw new Error('release trust registry seed count drifted from DETERMINISTIC_RERUN_GATES')
}
for (const entry of seededRegistry) {
  if (!seedIds.has(entry.gateId)) {
    throw new Error(`release trust registry contains unknown deterministic seed: ${entry.gateId}`)
  }
}

export const RELEASE_TRUST_GATE_REGISTRY: readonly ReleaseTrustGateRegistryEntry[] = [
  ...seededRegistry,
  {
    gateId: 'ai-quality-slots',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-ai-quality-slots.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('status', 'blockingCount', 'pendingCount'),
  },
  {
    gateId: 'plugin-first-closure',
    command: ['pnpm', 'exec', 'tsx', 'scripts/check-plugin-first-closure.ts', '--json'],
    kind: 'deterministic-fast',
    summarySelector: jsonSelector('status', 'blockingCount', 'headMatches'),
  },
] as const

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/
const PASSING_SUMMARY =
  /(?:^|[;\s])(status=(?:passed|ready|synchronized)|ok=true|verdict=compatible|exitCode=0)(?:$|[;\s])/i

export function isTrustDecision(value: unknown): value is TrustDecision {
  return typeof value === 'string' && (TRUST_DECISIONS as readonly string[]).includes(value)
}

function requiredText(
  value: unknown,
  field: string,
  record: Pick<ReleaseTrustEvidenceRecord, 'gateId'>,
): ReleaseTrustFinding[] {
  return typeof value === 'string' && value.trim().length > 0
    ? []
    : [
        {
          code: 'RTR-PROVENANCE-001',
          severity: 'blocking',
          gateId: record.gateId,
          field,
          message: `证据记录缺少必填 provenance 字段 ${field}`,
        },
      ]
}

export function validateEvidenceRecord(record: ReleaseTrustEvidenceRecord): ReleaseTrustFinding[] {
  const findings: ReleaseTrustFinding[] = []
  for (const [field, value] of [
    ['recordId', record.recordId],
    ['gateId', record.gateId],
    ['command', record.command],
    ['startedAt', record.startedAt],
    ['finishedAt', record.finishedAt],
    ['collectedHead', record.collectedHead],
    ['outputDigest', record.outputDigest],
    ['resultSummary', record.resultSummary],
  ] as const) {
    findings.push(...requiredText(value, field, record))
  }
  if (!Number.isInteger(record.exitCode) || record.exitCode < 0) {
    findings.push({
      code: 'RTR-PROVENANCE-001',
      severity: 'blocking',
      gateId: record.gateId,
      field: 'exitCode',
      message: '证据记录缺少有效的非负整数退出码',
    })
  }
  for (const field of ['startedAt', 'finishedAt'] as const) {
    if (record[field] && !ISO_TIMESTAMP.test(record[field])) {
      findings.push({
        code: 'RTR-PROVENANCE-002',
        severity: 'blocking',
        gateId: record.gateId,
        field,
        message: `${field} 必须为 UTC ISO-8601 时间戳`,
      })
    }
  }
  if (ISO_TIMESTAMP.test(record.startedAt) && ISO_TIMESTAMP.test(record.finishedAt)) {
    if (Date.parse(record.finishedAt) < Date.parse(record.startedAt)) {
      findings.push({
        code: 'RTR-PROVENANCE-003',
        severity: 'blocking',
        gateId: record.gateId,
        field: 'finishedAt',
        message: 'finishedAt 不得早于 startedAt',
      })
    }
  }
  if (record.outputDigest && !SHA256_DIGEST.test(record.outputDigest)) {
    findings.push({
      code: 'RTR-PROVENANCE-004',
      severity: 'blocking',
      gateId: record.gateId,
      field: 'outputDigest',
      message: 'outputDigest 必须为 sha256:<64 hex>',
    })
  }
  if (record.exitCode !== 0 && PASSING_SUMMARY.test(record.resultSummary)) {
    findings.push({
      code: 'RTR-OUTCOME-001',
      severity: 'blocking',
      gateId: record.gateId,
      field: 'resultSummary',
      message: `退出码 ${record.exitCode} 与通过型结论摘要矛盾`,
    })
  }
  if (record.mode === 'referenced') {
    for (const [field, value] of [
      ['originalDate', record.originalDate],
      ['originalHead', record.originalHead],
      ['intervalChangeSummary', record.intervalChangeSummary],
    ] as const) {
      findings.push(...requiredText(value, field, record))
    }
  } else {
    const raw = record as ReleaseTrustEvidenceRecord & Record<string, unknown>
    for (const field of ['originalDate', 'originalHead', 'intervalChangeSummary'] as const) {
      if (raw[field] !== undefined) {
        findings.push({
          code: 'RTR-PROVENANCE-005',
          severity: 'blocking',
          gateId: record.gateId,
          field,
          message: `rerun 记录不得携带 referenced 专属字段 ${field}`,
        })
      }
    }
  }
  return findings
}

export function detectHeadDrift(
  records: readonly ReleaseTrustEvidenceRecord[],
  currentHead: string,
  registry: readonly ReleaseTrustGateRegistryEntry[] = RELEASE_TRUST_GATE_REGISTRY,
): ReleaseTrustDriftEntry[] {
  const byGate = new Map(registry.map((entry) => [entry.gateId, entry]))
  return records
    .filter((record) => record.collectedHead !== currentHead)
    .map((record) => {
      const entry = byGate.get(record.gateId)
      const deterministicRerun =
        entry !== undefined &&
        (DETERMINISTIC_RERUN_GATES as readonly string[]).includes(record.gateId) &&
        record.mode === 'rerun'
      const severity: ReleaseTrustFindingSeverity = deterministicRerun ? 'blocking' : 'warning'
      return {
        gateId: record.gateId,
        recordId: record.recordId,
        collectedHead: record.collectedHead,
        currentHead,
        severity,
        intervalChangeSummary:
          record.mode === 'referenced'
            ? record.intervalChangeSummary
            : `证据采集 HEAD ${record.collectedHead} 落后于当前 HEAD ${currentHead}`,
      }
    })
    .sort((a, b) => a.gateId.localeCompare(b.gateId))
}

export function evaluateReleaseTrust(
  bundle: ReleaseTrustEvidenceBundle,
  currentHead: string,
  registry: readonly ReleaseTrustGateRegistryEntry[] = RELEASE_TRUST_GATE_REGISTRY,
): ReleaseTrustEvaluation {
  const findings = bundle.records.flatMap(validateEvidenceRecord)
  const registryIds = new Set(registry.map((entry) => entry.gateId))
  const recordsByGate = new Map<string, ReleaseTrustEvidenceRecord>()
  for (const record of bundle.records) {
    if (!registryIds.has(record.gateId)) continue
    if (recordsByGate.has(record.gateId)) {
      findings.push({
        code: 'RTR-EVIDENCE-002',
        severity: 'blocking',
        gateId: record.gateId,
        message: '同一证据束内一个门禁只能有一条当前记录',
      })
    }
    recordsByGate.set(record.gateId, record)
  }
  const missingGateIds = registry
    .filter((entry) => !recordsByGate.has(entry.gateId))
    .map((entry) => entry.gateId)
    .sort()
  const drift = detectHeadDrift(bundle.records, currentHead, registry)
  findings.push(
    ...drift.map((entry) => ({
      code: entry.severity === 'blocking' ? 'RTR-HEAD-001' : 'RTR-HEAD-002',
      severity: entry.severity,
      gateId: entry.gateId,
      field: 'collectedHead',
      message: entry.intervalChangeSummary,
    })),
  )
  const blockedGateIds = Array.from(
    new Set([
      ...bundle.records.filter((record) => record.exitCode !== 0).map((record) => record.gateId),
      ...findings
        .filter((finding) => finding.severity === 'blocking' && finding.gateId)
        .map((finding) => finding.gateId as string),
    ]),
  ).sort()
  const staleGateIds = Array.from(new Set(drift.map((entry) => entry.gateId))).sort()

  let decision: TrustDecision
  if (blockedGateIds.length > 0) decision = 'blocked'
  else if (missingGateIds.length > 0) decision = 'insufficient-evidence'
  else if (staleGateIds.length > 0) decision = 'stale'
  else decision = 'releasable'

  return {
    decision,
    wording: TRUST_DECISION_WORDING[decision],
    blockedGateIds,
    missingGateIds,
    staleGateIds,
    findings: findings.sort((a, b) =>
      `${a.severity}:${a.gateId ?? ''}:${a.code}:${a.field ?? ''}`.localeCompare(
        `${b.severity}:${b.gateId ?? ''}:${b.code}:${b.field ?? ''}`,
      ),
    ),
  }
}

const decisionRank: Readonly<Record<TrustDecision, number>> = {
  blocked: 0,
  'insufficient-evidence': 1,
  stale: 2,
  releasable: 3,
}

export function compareRecordedDecision(
  recordedDecision: TrustDecision,
  evaluation: Pick<ReleaseTrustEvaluation, 'decision'>,
): ReleaseTrustFinding[] {
  if (decisionRank[recordedDecision] <= decisionRank[evaluation.decision]) return []
  return [
    {
      code: 'RTR-DECISION-001',
      severity: 'blocking',
      message: `记录裁决 ${recordedDecision} 高于复算结果 ${evaluation.decision}`,
    },
  ]
}

export type ReleaseTrustSensitiveFindingKind =
  'credential' | 'token' | 'secret' | 'prompt-content' | 'model-output' | 'oversized-summary'

export interface ReleaseTrustSensitiveFinding {
  path: string
  kind: ReleaseTrustSensitiveFindingKind
}

const forbiddenKeyPatterns: readonly [ReleaseTrustSensitiveFindingKind, RegExp][] = [
  ['credential', /credential|password|passwd|apikey|api_key/i],
  ['token', /authorization|bearer|access[_-]?token|refresh[_-]?token/i],
  ['secret', /(^|[_-])secret($|[_-])|private[_-]?key/i],
  ['prompt-content', /prompt(text|content)?|system[_-]?instructions?/i],
  ['model-output', /model[_-]?(output|completion)|completion[_-]?text/i],
]

export function scanEvidenceBundleLowSensitive(
  payload: unknown,
  path = '$',
  depth = 0,
): ReleaseTrustSensitiveFinding[] {
  if (depth > 12 || payload === null || payload === undefined) return []
  if (Array.isArray(payload)) {
    return payload.flatMap((value, index) =>
      scanEvidenceBundleLowSensitive(value, `${path}[${index}]`, depth + 1),
    )
  }
  if (typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>).flatMap(([key, value]) => {
      const childPath = `${path}.${key}`
      const keyFindings = forbiddenKeyPatterns
        .filter(([, pattern]) => pattern.test(key))
        .map(([kind]) => ({ path: childPath, kind }))
      return [...keyFindings, ...scanEvidenceBundleLowSensitive(value, childPath, depth + 1)]
    })
  }
  if (typeof payload !== 'string') return []

  const findings: ReleaseTrustSensitiveFinding[] = []
  if (/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i.test(payload)) {
    findings.push({ path, kind: 'token' })
  }
  if (/\b(?:sk|pk|api)[-_][A-Za-z0-9]{12,}\b/i.test(payload)) {
    findings.push({ path, kind: 'credential' })
  }
  if (/\b(?:password|secret|api[_-]?key)\s*[:=]\s*\S+/i.test(payload)) {
    findings.push({ path, kind: 'secret' })
  }
  if (path.endsWith('.resultSummary') && payload.length > 400) {
    findings.push({ path, kind: 'oversized-summary' })
  }
  return findings
}
