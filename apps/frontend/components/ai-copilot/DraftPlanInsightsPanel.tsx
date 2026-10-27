'use client'

import { CheckCircle2, CircleAlert } from 'lucide-react'
import type {
  ProjectDraftGovernance,
  ProjectDraftPlanInsights,
  ProjectDraftTask,
} from '@aiproj/types'
import { cn } from '@/lib/utils'

/**
 * 计划体检：后端确定性推导的日历 / 产能 / 进度置信区间 / 阶段门 / 追溯链，
 * 按银行与 PMO 评审计划的习惯展示，帮助审查人在确认导入前看清计划是否站得住。
 */

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function utilizationTone(value: number): string {
  if (value > 1) return 'text-destructive'
  if (value > 0.85) return 'text-warning'
  return 'text-slate-800'
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: string
  hint?: string
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-2" title={hint}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={cn('font-medium', tone ?? 'text-slate-800')}>{value}</dd>
    </div>
  )
}

/** 连续同名的日期合并成区间展示（如「国庆节 10-01~10-07 放假」）。 */
function groupDays(days: ProjectDraftPlanInsights['workCalendar']['days']) {
  const groups: Array<{
    name: string
    from: string
    to: string
    work: boolean
    estimated: boolean
  }> = []
  for (const day of days) {
    const last = groups.at(-1)
    if (last && last.name === day.name && last.work === day.work) last.to = day.date
    else
      groups.push({
        name: day.name,
        from: day.date,
        to: day.date,
        work: day.work,
        estimated: day.estimated,
      })
  }
  return groups
}

