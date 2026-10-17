'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { CalendarDisplayWorkspace } from '@/components/next/settings/calendar/CalendarDisplayWorkspace'

/**
 * 日历与曆法设定页（/next/settings/calendar[?projectId=]）：个人 > 项目 > 组织 > 系统默认。
 * 登录即可进入；项目层与组织层的写权限由后端按层校验。
 */
function CalendarSettingsContent() {
  const params = useSearchParams()
  const raw = Number(params.get('projectId'))
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-[var(--nx-text-primary)]">日历与曆法</h2>
        <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
          选择日历要显示的曆法与顺序：公历、农历、藏历、回历，以及干支、节气、物候、三伏、数九、月相、节日与法定假日。
        </p>
      </header>
      <CalendarDisplayWorkspace initialProjectId={Number.isInteger(raw) && raw > 0 ? raw : null} />
    </div>
  )
}

export default function NextSettingsCalendarPage() {
  return (
    <React.Suspense fallback={null}>
      <CalendarSettingsContent />
    </React.Suspense>
  )
}
