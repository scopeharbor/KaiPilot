import type { ContractVersion } from './contract-versioning.js'

export const AGENT_OBSERVATION_MANIFEST_CONTRACT_ID = 'agent-observation-manifest-v1' as const
export const AGENT_OBSERVATION_MANIFEST_VERSION = '1.0' as const satisfies ContractVersion

export const OBSERVATION_PRINCIPLE =
  'Do not give the Agent more data; give the Agent the facts, changes, rules, causes, and evidence most relevant to the current objective.' as const

export type ObservationIntent =
  | 'understand'
  | 'debug'
  | 'verify'
  | 'impact_analysis'
  | 'locate_code'
  | 'regression_analysis'
  | 'explain_change'

export type ObservationToolName =
  | 'observe_scope'
  | 'inspect_entity'
  | 'compare_snapshots'
  | 'trace_action'
  | 'check_invariants'
  | 'run_probe'
  | 'get_evidence'
  | 'locate_implementation'
  | 'analyze_impact'
  | 'verify_context'

export type ObservationScopeType =
  | 'repository'
  | 'openspec_change'
  | 'capability'
  | 'package'
  | 'file'
  | 'symbol'
  | 'route'
  | 'project'

export interface ObservationScope {
  type: ObservationScopeType
  id: string
  label?: string
  version?: string
}

export interface ObservationSubject {
  type: string
  id: string
  label?: string
}

export type ObservationFreshnessStatus = 'live' | 'recent' | 'stale' | 'unknown'
export type ObservationPacketStatus = 'healthy' | 'degraded' | 'blocked' | 'unknown'

export interface ObservationFreshness {
  stateVersion?: string
  graphVersion?: string
  codeCommit?: string
  generatedAt: string
  status: ObservationFreshnessStatus
  lagMs?: number
  notes?: string[]
}

export interface ObservationPacketSummary {
  headline: string
  facts: string[]
}

export interface ObservationCurrentState {
  scope: ObservationScope
  snapshotVersion?: number
  status: ObservationPacketStatus
  facts: Record<string, unknown>
  evidenceRefs: string[]
}

export type ObservationEvidenceSourceKind =
  | 'mcp_graph'
  | 'source_file'
  | 'openspec'
  | 'progress'
  | 'git'
  | 'test_result'
  | 'runtime_state'
  | 'cli'
  | 'artifact'
  | 'manual'

export type ObservationVerificationStatus =
  'verified' | 'needs_source_verification' | 'stale' | 'unverified'

export interface ObservationEvidenceRef {
  id: string
  sourceKind: ObservationEvidenceSourceKind
  title: string
  summary: string
  verified: boolean
  generatedAt: string
  tool?: 'search_graph' | 'trace_path' | 'get_code_snippet' | 'get_architecture' | 'query_graph'
  graphProject?: string
  query?: string
  qualifiedName?: string
  filePath?: string
  startLine?: number
  endLine?: number
  command?: string
  exitCode?: number
  uri?: string
  contentHash?: string
  truncated?: boolean
}

export interface ObservationFact {
  id: string
  kind: 'fact'
  statement: string
  verification: ObservationVerificationStatus
  evidenceRefs: string[]
  subjectRef?: string
  validAt?: string
}

export interface ObservationInference {
  id: string
  kind: 'inference'
  statement: string
  confidence: 'low' | 'medium' | 'high'
  basis: string
  evidenceRefs: string[]
}

export interface ObservationSummary {
  id: string
  kind: 'summary'
  text: string
  summaryMethod: 'deterministic' | 'template' | 'agent'
  evidenceRefs: string[]
}

export type ObservationFindingSeverity = 'info' | 'warning' | 'blocking'
export type ObservationFindingKind =
  | 'current_state'
  | 'change'
  | 'rule'
  | 'cause'
  | 'impact'
  | 'verification'
  | 'stale_projection'
  | 'needs_source_verification'
  | 'security'

