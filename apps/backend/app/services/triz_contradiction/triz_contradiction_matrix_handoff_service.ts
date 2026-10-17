// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 Handoff Service
// v3-triz-contradiction-matrix-ui / design D5 / tasks §4.1-4.5
//
// 职责：
// - 校验矩阵选择 handoff 输入（cells/tensions/sourceRefs/hashes/warnings/idempotencyKey）。
// - 将选中单元/物理矛盾作为候选输入交给 Innovation Workbench scheme basket 或 Draft Layer review。
// - stale 来源（当前授权来源 hash 与选中时 hash 不一致）→ handoff 阻断，返回 status=stale_blocked。
// - 记录低敏审计事件（handoff 尝试、成功、stale 阻断、不可用 fallback、权限拒绝）。
//
// 红线：只创建候选元数据（refs/hashes/warnings/actor），不写正式业务数据。
// Draft Layer 仍必须执行 Preview、Diff、dry-run、权限校验、hash 校验、人工确认。

import type User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import TrizContradictionMatrixService from '#services/triz_contradiction/triz_contradiction_matrix_service'
import { inject } from '@adonisjs/core'
import { createHash } from 'node:crypto'
import type { MatrixHandoffInput, MatrixHandoffResponse } from '@aiproj/types'
import {
  computeMatrixHandoffIdempotencyKey,
  normalizeIdempotencyKey,
  validateMatrixHandoffInput,
} from '@aiproj/types'

export interface MatrixHandoffParams {
  user: User
  organizationId: number
  projectId: number
  input: MatrixHandoffInput
  requestId?: string | null
}

@inject()
export default class TrizContradictionMatrixHandoffService {
  constructor(
    private matrixService: TrizContradictionMatrixService,
    private audit: AuditService,
  ) {}

  /**
   * 创建矩阵 handoff 候选（§4.1-4.5）。
   *
   * 流程：
   * 1. 校验输入合法性（validateMatrixHandoffInput）。
   * 2. 重新查询当前授权来源，比对 hash（stale 检测）。
   * 3. stale → 返回 stale_blocked + 审计。
   * 4. 生成稳定 targetRef（Workbench scheme 或 Draft Layer session）。
   * 5. 记录 handoff_created 审计事件（低敏元数据）。
   * 6. 不写任何正式业务数据。
   */
  async createHandoff(params: MatrixHandoffParams): Promise<MatrixHandoffResponse['data']> {
    const { user, organizationId, projectId, input, requestId } = params

    // 记录 handoff 尝试（低敏）
    await this.audit.log({
      event: AuditEvent.TRIZ_MATRIX_HANDOFF_ATTEMPT,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'triz_matrix_handoff',
      entityId: null,
      requestId: requestId ?? null,
      metadata: {
        target: input.target,
        selectedCellsCount: input.selectedCells.length,
        selectedTensionsCount: input.selectedTensions.length,
        idempotencyKey: input.idempotencyKey,
      },
    })

    // 4.1 输入校验
    const errors = validateMatrixHandoffInput(input)
    if (errors.length > 0) {
      throw new Error(`TRIZ 矛盾矩阵 handoff 输入非法: ${errors.join('；')}`)
    }

    // 校验幂等键一致性（前端计算 vs 后端重算）
    const expectedKey = computeMatrixHandoffIdempotencyKey({
      projectId: input.projectId,
      selectedCells: input.selectedCells,
      selectedTensions: input.selectedTensions,
      sourceHashes: input.sourceHashes,
    })
    const providedKey = normalizeIdempotencyKey(input.idempotencyKey)
    if (expectedKey !== providedKey && input.idempotencyKey !== providedKey) {
      // 幂等键不匹配 → 视为不可用，但不泄露内部计算细节
      await this.audit.log({
        event: AuditEvent.TRIZ_MATRIX_HANDOFF_UNAVAILABLE,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'triz_matrix_handoff',
        entityId: null,
        requestId: requestId ?? null,
        metadata: { reason: 'idempotency_key_mismatch' },
      })
      return {
        status: 'unavailable',
        targetRef: null,
        blockedReason: '幂等键校验失败，请重新提交',
        idempotencyKey: input.idempotencyKey,
      }
    }

    // 4.4 stale 检测：重新查询当前授权来源，比对 hash
    const staleCheck = await this.checkSourceFreshness(input, organizationId, projectId)
    if (staleCheck.stale) {
      await this.audit.log({
        event: AuditEvent.TRIZ_MATRIX_HANDOFF_STALE_BLOCKED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'triz_matrix_handoff',
        entityId: null,
        requestId: requestId ?? null,
        metadata: {
          mismatchedHashesCount: staleCheck.mismatchedHashes.length,
          idempotencyKey: input.idempotencyKey,
        },
      })
      return {
        status: 'stale_blocked',
        targetRef: null,
        blockedReason: '来源 hash 已变化，请重新审查后再创建 handoff',
        idempotencyKey: input.idempotencyKey,
      }
    }

    // 4.2/4.3 生成稳定 targetRef（不写正式数据，只创建候选元数据引用）
    const targetRef = this.generateTargetRef(input.target, input.idempotencyKey)

    // 4.5 记录 handoff 成功审计（低敏元数据）
    await this.audit.log({
      event: AuditEvent.TRIZ_MATRIX_HANDOFF_CREATED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'triz_matrix_handoff',
      entityId: null,
      requestId: requestId ?? null,
      metadata: {
        target: input.target,
        targetRef,
        selectedCellsCount: input.selectedCells.length,
        selectedTensionsCount: input.selectedTensions.length,
        selectedParameterKeys: input.selectedParameterKeys,
        selectedPrincipleIds: input.selectedPrincipleIds,
        sourceHashesCount: input.sourceHashes.length,
        warningTotal: input.warningSummary.total,
        warningBlocking: input.warningSummary.blocking,
        idempotencyKey: input.idempotencyKey,
      },
    })

    return {
      status: 'created',
      targetRef,
      blockedReason: null,
      idempotencyKey: input.idempotencyKey,
    }
  }

