import {
  createObservationManifest,
  filterObservationByCursor,
  type ObservationCausalPath,
  type ObservationCodeTouchpoint,
  type ObservationCursor,
  type ObservationEvidenceRef,
  type ObservationFinding,
  type ObservationIntent,
  type ObservationManifest,
  type ObservationNextProbe,
  type ObservationRelation,
  type ObservationResourceHandle,
  type ObservationRuntimeSignal,
  type ObservationScope,
  type ObservationToolName,
  type ObservationVerificationSuggestion,
} from './observation.js'

export interface LocalObservationInput {
  objective: string
  tool?: ObservationToolName
  intent?: ObservationIntent
  scope?: ObservationScope
  generatedAt?: string
  codeCommit?: string
  graphVersion?: string
  cursor?: ObservationCursor
  mcpEvidence?: ObservationEvidenceRef[]
  localEvidence?: ObservationEvidenceRef[]
  changeName?: string
  symbol?: string
  resourceRef?: string
}

const DEFAULT_GENERATED_AT = '2026-07-19T00:00:00.000Z'

export function compileLocalObservation(input: LocalObservationInput): ObservationManifest {
  const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT
  const tool = input.tool ?? inferTool(input)
  const intent = input.intent ?? inferIntent(tool)
  const objective = input.objective.trim() || defaultObjective(tool)
  const scope = input.scope ?? inferScope(input)
  const evidenceRefs = dedupeEvidence([
    ...buildDefaultEvidence(input, generatedAt),
    ...(input.mcpEvidence ?? []),
    ...(input.localEvidence ?? []),
  ])
  const facts = buildFacts(input, evidenceRefs)
  const codeTouchpoints = buildCodeTouchpoints(input, evidenceRefs)
  const runtimeSignals = buildRuntimeSignals(evidenceRefs)
  const findings = buildFindings(
    input,
    evidenceRefs,
    facts.map((fact) => fact.id),
    runtimeSignals,
  )
  const relations = buildRelations(input, scope, evidenceRefs, codeTouchpoints, runtimeSignals)
  const causalPaths = buildCausalPaths(input, relations, runtimeSignals)
  const resources = buildResources(input, evidenceRefs, codeTouchpoints)
  const nextProbes = buildNextProbes(tool)
  const verificationSuggestions = buildVerificationSuggestions(input, tool)

  const manifest = createObservationManifest({
    observationId: stableObservationId(tool, objective, input.symbol ?? input.changeName ?? ''),
    objective,
    intent,
    tool,
    scope,
    generatedAt,
    status: findings.some((finding) => finding.severity === 'blocking') ? 'blocked' : 'unknown',
    freshness: {
      graphVersion: input.graphVersion ?? 'codebase-memory-mcp:aiproj',
      codeCommit: input.codeCommit ?? 'unknown',
      status: input.graphVersion ? 'recent' : 'unknown',
    },
    summary: {
      headline: buildHeadline(tool, objective),
      facts: facts.map((fact) => fact.statement).slice(0, 5),
    },
    evidenceRefs,
    facts,
    findings,
    currentState: {
      scope,
      status: runtimeSignals.some((signal) => signal.status === 'failed') ? 'degraded' : 'unknown',
      facts: {
        evidenceCount: evidenceRefs.length,
        relationCount: relations.length,
        runtimeSignalCount: runtimeSignals.length,
      },
      evidenceRefs: evidenceRefs.slice(0, 5).map((evidence) => evidence.id),
    },
    causalPaths,
    relations,
    runtimeSignals,
    codeTouchpoints,
    resources,
    nextProbes,
    verificationSuggestions,
  })

  return filterObservationByCursor(manifest, input.cursor)
}

function inferTool(input: LocalObservationInput): ObservationToolName {
  if (input.resourceRef) return 'get_evidence'
  if (input.symbol) return 'analyze_impact'
  if (input.changeName) return 'verify_context'
  return 'observe_scope'
}

function inferIntent(tool: ObservationToolName): ObservationIntent {
  if (tool === 'locate_implementation') return 'locate_code'
  if (tool === 'analyze_impact') return 'impact_analysis'
  if (tool === 'verify_context' || tool === 'check_invariants') return 'verify'
  if (tool === 'trace_action') return 'debug'
  return 'understand'
}

