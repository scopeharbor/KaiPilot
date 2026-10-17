/**
 * v3-copilot-agent-workflow-orchestration —— CopilotAgentOrchestrationService
 *
 * 多步骤编排的核心服务：编排状态管理、步骤执行调度、确认点约束、
 * 预算逐步判定、失败处理与重试。
 *
 * 核心裁决（design D1-D7）：
 * - D1：只读步骤连续执行，变更步骤逐个停确认点
 * - D2：复用 Compiler run 状态机（ALLOWED_TRANSITIONS）
 * - D3：回放确定性（同输入+同定义→同轨迹；模型只写叙述）
 * - D4：预算与限流每步各判一次
 * - D5：失败不回滚已确认变更
 * - D6：轨迹记录只存引用与状态
 * - D7：最大步数与最长时长硬上限
 */

import type {
  OrchestrationDefinition,
  OrchestrationStepDefinition,
  OrchestrationTrace,
  OrchestrationState,
  OrchestrationStepState,
  OrchestrationCeilingConfig,
  OrchestrationStepConfirmation,
  OrchestrationRunResult,
} from '@aiproj/types/copilot-agent-workflow'
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_DURATION_MS,
  ORCHESTRATION_RUN_TYPE,
} from '@aiproj/types/copilot-agent-workflow'
import CompilerRun from '#models/compiler_run'

// ── Types ──

export interface OrchestrationServiceDeps {
  /** 预算守卫 preflight（每步调用一次） */
  budgetPreflight?: (stepId: string) => Promise<{ allowed: boolean; reason?: string }>
  /** 动作边界确认验证 */
  confirmStep?: (
    confirmation: OrchestrationStepConfirmation,
  ) => Promise<{ valid: boolean; reason?: string }>
  /** 权限检查（每步调用一次） */
  checkPermission?: (stepId: string) => Promise<{ allowed: boolean; reason?: string }>
}

export interface StartOrchestrationInput {
  definition: OrchestrationDefinition
  ceiling?: OrchestrationCeilingConfig
}

export interface ConfirmStepInput {
  orchestrationId: string
  confirmation: OrchestrationStepConfirmation
  organizationId: number
}

export interface ResumeOrchestrationInput {
  orchestrationId: string
  organizationId: number
}

export interface RetryStepInput {
  orchestrationId: string
  stepId: string
  organizationId: number
}

// ── 服务 ──

export class CopilotAgentOrchestrationService {
  /** 内存中的编排轨迹（生产应持久化到 compiler_runs + compiler_stage_events） */
  readonly #traces = new Map<string, OrchestrationTrace>()
  /** 内存中的编排定义 */
  readonly #definitions = new Map<string, OrchestrationDefinition>()
  /** 内存中的上限配置 */
  readonly #ceilings = new Map<string, OrchestrationCeilingConfig>()
  /** 内存中的 run_id 映射 */
  readonly #runIdMap = new Map<string, number>()

  readonly #deps: OrchestrationServiceDeps

  constructor(deps?: OrchestrationServiceDeps) {
    this.#deps = deps ?? {}
  }

  // ── 启动编排 ──

