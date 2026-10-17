// @aiproj/backend — TenantSelectionStateService（v3-multitenant-tenant-identification §4.2）。
//
// 服务端 active organization selection 快照的读写。spec 要求切换成功后
// 「refresh or persist a low-sensitive selection snapshot」——本服务承担持久化那一半，
// access token claims 刷新由 `OrganizationSelectionService` 承担。
//
// `selectionEpoch` 单调递增，是 §4.3 失效旧派生句柄的唯一栅栏：只要 epoch 变了，
// 携带旧 epoch 的 preview/export/job/AI/Compiler 句柄一律判 stale——包括用户
// **切回原组织**的情况（那时 scope hash 会复原，只有 epoch 拦得住）。
//
// 归属说明：本表按 actor 唯一（`user_id` unique），不是 tenant-owned 资源，
// 因此不进 `TenantScopeRegistry`；一切读写以 userId 为键，绝不按 organizationId
// 反查他人 selection。

import TenantSelectionState from '#models/tenant_selection_state'
import type {
  TenantScopeMode,
  TenantSelectionSource,
} from '@aiproj/types/multitenant-tenant-identification'

export interface TenantSelectionStateSnapshot {
  userId: number
  organizationId: number | null
  membershipVersionHash: string | null
  scopeHash: string | null
  selectionSource: TenantSelectionSource
  scopeMode: TenantScopeMode
  selectionEpoch: number
}

export default class TenantSelectionStateService {
  /** 读取 actor 的当前 selection；从未选择过则返回 null（不代建行）。 */
  async find(userId: number): Promise<TenantSelectionStateSnapshot | null> {
    const row = await TenantSelectionState.query().where('user_id', userId).first()
    return row ? this.toSnapshot(row) : null
  }

  /**
   * 读取 actor 当前 epoch。无 selection 行时返回 0——语义是「尚无任何有效
   * selection」，因此任何携带 epoch 的旧句柄都不会与之相等（fail closed）。
   */
  async currentEpoch(userId: number): Promise<number> {
    const row = await TenantSelectionState.query()
      .where('user_id', userId)
      .select('selection_epoch')
      .first()
    return row?.selectionEpoch ?? 0
  }

  /**
   * 记录一次成功的组织选择：写入新组织与低敏派生值，并把 epoch +1。
   *
   * epoch 递增放在同一次写入里，保证「切换成功」与「旧句柄失效」原子发生：
   * 不存在切换已生效但旧 epoch 仍被认可的窗口。
   */
  async recordSelection(params: {
    userId: number
    organizationId: number | null
    membershipVersionHash: string | null
    scopeHash: string | null
    selectionSource: TenantSelectionSource
    scopeMode: TenantScopeMode
  }): Promise<TenantSelectionStateSnapshot> {
    const existing = await TenantSelectionState.query().where('user_id', params.userId).first()

    if (!existing) {
      const created = await TenantSelectionState.create({
        userId: params.userId,
        organizationId: params.organizationId,
        membershipVersionHash: params.membershipVersionHash,
        scopeHash: params.scopeHash,
        selectionSource: params.selectionSource,
        scopeMode: params.scopeMode,
        selectionEpoch: 1,
      })
      return this.toSnapshot(created)
    }

    existing.organizationId = params.organizationId
    existing.membershipVersionHash = params.membershipVersionHash
    existing.scopeHash = params.scopeHash
    existing.selectionSource = params.selectionSource
    existing.scopeMode = params.scopeMode
    existing.selectionEpoch = existing.selectionEpoch + 1
    await existing.save()
    return this.toSnapshot(existing)
  }

  /**
   * 清空 actor 的 active selection（成员关系被移除、组织被删除、登出时调用）。
   * 仍然递增 epoch——旧句柄必须随之失效，否则「被移出组织」后旧预览仍可确认。
   */
  async clearSelection(userId: number): Promise<TenantSelectionStateSnapshot | null> {
    const existing = await TenantSelectionState.query().where('user_id', userId).first()
    if (!existing) return null

    existing.organizationId = null
    existing.membershipVersionHash = null
    existing.scopeHash = null
    existing.selectionEpoch = existing.selectionEpoch + 1
    await existing.save()
    return this.toSnapshot(existing)
  }

  private toSnapshot(row: TenantSelectionState): TenantSelectionStateSnapshot {
    return {
      userId: Number(row.userId),
      organizationId: row.organizationId === null ? null : Number(row.organizationId),
      membershipVersionHash: row.membershipVersionHash,
      scopeHash: row.scopeHash,
      selectionSource: row.selectionSource,
      scopeMode: row.scopeMode,
      selectionEpoch: Number(row.selectionEpoch),
    }
  }
}