function defaultObjective(tool: ObservationToolName): string {
  return `Agent observation ${tool}`
}

function inferScope(input: LocalObservationInput): ObservationScope {
  if (input.changeName) {
    return { type: 'openspec_change', id: input.changeName }
  }
  if (input.symbol) {
    return { type: 'symbol', id: input.symbol }
  }
  return { type: 'repository', id: 'aiproj' }
}

function buildDefaultEvidence(
  input: LocalObservationInput,
  generatedAt: string,
): ObservationEvidenceRef[] {
  const evidence: ObservationEvidenceRef[] = [
    {
      id: 'ev-observation-principle',
      sourceKind: 'openspec',
      title: 'Agent Observation first principle',
      summary:
        'Observation output must provide objective-relevant facts, changes, rules, causes, and evidence instead of more raw context.',
      verified: true,
      generatedAt,
      filePath:
        'openspec/changes/v2-5-agent-observation-mcp-fabric-baseline/specs/agent-observation-mcp-fabric/spec.md',
    },
    {
      id: 'ev-mcp-baseline',
      sourceKind: 'mcp_graph',
      title: 'MCP-first Code Graph baseline',
      summary: 'First-phase Code Graph baseline is codebase-memory-mcp project aiproj.',
      verified: true,
      generatedAt,
      tool: 'get_architecture',
      graphProject: 'aiproj',
      query: 'architecture overview',
    },
  ]

  if (input.changeName) {
    evidence.push({
      id: `ev-change-${slug(input.changeName)}`,
      sourceKind: 'openspec',
      title: `OpenSpec change ${input.changeName}`,
      summary: 'Change-specific verification should start with OpenSpec strict validation.',
      verified: true,
      generatedAt,
      filePath: `openspec/changes/${input.changeName}/`,
    })
  }

  if (input.symbol) {
    evidence.push({
      id: `ev-symbol-${slug(input.symbol)}`,
      sourceKind: 'mcp_graph',
      title: `MCP symbol evidence for ${input.symbol}`,
      summary: 'Use search_graph and trace_path before expanding source code.',
      verified: false,
      generatedAt,
      tool: 'trace_path',
      graphProject: 'aiproj',
      query: input.symbol,
      qualifiedName: input.symbol,
    })
  }

  return evidence
}

function buildFacts(input: LocalObservationInput, evidenceRefs: ObservationEvidenceRef[]) {
  const evidenceIds = evidenceRefs.map((evidence) => evidence.id)
  return [
    {
      id: 'fact-observation-not-log',
      kind: 'fact' as const,
      statement:
        'Agent Observation Plane is a semantic observation layer, not a better log viewer.',
      verification: 'verified' as const,
      evidenceRefs: ['ev-observation-principle'].filter((id) => evidenceIds.includes(id)),
      subjectRef: 'agent-observation-plane',
    },
    {
      id: 'fact-mcp-first',
      kind: 'fact' as const,
      statement:
        'First-phase code observation uses codebase-memory-mcp/aiproj as the Code Graph baseline.',
      verification: 'verified' as const,
      evidenceRefs: ['ev-mcp-baseline'].filter((id) => evidenceIds.includes(id)),
      subjectRef: 'codebase-memory-mcp:aiproj',
    },
    ...(input.changeName
      ? [
          {
            id: 'fact-change-needs-deterministic-validation',
            kind: 'fact' as const,
            statement: `Change ${input.changeName} should be verified with deterministic OpenSpec and package checks.`,
            verification: 'verified' as const,
            evidenceRefs: [`ev-change-${slug(input.changeName)}`],
            subjectRef: `openspec:${input.changeName}`,
          },
        ]
      : []),
  ]
}

