/**
 * @aiproj/compiler-spec —— Context Compiler Fixtures（v2-context-compiler-artifact-store §1.6 P1）。
 *
 * 提供标准测试 fixture：
 * - 最小用户输入
 * - Contract / Manifest / Ledger / PDM refs
 * - 长文本 artifact
 * - Repair feedback
 * - 1000 任务摘要预算样本
 */
import type {
  ArtifactRef,
  ContextPacket,
  ContextSection,
  ContextBudget,
  ContextProvenance,
} from './artifact-context.js'
import { estimateTokens, stringifyArtifactRef } from './artifact-context.js'

// ── 基本常量 ──

export const FIXTURE_ORG_ID = 1
export const FIXTURE_RUN_ID = 42
export const FIXTURE_STAGE_ID = 'stage_intent_parsing'
export const FIXTURE_ENTITY_ID = 'Wdesign_1a2b3c4d'

// ── 最小用户输入 ──

export const MINIMAL_USER_INPUT: Record<string, unknown> = {
  text: '开发一个内部活动报名管理系统',
  language: 'zh-CN',
  constraints: ['两周内交付'],
}

// ── Artifact Refs ──

export const CONTRACT_REF: ArtifactRef = {
  compilerRunId: FIXTURE_RUN_ID,
  organizationId: FIXTURE_ORG_ID,
  kind: 'contract',
  artifactId: 'contract_main_v1',
  version: 1,
  summaryLevel: 'full',
}

export const MANIFEST_REF: ArtifactRef = {
  compilerRunId: FIXTURE_RUN_ID,
  organizationId: FIXTURE_ORG_ID,
  kind: 'manifest',
  artifactId: 'manifest_main_v1',
  version: 1,
  summaryLevel: 'full',
}

export const LEDGER_REF: ArtifactRef = {
  compilerRunId: FIXTURE_RUN_ID,
  organizationId: FIXTURE_ORG_ID,
  kind: 'ledger',
  artifactId: 'ledger_main_v1',
  version: 1,
  summaryLevel: 'full',
}

export const PDM_REF: ArtifactRef = {
  compilerRunId: FIXTURE_RUN_ID,
  organizationId: FIXTURE_ORG_ID,
  kind: 'pdm',
  artifactId: 'pdm_main_v1',
  version: 1,
  summaryLevel: 'full',
}

export const ALL_FIXTURE_REFS: ArtifactRef[] = [CONTRACT_REF, MANIFEST_REF, LEDGER_REF, PDM_REF]

// ── 长文本 artifact ──

export const LONG_TEXT_ARTIFACT = 'x'.repeat(10000)

export const LONG_TEXT_PAYLOAD: Record<string, unknown> = {
  entityId: 'Edesign_long',
  name: '长文本测试实体',
  description: LONG_TEXT_ARTIFACT,
  status: 'pending',
  constraints: ['约束 1', '约束 2'].concat(
    Array.from({ length: 50 }, (_, i) => `自动约束 ${i + 3}`),
  ),
}

// ── Repair Feedback ──

export const REPAIR_FEEDBACK_ENTRIES = [
  {
    source: 'hard_validator',
    severity: 'error' as const,
    message: '实体 Wdesign_1a2b3c4d 缺失必填字段 "estimatedHours"',
    artifactRef: 'artifact:validation_feedback:vf_001:v1@full',
  },
  {
    source: 'level_0_validator',
    severity: 'warning' as const,
    message: '日期 "startDate" 格式不合法，预期 ISO 8601',
  },
  {
    source: 'soft_evaluator',
    severity: 'info' as const,
    message: 'WBS 深度超限：建议最多 3 层，当前 5 层',
    artifactRef: 'artifact:validation_feedback:vf_002:v1@full',
  },
]

// ── 1000 任务摘要预算样本 ──

/**
 * 生成 1000 任务的摘要预算样本 ContextPacket。
 */
export function generate1000TaskBudgetSample(): ContextPacket {
  const tasks = Array.from({ length: 1000 }, (_, i) => ({
    id: `T${String(i + 1).padStart(4, '0')}`,
    name: `任务 ${i + 1}`,
    estimatedHours: Math.ceil(Math.random() * 40),
    status: 'pending',
  }))

  const sections: ContextSection[] = [
    {
      name: 'system',
      priority: 'P0',
      summaryLevel: 'full',
      requestedTokens: 200,
      includedTokens: 200,
      content: { rules: ['JSON 输出', '中文回复'] },
      sourceRefs: [],
    },
    {
      name: 'stageDirective',
      priority: 'P0',
      summaryLevel: 'full',
      requestedTokens: 300,
      includedTokens: 300,
      content: { stageId: 'stage_1000', name: '千任务测试' },
      sourceRefs: [],
    },
    {
      name: 'requiredArtifacts',
      priority: 'P1',
      summaryLevel: 'compact',
      requestedTokens: 50000,
      includedTokens: 15000,
      content: { tasks },
      sourceRefs: [stringifyArtifactRef(PDM_REF)],
      cutReason: 'budget_limit',
    },
  ]

  const budget: ContextBudget = {
    totalBudget: 16000,
    totalRequested: 50500,
    totalIncluded: 15500,
    sections,
    overBudget: false,
  }

  const provenance: ContextProvenance = {
    contractRef: stringifyArtifactRef(CONTRACT_REF),
    manifestRef: stringifyArtifactRef(MANIFEST_REF),
    ledgerRef: stringifyArtifactRef(LEDGER_REF),
    repairFeedbackRefs: [],
    inputScope: ['stage_outputs'],
    allowedTools: [],
    advisorySkillRefs: [],
  }

  return {
    schemaVersion: '2.0',
    packetId: 'ctx_1000_task_sample',
    compilerRunId: FIXTURE_RUN_ID,
    organizationId: FIXTURE_ORG_ID,
    sections,
    budget,
    provenance,
    createdAt: '2026-07-11T00:00:00.000Z',
  }
}

// ── Token 估算验证 ──

/**
 * 验证 1000 任务预算样本的 token 估算可复现。
 */
export function verify1000TaskTokenEstimate(): { estimate: number; deterministic: boolean } {
  const packet = generate1000TaskBudgetSample()
  const estimate1 = estimateTokens(packet)
  const estimate2 = estimateTokens(packet)
  return { estimate: estimate1, deterministic: estimate1 === estimate2 }
}
