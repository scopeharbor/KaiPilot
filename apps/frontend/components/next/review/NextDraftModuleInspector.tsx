'use client'

import * as React from 'react'
import { CalendarRange, FolderTree, ListChecks, Target } from 'lucide-react'
import type { ProjectDraft } from '@aiproj/types'
import { NextDraftCharterSection } from '@/components/next/review/NextDraftCharterSection'
import { NextDraftWbsSection } from '@/components/next/review/NextDraftWbsSection'
import { NextDraftTasksSection } from '@/components/next/review/NextDraftTasksSection'
import { NextDraftGanttSection } from '@/components/next/review/NextDraftGanttSection'
import { NextDraftSupportingSection } from '@/components/next/review/NextDraftSupportingSection'

/** 模块检视 4 标签页确定性定义（顺序即展示顺序；RL-14 静态映射，禁止运行时注入）。 */
export const INSPECTOR_TABS = [
  { id: 'charter', label: '项目章程', icon: Target },
  { id: 'wbs', label: 'WBS 分解树', icon: FolderTree },
  { id: 'tasks', label: '任务清单', icon: ListChecks },
  { id: 'gantt', label: '甘特预览', icon: CalendarRange },
] as const

export type InspectorTabId = (typeof INSPECTOR_TABS)[number]['id']

/**
 * 模块检视四区主容器（v3-ui-next-draft-review-panel tasks 1.7）。
 *
 * 整合章程 / WBS 树 / 任务表 / 甘特预览 4 标签页与底部配套折叠区；支持
 * ArrowLeft / ArrowRight / Home / End 键控切换（roving tabindex），完整
 * `role="tablist"` / `role="tab"` / `role="tabpanel"` 双通道语义。
 * 各面板常驻挂载（hidden 切换），保证 WBS 展开状态等本地态不随标签切换丢失。
 * 纯只读容器：零输入框、零网络请求（RL-01、RL-06）。
 */
export interface NextDraftModuleInspectorProps {
  draft: ProjectDraft
}

export function NextDraftModuleInspector({ draft }: NextDraftModuleInspectorProps) {
  const [activeTab, setActiveTab] = React.useState<InspectorTabId>('charter')
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = INSPECTOR_TABS.findIndex((tab) => tab.id === activeTab)
      let nextIndex = -1
      if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % INSPECTOR_TABS.length
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = INSPECTOR_TABS.length - 1
      }
      if (nextIndex === -1) return
      event.preventDefault()
      const next = INSPECTOR_TABS[nextIndex]
      if (next === undefined) return
      setActiveTab(next.id)
      tabRefs.current[nextIndex]?.focus()
    },
    [activeTab],
  )

  return (
    <section data-module-inspector aria-label="草案模块检视" className="space-y-4 text-left">
      <div
        role="tablist"
        aria-label="草案模块检视"
        onKeyDown={handleKeyDown}
        className="flex flex-wrap items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-1"
      >
        {INSPECTOR_TABS.map((tab, index) => {
          const isActive = activeTab === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              type="button"
              role="tab"
              id={`nx-draft-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`nx-draft-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              data-inspector-tab
              data-tab-id={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] ${
                isActive
                  ? 'border border-[var(--nx-workspace-blue)]/60 bg-[var(--nx-workspace-blue)]/10 text-[var(--nx-workspace-blue)]'
                  : 'border border-transparent text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id="nx-draft-panel-charter"
        aria-labelledby="nx-draft-tab-charter"
        data-panel-id="charter"
        hidden={activeTab !== 'charter'}
      >
        <NextDraftCharterSection charter={draft.charter} />
      </div>
      <div
        role="tabpanel"
        id="nx-draft-panel-wbs"
        aria-labelledby="nx-draft-tab-wbs"
        data-panel-id="wbs"
        hidden={activeTab !== 'wbs'}
      >
        <NextDraftWbsSection wbs={draft.wbs} />
      </div>
      <div
        role="tabpanel"
        id="nx-draft-panel-tasks"
        aria-labelledby="nx-draft-tab-tasks"
        data-panel-id="tasks"
        hidden={activeTab !== 'tasks'}
      >
        <NextDraftTasksSection tasks={draft.tasks} wbs={draft.wbs} />
      </div>
      <div
        role="tabpanel"
        id="nx-draft-panel-gantt"
        aria-labelledby="nx-draft-tab-gantt"
        data-panel-id="gantt"
        hidden={activeTab !== 'gantt'}
      >
        <NextDraftGanttSection
          preview={draft.ganttPreview}
          dependencies={draft.dependencies}
          tasks={draft.tasks}
        />
      </div>

      <NextDraftSupportingSection
        acceptanceCriteria={draft.acceptanceCriteria}
        resourceHints={draft.resourceHints}
        riskHints={draft.riskHints}
        milestoneHints={draft.milestoneHints}
      />
    </section>
  )
}

export default NextDraftModuleInspector
