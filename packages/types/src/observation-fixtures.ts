import {
  AGENT_OBSERVATION_MANIFEST_CONTRACT_ID,
  AGENT_OBSERVATION_MANIFEST_VERSION,
  createObservationManifest,
  type ObservationManifest,
} from './observation.js'

const GENERATED_AT = '2026-07-19T10:00:00.000Z'

export const OBSERVATION_CURRENT_FIXTURE = createObservationManifest({
  observationId: 'obs-ai-draft-streaming',
  objective: '定位 AI 草案流式进度实现',
  intent: 'locate_code',
  tool: 'observe_scope',
  scope: {
    type: 'repository',
    id: 'aiproj',
    version: 'HEAD',
  },
  generatedAt: GENERATED_AT,
  status: 'degraded',
  freshness: {
    graphVersion: 'codebase-memory-mcp:aiproj',
    codeCommit: 'HEAD',
    status: 'recent',
  },
  summary: {
    headline: 'AI 草案进度观察应优先查看 SSE 主链和前端投影',
    facts: ['Code Graph 基图为 codebase-memory-mcp/aiproj', '默认返回 manifest 而非完整源码'],
  },
  evidenceRefs: [
    {
      id: 'ev-mcp-ai-draft-controller',
      sourceKind: 'mcp_graph',
      title: 'AiProjectDraftsController stream 入口',
      summary: 'MCP search_graph 定位 AI Draft controller 和 SSE 入口。',
      verified: true,
      generatedAt: GENERATED_AT,
      tool: 'search_graph',
      graphProject: 'aiproj',
      query: 'AI draft stream SSE controller',
      qualifiedName:
        'aiproj.apps.backend.app.controllers.ai_project_drafts_controller.AiProjectDraftsController',
      filePath: 'apps/backend/app/controllers/ai_project_drafts_controller.ts',
      startLine: 1,
      endLine: 120,
    },
    {
      id: 'ev-openspec-streaming',
      sourceKind: 'openspec',
      title: 'Streaming progress contract spec',
      summary: '已归档 StreamingProgressEnvelope 契约定义进度事件形状。',
      verified: true,
      generatedAt: GENERATED_AT,
      filePath: 'openspec/specs/streaming-progress-contract/spec.md',
    },
  ],
  facts: [
    {
      id: 'fact-mcp-baseline',
      kind: 'fact',
      statement: '首期 Code Graph 基图是 codebase-memory-mcp 的 aiproj 项目。',
      verification: 'verified',
      evidenceRefs: ['ev-mcp-ai-draft-controller'],
      subjectRef: 'codebase-memory-mcp:aiproj',
    },
  ],
  findings: [
    {
      id: 'finding-ai-draft-touchpoint',
      kind: 'current_state',
      severity: 'info',
      subject: {
        type: 'symbol',
        id: 'AiProjectDraftsController',
      },
      title: 'AI 草案流式进度入口可由 MCP 图谱定位',
      summary: 'Agent 可先读取 controller 和 streaming contract，再按需展开源码。',
      confidence: 'deterministic',
      factRefs: ['fact-mcp-baseline'],
      evidenceRefs: ['ev-mcp-ai-draft-controller', 'ev-openspec-streaming'],
    },
  ],
  codeTouchpoints: [
    {
      id: 'touch-ai-draft-controller',
      label: 'controller',
      qualifiedName:
        'aiproj.apps.backend.app.controllers.ai_project_drafts_controller.AiProjectDraftsController',
      filePath: 'apps/backend/app/controllers/ai_project_drafts_controller.ts',
      startLine: 1,
      endLine: 120,
      reason: 'AI Draft SSE 入口和生成流程位于该 controller。',
      evidenceRefs: ['ev-mcp-ai-draft-controller'],
    },
  ],
  resources: [
    {
      uri: 'obs://code/aiproj/apps/backend/app/controllers/ai_project_drafts_controller.ts',
      title: 'AI Draft controller source',
      contentType: 'text/plain',
      estimatedTokens: 2500,
      priority: 1,
      description: '按需展开 controller 源码。',
      evidenceRefs: ['ev-mcp-ai-draft-controller'],
    },
  ],
  nextProbes: [
    {
      probe: 'trace_path',
      reason: '需要确认 AIGateway.stream 是否已接入主链时展开调用链。',
      estimatedPayloadSize: 'small',
      tool: 'run_probe',
    },
  ],
  verificationSuggestions: [
    {
      id: 'verify-openspec-streaming',
      command: 'openspec-cn validate v2-5-ai-draft-live-progress-projection --type change --strict',
      reason: '确认流式进度相关 OpenSpec 仍然有效。',
      scope: 'openspec',
      expectedEvidence: 'strict validation exits 0',
    },
  ],
})

export const OBSERVATION_UNKNOWN_FIELDS_FIXTURE = {
  ...OBSERVATION_CURRENT_FIXTURE,
  optionalFutureField: {
    safelyIgnored: true,
  },
} as ObservationManifest & { optionalFutureField: { safelyIgnored: boolean } }

export const OBSERVATION_UNSUPPORTED_MAJOR_FIXTURE = {
  ...OBSERVATION_CURRENT_FIXTURE,
  contractVersion: '99.0',
} as unknown as ObservationManifest

export const OBSERVATION_SENSITIVE_FIXTURE = {
  ...OBSERVATION_CURRENT_FIXTURE,
  evidenceRefs: [
    ...OBSERVATION_CURRENT_FIXTURE.evidenceRefs,
    {
      id: 'ev-sensitive',
      sourceKind: 'manual',
      title: 'Sensitive payload',
      summary: 'This contains a forbidden key.',
      verified: false,
      generatedAt: GENERATED_AT,
      apiKey: 'plain-secret',
    },
  ],
} as unknown as ObservationManifest

export const ALL_OBSERVATION_CURRENT_FIXTURES = [OBSERVATION_CURRENT_FIXTURE] as const
export const ALL_OBSERVATION_UNKNOWN_FIELD_FIXTURES = [OBSERVATION_UNKNOWN_FIELDS_FIXTURE] as const
export const ALL_OBSERVATION_UNSUPPORTED_MAJOR_FIXTURES = [
  OBSERVATION_UNSUPPORTED_MAJOR_FIXTURE,
] as const
export const ALL_OBSERVATION_SENSITIVE_FIXTURES = [OBSERVATION_SENSITIVE_FIXTURE] as const

export const OBSERVATION_CONTRACT_FIXTURE_META = {
  contractId: AGENT_OBSERVATION_MANIFEST_CONTRACT_ID,
  currentVersion: AGENT_OBSERVATION_MANIFEST_VERSION,
} as const
