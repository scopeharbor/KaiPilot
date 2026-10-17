/**
 * 34 阶段代码生成候选运行驱动器。
 *
 * 每一轮都真实走完 frame → provider 原生 tool call → 归一化 → 校验 → 落记忆，
 * 因此 stage-local 工具白名单、跨 stage 拒绝、副作用禁令在生产路径上被真正执行，
 * 而不是仅由单测直接构造入参验证。
 *
 * 边界（红线 1 / V3 baseline A4）：只产候选元数据。不写仓库源码、不装依赖、
 * 不执行脚本、不 commit/deploy/publish、不改动正式项目数据、不提供转正路径。
 */

import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  CODE_GENERATION_CONTRACT_VERSION,
  CODE_GENERATION_STAGE_IDS,
  getCodeGenerationStageDefinition,
  type CodeGenerationHumanReviewPacket,
  type CodeGenerationReasonCode,
  type CodeGenerationStageId,
  type CodeGenerationStageRuntimeFrame,
  type CodeGenerationToolProvider,
} from '@aiproj/types/compiler-code-generation'
import CompilerCodegenCandidateRun from '#models/compiler_codegen_candidate_run'
import type { CompilerCodegenExecutionMode } from '#models/compiler_codegen_candidate_run'
import AuditService from '#services/audit_service'
import { CodeGenerationStageRuntime } from './code_generation_stage_runtime.js'
import { CodeGenerationModuleFlowService } from './code_generation_module_flow.js'
import { DbCodeGenerationModuleMemory } from './codegen_module_memory_repository.js'
import {
  CodegenFixtureProvider,
  type CodegenCandidateProvider,
} from './codegen_fixture_provider.js'

export const CODEGEN_STAGE_TOTAL = CODE_GENERATION_STAGE_IDS.length

const FIRST_STAGE_ID = CODE_GENERATION_STAGE_IDS[0] as CodeGenerationStageId

export interface CodegenCandidateRunInput {
  organizationId: number
  projectId: number
  actorId: number
  provider: CodeGenerationToolProvider
  runtimeSessionId: string
  executionMode?: CompilerCodegenExecutionMode
}

export interface CodegenCandidateRunOutcome {
  run: CompilerCodegenCandidateRun
  completedStageCount: number
  halted: boolean
  failureStageId?: CodeGenerationStageId
  failureReasonCode?: CodeGenerationReasonCode
  violations: string[]
}

/** 驱动器内部的停机信号，由事务边界捕获后转成 halted 状态。 */
class CodegenHalt extends Error {
  constructor(
    readonly stageId: CodeGenerationStageId,
    readonly reasonCode: CodeGenerationReasonCode,
    readonly violations: string[],
  ) {
    super(`codegen halted at ${stageId}: ${reasonCode}`)
  }
}

interface DriveResult {
  completedStageCount: number
  reviewPacket: CodeGenerationHumanReviewPacket | null
}

export class CodegenCandidateRunService {
  constructor(
    private readonly provider: CodegenCandidateProvider = new CodegenFixtureProvider(),
    private readonly runtime = new CodeGenerationStageRuntime(),
  ) {}

