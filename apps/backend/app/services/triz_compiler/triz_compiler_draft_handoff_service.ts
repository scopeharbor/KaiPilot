/**
 * v2-triz-compiler-analysis-layer —— TrizCompilerDraftHandoffService（tasks 6.3, 6.5-6.7）。
 *
 * 从 TRIZ Compiler analysis artifact 创建 Draft Layer 候选输入。
 * 只创建建议型草案元数据，不写正式项目/任务/资源/风险数据。
 * Draft Layer 必须重新执行 Preview、Diff、dry-run、权限校验和人工确认才能写正式数据。
 */
import CompilerArtifact from '#models/compiler_artifact'
import type User from '#models/user'
import type ContradictionPolicy from '#policies/contradiction_policy'
import type AuditService from '#services/audit_service'
import { AuditEvent } from '#services/audit_service'
import { TrizContradictionReadAdapter } from './contradiction_read_adapter.js'
import { createHash } from 'node:crypto'
import type { TrizAnalysisArtifact, TrizHandoffStatus } from '@aiproj/types'

export interface DraftHandoffInput {
  compilerRunId: number
  artifactId: string
  selectedPathId: string
  organizationId: number
  projectId: number
  user: User
  note?: string
}

export interface DraftHandoffResult {
  handoffStatus: TrizHandoffStatus
  draftSessionRef: string | null
  blockedReason: string | null
}

export class TrizHandoffBlockedError extends Error {
  constructor(reason: string) {
    super(`TRIZ handoff blocked: ${reason}`)
    this.name = 'TrizHandoffBlockedError'
  }
}

export class TrizHandoffNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`TRIZ analysis artifact not found: ${artifactId}`)
    this.name = 'TrizHandoffNotFoundError'
  }
}

/**
 * TrizCompilerDraftHandoffService —— 从 TRIZ analysis artifact 创建 Draft Layer 候选。
 */
export class TrizCompilerDraftHandoffService {
  constructor(
    private contradictionPolicy: ContradictionPolicy,
    private audit: AuditService,
  ) {}

  /**
   * 创建 Draft handoff。
   * 验证：
   * 1. artifact 存在且属于该组织
   * 2. artifact 来源矛盾 hash 未变化（无 stale）
   * 3. selectedPathId 在 artifact 中存在
   * 4. 路径可 handoff（无 blocking warnings）
   *
   * 只创建候选草案元数据，不写正式业务数据。
   */
  async createHandoff(input: DraftHandoffInput): Promise<DraftHandoffResult> {
    const { compilerRunId, artifactId, selectedPathId, organizationId, projectId, user, note } =
      input

    // 1. 读取 artifact
    const artifact = await CompilerArtifact.query()
      .where('compiler_run_id', compilerRunId)
      .where('artifact_id', artifactId)
      .where('organization_id', organizationId)
      .where('kind', 'triz_analysis')
      .first()

    if (!artifact) {
      throw new TrizHandoffNotFoundError(artifactId)
    }

    // 2. 解析 payload 为 TrizAnalysisArtifact
    const analysisArtifact = artifact.payload as unknown as TrizAnalysisArtifact
    if (!analysisArtifact || !analysisArtifact.resolutionPaths) {
      throw new TrizHandoffBlockedError('Artifact payload is not a valid TrizAnalysisArtifact')
    }

    // 3. 验证 selectedPathId
    const selectedPath = analysisArtifact.resolutionPaths.find((p) => p.pathId === selectedPathId)
    if (!selectedPath) {
      throw new TrizHandoffBlockedError(`Resolution path not found: ${selectedPathId}`)
    }

    // 4. 验证 hash 一致性（检测 stale 来源矛盾）
    const adapter = new TrizContradictionReadAdapter(this.contradictionPolicy)
    const currentSnapshots = await adapter.getAuthorizedSnapshots(user, organizationId, projectId)
    const currentSignatures = new Set(currentSnapshots.map((s) => s.inputSignature))
    const artifactSignatures = new Set(analysisArtifact.sourceHashes.inputSignatures)

    // 检查是否有矛盾已变化（签名不匹配）
    for (const sig of artifactSignatures) {
      if (!currentSignatures.has(sig)) {
        return {
          handoffStatus: 'stale',
          draftSessionRef: null,
          blockedReason: '来源矛盾 hash 已变化，请重新运行 TRIZ 分析',
        }
      }
    }

    // 5. 检查路径是否可 handoff
    const { canHandoffResolutionPath } = await import('@aiproj/types')
    const handoffCheck = canHandoffResolutionPath(selectedPath, analysisArtifact.warnings)
    if (!handoffCheck.allowed) {
      return {
        handoffStatus: 'stale',
        draftSessionRef: null,
        blockedReason: handoffCheck.reason ?? '该解决路径无法创建草案',
      }
    }

    // 6. 检查 artifact 是否自我标记需要人工复核
    if (analysisArtifact.requiresHumanReview) {
      return {
        handoffStatus: 'stale',
        draftSessionRef: null,
        blockedReason: '该分析需要人工复核后才能创建草案',
      }
    }

    // 7. 创建草案候选 session ref（只创建元数据，不写正式数据）
    // 这里生成一个稳定的 session ref 作为 Draft Layer 入口
    const draftSessionRef = this.#generateDraftSessionRef(compilerRunId, artifactId, selectedPathId)

    // 8. 记录审计
    await this.audit.log({
      event: AuditEvent.TRIZ_ANALYSIS_HANDOFF_CREATED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'compiler_artifact',
      entityId: null,
      metadata: {
        compilerRunId,
        artifactId,
        selectedPathId,
        draftSessionRef,
        note: note ?? null,
        sourceHash: analysisArtifact.sourceHashes.contentHash,
      },
    })

    return {
      handoffStatus: 'candidate_created',
      draftSessionRef,
      blockedReason: null,
    }
  }

  /**
   * 生成 Draft session ref（稳定标识）。
   */
  #generateDraftSessionRef(compilerRunId: number, artifactId: string, pathId: string): string {
    const raw = `triz_handoff:${compilerRunId}:${artifactId}:${pathId}`
    const hash = createHash('sha256').update(raw, 'utf-8').digest('hex').slice(0, 16)
    return `draft_triz_${hash}`
  }
}