function buildFindings(
  input: LocalObservationInput,
  evidenceRefs: ObservationEvidenceRef[],
  factRefs: string[],
  runtimeSignals: ObservationRuntimeSignal[],
): ObservationFinding[] {
  const evidenceIds = evidenceRefs.map((evidence) => evidence.id)
  const findings: ObservationFinding[] = [
    {
      id: 'finding-use-observation-packet',
      kind: 'current_state',
      severity: 'info',
      subject: { type: 'capability', id: 'agent-observation-plane' },
      title: 'Use Observation Packet before expanding raw materials',
      summary:
        'The Agent should start from a bounded packet with facts, rules, causes, evidence, and next probes.',
      confidence: 'deterministic',
      factRefs: factRefs.filter((id) => id === 'fact-observation-not-log'),
      evidenceRefs: ['ev-observation-principle'].filter((id) => evidenceIds.includes(id)),
    },
  ]

  if (input.symbol) {
    findings.push({
      id: `finding-impact-${slug(input.symbol)}`,
      kind: 'impact',
      severity: 'warning',
      subject: { type: 'symbol', id: input.symbol },
      title: `Trace impact for ${input.symbol}`,
      summary: 'Run MCP trace_path inbound and outbound before deciding implementation impact.',
      confidence: 'medium',
      factRefs: factRefs.filter((id) => id === 'fact-mcp-first'),
      evidenceRefs: [`ev-symbol-${slug(input.symbol)}`],
    })
  }

  if (input.changeName) {
    findings.push({
      id: `finding-verify-${slug(input.changeName)}`,
      kind: 'verification',
      severity: 'warning',
      subject: { type: 'openspec_change', id: input.changeName },
      title: `Verify ${input.changeName} with deterministic gates`,
      summary: 'Do not mark the change complete from Agent self-assessment alone.',
      confidence: 'deterministic',
      factRefs: factRefs.filter((id) => id === 'fact-change-needs-deterministic-validation'),
      evidenceRefs: [`ev-change-${slug(input.changeName)}`],
    })
  }

  for (const signal of runtimeSignals.filter((item) => item.status === 'failed')) {
    findings.push({
      id: `finding-runtime-${slug(signal.id)}`,
      kind: 'verification',
      severity: 'warning',
      subject: { type: 'runtime_signal', id: signal.id },
      title: `Runtime probe failed: ${signal.command ?? signal.id}`,
      summary: signal.summary,
      confidence: 'deterministic',
      factRefs: [],
      evidenceRefs: signal.evidenceRefs,
    })
  }

  return findings
}

function buildRuntimeSignals(evidenceRefs: ObservationEvidenceRef[]): ObservationRuntimeSignal[] {
  return evidenceRefs
    .filter(
      (evidence) =>
        evidence.sourceKind === 'test_result' ||
        evidence.sourceKind === 'runtime_state' ||
        evidence.sourceKind === 'cli',
    )
    .map((evidence): ObservationRuntimeSignal => {
      const exitCode = evidence.exitCode
      return {
        id: `signal-${slug(evidence.id)}`,
        signalType:
          evidence.sourceKind === 'runtime_state'
            ? 'runtime_state'
            : evidence.sourceKind === 'test_result'
              ? 'test_result'
              : 'command_status',
        status: exitCode === undefined ? 'unknown' : exitCode === 0 ? 'passed' : 'failed',
        summary: evidence.summary,
        observedAt: evidence.generatedAt,
        command: evidence.command,
        exitCode,
        sourceKinds: [evidence.sourceKind],
        evidenceRefs: [evidence.id],
      }
    })
}

