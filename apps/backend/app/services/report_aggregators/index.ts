import type { ReportSnapshot, ReportTemplate } from '@aiproj/types'
import DelayAggregator from './delay_aggregator.js'
import MilestoneAggregator from './milestone_aggregator.js'
import ProgressAggregator from './progress_aggregator.js'
import WorkloadAggregator from './workload_aggregator.js'
import type { ReportAggregator } from './aggregator_context.js'

/**
 * 模板 -> 聚合器的静态注册表（design D6 可扩展点）。
 *
 * 新增模板时：
 *  1. 在 `@aiproj/types` 追加白名单与 snapshot 类型；
 *  2. 在本目录新增 `<template>_aggregator.ts`；
 *  3. 在此表登记；
 *  4. Validator 白名单自动跟随 `REPORT_TEMPLATES`。
 */
export const REPORT_AGGREGATORS: Record<ReportTemplate, ReportAggregator<ReportSnapshot>> = {
  progress: new ProgressAggregator() as unknown as ReportAggregator<ReportSnapshot>,
  delay: new DelayAggregator() as unknown as ReportAggregator<ReportSnapshot>,
  workload: new WorkloadAggregator() as unknown as ReportAggregator<ReportSnapshot>,
  milestone: new MilestoneAggregator() as unknown as ReportAggregator<ReportSnapshot>,
}

export { default as ProgressAggregator } from './progress_aggregator.js'
export { default as DelayAggregator } from './delay_aggregator.js'
export { default as WorkloadAggregator } from './workload_aggregator.js'
export { default as MilestoneAggregator } from './milestone_aggregator.js'
export * from './aggregator_context.js'
