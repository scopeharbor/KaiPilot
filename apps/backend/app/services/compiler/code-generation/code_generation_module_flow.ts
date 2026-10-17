/**
 * Module-flow gate for the 34-stage code generation candidate pipeline.
 *
 * The flow service keeps stage memory as candidate refs. It does not call
 * models, write repository files, install packages, or mutate formal project
 * data.
 */

import {
  buildCodeGenerationModuleFlowSnapshot,
  createCodeGenerationHumanReviewPacket,
  createCodeGenerationModuleMemoryRecord,
  getCodeGenerationStageDefinition,
  validateCodeGenerationHumanReviewReadiness,
  validateCodeGenerationModuleMemoryRecord,
  type CodeCandidateBundleValidation,
  type CodeGenerationHumanReviewPacket,
  type CodeGenerationModuleFlowSnapshot,
  type CodeGenerationModuleMemoryRecord,
  type CodeGenerationStageId,
  type CodeGenerationStageRuntimeFrame,
  type CodeGenerationToolInvocation,
  type CodeGenerationToolProvider,
  type CodeGenerationToolResult,
} from '@aiproj/types/compiler-code-generation'
import { CodeGenerationStageRuntime } from './code_generation_stage_runtime.js'

export interface CodeGenerationModuleMemoryPort {
  list(runtimeSessionId: string): Promise<CodeGenerationModuleMemoryRecord[]>
  save(record: CodeGenerationModuleMemoryRecord): Promise<CodeGenerationModuleMemoryRecord>
}

export class InMemoryCodeGenerationModuleMemory implements CodeGenerationModuleMemoryPort {
  readonly #records = new Map<string, CodeGenerationModuleMemoryRecord>()

  async list(runtimeSessionId: string): Promise<CodeGenerationModuleMemoryRecord[]> {
    return Array.from(this.#records.values())
      .filter((record) => record.runtimeSessionId === runtimeSessionId)
      .sort((a, b) => {
        const aOrder = getCodeGenerationStageDefinition(a.stageId)?.order ?? 0
        const bOrder = getCodeGenerationStageDefinition(b.stageId)?.order ?? 0
        return aOrder - bOrder
      })
      .map(cloneMemoryRecord)
  }

  async save(record: CodeGenerationModuleMemoryRecord): Promise<CodeGenerationModuleMemoryRecord> {
    const key = memoryKey(record.runtimeSessionId, record.stageId)
    const existing = this.#records.get(key)
    if (existing) return cloneMemoryRecord(existing)

    this.#records.set(key, cloneMemoryRecord(record))
    return cloneMemoryRecord(record)
  }
}

export interface CodeGenerationModuleFlowInput {
  runtimeSessionId: string
  provider: CodeGenerationToolProvider
}

export interface CodeGenerationStageCompletionInput extends CodeGenerationModuleFlowInput {
  stageId: CodeGenerationStageId
  artifactRefs?: string[]
  observationRefs?: string[]
  toolCallIds?: string[]
  summary: string
  completedAt?: string
}

export interface CodeGenerationStageCompletionResult {
  record?: CodeGenerationModuleMemoryRecord
  snapshot: CodeGenerationModuleFlowSnapshot
  validation: CodeCandidateBundleValidation
}

export interface CodeGenerationReviewGateResult {
  snapshot: CodeGenerationModuleFlowSnapshot
  validation: CodeCandidateBundleValidation
  reviewPacket?: CodeGenerationHumanReviewPacket
}

export class CodeGenerationModuleFlowService {
  constructor(
    private readonly runtime = new CodeGenerationStageRuntime(),
    private readonly memory: CodeGenerationModuleMemoryPort = new InMemoryCodeGenerationModuleMemory(),
  ) {}

  async getSnapshot(
    input: CodeGenerationModuleFlowInput,
  ): Promise<CodeGenerationModuleFlowSnapshot> {
    return buildCodeGenerationModuleFlowSnapshot({
      runtimeSessionId: input.runtimeSessionId,
      provider: input.provider,
      records: await this.memory.list(input.runtimeSessionId),
    })
  }

  async buildFrameForStage(
    input: CodeGenerationModuleFlowInput & { stageId: CodeGenerationStageId },
  ) {
    const stageDef = getCodeGenerationStageDefinition(input.stageId)
    if (!stageDef) throw new Error(`Unknown code generation stage: ${input.stageId}`)

    const records = await this.memory.list(input.runtimeSessionId)
    const dependencyValidation = validateDependencies(stageDef.dependsOn, records)
    if (!dependencyValidation.ok) {
      throw new Error(dependencyValidation.violations.join('; '))
    }

    const dependencyRecords = records.filter((record) =>
      stageDef.dependsOn.includes(record.stageId),
    )
    const artifactRefs = uniqueStrings(dependencyRecords.flatMap((record) => record.artifactRefs))
    const evidenceRefs = uniqueStrings(
      dependencyRecords.flatMap((record) => record.observationRefs),
    )
    const frame = this.runtime.buildFrame({
      stageId: input.stageId,
      provider: input.provider,
      runtimeSessionId: input.runtimeSessionId,
      context: {
        artifactRefs,
        evidenceRefs,
        data: {
          dependencyStageIds: [...stageDef.dependsOn],
          upstreamArtifactRefs: artifactRefs,
          upstreamObservationRefs: evidenceRefs,
        },
      },
    })
    const validation = this.runtime.validateFrame(frame)
    if (!validation.ok) throw new Error(validation.violations.join('; '))

    return frame
  }

