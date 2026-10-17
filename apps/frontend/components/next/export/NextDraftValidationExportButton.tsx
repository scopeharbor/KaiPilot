'use client'

import * as React from 'react'
import { Download } from 'lucide-react'
import type { DraftValidationReport } from '@aiproj/types'
import { formatDraftShortCode } from '@/components/next/theater/TheaterSettledView'
import { ChartShareCardModal } from '@/components/next/export/ChartShareCardModal'
import { ValidationReportShareCardTemplate } from '@/components/next/export/ValidationReportShareCardTemplate'

/**
 * 反幻觉自检报告「汇出报告卡」按钮（v3-ui-next-chart-export W2 / 接入点二）。
 *
 * - 挂载于 NextDraftValidationReport 头部 Header（RiskBadge 旁），暗黑仪器感按钮；
 * - 权威数据绑定：直接消费宿主传入的服务端 `DraftValidationReport` 实体，严禁
 *   前端伪造或裁剪（spec「草案审查面板反幻觉自检报告『汇出报告卡』接入点」）；
 * - 点击呼出 W1 `ChartShareCardModal`，children 装配
 *   `ValidationReportShareCardTemplate`：综合置信度大字、风险等级盾牌徽章、
 *   五维能量条与 Blocking/Warning 违规明细；
 * - 实体标识：提供 `draftId` 时按 `formatDraftShortCode` 派生 `#DRAFT-XXXXXXXX`
 *   短码；缺省兜底「反幻觉自检报告」，保证分享卡 Header 与文件名永不空缺。
 */
export interface NextDraftValidationExportButtonProps {
  /** 服务端权威校验报告（非空；宿主在 validation 为 null 时不渲染本按钮）。 */
  validation: DraftValidationReport
  /** 草案会话 ID（短码派生源，如 `df_7e3f1a90` → #DRAFT-7E3F1A90）。 */
  draftId?: string
}

export function NextDraftValidationExportButton({
  validation,
  draftId,
}: NextDraftValidationExportButtonProps) {
  const [open, setOpen] = React.useState(false)
  const entityName =
    draftId !== undefined ? `#DRAFT-${formatDraftShortCode(draftId)}` : '反幻觉自检报告'

  return (
    <>
      <button
        type="button"
        data-validation-report-export
        aria-label="汇出报告卡"
        onClick={() => setOpen(true)}
        className="flex h-7 items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[10px] font-medium text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
      >
        <Download className="h-3 w-3" aria-hidden />
        汇出报告卡
      </button>

      <ChartShareCardModal
        open={open}
        onOpenChange={setOpen}
        title="反幻觉自检报告卡"
        entityName={entityName}
        viewType="反幻觉自检报告"
        filenameViewType="反幻觉自检报告"
      >
        <ValidationReportShareCardTemplate validation={validation} />
      </ChartShareCardModal>
    </>
  )
}

export default NextDraftValidationExportButton