export interface ObservationFinding {
  id: string
  kind: ObservationFindingKind
  severity: ObservationFindingSeverity
  subject?: ObservationSubject
  title: string
  summary: string
  expected?: unknown
  actual?: unknown
  impact?: {
    affectedEntities?: number
    blockedCapabilities?: string[]
    notes?: string[]
  }
  confidence: 'deterministic' | 'high' | 'medium' | 'unknown'
  factRefs: string[]
  inferenceRefs?: string[]
  evidenceRefs: string[]
  ruleRefs?: string[]
  changedSinceCursor?: boolean
}

export interface ObservationSemanticChange {
  id: string
  subjectRef: string
  operation: 'created' | 'updated' | 'deleted' | 'linked' | 'unlinked' | 'status_transition'
  semanticMeaning: string
  before?: unknown
  after?: unknown
  evidenceRefs: string[]
}

export interface ObservationRuleRef {
  id: string
  title: string
  source: 'openspec' | 'policy' | 'validator' | 'baseline' | 'test'
  severity: ObservationFindingSeverity
  evidenceRefs: string[]
}

export interface ObservationInvariantResult {
  id: string
  ruleId: string
  status: 'passed' | 'failed' | 'skipped' | 'unknown'
  severity: ObservationFindingSeverity
  subject?: ObservationSubject
  explanation: string
  expected?: unknown
  actual?: unknown
  impact?: string[]
  evidenceRefs: string[]
}

export interface ObservationCausalPath {
  id: string
  summary: string
  nodes: string[]
  evidenceRefs: string[]
  confidence: 'low' | 'medium' | 'high'
}

export type ObservationRelationKind =
  | 'observes'
  | 'locates'
  | 'calls'
  | 'depends_on'
  | 'verifies'
  | 'causes'
  | 'contradicts'
  | 'summarizes'
  | 'produces'

export interface ObservationRelation {
  id: string
  kind: ObservationRelationKind
  fromRef: string
  toRef: string
  label: string
  confidence: 'deterministic' | 'high' | 'medium' | 'unknown'
  sourceKinds: ObservationEvidenceSourceKind[]
  evidenceRefs: string[]
}

export interface ObservationRuntimeSignal {
  id: string
  signalType: 'probe_result' | 'test_result' | 'runtime_state' | 'command_status'
  status: 'passed' | 'failed' | 'skipped' | 'unknown'
  summary: string
  observedAt: string
  command?: string
  exitCode?: number
  durationMs?: number
  sourceKinds: ObservationEvidenceSourceKind[]
  evidenceRefs: string[]
}

export interface ObservationEventEnvelope<TPayload = unknown> {
  eventId: string
  eventType: string
  correlationId: string
  causationId?: string
  actionId?: string
  workflowId?: string
  workflowStepId?: string
  toolCallId?: string
  aggregateType?: string
  aggregateId?: string
  aggregateVersion?: number
  occurredAt: string
  actor: {
    type: 'user' | 'agent' | 'system' | 'worker'
    id: string
  }
  payload: TPayload
}

export interface ObservationCodeTouchpoint {
  id: string
  label:
    'route' | 'controller' | 'service' | 'model' | 'validator' | 'policy' | 'test' | 'type' | 'doc'
  qualifiedName?: string
  filePath: string
  startLine?: number
  endLine?: number
  reason: string
  evidenceRefs: string[]
}

export interface ObservationResourceHandle {
  uri: string
  title: string
  contentType:
    | 'application/json'
    | 'text/plain'
    | 'text/x-diff'
    | 'text/markdown'
    | 'application/vnd.aiproj.observation.subgraph+json'
  estimatedTokens: number
  priority: number
  description: string
  evidenceRefs: string[]
  expiresAt?: string
}

export interface ObservationVerificationSuggestion {
  id: string
  command: string
  reason: string
  scope: string
  expectedEvidence: string
}

export interface ObservationNextProbe {
  probe: string
  reason: string
  estimatedPayloadSize: 'small' | 'medium' | 'large'
  tool: Extract<ObservationToolName, 'run_probe' | 'check_invariants' | 'inspect_entity'>
}

