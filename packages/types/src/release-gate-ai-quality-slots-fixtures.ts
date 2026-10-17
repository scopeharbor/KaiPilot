/**
 * v3-release-gate-ai-quality-slots —— AI 门槽测试 fixtures。
 *
 * 覆盖五态：全绿、单槽失败、无数据 pending、漂移已确认、漂移未确认。
 * 所有 fixture 低敏：不含 secret/token/原始 prompt/模型输出/provider 载荷。
 *
 * @aiproj/types 零依赖约束
 */

import type {
  AiQualitySlotId,
  AiQualitySlotRecord,
  AiQualitySlotEvaluationInput,
  DriftConfirmationStatus,
} from './release-gate-ai-quality-slots.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1 门槽记录 fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** 固定组织 ID。 */
export const AI_SLOT_FIXTURE_ORG_ID = 42

/** 固定评估时间。 */
export const AI_SLOT_FIXTURE_EVALUATED_AT = '2026-08-22T12:00:00.000Z'

/** 构建单个门槽记录。 */
export function makeAiQualitySlotRecord(
  overrides: Partial<AiQualitySlotRecord> & { slotId: AiQualitySlotId },
): AiQualitySlotRecord {
  return {
    name: overrides.slotId,
    status: 'pending',
    runReference: null,
    criterion: '',
    evaluatedAt: AI_SLOT_FIXTURE_EVALUATED_AT,
    organizationId: AI_SLOT_FIXTURE_ORG_ID,
    ...overrides,
  }
}

// ── 全绿状态 ──────────────────────────────────────────────────────────────

/** 输出质量：passed。 */
export const fixtureOutputQualityPassed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-output-quality',
  name: '输出质量',
  status: 'passed',
  runReference: {
    evidenceSource: 'online-evaluation',
    runId: 'eval-run-2026-08-22-001',
    runAt: '2026-08-22T11:00:00.000Z',
  },
  criterion: '最近一次在线评测运行的通过率 >= 阈值',
  aggregateValue: 0.92,
  aggregateDescription: '通过率 92.0%（460/500）',
})

/** 离线回归：passed。 */
export const fixtureOfflineRegressionPassed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-offline-regression',
  name: '离线回归',
  status: 'passed',
  runReference: {
    evidenceSource: 'offline-eval-dataset',
    runId: 'offline-run-2026-08-22-001',
    runAt: '2026-08-22T10:30:00.000Z',
  },
  criterion: '最近一次离线回归运行无样本回归',
  aggregateValue: 0,
  aggregateDescription: '无回归（共 100 样本）',
})

/** 成本：passed。 */
export const fixtureCostPassed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-cost',
  name: '成本',
  status: 'passed',
  runReference: {
    evidenceSource: 'invocation-ledger',
    runId: 'cost-window-2026-08-21-2026-08-22',
    runAt: '2026-08-22T12:00:00.000Z',
  },
  criterion: '最近一个时间窗口的累计成本 <= 预算上限',
  aggregateValue: 12.5,
  aggregateDescription: '累计成本 12.5000 / 预算 50.0000（120 次调用）',
})

/** 漂移：passed（无漂移事件）。 */
export const fixtureDriftPassed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-model-drift',
  name: '模型漂移',
  status: 'passed',
  runReference: {
    evidenceSource: 'drift-detection',
    runId: 'drift-run-2026-08-22-001',
    runAt: '2026-08-22T09:00:00.000Z',
  },
  criterion: '无未经确认的漂移事件',
  aggregateValue: 0,
  aggregateDescription: '无未经确认的漂移事件',
})

/** 安全事件：passed。 */
export const fixtureSecurityEventsPassed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-security-events',
  name: '安全事件',
  status: 'passed',
  runReference: {
    evidenceSource: 'security-observability',
    runId: 'security-window-2026-08-21-2026-08-22',
    runAt: '2026-08-22T12:00:00.000Z',
  },
  criterion: '最近一个时间窗口的安全事件聚合计数 = 0',
  aggregateValue: 0,
  aggregateDescription: '无安全事件',
})

/** 全绿 fixtures。 */
export const fixtureAllSlotsPassed: AiQualitySlotRecord[] = [
  fixtureOutputQualityPassed,
  fixtureOfflineRegressionPassed,
  fixtureCostPassed,
  fixtureDriftPassed,
  fixtureSecurityEventsPassed,
]

// ── 单槽失败状态 ──────────────────────────────────────────────────────────

/** 输出质量：failed。 */
export const fixtureOutputQualityFailed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-output-quality',
  name: '输出质量',
  status: 'failed',
  runReference: {
    evidenceSource: 'online-evaluation',
    runId: 'eval-run-2026-08-22-002',
    runAt: '2026-08-22T11:30:00.000Z',
  },
  criterion: '最近一次在线评测运行的通过率 >= 阈值',
  aggregateValue: 0.65,
  aggregateDescription: '通过率 65.0%（325/500）',
})

