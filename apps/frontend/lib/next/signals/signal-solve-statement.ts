import type { ProjectSignal } from '@/lib/api/project-signals'
import { SIGNAL_SEVERITY_LABELS, primaryEvidenceReadings } from './signal-presentation'

// 信号 → 矛盾求解的大白话陈述与推荐落实方式（纯函数；store 与信号卡交接共用，不依赖 store）。

/** 每类信号背后的典型两难（求解陈述用：想守住什么、却被什么拖累）。 */
const SIGNAL_DILEMMAS: Record<ProjectSignal['signalType'], string> = {
  progress_deviation: '想守住交付范围与质量，但进度已经落后于计划',
  risk_surge: '想按计划继续推进，但风险与缺陷在快速增加',
  resource_overload: '想按期完成任务，但团队负载已经超出可承受范围',
  milestone_slip: '想守住里程碑日期，但里程碑在持续往后滑',
}

const SIGNAL_TYPE_LABELS: Record<ProjectSignal['signalType'], string> = {
  progress_deviation: '进度偏差',
  risk_surge: '风险/缺陷突变',
  resource_overload: '资源负载过载',
  milestone_slip: '里程碑滑移',
}

/** 信号 → 推荐的落实方式（风险类登记为风险条目，其余新建任务去执行）。 */
export function recommendedTargetForSignal(
  signalType: string | null | undefined,
): 'task' | 'risk' | 'change_request' {
  return signalType === 'risk_surge' ? 'risk' : 'task'
}

/**
 * 交给求解端的大白话陈述（纯函数）：项目 + 状况 + 关键读数 + 两难。
 * 只用团队 / 项目聚合口径读数；证据被权限裁剪时只说类型，不编造数字。
 */
export function buildSignalSolverStatement(signal: ProjectSignal): string {
  const typeLabel = signal.signalTypeLabel || SIGNAL_TYPE_LABELS[signal.signalType] || '异常'
  const project = signal.projectName ? `项目「${signal.projectName}」` : '这个项目'
  const severity = SIGNAL_SEVERITY_LABELS[signal.severity] ?? signal.severity
  const readings = signal.evidence
    ? primaryEvidenceReadings(signal.evidence, 3)
        .map((entry) => `${entry.label} ${entry.value}`)
        .join('，')
    : ''
  const dilemma = SIGNAL_DILEMMAS[signal.signalType] ?? '想按计划推进，但项目出现了异常'
  return [
    `${project}出现「${typeLabel}」（${severity}），观测窗 ${signal.observationWindow}`,
    readings ? `：${readings}。` : '。',
    `${dilemma}。请分析其中的矛盾，给出可以落地的解法。`,
  ].join('')
}