function buildRelations(
  input: LocalObservationInput,
  scope: ObservationScope,
  evidenceRefs: ObservationEvidenceRef[],
  codeTouchpoints: ObservationCodeTouchpoint[],
  runtimeSignals: ObservationRuntimeSignal[],
): ObservationRelation[] {
  const scopeRef = `${scope.type}:${scope.id}`
  const relations: ObservationRelation[] = []

  const firstEvidence = evidenceRefs[0]
  if (firstEvidence) {
    relations.push({
      id: `rel-objective-observes-${slug(scopeRef)}`,
      kind: 'observes',
      fromRef: `objective:${slug(input.objective)}`,
      toRef: scopeRef,
      label: 'objective observes scope',
      confidence: 'deterministic',
      sourceKinds: [firstEvidence.sourceKind],
      evidenceRefs: [firstEvidence.id],
    })
  }

  for (const touchpoint of codeTouchpoints) {
    const evidence = evidenceRefs.find((item) => touchpoint.evidenceRefs.includes(item.id))
    if (!evidence) continue
    relations.push({
      id: `rel-${slug(scopeRef)}-locates-${slug(touchpoint.id)}`,
      kind: 'locates',
      fromRef: scopeRef,
      toRef: touchpoint.qualifiedName ?? touchpoint.filePath,
      label: touchpoint.reason,
      confidence: evidence.verified ? 'deterministic' : 'medium',
      sourceKinds: [evidence.sourceKind],
      evidenceRefs: [evidence.id],
    })
  }

  for (const signal of runtimeSignals) {
    relations.push({
      id: `rel-${slug(signal.id)}-verifies-${slug(scopeRef)}`,
      kind: 'verifies',
      fromRef: signal.id,
      toRef: scopeRef,
      label: 'runtime or test probe verifies observed scope state',
      confidence: 'deterministic',
      sourceKinds: signal.sourceKinds,
      evidenceRefs: signal.evidenceRefs,
    })
  }

  if (input.symbol) {
    const symbolEvidence = evidenceRefs.find((evidence) => evidence.qualifiedName === input.symbol)
    if (symbolEvidence) {
      relations.push({
        id: `rel-symbol-trace-${slug(input.symbol)}`,
        kind: 'observes',
        fromRef: input.symbol,
        toRef: 'mcp:trace_path',
        label: 'symbol impact should be confirmed through MCP trace_path',
        confidence: 'medium',
        sourceKinds: [symbolEvidence.sourceKind],
        evidenceRefs: [symbolEvidence.id],
      })
    }
  }

  return relations
}

function buildCausalPaths(
  input: LocalObservationInput,
  relations: ObservationRelation[],
  runtimeSignals: ObservationRuntimeSignal[],
): ObservationCausalPath[] {
  const paths: ObservationCausalPath[] = []
  const objectiveRef = `objective:${slug(input.objective)}`

  if (relations.length > 0) {
    paths.push({
      id: 'path-objective-to-evidence',
      summary:
        'Objective narrows scope, scope locates evidence, and probes verify only the relevant state.',
      nodes: [objectiveRef, ...relations.slice(0, 5).map((relation) => relation.toRef)],
      evidenceRefs: [...new Set(relations.flatMap((relation) => relation.evidenceRefs))].slice(
        0,
        5,
      ),
      confidence: runtimeSignals.length > 0 ? 'high' : 'medium',
    })
  }

  for (const signal of runtimeSignals) {
    paths.push({
      id: `path-runtime-${slug(signal.id)}`,
      summary:
        'Runtime probe result is linked to verification without embedding raw command output.',
      nodes: [signal.command ?? signal.id, signal.id, 'verificationSuggestions'],
      evidenceRefs: signal.evidenceRefs,
      confidence: 'high',
    })
  }

  return paths
}

function buildCodeTouchpoints(
  input: LocalObservationInput,
  evidenceRefs: ObservationEvidenceRef[],
): ObservationCodeTouchpoint[] {
  const touchpoints: ObservationCodeTouchpoint[] = evidenceRefs
    .filter((evidence) => evidence.filePath)
    .slice(0, 10)
    .map((evidence, index): ObservationCodeTouchpoint => ({
      id: `touch-${index + 1}-${slug(evidence.id)}`,
      label: evidence.sourceKind === 'openspec' ? 'doc' : 'service',
      qualifiedName: evidence.qualifiedName,
      filePath: evidence.filePath!,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      reason:
        evidence.sourceKind === 'mcp_graph'
          ? 'MCP graph identified this as a relevant code touchpoint.'
          : 'Local source is relevant evidence for the current observation.',
      evidenceRefs: [evidence.id],
    }))

  if (input.symbol) {
    touchpoints.push({
      id: `touch-symbol-${slug(input.symbol)}`,
      label: 'service',
      qualifiedName: input.symbol,
      filePath: 'obs://mcp/trace_path',
      reason: 'Symbol impact should be expanded through MCP trace_path.',
      evidenceRefs: [`ev-symbol-${slug(input.symbol)}`],
    })
  }

  return touchpoints
}

