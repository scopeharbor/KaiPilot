'use client'

import * as React from 'react'
import {
  formatOkrCycleLabel,
  formatOkrCycleWindow,
  OKR_CYCLE_ALL_LABEL,
} from '@/lib/next/org-okr/org-okr-adapter'
import type { OkrCycle } from '@aiproj/types'

/**
 * OKR 周期选择器（v3-ui-next-org-portfolio-domains W2 · tasks 2.3）。
 *
 * 纯受控展示组件：周期列表 + 「全部周期」兜底项；选择变化仅回调上层（读请求
 * 参数联动由工作台负责，本组件零网络、零写）。
 */
export interface OkrCyclePickerProps {
  cycles: readonly OkrCycle[]
  /** 当前选中周期 id；undefined = 全部周期。 */
  value: number | undefined
  onChange: (cycleId: number | undefined) => void
  /** 周期列表加载中（禁用选择器防误操作）。 */
  loading?: boolean
  disabled?: boolean
}

export function OkrCyclePicker({
  cycles,
  value,
  onChange,
  loading = false,
  disabled = false,
}: OkrCyclePickerProps) {
  return (
    <label className="flex flex-col gap-1" data-okr-cycle-picker-block>
      <span className="text-[11px] text-[var(--nx-text-muted)]">周期</span>
      <select
        data-okr-cycle-picker
        aria-label="选择 OKR 周期"
        value={value ?? ''}
        disabled={disabled || loading}
        onChange={(event) => {
          const raw = event.target.value
          onChange(raw ? Number(raw) : undefined)
        }}
        className="h-8 min-w-44 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
      >
        <option value="">{OKR_CYCLE_ALL_LABEL}</option>
        {cycles.map((cycle) => (
          <option key={cycle.id} value={cycle.id} title={formatOkrCycleWindow(cycle)}>
            {formatOkrCycleLabel(cycle)}
          </option>
        ))}
      </select>
    </label>
  )
}

export default OkrCyclePicker
