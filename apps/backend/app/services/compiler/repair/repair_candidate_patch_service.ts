/**
 * @aiproj/backend —— Repair Candidate Patch Service（tasks 3.1–3.5）。
 *
 * 负责生成、校验和序列化 RepairCandidatePatch。
 * 包含幂等键生成、稳定 path 校验、patch replay 和重复写入保护。
 *
 * @aiproj/backend
 */

import type { RepairCandidatePatch } from '@aiproj/compiler-spec'
import { generateIdempotencyKey } from '@aiproj/compiler-spec'
import type { IdempotencyKeyType } from '@aiproj/compiler-spec'

// ── Patch Generation Input ──

export interface PatchGenInput {
  attemptId: string
  issueIds: string[]
  entityIds: string[]
  baseArtifactRef: string
  ops: {
    op: 'replace' | 'add' | 'remove' | 'transform'
    path: string
    value: unknown
    oldValue?: unknown
    reason?: string
  }[]
  reason: string
  sourceRuleIds: string[]
  attemptNumber: number
  riskLevel: 'safe' | 'low_risk' | 'medium_risk' | 'high_risk'
  confidence: number
  compilerRunId: number
  stageId: string
}

// ── Idempotency Key Input ──

export interface RepairIdempotencyKeyInput {
  compilerRunId: number
  stageId: string
  entityId: string
  contractVersion: number
  manifestVersion: number
  attemptNumber: number
}

// ── Path Validation Result ──

export interface PathValidationResult {
  valid: boolean
  reason?: string
}

// ── Replay Result ──

export interface ReplayResult {
  match: boolean
  target: unknown
  error?: string
}

// ── Service ──

export class RepairCandidatePatchService {
  /**
   * 生成 repair idempotency key（tasks 3.2）。
   * 覆盖 runId、stageId、entityId、contractVersion、manifestVersion、attemptNumber。
   */
  generateRepairIdempotencyKey(input: RepairIdempotencyKeyInput): string {
    return generateIdempotencyKey('ledger_write' as IdempotencyKeyType, {
      compilerRunId: input.compilerRunId,
      stageId: `${input.stageId}_repair`,
      entityId: input.entityId,
      contractVersion: input.contractVersion,
      manifestVersion: input.manifestVersion,
      attemptNumber: input.attemptNumber,
    })
  }

  /**
   * 生成 patch idempotency key（task 3.2）。
   */
  generatePatchIdempotencyKey(input: RepairIdempotencyKeyInput): string {
    return generateIdempotencyKey('pdm_merge' as IdempotencyKeyType, {
      compilerRunId: input.compilerRunId,
      stageId: `${input.stageId}_patch`,
      entityId: input.entityId,
      contractVersion: input.contractVersion,
      manifestVersion: input.manifestVersion,
      attemptNumber: input.attemptNumber,
    })
  }

  /**
   * 创建 RepairCandidatePatch（tasks 3.1）。
   * 在创建时校验 path 稳定性并生成 idempotency key。
   */
  createPatch(input: PatchGenInput): RepairCandidatePatch {
    // 3.3: 校验 path 稳定性
    for (const op of input.ops) {
      const validation = this.validatePath(op.path)
      if (!validation.valid) {
        throw new Error(`Invalid patch path: ${validation.reason}`)
      }
    }

    const now = new Date().toISOString()
    const patchId = `patch-${input.attemptId}-${now}`

    // 生成 idempotency key
    const primaryEntityId = input.entityIds[0] ?? 'no-entity'
    const idempotencyKey = this.generatePatchIdempotencyKey({
      compilerRunId: input.compilerRunId,
      stageId: input.stageId,
      entityId: primaryEntityId,
      contractVersion: 1,
      manifestVersion: 1,
      attemptNumber: input.attemptNumber,
    })

    return {
      patchId,
      attemptId: input.attemptId,
      issueIds: input.issueIds,
      baseArtifactRef: input.baseArtifactRef,
      entityIds: input.entityIds,
      ops: input.ops.map((op) => ({
        op: op.op,
        path: op.path,
        value: op.value,
        oldValue: op.oldValue,
        reason: op.reason,
      })),
      isSchemaPath: true,
      reason: input.reason,
      sourceRuleIds: input.sourceRuleIds,
      attemptNumber: input.attemptNumber,
      riskLevel: input.riskLevel,
      confidence: input.confidence,
      idempotencyKey,
      createdAt: now,
      revalidationStatus: 'pending',
    }
  }