/** 离线回归：failed。 */
export const fixtureOfflineRegressionFailed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-offline-regression',
  name: '离线回归',
  status: 'failed',
  runReference: {
    evidenceSource: 'offline-eval-dataset',
    runId: 'offline-run-2026-08-22-002',
    runAt: '2026-08-22T10:45:00.000Z',
  },
  criterion: '最近一次离线回归运行无样本回归',
  aggregateValue: 3,
  aggregateDescription: '存在 3 个回归样本（共 100）',
})

/** 成本：failed。 */
export const fixtureCostFailed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-cost',
  name: '成本',
  status: 'failed',
  runReference: {
    evidenceSource: 'invocation-ledger',
    runId: 'cost-window-2026-08-21-2026-08-22',
    runAt: '2026-08-22T12:00:00.000Z',
  },
  criterion: '最近一个时间窗口的累计成本 <= 预算上限',
  aggregateValue: 75.0,
  aggregateDescription: '累计成本 75.0000 / 预算 50.0000（300 次调用）',
})

// ── 无数据 pending 状态 ──────────────────────────────────────────────────

/** 输出质量：pending（无数据）。 */
export const fixtureOutputQualityPending: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-output-quality',
  name: '输出质量',
  status: 'pending',
  runReference: null,
  criterion: '最近一次在线评测运行的通过率 >= 阈值',
})

/** 离线回归：pending（无数据）。 */
export const fixtureOfflineRegressionPending: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-offline-regression',
  name: '离线回归',
  status: 'pending',
  runReference: null,
  criterion: '最近一次离线回归运行无样本回归',
})

/** 成本：pending（无数据）。 */
export const fixtureCostPending: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-cost',
  name: '成本',
  status: 'pending',
  runReference: null,
  criterion: '最近一个时间窗口的累计成本 <= 预算上限',
})

/** 漂移：pending（无数据）。 */
export const fixtureDriftPending: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-model-drift',
  name: '模型漂移',
  status: 'pending',
  runReference: null,
  criterion: '无未经确认的漂移事件',
})

/** 安全事件：pending（无数据）。 */
export const fixtureSecurityEventsPending: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-security-events',
  name: '安全事件',
  status: 'pending',
  runReference: null,
  criterion: '最近一个时间窗口的安全事件聚合计数 = 0',
})

/** 全 pending fixtures。 */
export const fixtureAllSlotsPending: AiQualitySlotRecord[] = [
  fixtureOutputQualityPending,
  fixtureOfflineRegressionPending,
  fixtureCostPending,
  fixtureDriftPending,
  fixtureSecurityEventsPending,
]

// ── 漂移已确认状态 ──────────────────────────────────────────────────────

/** 漂移：passed（漂移已确认）。 */
export const fixtureDriftConfirmedPassed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-model-drift',
  name: '模型漂移',
  status: 'passed',
  runReference: {
    evidenceSource: 'drift-detection',
    runId: 'drift-run-2026-08-22-002',
    runAt: '2026-08-22T09:30:00.000Z',
  },
  criterion: '无未经确认的漂移事件',
  aggregateValue: 0,
  aggregateDescription: '无未经确认的漂移事件（2 个漂移事件已确认）',
})

// ── 漂移未确认状态 ──────────────────────────────────────────────────────

