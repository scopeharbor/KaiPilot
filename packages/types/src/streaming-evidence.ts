/**
 * streaming-evidence —— Streaming 发布证据门禁类型（V2.5 W7）。
 *
 * 定义场景目录、证据 manifest 和验证器的共享类型。
 * 零运行时依赖。
 */

// ── 场景目录 ───────────────────────────────────────────────────

export type StreamingEvidenceDomain = 'ai-draft' | 'compiler'
export type StreamingEvidenceLevel = 'contract' | 'integration' | 'browser'
export type StreamingEvidenceBrowser = 'chromium' | 'firefox' | 'webkit'

export interface StreamingScenario {
  id: string
  domain: StreamingEvidenceDomain
  level: StreamingEvidenceLevel
  title: string
  fixtureRef: string
  requiredBrowsers: StreamingEvidenceBrowser[]
  assertion: string
  attachmentStrategy: 'none' | 'screenshot' | 'trace' | 'both'
}

export interface StreamingScenarioCatalog {
  version: string
  scenarios: StreamingScenario[]
  hash: string
}

// ── 领域 Adapter 接口 ──────────────────────────────────────────

export interface StreamingEvidenceAdapter {
  domain: StreamingEvidenceDomain
  /** 为给定场景准备 fixture 数据。 */
  prepareScenario(scenarioId: string): Promise<unknown>
  /** 运行场景并返回断言结果。 */
  runScenario(scenarioId: string, fixture: unknown): Promise<ScenarioResult>
  /** 获取当前支持的契约版本。 */
  supportedContractVersion(): string
}

export interface ScenarioResult {
  passed: boolean
  errors: string[]
  screenshots: string[]
  durationMs: number
}

// ── Evidence Manifest ──────────────────────────────────────────

export interface EvidenceManifest {
  manifestVersion: '1.0'
  /** 本次运行的 Git commit。 */
  commit: string
  /** 工作树是否有未提交改动。 */
  dirtyState: boolean
  /** 运行环境。 */
  environment: {
    nodeVersion: string
    os: string
    timestamp: string
  }
  /** 契约目录 hash。 */
  contractHash: string
  /** 场景目录 hash。 */
  catalogHash: string
  /** 运行结果。 */
  result: 'passed' | 'failed' | 'partial'
  /** 各场景结果。 */
  scenarios: ManifestScenarioEntry[]
  /** 附件索引。 */
  attachments: ManifestAttachment[]
  /** 重跑记录。 */
  attempts: ManifestAttempt[]
}

export interface ManifestScenarioEntry {
  scenarioId: string
  domain: StreamingEvidenceDomain
  browser: StreamingEvidenceBrowser
  passed: boolean
  errorSummary: string | null
  durationMs: number
  attachmentRefs: string[]
}

export interface ManifestAttachment {
  ref: string
  path: string
  hash: string
  type: 'screenshot' | 'trace' | 'log'
  sizeBytes: number
}

export interface ManifestAttempt {
  attempt: number
  timestamp: string
  scenarioId: string
  passed: boolean
  errorSummary: string | null
}

// ── Quarantine ─────────────────────────────────────────────────

export interface QuarantineEntry {
  scenarioId: string
  owner: string
  reason: string
  defectRef: string
  expiry: string | null
}

// ── Manifest Validator ─────────────────────────────────────────

export type EvidenceManifestValidationResult = { valid: true } | { valid: false; errors: string[] }

export function validateEvidenceManifest(
  manifest: EvidenceManifest,
  expectedCommit: string,
  expectedCatalogHash: string,
  requiredScenarioIds: string[],
): EvidenceManifestValidationResult {
  const errors: string[] = []

  // 检查 commit 匹配
  if (manifest.commit !== expectedCommit) {
    errors.push(`commit 不匹配: expected ${expectedCommit}, got ${manifest.commit}`)
  }

  // 检查 catalog hash
  if (manifest.catalogHash !== expectedCatalogHash) {
    errors.push(`Catalog hash 不匹配: expected ${expectedCatalogHash}, got ${manifest.catalogHash}`)
  }

  // 检查必需场景
  for (const requiredId of requiredScenarioIds) {
    const found = manifest.scenarios.some((s) => s.scenarioId === requiredId)
    if (!found) {
      errors.push(`必需场景缺失: ${requiredId}`)
    }
  }

  // 检查附件 hash
  for (const att of manifest.attachments) {
    if (!att.hash || att.hash.length < 8) {
      errors.push(`附件 hash 无效: ${att.ref}`)
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

// ── Shared Assertions ──────────────────────────────────────────

export interface SharedAssertionInput {
  eventIds: string[]
  sequences: number[]
  eventTypes: string[]
  terminalReached: boolean
  heartbeats: number
  fsmStates: string[]
}

/**
 * 公共断言：验证 eventId 无重复。
 */
export function assertNoDuplicateEventIds(eventIds: string[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const id of eventIds) {
    if (seen.has(id)) errors.push(`重复 eventId: ${id}`)
    seen.add(id)
  }
  return errors
}

/**
 * 公共断言：验证 sequence 严格单调递增。
 */
export function assertMonotonicSequence(sequences: number[]): string[] {
  const errors: string[] = []
  for (let i = 1; i < sequences.length; i++) {
    const curr = sequences[i]!
    const prev = sequences[i - 1]!
    if (curr <= prev) {
      errors.push(`非单调 sequence: ${curr} <= ${prev}`)
    }
  }
  return errors
}

/**
 * 公共断言：终态后只能有 heartbeat。
 */
export function assertNoEventsAfterTerminal(
  eventTypes: string[],
  terminalTypes: string[],
): string[] {
  const errors: string[] = []
  const terminalIndex = eventTypes.findIndex((t) => terminalTypes.includes(t))
  if (terminalIndex >= 0) {
    for (let i = terminalIndex + 1; i < eventTypes.length; i++) {
      if (eventTypes[i] !== 'heartbeat') {
        errors.push(`终态后非 heartbeat 事件: ${eventTypes[i]} at index ${i}`)
      }
    }
  }
  return errors
}

/**
 * 公共断言：验证唯一终态。
 */
export function assertUniqueTerminal(eventTypes: string[], terminalTypes: string[]): string[] {
  const terminals = eventTypes.filter((t) => terminalTypes.includes(t))
  if (terminals.length > 1) {
    return [`多个终态: ${terminals.join(', ')}`]
  }
  return []
}

/**
 * 公共断言：heartbeat 不包含语义 payload。
 */
export function assertHeartbeatPayload(payloads: Record<string, unknown>[]): string[] {
  const errors: string[] = []
  const semanticKeys = ['progressPercent', 'stageProgress', 'errorCode']
  for (const pl of payloads) {
    for (const key of semanticKeys) {
      if (key in pl) {
        errors.push(`heartbeat 包含语义字段: ${key}`)
      }
    }
  }
  return errors
}