function buildResources(
  input: LocalObservationInput,
  evidenceRefs: ObservationEvidenceRef[],
  codeTouchpoints: ObservationCodeTouchpoint[],
): ObservationResourceHandle[] {
  const codeResources: ObservationResourceHandle[] = codeTouchpoints.map((touchpoint, index) => ({
    uri: touchpoint.filePath.startsWith('obs://')
      ? touchpoint.filePath
      : `obs://source/${touchpoint.filePath}`,
    title: touchpoint.qualifiedName ?? touchpoint.filePath,
    contentType: 'text/plain' as const,
    estimatedTokens: 1500,
    priority: index + 1,
    description: 'Expand only when the manifest summary is insufficient.',
    evidenceRefs: touchpoint.evidenceRefs,
  }))

  if (input.resourceRef) {
    codeResources.unshift({
      uri: input.resourceRef,
      title: `Requested evidence ${input.resourceRef}`,
      contentType: 'application/json' as const,
      estimatedTokens: 800,
      priority: 0,
      description: 'Explicitly requested evidence handle.',
      evidenceRefs: evidenceRefs.slice(0, 1).map((evidence) => evidence.id),
    })
  }

  return codeResources
}

function buildNextProbes(tool: ObservationToolName): ObservationNextProbe[] {
  if (tool === 'analyze_impact') {
    return [
      {
        probe: 'trace_path',
        reason: 'Confirm inbound and outbound call graph before editing.',
        estimatedPayloadSize: 'small',
        tool: 'run_probe',
      },
    ]
  }

  if (tool === 'verify_context') {
    return [
      {
        probe: 'check_invariants',
        reason: 'After implementation, deterministic checks must replace Agent self-assessment.',
        estimatedPayloadSize: 'medium',
        tool: 'check_invariants',
      },
    ]
  }

  return [
    {
      probe: 'inspect_entity',
      reason: 'Expand only the most relevant symbol, change, or evidence handle.',
      estimatedPayloadSize: 'small',
      tool: 'inspect_entity',
    },
  ]
}

function buildVerificationSuggestions(
  input: LocalObservationInput,
  tool: ObservationToolName,
): ObservationVerificationSuggestion[] {
  const suggestions: ObservationVerificationSuggestion[] = [
    {
      id: 'verify-openspec-specs',
      command: 'openspec-cn validate --specs',
      reason: 'Main specification set must remain valid.',
      scope: 'openspec',
      expectedEvidence: 'command exits 0',
    },
    {
      id: 'verify-types',
      command: 'pnpm --filter @aiproj/types test',
      reason: 'Observation contracts and compatibility fixtures live in @aiproj/types.',
      scope: 'packages/types',
      expectedEvidence: 'vitest exits 0',
    },
  ]

  if (input.changeName) {
    suggestions.unshift({
      id: `verify-change-${slug(input.changeName)}`,
      command: `openspec-cn validate ${input.changeName} --type change --strict`,
      reason: 'The active change must pass strict OpenSpec validation.',
      scope: input.changeName,
      expectedEvidence: 'strict validation exits 0',
    })
  }

  if (tool === 'analyze_impact' || input.symbol) {
    suggestions.push({
      id: 'verify-mcp-trace',
      command: `mcp:trace_path project=aiproj function_name="${input.symbol ?? '<symbol>'}" direction=both`,
      reason: 'MCP call graph should be checked before editing impacted code.',
      scope: input.symbol ?? 'symbol',
      expectedEvidence: 'inbound and outbound callers summarized',
    })
  }

  return suggestions
}

function dedupeEvidence(evidenceRefs: ObservationEvidenceRef[]): ObservationEvidenceRef[] {
  return Array.from(new Map(evidenceRefs.map((evidence) => [evidence.id, evidence])).values())
}

function buildHeadline(tool: ObservationToolName, objective: string): string {
  return `${tool}: ${objective}`
}

function stableObservationId(tool: ObservationToolName, objective: string, suffix: string): string {
  return `obs-${slug(`${tool}-${objective}-${suffix}`).slice(0, 80)}`
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
