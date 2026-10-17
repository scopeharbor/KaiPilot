/**
 * PdmMergeGuard —— PDM 合并前实体 ID 校验与幂等保护。
 *
 * 所有进入 PDM 合并的实体必须：
 * - 存在于 Manifest（拒绝未知实体）
 * - 不重复提交（幂等键保护）
 * - 通过前置验证
 *
 * @aiproj/backend compiler
 */

import type { GenerationManifest } from '@aiproj/compiler-spec'
import { idempotencyKeyHash } from '@aiproj/compiler-spec'

export interface PdmMergeRequest {
  entityId: string
  stageId: string
  payload: Record<string, unknown>
  contractVersion: number
  manifestVersion: number
  attemptNumber: number
  compilerRunId: number
}

export interface PdmMergeResult {
  accepted: boolean
  entityId: string
  reason?: string
  idempotencyHash?: string
}

interface ProcessedMerge {
  idempotencyHash: string
  entityId: string
  timestamp: string
}

/**
 * PdmMergeGuard —— PDM 合并前校验与幂等保护。
 * 确保只有 Manifest 登记的实体能进入 PDM。
 */
export class PdmMergeGuard {
  /** 已处理的合并（内存缓存，用于运行时幂等检查）。 */
  readonly #processed = new Map<string, ProcessedMerge>()

  /**
   * 校验 PDM 合并请求。
   * - 检查实体存在性
   * - 检查幂等性（重复提交被忽略）
   */
  validate(request: PdmMergeRequest, manifest: GenerationManifest): PdmMergeResult {
    // 1. 检查实体存在于 Manifest
    const manifestEntity = manifest.entities.find((e) => e.entityId === request.entityId)
    if (!manifestEntity) {
      return {
        accepted: false,
        entityId: request.entityId,
        reason: `Unknown entity: ${request.entityId}. Entity must exist in Manifest.`,
      }
    }

    // 2. 生成幂等 hash
    const idHash = idempotencyKeyHash('pdm_merge', {
      compilerRunId: request.compilerRunId,
      stageId: request.stageId,
      entityId: request.entityId,
      contractVersion: request.contractVersion,
      manifestVersion: request.manifestVersion,
      attemptNumber: request.attemptNumber,
    })

    // 3. 幂等检查（同一 attempt 的合并拒绝重复）
    const existing = this.#processed.get(request.entityId)
    if (existing && existing.idempotencyHash === idHash) {
      return {
        accepted: false,
        entityId: request.entityId,
        reason: `Duplicate PDM merge request for entity ${request.entityId} (idempotent)`,
        idempotencyHash: idHash,
      }
    }

    // 4. 接受
    this.#processed.set(request.entityId, {
      idempotencyHash: idHash,
      entityId: request.entityId,
      timestamp: new Date().toISOString(),
    })

    return {
      accepted: true,
      entityId: request.entityId,
      idempotencyHash: idHash,
    }
  }

  /**
   * 检查实体是否已被合并到 PDM。
   * 用于 Resume 时判断是否可跳过。
   */
  isAlreadyMerged(entityId: string): boolean {
    return this.#processed.has(entityId)
  }

  /**
   * 清除某次 run 的已处理记录。
   */
  clear(entityId?: string): void {
    if (entityId) {
      this.#processed.delete(entityId)
    } else {
      this.#processed.clear()
    }
  }
}