  async buildNextFrame(
    input: CodeGenerationModuleFlowInput,
  ): Promise<CodeGenerationStageRuntimeFrame | undefined> {
    const snapshot = await this.getSnapshot(input)
    if (!snapshot.currentStageId) return undefined

    return this.buildFrameForStage({
      ...input,
      stageId: snapshot.currentStageId,
    })
  }

  async completeStage(
    input: CodeGenerationStageCompletionInput,
  ): Promise<CodeGenerationStageCompletionResult> {
    const stageDef = getCodeGenerationStageDefinition(input.stageId)
    if (!stageDef) {
      const snapshot = await this.getSnapshot(input)
      return {
        snapshot,
        validation: {
          ok: false,
          reasonCodes: ['CODEGEN_VALIDATION_FAILED'],
          violations: [`Unknown code generation stage: ${input.stageId}`],
        },
      }
    }

    const records = await this.memory.list(input.runtimeSessionId)
    const dependencyValidation = validateDependencies(stageDef.dependsOn, records)
    if (!dependencyValidation.ok) {
      return {
        snapshot: await this.getSnapshot(input),
        validation: dependencyValidation,
      }
    }

    const record = createCodeGenerationModuleMemoryRecord({
      runtimeSessionId: input.runtimeSessionId,
      stageId: input.stageId,
      artifactRefs: input.artifactRefs ?? [
        defaultArtifactRef(input.runtimeSessionId, input.stageId),
      ],
      observationRefs: input.observationRefs ?? [],
      toolCallIds: input.toolCallIds ?? [],
      summary: input.summary,
      completedAt: input.completedAt,
    })
    const recordValidation = validateCodeGenerationModuleMemoryRecord(record)
    if (!recordValidation.ok) {
      return {
        snapshot: await this.getSnapshot(input),
        validation: recordValidation,
      }
    }

    const saved = await this.memory.save(record)
    return {
      record: saved,
      snapshot: await this.getSnapshot(input),
      validation: {
        ok: true,
        reasonCodes: ['CODEGEN_PLAN_READY'],
        violations: [],
      },
    }
  }

  async completeStageFromToolResult(params: {
    frame: CodeGenerationStageRuntimeFrame
    invocation: CodeGenerationToolInvocation
    result: CodeGenerationToolResult
    provider: CodeGenerationToolProvider
  }): Promise<CodeGenerationStageCompletionResult> {
    const resultValidation = this.runtime.validateResult(
      params.frame,
      params.invocation,
      params.result,
    )
    if (!resultValidation.ok) {
      return {
        snapshot: await this.getSnapshot({
          runtimeSessionId: params.frame.runtimeSessionId,
          provider: params.provider,
        }),
        validation: resultValidation,
      }
    }

    return this.completeStage({
      runtimeSessionId: params.frame.runtimeSessionId,
      provider: params.provider,
      stageId: params.frame.stageId,
      artifactRefs: params.result.artifactRefs,
      observationRefs: readStringArrayMetadata(params.result.metadata, 'observationRefs'),
      toolCallIds: [params.invocation.callId],
      summary: params.result.summary,
    })
  }

  async requestHumanReview(
    input: CodeGenerationModuleFlowInput,
  ): Promise<CodeGenerationReviewGateResult> {
    const snapshot = await this.getSnapshot(input)
    const validation = validateCodeGenerationHumanReviewReadiness(snapshot)
    const reviewPacket = createCodeGenerationHumanReviewPacket(snapshot)

    return {
      snapshot,
      validation,
      reviewPacket,
    }
  }
}

export function createCodeGenerationModuleFlowService(): CodeGenerationModuleFlowService {
  return new CodeGenerationModuleFlowService()
}

function memoryKey(runtimeSessionId: string, stageId: CodeGenerationStageId): string {
  return `${runtimeSessionId}:${stageId}`
}

function cloneMemoryRecord(
  record: CodeGenerationModuleMemoryRecord,
): CodeGenerationModuleMemoryRecord {
  return {
    ...record,
    artifactRefs: [...record.artifactRefs],
    observationRefs: [...record.observationRefs],
    toolCallIds: [...record.toolCallIds],
  }
}

function validateDependencies(
  dependencyStageIds: readonly CodeGenerationStageId[],
  records: readonly CodeGenerationModuleMemoryRecord[],
): CodeCandidateBundleValidation {
  const completed = new Set(records.map((record) => record.stageId))
  const missing = dependencyStageIds.filter((stageId) => !completed.has(stageId))

  return {
    ok: missing.length === 0,
    reasonCodes:
      missing.length === 0 ? ['CODEGEN_PLAN_READY'] : ['CODEGEN_STAGE_DEPENDENCY_INCOMPLETE'],
    violations: missing.length === 0 ? [] : [`incomplete dependency stages: ${missing.join(', ')}`],
  }
}

function defaultArtifactRef(runtimeSessionId: string, stageId: CodeGenerationStageId): string {
  return `codegen-candidate://${runtimeSessionId}/${stageId}`
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function readStringArrayMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const value = metadata?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
