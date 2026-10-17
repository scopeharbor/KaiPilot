'use client'

import type { ProjectDraftTaskExecution } from '@aiproj/types'

/**
 * 任务可执行说明（任务翻译器产物）：为什么做 / 输入 / 产出 / 完成标准 / 步骤清单 / 验收人。
 * 折叠展示，展开后拿到任务的人不用再问就能开工；导入后写入任务描述，步骤成为可勾选清单。
 */
export function NextDraftTaskExecution({ execution }: { execution: ProjectDraftTaskExecution }) {
  const sections: Array<[string, string[]]> = [
    ['输入', execution.inputs],
    ['产出', execution.outputs],
    ['完成标准', execution.doneCriteria],
  ]
  return (
    <details data-task-execution className="group mt-1 text-[10px] text-[var(--nx-text-secondary)]">
      <summary className="cursor-pointer select-none text-[var(--nx-accent)] hover:underline">
        可执行说明 · {execution.steps.length} 步
      </summary>
      <div className="mt-1 space-y-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1.5 leading-relaxed">
        {execution.purpose ? (
          <p>
            <span className="text-[var(--nx-text-muted)]">为什么做：</span>
            {execution.purpose}
          </p>
        ) : null}
        {sections.map(([label, items]) =>
          items.length > 0 ? (
            <div key={label}>
              <span className="text-[var(--nx-text-muted)]">{label}：</span>
              <ul className="ml-3 list-disc">
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        {execution.steps.length > 0 ? (
          <div>
            <span className="text-[var(--nx-text-muted)]">执行步骤：</span>
            <ol className="ml-3 list-decimal">
              {execution.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}
        {execution.reviewerRole ? (
          <p>
            <span className="text-[var(--nx-text-muted)]">验收人：</span>
            {execution.reviewerRole}
          </p>
        ) : null}
      </div>
    </details>
  )
}