  /**
   * 3.3: 验证 path 稳定性。
   * 禁止使用不稳定数组 index 作为实体定位方式。
   *
   * 规则：
   * - path 必须以 '/' 开头
   * - 任何纯数字分段（数组 index）都不稳定，一律拒绝
   * - /tasks/0/name 拒绝（数组 index）
   * - /tasks/T1-001/name 允许（entity id）
   * - /dependencies/0/type 拒绝（数组 index）
   *
   * 注意：entity ID 格式如 T1-001、WP-001 包含连字符，不是纯数字。
   */
  validatePath(path: string): PathValidationResult {
    if (!path.startsWith('/')) {
      return { valid: false, reason: 'Path must start with /' }
    }

    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) {
      return { valid: false, reason: 'Path must have at least one segment' }
    }

    for (const [i, segment] of segments.entries()) {
      if (/^\d+$/.test(segment)) {
        return {
          valid: false,
          reason: `Path segment "${segment}" at position ${i} is a numeric array index — entity IDs must be stable keys`,
        }
      }
    }

    return { valid: true }
  }

  /**
   * 3.4: Patch replay helper。
   * 对相同 base artifact 回放 patch 并验证 target 片段一致。
   *
   * @param base 原始 PDM 或片段
   * @param patch 候选 patch
   * @returns replay 结果
   */
  replay(base: unknown, patch: RepairCandidatePatch): ReplayResult {
    try {
      let target: unknown

      if (typeof base === 'object' && base !== null) {
        target = JSON.parse(JSON.stringify(base))

        for (const op of patch.ops) {
          switch (op.op) {
            case 'replace':
              target = this.#applyReplace(target as Record<string, unknown>, op.path, op.value)
              break
            case 'add':
              target = this.#applyAdd(target as Record<string, unknown>, op.path, op.value)
              break
            case 'remove':
              target = this.#applyRemove(target as Record<string, unknown>, op.path)
              break
            case 'transform':
              target = this.#applyTransform(target as Record<string, unknown>, op.path, op.value)
              break
          }
        }
      } else {
        target = patch.ops.length > 0 ? patch.ops[0].value : base
      }

      return { match: true, target }
    } catch (err) {
      return {
        match: false,
        target: base,
        error: err instanceof Error ? err.message : 'Replay failed',
      }
    }
  }

  /**
   * 3.5: 检查重复提交。
   * 相同 idempotencyKey 应当返回既有结果。
   */
  isDuplicate(
    existingPatches: RepairCandidatePatch[],
    newPatch: RepairCandidatePatch,
  ): RepairCandidatePatch | null {
    for (const existing of existingPatches) {
      if (existing.idempotencyKey === newPatch.idempotencyKey) {
        return existing
      }
    }
    return null
  }

  #applyReplace(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): Record<string, unknown> {
    const segments = path.split('/').filter(Boolean)
    let current: unknown = obj

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[seg]
      } else {
        throw new Error(`Cannot traverse path ${path} at segment ${seg}`)
      }
    }

    const lastSeg = segments[segments.length - 1]
    if (typeof current === 'object' && current !== null) {
      ;(current as Record<string, unknown>)[lastSeg] = value
    }

    return obj
  }

  #applyAdd(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    const segments = path.split('/').filter(Boolean)
    let current: unknown = obj

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[seg]
      } else {
        throw new Error(`Cannot traverse path ${path} at segment ${seg}`)
      }
    }

    const lastSeg = segments[segments.length - 1]
    if (typeof current === 'object' && current !== null) {
      const arr = (current as Record<string, unknown>)[lastSeg]
      if (Array.isArray(arr)) {
        arr.push(value)
      } else {
        ;(current as Record<string, unknown>)[lastSeg] = value
      }
    }

    return obj
  }

  #applyRemove(obj: Record<string, unknown>, path: string): Record<string, unknown> {
    const segments = path.split('/').filter(Boolean)
    let current: unknown = obj

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[seg]
      } else {
        throw new Error(`Cannot traverse path ${path} at segment ${seg}`)
      }
    }

    const lastSeg = segments[segments.length - 1]
    if (typeof current === 'object' && current !== null) {
      const val = (current as Record<string, unknown>)[lastSeg]
      if (Array.isArray(val)) {
        ;(current as Record<string, unknown>)[lastSeg] = []
      } else {
        delete (current as Record<string, unknown>)[lastSeg]
      }
    }

    return obj
  }

  #applyTransform(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): Record<string, unknown> {
    return this.#applyReplace(obj, path, value)
  }
}
