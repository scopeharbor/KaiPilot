import { describe, expect, it } from 'vitest'
import { compileLocalObservation } from './observation-compiler.js'
import type { ObservationCursor, ObservationEvidenceRef } from './observation.js'

const GENERATED_AT = '2026-07-19T12:00:00.000Z'

const mcpEvidence: ObservationEvidenceRef = {
  id: 'ev-mcp-gantt-schedule',
  sourceKind: 'mcp_graph',
  title: 'Gantt scheduleProject',
  summary: 'MCP trace_path identified scheduleProject as a Gantt scheduling touchpoint.',
  verified: true,
  generatedAt: GENERATED_AT,
  tool: 'trace_path',
  graphProject: 'aiproj',
  query: 'scheduleProject',
  qualifiedName: 'aiproj.apps.backend.app.services.gantt_scheduling_engine.scheduleProject',
  filePath: 'apps/backend/app/services/gantt_scheduling_engine.ts',
  startLine: 151,
  endLine: 330,
}

describe('compileLocalObservation', () => {
  it('builds observe_scope packet with MCP-first evidence', () => {
    const manifest = compileLocalObservation({
      objective: '为 Gantt What-if change 生成最小观察 manifest',
      tool: 'observe_scope',
      generatedAt: GENERATED_AT,
      mcpEvidence: [mcpEvidence],
      graphVersion: 'codebase-memory-mcp:aiproj',
      codeCommit: 'HEAD',
    })

    expect(manifest.tool).toBe('observe_scope')
    expect(manifest.evidenceRefs.some((evidence) => evidence.graphProject === 'aiproj')).toBe(true)
    expect(manifest.findings[0]!.title).toContain('Observation Packet')
    expect(manifest.resources.some((resource) => resource.uri.startsWith('obs://'))).toBe(true)
  })

  it('builds impact packet for symbols', () => {
    const manifest = compileLocalObservation({
      objective: '分析 Compiler run executor wiring 影响面',
      tool: 'analyze_impact',
      symbol: 'PipelineExecutor.execute',
      generatedAt: GENERATED_AT,
    })

    expect(manifest.intent).toBe('impact_analysis')
    expect(manifest.scope).toEqual({ type: 'symbol', id: 'PipelineExecutor.execute' })
    expect(manifest.nextProbes.some((probe) => probe.probe === 'trace_path')).toBe(true)
    expect(manifest.verificationSuggestions.some((item) => item.id === 'verify-mcp-trace')).toBe(
      true,
    )
  })

  it('builds verify packet for OpenSpec changes', () => {
    const manifest = compileLocalObservation({
      objective: '根据 OpenSpec change 输出推荐验证命令',
      tool: 'verify_context',
      changeName: 'v2-5-agent-observation-mcp-fabric-baseline',
      generatedAt: GENERATED_AT,
    })

    expect(manifest.scope.type).toBe('openspec_change')
    expect(manifest.verificationSuggestions[0]!.command).toContain(
      'v2-5-agent-observation-mcp-fabric-baseline',
    )
    expect(manifest.findings.some((finding) => finding.kind === 'verification')).toBe(true)
  })

  it('supports explicit get_evidence resource handles', () => {
    const manifest = compileLocalObservation({
      objective: '展开证据',
      tool: 'get_evidence',
      resourceRef: 'obs://tests/types/observation',
      generatedAt: GENERATED_AT,
    })

    expect(manifest.tool).toBe('get_evidence')
    expect(manifest.resources[0]!.uri).toBe('obs://tests/types/observation')
  })

  it('deduplicates seen findings through cursor', () => {
    const base = compileLocalObservation({
      objective: 'cursor test',
      tool: 'observe_scope',
      generatedAt: GENERATED_AT,
    })
    const cursor: ObservationCursor = {
      ...base.cursor,
      seenFindingIds: base.findings.map((finding) => finding.id),
    }
    const next = compileLocalObservation({
      objective: 'cursor test',
      tool: 'observe_scope',
      generatedAt: GENERATED_AT,
      cursor,
    })

    expect(next.findings).toHaveLength(0)
  })

  it('bridges test result evidence into runtime signals, relations, and causal paths', () => {
    const manifest = compileLocalObservation({
      objective: '确认观察层 runtime probe',
      tool: 'run_probe',
      generatedAt: GENERATED_AT,
      localEvidence: [
        {
          id: 'ev-types-probe',
          sourceKind: 'test_result',
          title: 'Types probe',
          summary: 'Command exited 0; output summarized by hash.',
          verified: true,
          generatedAt: GENERATED_AT,
          command: 'pnpm --filter @aiproj/types test',
          exitCode: 0,
          contentHash: 'hash',
          truncated: true,
        },
      ],
    })

    expect(manifest.runtimeSignals).toHaveLength(1)
    expect(manifest.runtimeSignals[0]!.status).toBe('passed')
    expect(manifest.relations.some((relation) => relation.kind === 'verifies')).toBe(true)
    expect(manifest.causalPaths.some((path) => path.id.startsWith('path-runtime'))).toBe(true)
    expect(JSON.stringify(manifest)).not.toContain('stdout:')
  })
})