export function DraftPlanInsightsPanel({
  insights,
  tasks,
}: {
  insights: ProjectDraftPlanInsights
  tasks: ProjectDraftTask[]
}) {
  const {
    scheduleConfidence: confidence,
    capacity,
    stageGates,
    traceability,
    workCalendar,
  } = insights
  const taskName = (id: string) => tasks.find((task) => task.id === id)?.name.value ?? id
  const gatesPresent = stageGates.gates.filter((gate) => gate.present).length
  const onTimeTone =
    confidence.onTimeProbability === null
      ? undefined
      : confidence.onTimeProbability < 0.5
        ? 'text-destructive'
        : confidence.onTimeProbability < 0.8
          ? 'text-warning'
          : 'text-success'

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3"
      data-testid="draft-plan-insights"
    >
      <h3 className="mb-1 font-medium text-heading">计划体检</h3>
      <p className="mb-3 text-xs text-gray-500">
        由系统按工作日历、团队人数与依赖网确定性推导，供评审参考；不会修改草案内容。
      </p>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <Tile
          label="按期完成概率"
          value={percent(confidence.onTimeProbability)}
          tone={onTimeTone}
          hint={`三点估算 + 蒙特卡洛模拟 ${confidence.samples} 次`}
        />
        <Tile label="P80 完工日" value={confidence.p80EndDate ?? '—'} />
        <Tile
          label="团队人天利用率"
          value={percent(capacity.utilization)}
          tone={utilizationTone(capacity.utilization)}
          hint={`需求 ${capacity.requiredPersonDays} 人天 / 可用 ${capacity.availablePersonDays} 人天`}
        />
        <Tile
          label="行业阶段门"
          value={`${gatesPresent}/${stageGates.gates.length}`}
          tone={stageGates.missing.length > 0 ? 'text-warning' : 'text-success'}
        />
        <Tile
          label="追溯链完整率"
          value={percent(traceability.coverage)}
          tone={traceability.coverage < 1 ? 'text-warning' : 'text-success'}
        />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section aria-label="进度置信区间" className="text-sm">
          <h4 className="mb-1 text-xs font-medium text-gray-600">进度置信区间</h4>
          <ul className="space-y-0.5 text-xs text-gray-600">
            <li>
              计划完工：{confidence.deterministicEndDate ?? '—'}（目标截止{' '}
              {confidence.deadline ?? '未定'}）
            </li>
            <li>
              P50 {confidence.p50EndDate ?? '—'} · P80 {confidence.p80EndDate ?? '—'} · P90{' '}
              {confidence.p90EndDate ?? '—'}
            </li>
            <li>
              模型给出三点估算的任务占 {percent(confidence.explicitEstimateRatio)}
              ，其余按任务类别的默认不确定性系数估计
            </li>
          </ul>
        </section>

        <section aria-label="工作日历与封网" className="text-sm">
          <h4 className="mb-1 text-xs font-medium text-gray-600">工作日历与封网</h4>
          <ul className="space-y-0.5 text-xs text-gray-600">
            {groupDays(workCalendar.days).map((group) => (
              <li key={`${group.name}-${group.from}-${group.work}`}>
                {group.name} {group.from}
                {group.to !== group.from ? `~${group.to}` : ''} {group.work ? '调休上班' : '放假'}
                {group.estimated ? '（估算）' : ''}
              </li>
            ))}
            {workCalendar.changeFreezeWindows.map((window) => (
              <li key={`${window.start}-${window.label}`} className="text-warning">
                {window.label}：{window.start} ~ {window.end}
              </li>
            ))}
            {workCalendar.estimatedYears.length > 0 ? (
              <li>
                {workCalendar.estimatedYears.join('、')}{' '}
                年放假安排尚未公布，按农历估算，以国务院公布为准。
              </li>
            ) : null}
          </ul>
          {workCalendar.productionTasksInFreeze.length > 0 ? (
            <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              封网期内仍有投产类任务：
              {workCalendar.productionTasksInFreeze.slice(0, 5).map(taskName).join('、')}
            </p>
          ) : null}
          {workCalendar.releaseWindowsInFreeze.length > 0 ? (
            <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              投产窗口与封网重叠：{workCalendar.releaseWindowsInFreeze.join('、')}
            </p>
          ) : null}
        </section>
      </div>

      <section aria-label="团队产能" className="mt-4">
        <h4 className="mb-1 text-xs font-medium text-gray-600">
          团队产能（{capacity.workingDays} 个工作日）
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-2 font-normal">角色</th>
                <th className="py-1 pr-2 font-normal">人数</th>
                <th className="py-1 pr-2 font-normal">可用人天</th>
                <th className="py-1 pr-2 font-normal">任务人天</th>
                <th className="py-1 font-normal">利用率</th>
              </tr>
            </thead>
            <tbody>
              {capacity.byRole.map((row) => (
                <tr key={row.role} className="border-t border-border">
                  <td className="py-1 pr-2 text-slate-800">{row.role}</td>
                  <td className="py-1 pr-2">{row.headcount}</td>
                  <td className="py-1 pr-2">{row.availablePersonDays}</td>
                  <td className="py-1 pr-2">{row.requiredPersonDays}</td>
                  <td className={cn('py-1', utilizationTone(row.utilization))}>
                    {row.headcount > 0 ? percent(row.utilization) : '未配置人数'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="行业阶段门" className="mt-4">
        <h4 className="mb-1 text-xs font-medium text-gray-600">
          行业阶段门（{stageGates.template}）
        </h4>
        <ul className="flex flex-wrap gap-1.5">
          {stageGates.gates.map((gate) => (
            <li
              key={gate.key}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                gate.present ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning',
              )}
            >
              {gate.present ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden />
              ) : (
                <CircleAlert className="h-3 w-3" aria-hidden />
              )}
              {gate.name}
              <span className="sr-only">{gate.present ? '已覆盖' : '缺失'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="交付物追溯链" className="mt-4">
        <h4 className="mb-1 text-xs font-medium text-gray-600">交付物追溯链</h4>
        {traceability.deliverables.length === 0 ? (
          <p className="text-xs text-gray-500">未识别到已确认的交付物清单。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-2 font-normal">交付物</th>
                  <th className="py-1 pr-2 font-normal">WBS</th>
                  <th className="py-1 pr-2 font-normal">任务</th>
                  <th className="py-1 pr-2 font-normal">验收标准</th>
                  <th className="py-1 font-normal">里程碑</th>
                </tr>
              </thead>
              <tbody>
                {traceability.deliverables.map((row) => (
                  <tr key={row.deliverable} className="border-t border-border">
                    <td
                      className={cn('py-1 pr-2', row.complete ? 'text-slate-800' : 'text-warning')}
                    >
                      {row.deliverable}
                    </td>
                    {[row.wbsNodeIds, row.taskIds, row.acceptanceIds, row.milestoneIds].map(
                      (ids, index) => (
                        <td
                          key={index}
                          className={cn('py-1 pr-2', ids.length === 0 && 'text-destructive')}
                        >
                          {ids.length > 0 ? ids.length : '缺'}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {traceability.untracedTaskIds.length > 0 ? (
          <p className="mt-1 text-xs text-warning">
            {traceability.untracedTaskIds.length} 个任务无法追溯到交付物：
            {traceability.untracedTaskIds.slice(0, 5).map(taskName).join('、')}
            {traceability.untracedTaskIds.length > 5 ? ' 等' : ''}
          </p>
        ) : null}
      </section>

      {insights.referenceClass ? (
        <section aria-label="参照类对比" className="mt-4" data-testid="draft-reference-class">
          <h4 className="mb-1 text-xs font-medium text-gray-600">参照类对比</h4>
          <p className="text-xs text-gray-500">
            依据组织维基「{insights.referenceClass.label}」：同类已完成任务实际用时中位数{' '}
            {insights.referenceClass.p50Days} 个工作日，P80 {insights.referenceClass.p80Days}{' '}
            个工作日（{insights.referenceClass.samples} 个样本）。
          </p>
          {insights.referenceClass.longTasks.length === 0 ? (
            <p className="mt-1 text-xs text-success">没有任务的工期超过 P80。</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-warning">
                {insights.referenceClass.longTasks.length} 个任务的工期超过
                P80，请确认拆分是否足够细，或在任务说明里写明理由（仅提示，不影响转正）：
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-800">
                {insights.referenceClass.longTasks.map((task) => (
                  <li key={task.id}>
                    {task.name || taskName(task.id)} · {task.durationDays} 天
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      {insights.processReality ? (
        <section aria-label="流程实况" className="mt-4" data-testid="draft-process-reality">
          <h4 className="mb-1 text-xs font-medium text-gray-600">流程实况</h4>
          <p className="text-xs text-gray-500">
            依据组织维基里本组织实际的任务流转与审批记录（仅提示，不影响转正）：
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-warning">
            {insights.processReality.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {insights.processReality.approvalTasks.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-800">
              {insights.processReality.approvalTasks.map((task) => (
                <li key={task.id}>
                  {task.name || taskName(task.id)} · {task.durationDays} 天
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {insights.lessons && insights.lessons.length > 0 ? (
        <section aria-label="历史教训" className="mt-4" data-testid="draft-lessons">
          <h4 className="mb-1 text-xs font-medium text-gray-600">历史教训</h4>
          <p className="text-xs text-gray-500">
            组织教训库里与本项目相关的教训（仅提示，不影响转正）：
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-800">
            {insights.lessons.map((lesson) => (
              <li key={lesson.statement}>
                {lesson.section ? (
                  <span className="text-gray-500">［{lesson.section}］</span>
                ) : null}
                {lesson.statement}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

const RISK_STRATEGY_LABELS: Record<string, string> = {
  avoid: '规避',
  transfer: '转移',
  mitigate: '减轻',
  accept: '接受',
}

export function riskStrategyLabel(value: string | undefined): string | null {
  return value ? (RISK_STRATEGY_LABELS[value] ?? value) : null
}

export function DraftGovernanceSection({ governance }: { governance: ProjectDraftGovernance }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3"
      data-testid="draft-governance"
    >
      <h3 className="mb-2 font-medium text-heading">治理文档</h3>

      {governance.raci.length > 0 ? (
        <section aria-label="RACI 责任矩阵" className="mb-4">
          <h4 className="mb-1 text-xs font-medium text-gray-600">RACI 责任矩阵</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-2 font-normal">活动 / 交付物</th>
                  <th className="py-1 pr-2 font-normal">R 执行</th>
                  <th className="py-1 pr-2 font-normal">A 负责</th>
                  <th className="py-1 pr-2 font-normal">C 咨询</th>
                  <th className="py-1 font-normal">I 知会</th>
                </tr>
              </thead>
              <tbody>
                {governance.raci.map((row) => (
                  <tr key={row.activity} className="border-t border-border align-top">
                    <td className="py-1 pr-2 text-slate-800">{row.activity}</td>
                    <td className="py-1 pr-2">{row.responsible.join('、')}</td>
                    <td className="py-1 pr-2">{row.accountable || '—'}</td>
                    <td className="py-1 pr-2">{row.consulted.join('、') || '—'}</td>
                    <td className="py-1">{row.informed.join('、') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {governance.qualityGates.length > 0 ? (
        <section aria-label="质量门准入准出" className="mb-4">
          <h4 className="mb-1 text-xs font-medium text-gray-600">质量门准入 / 准出标准</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {governance.qualityGates.map((gate) => (
              <div key={gate.name} className="rounded-lg bg-gray-50 p-3 text-xs">
                <p className="mb-1 text-sm font-medium text-slate-800">{gate.name}</p>
                <p className="text-gray-500">准入</p>
                <ul className="mb-1 list-disc pl-4 text-gray-700">
                  {gate.entryCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="text-gray-500">准出</p>
                <ul className="list-disc pl-4 text-gray-700">
                  {gate.exitCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {governance.releaseWindows.length > 0 ? (
        <section aria-label="投产窗口计划">
          <h4 className="mb-1 text-xs font-medium text-gray-600">变更与投产窗口</h4>
          <ul className="space-y-1 text-xs text-gray-700">
            {governance.releaseWindows.map((window) => (
              <li key={`${window.name}-${window.startDate}`} className="rounded-lg bg-gray-50 p-2">
                <span className="font-medium text-slate-800">{window.name}</span> {window.startDate}{' '}
                ~ {window.endDate}
                {window.scope ? (
                  <span className="block text-gray-600">范围：{window.scope}</span>
                ) : null}
                {window.rollbackPlan ? (
                  <span className="block text-gray-600">回滚：{window.rollbackPlan}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
