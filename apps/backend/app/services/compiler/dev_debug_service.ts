/**
 * v2-project-compiler-foundation —— DevDebugService（tasks 9.3, 9.4）。
 *
 * dev-only 调试入口，只在 NODE_ENV !== 'production' 时可用。
 * 用于发起骨架编译、查看 run/events/ledger/pdm。
 * production 下返回 404 或不可达。
 *
 * 复用现有 dev_only_middleware 模式。
 */
import { StageRegistry } from './stage_registry.js'
import { PipelineExecutor, type StageHandler } from './pipeline_executor.js'
import { ArtifactStore, type ArtifactKind } from './artifact_store.js'
import {
  intentIngestionDefinition,
  handleIntentIngestion,
} from './stages/intent_ingestion_stage.js'
import { intentParsingDefinition, handleIntentParsingMock } from './stages/intent_parsing_stage.js'
import { dagStubDefinition, handleDagStub } from './stages/dag_stub_stage.js'

export interface DevSkeletonResult {
  runId: number
  succeeded: boolean
  failedStages: string[]
  checkpointVersion: number
}

export interface ContextPacketSummary {
  packetId: string | null
  compilerRunId: number
  totalSections: number
  totalBudget: number
  totalIncluded: number
  overBudget: boolean
  sections: Array<{
    name: string
    priority: string
    summaryLevel: string
    requested: number
    included: number
    cutReason?: string
  }>
  provenance: {
    contractRef?: string
    manifestRef?: string
    ledgerRef?: string
    repairFeedbackRefs: string[]
    inputScope: string[]
    allowedTools: string[]
  } | null
  found: boolean
}

/**
 * DevDebugService —— dev-only 沙箱，用于快速验证骨架编译。
 *
 * 包含：
 * - 发起骨架编译（3 Stage + Executor + Checkpoint）
 * - 查看 run/events/ledger/pdm
 */
export class DevDebugService {
  readonly #stageRegistry: StageRegistry
  readonly #executor: PipelineExecutor
  readonly #artifactStore: ArtifactStore

  constructor() {
    this.#stageRegistry = new StageRegistry()
    this.#artifactStore = new ArtifactStore()

    // 注册 3 个骨架 Stage
    this.#stageRegistry.register(intentIngestionDefinition)
    this.#stageRegistry.register(intentParsingDefinition)
    this.#stageRegistry.register(dagStubDefinition)

    this.#executor = new PipelineExecutor(this.#stageRegistry)

    // 注册 handler
    this.#executor.registerHandler(
      intentIngestionDefinition,
      handleIntentIngestion as StageHandler<any, any>,
    )
    this.#executor.registerHandler(
      intentParsingDefinition,
      handleIntentParsingMock as StageHandler<any, any>,
    )
    this.#executor.registerHandler(dagStubDefinition, handleDagStub as StageHandler<any, any>)
  }

  get stageRegistry(): StageRegistry {
    return this.#stageRegistry
  }

  get executor(): PipelineExecutor {
    return this.#executor
  }

  get artifactStore(): ArtifactStore {
    return this.#artifactStore
  }

  /**
   * 读取 run 内 context_packet artifact 的 compact 摘要。
   * 用于 debug 接口，只返回 refs 和预算摘要，不返回完整 Context Packet。
   */
  async getContextPacketSummary(
    runId: number,
    organizationId: number,
  ): Promise<ContextPacketSummary> {
    const artifact = await this.#artifactStore.latest(runId, 'context_packet' as ArtifactKind)
    if (!artifact) {
      return {
        packetId: null,
        compilerRunId: runId,
        totalSections: 0,
        totalBudget: 0,
        totalIncluded: 0,
        overBudget: false,
        sections: [],
        provenance: null,
        found: false,
      }
    }

    if (artifact.organizationId !== organizationId) {
      return {
        packetId: null,
        compilerRunId: runId,
        totalSections: 0,
        totalBudget: 0,
        totalIncluded: 0,
        overBudget: false,
        sections: [],
        provenance: null,
        found: false,
      }
    }

    const payload = artifact.payload
    const packet = payload as any

    return {
      packetId: packet.packetId ?? null,
      compilerRunId: runId,
      totalSections: packet.sections?.length ?? 0,
      totalBudget: packet.budget?.totalBudget ?? 0,
      totalIncluded: packet.budget?.totalIncluded ?? 0,
      overBudget: packet.budget?.overBudget ?? false,
      sections: (packet.sections ?? []).map((s: any) => ({
        name: s.name,
        priority: s.priority,
        summaryLevel: s.summaryLevel,
        requested: s.requestedTokens,
        included: s.includedTokens,
        cutReason: s.cutReason,
      })),
      provenance: packet.provenance
        ? {
            contractRef: packet.provenance.contractRef,
            manifestRef: packet.provenance.manifestRef,
            ledgerRef: packet.provenance.ledgerRef,
            repairFeedbackRefs: packet.provenance.repairFeedbackRefs ?? [],
            inputScope: packet.provenance.inputScope ?? [],
            allowedTools: packet.provenance.allowedTools ?? [],
          }
        : null,
      found: true,
    }
  }

  /**
   * 读取 run 内所有 stage 的 input/output artifact refs 简要。
   */
  async getRunStageArtifactRefs(
    runId: number,
  ): Promise<Array<{ stageId: string; contextPacketRef: string | null; outputRefs: string[] }>> {
    const stageOutputs = await this.#artifactStore.getStageOutputs(runId)
    const stageMap = new Map<string, { contextPacketRef: string | null; outputRefs: string[] }>()

    for (const out of stageOutputs) {
      if (out.stageId) {
        const existing = stageMap.get(out.stageId) ?? { contextPacketRef: null, outputRefs: [] }
        if (out.artifactId) existing.outputRefs.push(out.artifactId)
        stageMap.set(out.stageId, existing)
      }
    }

    return Array.from(stageMap.entries()).map(([stageId, refs]) => ({
      stageId,
      contextPacketRef: refs.contextPacketRef,
      outputRefs: refs.outputRefs,
    }))
  }
}
