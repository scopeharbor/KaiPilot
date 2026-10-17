/**
 * @aiproj/types — V3 Copilot Agent Workflow Orchestration Fixtures
 * v3-copilot-agent-workflow-orchestration
 *
 * 五态 fixtures：全只读编排、含变更步骤编排、中途暂停、步骤失败、触及上限。
 * 纯工厂函数，零外部依赖。
 */

import type {
  OrchestrationDefinition,
  OrchestrationStepDefinition,
  OrchestrationTrace,
  OrchestrationStepTrace,
  OrchestrationCeilingConfig,
  CompilerRunType,
} from './copilot-agent-workflow.js'
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_DURATION_MS,
  ORCHESTRATION_RUN_TYPE,
  COMPILER_RUN_TYPE,
} from './copilot-agent-workflow.js'

// ── 步骤工厂 ──

export function buildReadonlyStep(
  overrides?: Partial<OrchestrationStepDefinition>,
): OrchestrationStepDefinition {
  return {
    stepId: `step-ro-${Date.now()}`,
    kind: 'readonly',
    title: '读取项目信息',
    description: '读取当前项目的基础数据和配置',
    ...overrides,
  }
}

export function buildMutationStep(
  overrides?: Partial<OrchestrationStepDefinition>,
): OrchestrationStepDefinition {
  return {
    stepId: `step-mut-${Date.now()}`,
    kind: 'mutation',
    title: '更新任务状态',
    description: '将任务状态从进行中改为已完成',
    targets: ['task:123'],
    ...overrides,
  }
}

// ── 编排定义工厂 ──

/** 五态 1：全只读编排 */
export function buildAllReadonlyOrchestration(): OrchestrationDefinition {
  return {
    orchestrationId: `orch-ro-${Date.now()}`,
    name: '读取项目全景',
    steps: [
      buildReadonlyStep({ stepId: 'step-1', title: '读取项目概述' }),
      buildReadonlyStep({ stepId: 'step-2', title: '读取 WBS 结构' }),
      buildReadonlyStep({ stepId: 'step-3', title: '读取资源分配' }),
    ],
    sessionId: 'session-1',
    userId: 1,
    organizationId: 1,
  }
}

/** 五态 2：含变更步骤编排 */
export function buildWithMutationOrchestration(): OrchestrationDefinition {
  return {
    orchestrationId: `orch-mut-${Date.now()}`,
    name: '分析并更新任务',
    steps: [
      buildReadonlyStep({ stepId: 'step-1', title: '分析项目数据' }),
      buildMutationStep({ stepId: 'step-2', title: '更新任务描述', targets: ['task:100'] }),
      buildReadonlyStep({ stepId: 'step-3', title: '验证更新结果' }),
    ],
    sessionId: 'session-2',
    userId: 1,
    organizationId: 1,
  }
}

/** 五态 3：中途暂停编排 */
export function buildPausedOrchestration(): OrchestrationDefinition {
  return {
    orchestrationId: `orch-pause-${Date.now()}`,
    name: '多步分析与修改',
    steps: [
      buildReadonlyStep({ stepId: 'step-1', title: '收集数据' }),
      buildMutationStep({ stepId: 'step-2', title: '修改计划', targets: ['project:1'] }),
      buildMutationStep({ stepId: 'step-3', title: '调整资源', targets: ['resource:5'] }),
    ],
    sessionId: 'session-3',
    userId: 2,
    organizationId: 1,
  }
}

/** 五态 4：步骤失败编排 */
export function buildFailedOrchestration(): OrchestrationDefinition {
  return {
    orchestrationId: `orch-fail-${Date.now()}`,
    name: '失败场景编排',
    steps: [
      buildReadonlyStep({ stepId: 'step-1', title: '读取数据' }),
      buildMutationStep({ stepId: 'step-2', title: '更新数据', targets: ['task:200'] }),
      buildMutationStep({ stepId: 'step-3', title: '写入结果', targets: ['task:201'] }),
    ],
    sessionId: 'session-4',
    userId: 1,
    organizationId: 1,
  }
}

/** 五态 5：触及上限编排 */
export function buildAtCeilingOrchestration(): OrchestrationDefinition {
  const steps: OrchestrationStepDefinition[] = []
  for (let i = 1; i <= DEFAULT_MAX_STEPS; i++) {
    steps.push(
      buildReadonlyStep({
        stepId: `step-${i}`,
        title: `步骤 ${i}`,
      }),
    )
  }
  return {
    orchestrationId: `orch-ceiling-${Date.now()}`,
    name: '触及步数上限',
    steps,
    sessionId: 'session-5',
    userId: 1,
    organizationId: 1,
  }
}

// ── 轨迹工厂 ──

export function buildStepTrace(
  overrides?: Partial<OrchestrationStepTrace>,
): OrchestrationStepTrace {
  return {
    stepId: `step-trace-${Date.now()}`,
    status: 'completed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1234,
    ...overrides,
  }
}

export function buildOrchestrationTrace(
  overrides?: Partial<OrchestrationTrace>,
): OrchestrationTrace {
  return {
    orchestrationId: `orch-trace-${Date.now()}`,
    status: 'completed',
    steps: [buildStepTrace({ stepId: 'step-1' }), buildStepTrace({ stepId: 'step-2' })],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── 上限配置工厂 ──

export function buildDefaultCeilingConfig(): OrchestrationCeilingConfig {
  return {
    maxSteps: DEFAULT_MAX_STEPS,
    maxDurationMs: DEFAULT_MAX_DURATION_MS,
  }
}

export function buildLoweredCeilingConfig(): OrchestrationCeilingConfig {
  return {
    maxSteps: 5,
    maxDurationMs: 10 * 60 * 1000,
  }
}

// ── Run 类型 ──

export function buildCompilerRunType(): CompilerRunType {
  return COMPILER_RUN_TYPE
}

export function buildOrchestrationRunType(): CompilerRunType {
  return ORCHESTRATION_RUN_TYPE
}

// ── 敏感样本（禁存测试用） ──

export const SENSITIVE_SAMPLES = [
  'sk-abc123def456ghi789jkl012mno',
  'token: Bearer eyJhbGciOiJIUzI1NiIs',
  'api_key: AKIAIOSFODNN7EXAMPLE',
  'secret: wJalrXUtnFEMI/K7MDENG',
  'password: mySecretPassword123',
  'The prompt was: "You are a helpful assistant"',
  'Model output: Here is the result...',
] as const

/** 中间产物正文样本 */
export const INTERMEDIATE_BODY_SAMPLES = [
  '# 项目计划\n\n这是一个详细的项目计划...',
  '{"tasks": [{"id": 1, "name": "设计阶段"}]}',
  '根据分析，建议将任务拆分为5个子任务...',
] as const