export interface ObservationCursor {
  cursorId: string
  manifestId?: string
  graphVersion?: string
  seenFindingIds: string[]
  seenEvidenceIds: string[]
  seenEntityRefs: string[]
  seenCodeTouchpointIds: string[]
  createdAt: string
  expiresAt?: string
}

export interface ObservationBudget {
  maxTokens: number
  maxFindings: number
  maxEvidenceRefs: number
  maxResourceHandles: number
  maxRelations: number
  maxRuntimeSignals: number
}

export interface ObservationBudgetUsage {
  estimatedTokens: number
  omittedFindings: number
  omittedEvidenceRefs: number
  omittedResourceHandles: number
  omittedRelations: number
  omittedRuntimeSignals: number
}

export interface ObservationManifest {
  contractId: typeof AGENT_OBSERVATION_MANIFEST_CONTRACT_ID
  contractVersion: typeof AGENT_OBSERVATION_MANIFEST_VERSION
  observationId: string
  objective: string
  principle: typeof OBSERVATION_PRINCIPLE
  intent: ObservationIntent
  tool: ObservationToolName
  scope: ObservationScope
  generatedAt: string
  snapshotVersion?: number
  status: ObservationPacketStatus
  summary: ObservationPacketSummary
  freshness: ObservationFreshness
  cursor: ObservationCursor
  budget: ObservationBudget
  budgetUsage: ObservationBudgetUsage
  currentState?: ObservationCurrentState
  findings: ObservationFinding[]
  facts: ObservationFact[]
  inferences: ObservationInference[]
  summaries: ObservationSummary[]
  changes: ObservationSemanticChange[]
  rules: ObservationRuleRef[]
  invariantResults: ObservationInvariantResult[]
  causalPaths: ObservationCausalPath[]
  relations: ObservationRelation[]
  runtimeSignals: ObservationRuntimeSignal[]
  codeTouchpoints: ObservationCodeTouchpoint[]
  evidenceRefs: ObservationEvidenceRef[]
  resources: ObservationResourceHandle[]
  nextProbes: ObservationNextProbe[]
  verificationSuggestions: ObservationVerificationSuggestion[]
  pagination?: {
    hasMore: boolean
    cursor?: string
  }
}

export type ObservationPacket = ObservationManifest

export interface ObservationValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export const DEFAULT_OBSERVATION_BUDGET: ObservationBudget = {
  maxTokens: 4000,
  maxFindings: 8,
  maxEvidenceRefs: 12,
  maxResourceHandles: 10,
  maxRelations: 16,
  maxRuntimeSignals: 8,
} as const

const SENSITIVE_KEY_PATTERNS = [
  /prompt/i,
  /model.?output/i,
  /^(token|accessToken|access_token|refreshToken|refresh_token)$/i,
  /^authorization$/i,
  /^(apiKey|api_key)$/i,
  /^secret$/i,
  /password/i,
  /^privateKey$|^private_key$/i,
  /raw.?webhook.?body/i,
] as const

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
] as const

export function containsSensitiveObservationContent(value: unknown): boolean {
  return findSensitiveObservationPaths(value).length > 0
}

export function findSensitiveObservationPaths(value: unknown): string[] {
  const paths: string[] = []
  visitForSensitiveContent(value, '$', paths, new Set())
  return paths
}

function visitForSensitiveContent(
  value: unknown,
  path: string,
  paths: string[],
  seen: Set<unknown>,
): void {
  if (value === null || value === undefined) return

  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      paths.push(path)
    }
    return
  }

  if (typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitForSensitiveContent(item, `${path}[${index}]`, paths, seen))
    return
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nestedPath = `${path}.${key}`
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      paths.push(nestedPath)
      continue
    }
    visitForSensitiveContent(nested, nestedPath, paths, seen)
  }
}