/** 漂移：failed（漂移未确认）。 */
export const fixtureDriftUnconfirmedFailed: AiQualitySlotRecord = makeAiQualitySlotRecord({
  slotId: 'ai-model-drift',
  name: '模型漂移',
  status: 'failed',
  runReference: {
    evidenceSource: 'drift-detection',
    runId: 'drift-run-2026-08-22-003',
    runAt: '2026-08-22T10:00:00.000Z',
  },
  criterion: '无未经确认的漂移事件',
  aggregateValue: 1,
  aggregateDescription: '存在 1 个未经确认的漂移事件',
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2 评估输入 fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** 全绿评估输入。 */
export const fixtureEvaluationInputAllPassed: AiQualitySlotEvaluationInput = {
  organizationId: AI_SLOT_FIXTURE_ORG_ID,
  evaluatedAt: AI_SLOT_FIXTURE_EVALUATED_AT,
  onlineEvaluation: {
    runId: 'eval-run-2026-08-22-001',
    runAt: '2026-08-22T11:00:00.000Z',
    passRate: 0.92,
    totalSamples: 500,
    passedSamples: 460,
  },
  offlineRegression: {
    runId: 'offline-run-2026-08-22-001',
    runAt: '2026-08-22T10:30:00.000Z',
    hasRegression: false,
    regressionCount: 0,
    totalSamples: 100,
  },
  cost: {
    windowStart: '2026-08-21T12:00:00.000Z',
    windowEnd: '2026-08-22T12:00:00.000Z',
    totalCost: 12.5,
    budgetLimit: 50.0,
    totalCalls: 120,
  },
  modelDrift: {
    runId: 'drift-run-2026-08-22-001',
    runAt: '2026-08-22T09:00:00.000Z',
    events: [],
  },
  securityEvents: {
    windowStart: '2026-08-21T12:00:00.000Z',
    windowEnd: '2026-08-22T12:00:00.000Z',
    eventCount: 0,
  },
}

/** 无数据评估输入（全部 pending）。 */
export const fixtureEvaluationInputNoData: AiQualitySlotEvaluationInput = {
  organizationId: AI_SLOT_FIXTURE_ORG_ID,
  evaluatedAt: AI_SLOT_FIXTURE_EVALUATED_AT,
}

/** 单槽失败评估输入（输出质量失败）。 */
export const fixtureEvaluationInputOutputQualityFailed: AiQualitySlotEvaluationInput = {
  ...fixtureEvaluationInputAllPassed,
  onlineEvaluation: {
    runId: 'eval-run-2026-08-22-002',
    runAt: '2026-08-22T11:30:00.000Z',
    passRate: 0.65,
    totalSamples: 500,
    passedSamples: 325,
  },
}

/** 漂移已确认评估输入。 */
export const fixtureEvaluationInputDriftConfirmed: AiQualitySlotEvaluationInput = {
  ...fixtureEvaluationInputAllPassed,
  modelDrift: {
    runId: 'drift-run-2026-08-22-002',
    runAt: '2026-08-22T09:30:00.000Z',
    events: [
      { eventId: 'drift-001', confirmationStatus: 'confirmed' as DriftConfirmationStatus },
      { eventId: 'drift-002', confirmationStatus: 'confirmed' as DriftConfirmationStatus },
    ],
  },
}

/** 漂移未确认评估输入。 */
export const fixtureEvaluationInputDriftUnconfirmed: AiQualitySlotEvaluationInput = {
  ...fixtureEvaluationInputAllPassed,
  modelDrift: {
    runId: 'drift-run-2026-08-22-003',
    runAt: '2026-08-22T10:00:00.000Z',
    events: [
      { eventId: 'drift-003', confirmationStatus: 'unconfirmed' as DriftConfirmationStatus },
    ],
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3 敏感样本（用于禁存测试）
// ═══════════════════════════════════════════════════════════════════════════════

/** 敏感样本集合（用于验证门槽记录不含敏感内容）。 */
export const AI_SLOT_SENSITIVE_SAMPLES = [
  'sk-abcdefghijklmnopqrstuvwxyz123456',
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature',
  'password=hunter2secret123',
  'token=abcdefghijklmnopqrstuvwxyz1234567890',
  'api_key=sk-proj-abcdefghijklmnopqrstuvwxyz',
  'secret=mysupersecretkey1234567890',
  'Authorization: Bearer sk-test-1234567890abcdef',
  'The model output was: Here is the answer...',
  'User prompt: What is the meaning of life?',
  '{"messages": [{"role": "user", "content": "secret"}]}',
] as const

/** 敏感内容检测（值级）。 */
export function containsAiSlotSensitiveContent(text: string): boolean {
  return AI_SLOT_SENSITIVE_SAMPLES.some((sample) => text.includes(sample))
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4 引用解析器 fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** 已知运行 ID 集合（用于引用解析）。 */
export const KNOWN_RUN_IDS = new Set([
  'eval-run-2026-08-22-001',
  'eval-run-2026-08-22-002',
  'offline-run-2026-08-22-001',
  'offline-run-2026-08-22-002',
  'drift-run-2026-08-22-001',
  'drift-run-2026-08-22-002',
  'drift-run-2026-08-22-003',
  'cost-window-2026-08-21-2026-08-22',
  'security-window-2026-08-21-2026-08-22',
  'cost-window-2026-08-21T12:00:00.000Z-2026-08-22T12:00:00.000Z',
  'security-window-2026-08-21T12:00:00.000Z-2026-08-22T12:00:00.000Z',
])

/** 引用解析器：已知 ID 返回 true，未知 ID 返回 false。 */
export function fixtureRunReferenceResolver(ref: { runId: string }): boolean {
  return KNOWN_RUN_IDS.has(ref.runId)
}

/** 引用解析器：全部失败（模拟引用失效）。 */
export function fixtureRunReferenceResolverAlwaysFails(_ref: { runId: string }): boolean {
  return false
}