  /**
   * 启动一个新的多步骤编排。
   * 创建 CompilerRun 记录（run_type = copilot_orchestration）并初始化轨迹。
   */
  async startOrchestration(input: StartOrchestrationInput): Promise<OrchestrationRunResult> {
    const { definition, ceiling } = input

    // 验证步骤定义
    this.#validateStepDefinitions(definition.steps)

    // 应用上限配置
    const effectiveCeiling = {
      maxSteps: ceiling?.maxSteps ?? DEFAULT_MAX_STEPS,
      maxDurationMs: ceiling?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
    }

    // 不在启动时拒绝超过上限的编排——上限在执行过程中逐步检查（D7）
    // 启动时只验证步骤定义合法性

    // 创建 CompilerRun 记录（复用现有表，D2）
    const run = await CompilerRun.create({
      organizationId: definition.organizationId,
      requestedByUserId: definition.userId,
      status: 'running',
      input: {
        runType: ORCHESTRATION_RUN_TYPE,
        orchestrationId: definition.orchestrationId,
        name: definition.name,
        sessionId: definition.sessionId,
      } as Record<string, unknown>,
    } as any)

    // 初始化轨迹
    const trace: OrchestrationTrace = {
      orchestrationId: definition.orchestrationId,
      status: 'running',
      steps: definition.steps.map((step) => ({
        stepId: step.stepId,
        status: 'pending' as OrchestrationStepState,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.#traces.set(definition.orchestrationId, trace)
    this.#definitions.set(definition.orchestrationId, definition)
    this.#ceilings.set(definition.orchestrationId, effectiveCeiling)
    this.#runIdMap.set(definition.orchestrationId, run.id)

    // 开始执行
    return this.#executeSteps(definition.orchestrationId)
  }

  // ── 确认变更步骤 ──

  /**
   * 确认一个暂停的变更步骤。
   * D1：每个变更步骤需要单独确认。
   */
  async confirmStep(input: ConfirmStepInput): Promise<OrchestrationRunResult> {
    const { orchestrationId, confirmation, organizationId } = input

    const trace = this.#traces.get(orchestrationId)
    const definition = this.#definitions.get(orchestrationId)
    if (!trace || !definition) {
      throw new OrchestrationNotFoundError(`编排 ${orchestrationId} 不存在`)
    }

    // 组织隔离检查
    if (definition.organizationId !== organizationId) {
      throw new OrchestrationOrganizationIsolationError('不可访问他组织编排')
    }

    // 检查编排状态
    if (trace.status !== 'paused') {
      throw new OrchestrationStateError(`编排状态 ${trace.status} 不允许确认操作`)
    }

    // 查找对应步骤
    const stepIndex = definition.steps.findIndex((s) => s.stepId === confirmation.stepId)
    if (stepIndex === -1) {
      throw new OrchestrationStepNotFoundError(`步骤 ${confirmation.stepId} 不存在`)
    }

    const stepTrace = trace.steps[stepIndex]
    if (stepTrace.status !== 'paused') {
      throw new OrchestrationStateError(
        `步骤 ${confirmation.stepId} 状态 ${stepTrace.status} 不允许确认`,
      )
    }

    // 委托确认验证（走既有动作边界）
    if (this.#deps.confirmStep) {
      const result = await this.#deps.confirmStep(confirmation)
      if (!result.valid) {
        throw new OrchestrationConfirmationDeniedError(result.reason ?? '确认被拒绝')
      }
    }

    if (confirmation.decision === 'reject') {
      // 拒绝：标记步骤为 cancelled，编排继续下一个
      stepTrace.status = 'cancelled'
      stepTrace.completedAt = new Date().toISOString()
    } else {
      // 确认或修改：标记为 completed
      stepTrace.status = 'completed'
      stepTrace.completedAt = new Date().toISOString()
    }

    trace.updatedAt = new Date().toISOString()

    // 继续执行后续步骤
    return this.#executeSteps(orchestrationId)
  }

  // ── 恢复编排 ──

  /**
   * 恢复一个暂停的编排（D2：复用 resume-replay）。
   */
  async resumeOrchestration(input: ResumeOrchestrationInput): Promise<OrchestrationRunResult> {
    const { orchestrationId, organizationId } = input

    const trace = this.#traces.get(orchestrationId)
    const definition = this.#definitions.get(orchestrationId)
    if (!trace || !definition) {
      throw new OrchestrationNotFoundError(`编排 ${orchestrationId} 不存在`)
    }

    // 组织隔离
    if (definition.organizationId !== organizationId) {
      throw new OrchestrationOrganizationIsolationError('不可访问他组织编排')
    }

    if (trace.status !== 'paused') {
      throw new OrchestrationStateError(`编排状态 ${trace.status} 不允许恢复`)
    }

    return this.#executeSteps(orchestrationId)
  }

  // ── 重试失败步骤 ──

  /**
   * D5：重试失败步骤，不重复执行已成功步骤。
   */
  async retryStep(input: RetryStepInput): Promise<OrchestrationRunResult> {
    const { orchestrationId, stepId, organizationId } = input

    const trace = this.#traces.get(orchestrationId)
    const definition = this.#definitions.get(orchestrationId)
    if (!trace || !definition) {
      throw new OrchestrationNotFoundError(`编排 ${orchestrationId} 不存在`)
    }

    // 组织隔离
    if (definition.organizationId !== organizationId) {
      throw new OrchestrationOrganizationIsolationError('不可访问他组织编排')
    }

    // 查找步骤
    const stepIndex = definition.steps.findIndex((s) => s.stepId === stepId)
    if (stepIndex === -1) {
      throw new OrchestrationStepNotFoundError(`步骤 ${stepId} 不存在`)
    }

    const stepTrace = trace.steps[stepIndex]
    if (stepTrace.status !== 'failed') {
      throw new OrchestrationStateError(`步骤 ${stepId} 状态 ${stepTrace.status} 不允许重试`)
    }

    // 重置步骤状态为 pending
    stepTrace.status = 'pending'
    stepTrace.error = undefined
    stepTrace.startedAt = undefined
    stepTrace.completedAt = undefined
    stepTrace.durationMs = undefined
    stepTrace.artifactRef = undefined

    trace.status = 'running'
    trace.updatedAt = new Date().toISOString()

    return this.#executeSteps(orchestrationId)
  }

  // ── 查询 ──

  /** 获取编排轨迹 */
  getTrace(orchestrationId: string): OrchestrationTrace | undefined {
    return this.#traces.get(orchestrationId)
  }

  /** 获取编排定义 */
  getDefinition(orchestrationId: string): OrchestrationDefinition | undefined {
    return this.#definitions.get(orchestrationId)
  }

  /** 获取编排状态 */
  getState(orchestrationId: string): OrchestrationState | undefined {
    return this.#traces.get(orchestrationId)?.status
  }

  // ── 私有方法 ──

  /**
   * 验证步骤定义：步骤 ID 唯一，依赖存在，无循环。
   */
  #validateStepDefinitions(steps: OrchestrationStepDefinition[]): void {
    const ids = new Set<string>()
    for (const step of steps) {
      if (ids.has(step.stepId)) {
        throw new OrchestrationValidationError(`步骤 ID ${step.stepId} 重复`)
      }
      ids.add(step.stepId)

      // 验证依赖存在
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!ids.has(dep)) {
            throw new OrchestrationValidationError(
              `步骤 ${step.stepId} 依赖 ${dep}，但该依赖不在其前面`,
            )
          }
        }
      }

      // mutation 步骤必须有 targets
      if (step.kind === 'mutation' && (!step.targets || step.targets.length === 0)) {
        throw new OrchestrationValidationError(`变更步骤 ${step.stepId} 必须指定 targets`)
      }
    }
  }