export function validateObservationManifest(
  manifest: ObservationManifest,
): ObservationValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (manifest.contractId !== AGENT_OBSERVATION_MANIFEST_CONTRACT_ID) {
    errors.push('contractId must be agent-observation-manifest-v1')
  }
  if (manifest.contractVersion !== AGENT_OBSERVATION_MANIFEST_VERSION) {
    errors.push('contractVersion must be 1.0')
  }
  if (manifest.principle !== OBSERVATION_PRINCIPLE) {
    errors.push('principle must match the Agent Observation first principle')
  }
  if (!manifest.objective.trim()) {
    errors.push('objective is required')
  }
  if (!manifest.summary.headline.trim()) {
    errors.push('summary.headline is required')
  }

  const evidenceIds = new Set(manifest.resources.flatMap((resource) => resource.evidenceRefs))
  for (const evidence of manifestEvidenceList(manifest)) {
    evidenceIds.add(evidence.id)
    if (!evidence.title.trim()) errors.push(`evidence ${evidence.id} title is required`)
    if (!evidence.summary.trim()) errors.push(`evidence ${evidence.id} summary is required`)
    if (evidence.sourceKind === 'mcp_graph' && !evidence.graphProject) {
      errors.push(`mcp evidence ${evidence.id} must include graphProject`)
    }
    if (evidence.sourceKind === 'mcp_graph' && !evidence.tool) {
      errors.push(`mcp evidence ${evidence.id} must include tool`)
    }
    if (evidence.sourceKind === 'source_file' && !evidence.filePath) {
      errors.push(`source evidence ${evidence.id} must include filePath`)
    }
    if (
      (evidence.sourceKind === 'test_result' || evidence.sourceKind === 'runtime_state') &&
      !evidence.command &&
      !evidence.uri
    ) {
      errors.push(`runtime evidence ${evidence.id} must include command or uri`)
    }
  }

  for (const fact of manifest.facts) {
    if (fact.kind !== 'fact') errors.push(`fact ${fact.id} must use kind=fact`)
    if (fact.verification === 'verified' && fact.evidenceRefs.length === 0) {
      errors.push(`verified fact ${fact.id} must include evidenceRefs`)
    }
    for (const ref of fact.evidenceRefs) {
      if (!evidenceIds.has(ref)) warnings.push(`fact ${fact.id} references missing evidence ${ref}`)
    }
  }

  for (const inference of manifest.inferences) {
    if (inference.kind !== 'inference') {
      errors.push(`inference ${inference.id} must use kind=inference`)
    }
    if (!inference.basis.trim()) errors.push(`inference ${inference.id} must include basis`)
  }

  for (const summary of manifest.summaries) {
    if (summary.kind !== 'summary') errors.push(`summary ${summary.id} must use kind=summary`)
    if (!summary.summaryMethod) errors.push(`summary ${summary.id} must include summaryMethod`)
  }

  const verifiedFactIds = new Set(
    manifest.facts
      .filter((fact) => fact.verification === 'verified' && fact.evidenceRefs.length > 0)
      .map((fact) => fact.id),
  )
  for (const finding of manifest.findings) {
    if (finding.severity === 'blocking') {
      const hasVerifiedFact = finding.factRefs.some((factRef) => verifiedFactIds.has(factRef))
      const hasVerifiedEvidence = finding.evidenceRefs.some((evidenceRef) =>
        manifestEvidenceList(manifest).some(
          (evidence) => evidence.id === evidenceRef && evidence.verified,
        ),
      )
      if (!hasVerifiedFact && !hasVerifiedEvidence) {
        errors.push(`blocking finding ${finding.id} must reference verified fact or evidence`)
      }
    }
  }

  for (const relation of manifest.relations) {
    if (!relation.fromRef.trim()) errors.push(`relation ${relation.id} must include fromRef`)
    if (!relation.toRef.trim()) errors.push(`relation ${relation.id} must include toRef`)
    if (relation.evidenceRefs.length === 0) {
      errors.push(`relation ${relation.id} must include evidenceRefs`)
    }
    for (const ref of relation.evidenceRefs) {
      if (!evidenceIds.has(ref))
        warnings.push(`relation ${relation.id} references missing evidence ${ref}`)
    }
  }

  for (const signal of manifest.runtimeSignals) {
    if (!signal.summary.trim()) errors.push(`runtime signal ${signal.id} must include summary`)
    if (signal.evidenceRefs.length === 0) {
      errors.push(`runtime signal ${signal.id} must include evidenceRefs`)
    }
    for (const ref of signal.evidenceRefs) {
      if (!evidenceIds.has(ref)) {
        warnings.push(`runtime signal ${signal.id} references missing evidence ${ref}`)
      }
    }
  }

  const sensitivePaths = findSensitiveObservationPaths(manifest)
  if (sensitivePaths.length > 0) {
    errors.push(`manifest contains sensitive content at ${sensitivePaths.slice(0, 5).join(', ')}`)
  }

  if (manifest.findings.length > manifest.budget.maxFindings) {
    errors.push('findings exceed budget.maxFindings')
  }
  if (manifestEvidenceList(manifest).length > manifest.budget.maxEvidenceRefs) {
    errors.push('evidence refs exceed budget.maxEvidenceRefs')
  }
  if (manifest.resources.length > manifest.budget.maxResourceHandles) {
    errors.push('resources exceed budget.maxResourceHandles')
  }
  if (manifest.relations.length > manifest.budget.maxRelations) {
    errors.push('relations exceed budget.maxRelations')
  }
  if (manifest.runtimeSignals.length > manifest.budget.maxRuntimeSignals) {
    errors.push('runtime signals exceed budget.maxRuntimeSignals')
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function estimateObservationTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

export function applyObservationBudget(manifest: ObservationManifest): ObservationManifest {
  const budget = manifest.budget
  const findings = manifest.findings.slice(0, budget.maxFindings)
  const evidenceRefs = manifest.evidenceRefs.slice(0, budget.maxEvidenceRefs)
  const allowedEvidenceIds = new Set(evidenceRefs.map((evidence) => evidence.id))
  const facts = manifest.facts.filter(
    (fact) =>
      fact.evidenceRefs.some((ref) => allowedEvidenceIds.has(ref)) ||
      fact.evidenceRefs.length === 0,
  )
  const resources = manifest.resources.slice(0, budget.maxResourceHandles)
  const relations = manifest.relations.slice(0, budget.maxRelations)
  const runtimeSignals = manifest.runtimeSignals.slice(0, budget.maxRuntimeSignals)

  const next = {
    ...manifest,
    findings,
    facts,
    evidenceRefs,
    resources,
    relations,
    runtimeSignals,
    budgetUsage: {
      estimatedTokens: 0,
      omittedFindings: Math.max(0, manifest.findings.length - findings.length),
      omittedEvidenceRefs: Math.max(0, manifest.evidenceRefs.length - evidenceRefs.length),
      omittedResourceHandles: Math.max(0, manifest.resources.length - resources.length),
      omittedRelations: Math.max(0, manifest.relations.length - relations.length),
      omittedRuntimeSignals: Math.max(0, manifest.runtimeSignals.length - runtimeSignals.length),
    },
  }
  next.budgetUsage.estimatedTokens = estimateObservationTokens(next)
  return next
}

export function filterObservationByCursor(
  manifest: ObservationManifest,
  cursor?: ObservationCursor,
): ObservationManifest {
  if (!cursor) return manifest
  const seen = new Set(cursor.seenFindingIds)
  return {
    ...manifest,
    findings: manifest.findings.filter(
      (finding) => !seen.has(finding.id) || finding.changedSinceCursor === true,
    ),
  }
}

export function deriveObservationCursor(manifest: ObservationManifest): ObservationCursor {
  return {
    cursorId: `cursor:${manifest.observationId}`,
    manifestId: manifest.observationId,
    graphVersion: manifest.freshness.graphVersion,
    seenFindingIds: manifest.findings.map((finding) => finding.id),
    seenEvidenceIds: manifestEvidenceList(manifest).map((evidence) => evidence.id),
    seenEntityRefs: [
      ...new Set([
        ...manifest.facts
          .map((fact) => fact.subjectRef)
          .filter((ref): ref is string => Boolean(ref)),
        ...manifest.codeTouchpoints
          .map((touchpoint) => touchpoint.qualifiedName)
          .filter((ref): ref is string => Boolean(ref)),
      ]),
    ],
    seenCodeTouchpointIds: manifest.codeTouchpoints.map((touchpoint) => touchpoint.id),
    createdAt: manifest.generatedAt,
  }
}

export function manifestEvidenceList(manifest: ObservationManifest): ObservationEvidenceRef[] {
  const evidenceById = new Map<string, ObservationEvidenceRef>()
  for (const evidence of manifest.evidenceRefs) {
    evidenceById.set(evidence.id, evidence)
  }
  return Array.from(evidenceById.values())
}

export function createObservationManifest(input: {
  observationId: string
  objective: string
  intent: ObservationIntent
  tool?: ObservationToolName
  scope: ObservationScope
  generatedAt: string
  snapshotVersion?: number
  status?: ObservationPacketStatus
  summary?: Partial<ObservationPacketSummary>
  currentState?: ObservationCurrentState
  freshness?: Partial<ObservationFreshness>
  budget?: Partial<ObservationBudget>
  evidenceRefs?: ObservationEvidenceRef[]
  findings?: ObservationFinding[]
  facts?: ObservationFact[]
  inferences?: ObservationInference[]
  summaries?: ObservationSummary[]
  changes?: ObservationSemanticChange[]
  rules?: ObservationRuleRef[]
  invariantResults?: ObservationInvariantResult[]
  causalPaths?: ObservationCausalPath[]
  relations?: ObservationRelation[]
  runtimeSignals?: ObservationRuntimeSignal[]
  codeTouchpoints?: ObservationCodeTouchpoint[]
  resources?: ObservationResourceHandle[]
  nextProbes?: ObservationNextProbe[]
  verificationSuggestions?: ObservationVerificationSuggestion[]
}): ObservationManifest {
  const generatedAt = input.generatedAt
  const budget = { ...DEFAULT_OBSERVATION_BUDGET, ...input.budget }
  const manifest: ObservationManifest = {
    contractId: AGENT_OBSERVATION_MANIFEST_CONTRACT_ID,
    contractVersion: AGENT_OBSERVATION_MANIFEST_VERSION,
    observationId: input.observationId,
    objective: input.objective,
    principle: OBSERVATION_PRINCIPLE,
    intent: input.intent,
    tool: input.tool ?? 'observe_scope',
    scope: input.scope,
    generatedAt,
    snapshotVersion: input.snapshotVersion,
    status: input.status ?? 'unknown',
    summary: {
      headline: input.summary?.headline ?? input.objective,
      facts: input.summary?.facts ?? [],
    },
    freshness: {
      generatedAt,
      status: 'recent',
      ...input.freshness,
    },
    cursor: {
      cursorId: `cursor:${input.observationId}`,
      manifestId: input.observationId,
      graphVersion: input.freshness?.graphVersion,
      seenFindingIds: [],
      seenEvidenceIds: [],
      seenEntityRefs: [],
      seenCodeTouchpointIds: [],
      createdAt: generatedAt,
    },
    budget,
    budgetUsage: {
      estimatedTokens: 0,
      omittedFindings: 0,
      omittedEvidenceRefs: 0,
      omittedResourceHandles: 0,
      omittedRelations: 0,
      omittedRuntimeSignals: 0,
    },
    currentState: input.currentState,
    findings: input.findings ?? [],
    facts: input.facts ?? [],
    inferences: input.inferences ?? [],
    summaries: input.summaries ?? [],
    changes: input.changes ?? [],
    rules: input.rules ?? [],
    invariantResults: input.invariantResults ?? [],
    causalPaths: input.causalPaths ?? [],
    relations: input.relations ?? [],
    runtimeSignals: input.runtimeSignals ?? [],
    codeTouchpoints: input.codeTouchpoints ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    resources: input.resources ?? [],
    nextProbes: input.nextProbes ?? [],
    verificationSuggestions: input.verificationSuggestions ?? [],
    pagination: { hasMore: false },
  }
  manifest.cursor = deriveObservationCursor(manifest)
  manifest.budgetUsage.estimatedTokens = estimateObservationTokens(manifest)
  return applyObservationBudget(manifest)
}