  /**
   * 创建并执行一次候选运行，推进到 34/34 或在首个被拒的 stage 停机。
   *
   * 事务只包住 stage 记录：停机时回滚全部已写入的 stage 记录（不部分提交），
   * run 头留在事务外，用来承载 halted 状态与失败 reason code。
   */
  async execute(input: CodegenCandidateRunInput): Promise<CodegenCandidateRunOutcome> {
    const executionMode: CompilerCodegenExecutionMode = input.executionMode ?? 'fixture'

    const run = await CompilerCodegenCandidateRun.create({
      organizationId: input.organizationId,
      projectId: input.projectId,
      createdBy: input.actorId,
      runtimeSessionId: input.runtimeSessionId,
      catalogVersion: CODE_GENERATION_CONTRACT_VERSION,
      provider: input.provider,
      executionMode,
      status: 'running',
      stageCount: CODEGEN_STAGE_TOTAL,
      completedStageCount: 0,
      currentStageId: FIRST_STAGE_ID,
    })

    await new AuditService().log({
      event: 'CODEGEN_CANDIDATE_RUN_STARTED',
      userId: input.actorId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      entityType: 'compiler_codegen_candidate_run',
      entityId: run.id,
      metadata: {
        catalogVersion: CODE_GENERATION_CONTRACT_VERSION,
        executionMode,
        provider: input.provider,
        stageCount: CODEGEN_STAGE_TOTAL,
      },
    })

    let halt: CodegenHalt | undefined
    let drive: DriveResult = { completedStageCount: 0, reviewPacket: null }

    try {
      drive = await db.transaction(async (trx) => this.#driveStages(run, trx))
    } catch (error) {
      if (!(error instanceof CodegenHalt)) throw error
      halt = error
    }

    if (halt) {
      run.status = 'halted'
      run.completedStageCount = 0
      run.currentStageId = halt.stageId
      run.failureStageId = halt.stageId
      run.failureReasonCode = halt.reasonCode
      run.failureViolationsJson = halt.violations
      await run.save()

      await new AuditService().log({
        event: 'CODEGEN_CANDIDATE_RUN_HALTED',
        severity: 'warning',
        userId: input.actorId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        entityType: 'compiler_codegen_candidate_run',
        entityId: run.id,
        metadata: { failureStageId: halt.stageId, failureReasonCode: halt.reasonCode },
      })

      return {
        run,
        completedStageCount: 0,
        halted: true,
        failureStageId: halt.stageId,
        failureReasonCode: halt.reasonCode,
        violations: halt.violations,
      }
    }

    run.status = 'candidate_ready_pending_review'
    run.completedStageCount = drive.completedStageCount
    run.currentStageId = null
    run.reviewPacketJson = drive.reviewPacket
    run.completedAt = DateTime.now()
    await run.save()

    await new AuditService().log({
      event: 'CODEGEN_CANDIDATE_RUN_READY_FOR_REVIEW',
      userId: input.actorId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      entityType: 'compiler_codegen_candidate_run',
      entityId: run.id,
      metadata: { completedStageCount: drive.completedStageCount, requiresHumanReview: true },
    })

    return { run, completedStageCount: drive.completedStageCount, halted: false, violations: [] }
  }

  /** 34 轮推进主体。任一轮被拒即抛 CodegenHalt，由事务回滚已写入的 stage 记录。 */
  async #driveStages(
    run: CompilerCodegenCandidateRun,
    trx: TransactionClientContract,
  ): Promise<DriveResult> {
    const memory = new DbCodeGenerationModuleMemory({
      runId: run.id,
      organizationId: run.organizationId,
      client: trx,
    })
    const flow = new CodeGenerationModuleFlowService(this.runtime, memory)
    const flowInput = { runtimeSessionId: run.runtimeSessionId, provider: run.provider }
    const seenCallIds: string[] = []

    for (let round = 0; round < CODEGEN_STAGE_TOTAL; round += 1) {
      const frame = await this.#buildNextFrame(flow, flowInput)
      if (!frame) break

      const raw = this.provider.produceRawToolCall(frame)
      const normalization = this.runtime.normalizeInvocation(frame, raw, seenCallIds)
      if (!normalization.validation.ok || !normalization.invocation) {
        throw new CodegenHalt(
          frame.stageId,
          firstReasonCode(normalization.validation.reasonCodes),
          normalization.validation.violations,
        )
      }
      const invocation = normalization.invocation
      seenCallIds.push(invocation.callId)

      const result = this.provider.produceToolResult(frame, invocation)

      // 落库前登记 frame 证据：该 stage 实际可见的工具与上下文域
      memory.registerStageEvidence(frame.stageId, {
        contextScope: frame.contextPacket.scope,
        visibleToolIds: frame.visibleTools.map((tool) => tool.toolId),
        reasonCode: 'CODEGEN_PLAN_READY',
      })

      const completion = await flow.completeStageFromToolResult({
        frame,
        invocation,
        result,
        provider: run.provider,
      })
      if (!completion.validation.ok) {
        throw new CodegenHalt(
          frame.stageId,
          firstReasonCode(completion.validation.reasonCodes),
          completion.validation.violations,
        )
      }
    }

    const gate = await flow.requestHumanReview(flowInput)
    if (!gate.validation.ok) {
      throw new CodegenHalt(
        gate.snapshot.currentStageId ?? FIRST_STAGE_ID,
        gate.snapshot.reviewGateReason,
        gate.validation.violations,
      )
    }

    return {
      completedStageCount: gate.snapshot.completedStageIds.length,
      reviewPacket: gate.reviewPacket ?? null,
    }
  }

  /**
   * `buildNextFrame` 在依赖不全时 **抛异常** 而非返回 validation
   * （见 code_generation_module_flow.ts 的 buildFrameForStage）。这里捕获并映射为
   * 稳定 reason code，避免漏成 500。
   */
  async #buildNextFrame(
    flow: CodeGenerationModuleFlowService,
    flowInput: { runtimeSessionId: string; provider: CodeGenerationToolProvider },
  ): Promise<CodeGenerationStageRuntimeFrame | undefined> {
    try {
      return await flow.buildNextFrame(flowInput)
    } catch (error) {
      const snapshot = await flow.getSnapshot(flowInput)
      const stageId = snapshot.currentStageId ?? FIRST_STAGE_ID
      const message = error instanceof Error ? error.message : 'failed to build stage frame'
      const reasonCode: CodeGenerationReasonCode = message.includes('incomplete dependency stages')
        ? 'CODEGEN_STAGE_DEPENDENCY_INCOMPLETE'
        : 'CODEGEN_VALIDATION_FAILED'
      throw new CodegenHalt(stageId, reasonCode, [message])
    }
  }
}

function firstReasonCode(
  reasonCodes: readonly CodeGenerationReasonCode[],
): CodeGenerationReasonCode {
  return reasonCodes[0] ?? 'CODEGEN_VALIDATION_FAILED'
}

export function createCodegenCandidateRunService(): CodegenCandidateRunService {
  return new CodegenCandidateRunService()
}

/** 供只读查询复用：把 stage 定义映射成低敏展示元数据。 */
export function describeCodegenStage(stageId: CodeGenerationStageId) {
  const definition = getCodeGenerationStageDefinition(stageId)
  if (!definition) return undefined
  return {
    stageId: definition.id,
    order: definition.order,
    phase: definition.phase,
    artifactKind: definition.artifactKind,
    contextScope: definition.contextScope,
    allowedTools: [...definition.allowedTools],
    dependsOn: [...definition.dependsOn],
  }
}
