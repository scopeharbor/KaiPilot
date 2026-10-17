/**
 * v3-triz-to-delivery-closed-loop —— apply result receipt 覆盖判定（task 4.6）。
 *
 * 历史无 typed receipt（entity_refs 为 null/空）的 apply result 一律返回
 * `legacy_unlinked` warning 与 manual-link 导航提示，不做猜测式自动回填。
 * 该函数为纯投影：只读输入，不触库。
 */
import type { DraftLayerApplyEntityReceipt } from '@aiproj/types'

export interface TrizDlReceiptCoverage {
  /** null/空 receipt → true（历史行语义） */
  legacyUnlinked: boolean
  warningCode: 'TRIZ_DL_LEGACY_UNLINKED' | null
  /** manual-link 导航负载：existing-entity preview 需要的最低限度 ref */
  manualLink: {
    mode: 'existing_entity'
    applyResultId: number
  } | null
}

export function describeTrizDlReceiptCoverage(
  applyResultId: number,
  entityRefs: readonly DraftLayerApplyEntityReceipt[] | null | undefined,
): TrizDlReceiptCoverage {
  if (!entityRefs || entityRefs.length === 0) {
    return {
      legacyUnlinked: true,
      warningCode: 'TRIZ_DL_LEGACY_UNLINKED',
      manualLink: { mode: 'existing_entity', applyResultId },
    }
  }
  return { legacyUnlinked: false, warningCode: null, manualLink: null }
}