  /**
   * 执行步骤：从当前暂停/待执行位置继续。
   * D1：只读连续，变更逐个停。
   * D4：每步预算判定。
   */
  async #executeSteps(orchestrationId: string): Promise<OrchestrationRunResult> {
    const trace = this.#traces.get(orchestrationId)!
    const definition = this.#definitions.get(orchestrationId)!
    const ceiling = this.#ceilings.get(orchestrationId)!

    trace.status = 'running'
    trace.updatedAt = new Date().toISOString()

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i]
      const stepTrace = trace.steps[i]

      // 跳过已完成/已取消的步骤
      if (stepTrace.status === 'completed' || stepTrace.status === 'cancelled') {
        continue
      }

      // 检查依赖是否满足
      if (step.dependsOn) {
        const depsMet = step.dependsOn.every((depId) => {
          const depIndex = definition.steps.findIndex((s) => s.stepId === depId)
          return depIndex >= 0 && trace.steps[depIndex].status === 'completed'
        })
        if (!depsMet) {
          stepTrace.status = 'pending'
          continue
        }
      }

      // D7：检查时长上限
      const elapsed = Date.now() - new Date(trace.createdAt).getTime()
      if (ceiling.maxDurationMs != null && elapsed >= ceiling.maxDurationMs) {
        trace.status = 'paused'
        stepTrace.status = 'paused'
        trace.updatedAt = new Date().toISOString()
        return this.#buildResult(orchestrationId, 'paused', '触及时长上限', undefined, true)
      }

      // D7：检查步数上限（已完成步骤数）
      const completedCount = trace.steps.filter((s) => s.status === 'completed').length
      if (ceiling.maxSteps != null && completedCount >= ceiling.maxSteps) {
        trace.status = 'paused'
        stepTrace.status = 'paused'
        trace.updatedAt = new Date().toISOString()
        return this.#buildResult(orchestrationId, 'paused', '触及步数上限', undefined, true)
      }

      // D4：预算逐步判定
      if (this.#deps.budgetPreflight) {
        const budgetResult = await this.#deps.budgetPreflight(step.stepId)
        if (!budgetResult.allowed) {
          trace.status = 'paused'
          stepTrace.status = 'paused'
          trace.updatedAt = new Date().toISOString()
          return this.#buildResult(
            orchestrationId,
            'paused',
            `预算不足：${budgetResult.reason}`,
            undefined,
            true,
          )
        }
      }

      // 权限逐步判定
      if (this.#deps.checkPermission) {
        const permResult = await this.#deps.checkPermission(step.stepId)
        if (!permResult.allowed) {
          stepTrace.status = 'failed'
          stepTrace.error = `权限不足：${permResult.reason}`
          stepTrace.completedAt = new Date().toISOString()
          trace.status = 'failed'
          trace.updatedAt = new Date().toISOString()
          return this.#buildResult(orchestrationId, 'failed', stepTrace.error, step.stepId)
        }
      }

      // D1：mutation 步骤停在确认点
      if (step.kind === 'mutation') {
        trace.status = 'paused'
        stepTrace.status = 'paused'
        stepTrace.startedAt = new Date().toISOString()
        trace.updatedAt = new Date().toISOString()
        return this.#buildResult(orchestrationId, 'paused', undefined, undefined, true)
      }

      // D1：readonly 步骤连续执行
      stepTrace.status = 'running'
      stepTrace.startedAt = new Date().toISOString()

      // 模拟只读步骤执行（实际应调用对应的 handler）
      stepTrace.status = 'completed'
      stepTrace.completedAt = new Date().toISOString()
      stepTrace.durationMs = 100 // 模拟耗时
      stepTrace.artifactRef = `artifact-${step.stepId}`

      trace.updatedAt = new Date().toISOString()
    }

    // 所有步骤完成
    trace.status = 'completed'
    trace.updatedAt = new Date().toISOString()

    // 更新 CompilerRun 终态
    const runId = this.#runIdMap.get(orchestrationId)
    if (runId) {
      await CompilerRun.query()
        .where('id', runId)
        .update({ status: 'completed', completedAt: new Date().toISOString() })
    }

    return this.#buildResult(orchestrationId, 'completed')
  }

  /**
   * 构建返回结果。
   */
  #buildResult(
    orchestrationId: string,
    status: OrchestrationState,
    error?: string,
    failedStepId?: string,
    awaitingDecision?: boolean,
  ): OrchestrationRunResult {
    const trace = this.#traces.get(orchestrationId)!
    const definition = this.#definitions.get(orchestrationId)!
    const completedSteps = trace.steps.filter((s) => s.status === 'completed').length

    return {
      orchestrationId,
      completed: status === 'completed',
      status,
      completedSteps,
      totalSteps: definition.steps.length,
      failedStepId,
      error,
      awaitingDecision,
    }
  }
}

// ── 错误类型 ──

export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationError'
  }
}

export class OrchestrationNotFoundError extends OrchestrationError {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationNotFoundError'
  }
}

export class OrchestrationValidationError extends OrchestrationError {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationValidationError'
  }
}

export class OrchestrationCeilingExceededError extends OrchestrationError {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationCeilingExceededError'
  }
}

export class OrchestrationStateError extends OrchestrationError {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationStateError'
  }
}

export class OrchestrationStepNotFoundError extends OrchestrationError {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationStepNotFoundError'
  }
}

export class OrchestrationConfirmationDeniedError extends OrchestrationError {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationConfirmationDeniedError'
  }
}

export class OrchestrationOrganizationIsolationError extends OrchestrationError {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationOrganizationIsolationError'
  }
}