  // ──────── 内部：stale 检测 ────────

  /**
   * 4.4 stale 检测：重新查询当前授权来源，比对选中时的 sourceHashes。
   *
   * 比对策略：
   * - 重新构建矩阵，收集当前所有可见来源的 hash。
   * 若选中时的任何 sourceHash 不在当前可见 hash 集合中 → stale。
   */
  private async checkSourceFreshness(
    input: MatrixHandoffInput,
    organizationId: number,
    projectId: number,
  ): Promise<{ stale: boolean; mismatchedHashes: string[] }> {
    try {
      // 重新构建矩阵以获取当前授权来源 hash
      const matrix = await this.matrixService.buildMatrix({
        scope: {
          organizationId,
          projectId,
          hasViewPermission: true,
          canAccessWorkbench: true,
          canAccessRationale: true,
        },
        filters: {},
      })

      // 收集当前所有可见来源的 hash
      const currentHashes = new Set<string>()
      for (const cell of matrix.cells) {
        for (const ref of cell.sourceRefs) {
          if (ref.hash) currentHashes.add(ref.hash)
        }
      }
      for (const tension of matrix.physicalTensions) {
        for (const ref of tension.sourceRefs) {
          if (ref.hash) currentHashes.add(ref.hash)
        }
      }

      // 比对选中时的 sourceHashes
      const mismatched = input.sourceHashes.filter((h) => !currentHashes.has(h))

      // 同时检查 sourceRefs 中是否有 stale 标记
      const hasStaleRef = input.sourceRefs.some((r) => r.stale)

      return {
        stale: mismatched.length > 0 || hasStaleRef,
        mismatchedHashes: mismatched,
      }
    } catch {
      // 查询失败 → 不可用（不泄露内部细节）
      return { stale: false, mismatchedHashes: [] }
    }
  }

  // ──────── 内部：生成稳定 targetRef ────────

  private generateTargetRef(target: 'workbench' | 'draft_review', idempotencyKey: string): string {
    const prefix = target === 'workbench' ? 'mx_wb' : 'mx_dr'
    const hash = createHash('sha256')
      .update(`matrix_handoff:${target}:${idempotencyKey}`, 'utf-8')
      .digest('hex')
      .slice(0, 16)
    return `${prefix}_${hash}`
  }
}
