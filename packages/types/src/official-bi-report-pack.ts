import type { TemplatePackPayloadBi } from './plugin-template-pack.js'

export const OFFICIAL_BI_REPORT_PACK_PLUGIN_ID = 'com.aiproj.official.bi-report-pack' as const
export const OFFICIAL_BI_REPORT_PACK_VERSION = '1.0.0' as const

export const OFFICIAL_BI_REPORT_PACK_PAYLOAD: TemplatePackPayloadBi = {
  domain: 'bi-report-template',
  version: OFFICIAL_BI_REPORT_PACK_VERSION,
  description:
    'Official BI report pack — curated governance, risk heatmap and trend analysis templates',
  templates: [
    {
      templateId: 'ptpl_official_exec_governance',
      version: 1,
      name: '组织执行全景治理报告',
      description: '面向高管与 PMO 的跨项目进度、里程碑、资源与风险四象限全景，整合组织看板与趋势',
      category: 'execution',
      scenario: 'weekly_review',
      personDimensionRequiresExtraPermission: false,
      composition: {
        dataSourceKeys: ['organization_dashboard', 'pmo_portfolio_dashboard', 'bi_trend_analysis'],
        metricKeys: [
          'project_progress',
          'schedule_delay_pressure',
          'milestone_completion_rate',
          'risk_pressure',
          'resource_utilization_rate',
        ],
        dimensionKeys: ['organization', 'project', 'time'],
        defaultFilters: {
          period: 'current_quarter',
        },
        charts: [
          {
            chartType: 'stat_card',
            title: '整体交付进度',
            metricKeys: ['project_progress', 'schedule_delay_pressure'],
            dimensionKey: 'organization',
          },
          {
            chartType: 'bar',
            title: '各项目进度与延期对比',
            metricKeys: ['project_progress', 'schedule_delay_pressure'],
            dimensionKey: 'project',
          },
          {
            chartType: 'line',
            title: '里程碑完成趋势',
            metricKeys: ['milestone_completion_rate'],
            dimensionKey: 'time',
            optional: true,
          },
          {
            chartType: 'stat_card',
            title: '风险与资源健康',
            metricKeys: ['risk_pressure', 'resource_utilization_rate'],
            dimensionKey: 'organization',
          },
        ],
      },
    },
    {
      templateId: 'ptpl_official_risk_heatmap_matrix',
      version: 1,
      name: '风险热力矩阵分析',
      description: '多维度风险等级与项目矩阵，揭示高危聚集区与类别分布，支持热力下钻与优先级洞察',
      category: 'risk',
      scenario: 'risk_review',
      personDimensionRequiresExtraPermission: false,
      composition: {
        dataSourceKeys: ['bi_risk_heatmap', 'organization_dashboard'],
        metricKeys: ['risk_pressure'],
        dimensionKeys: ['project', 'risk_level'],
        defaultFilters: {},
        charts: [
          {
            chartType: 'heatmap',
            title: '项目风险等级热力图',
            metricKeys: ['risk_pressure'],
            dimensionKey: 'project',
          },
          {
            chartType: 'table',
            title: '高风险项目清单',
            metricKeys: ['risk_pressure'],
            dimensionKey: 'risk_level',
          },
        ],
      },
    },
    {
      templateId: 'ptpl_official_trend_velocity',
      version: 1,
      name: '交付速度趋势洞察',
      description: '基于时间维度的交付进度与延期压力趋势、移动平均与异常点，辅助预测瓶颈与节拍偏移',
      category: 'execution',
      scenario: 'progress_review',
      personDimensionRequiresExtraPermission: false,
      composition: {
        dataSourceKeys: ['bi_trend_analysis', 'organization_dashboard'],
        metricKeys: ['project_progress', 'schedule_delay_pressure'],
        dimensionKeys: ['time', 'project'],
        defaultFilters: {
          window: 'last_12_weeks',
        },
        charts: [
          {
            chartType: 'line',
            title: '交付进度趋势',
            metricKeys: ['project_progress'],
            dimensionKey: 'time',
          },
          {
            chartType: 'line',
            title: '延期压力趋势',
            metricKeys: ['schedule_delay_pressure'],
            dimensionKey: 'time',
          },
          {
            chartType: 'bar',
            title: '团队交付速度对比',
            metricKeys: ['project_progress'],
            dimensionKey: 'project',
            optional: true,
          },
        ],
      },
    },
    {
      templateId: 'ptpl_official_resource_health',
      version: 1,
      name: '资源健康度诊断报告',
      description: '全组织资源利用、缺口与争用聚合，揭示过载与闲置区间，支撑资源再分配决策',
      category: 'resource',
      scenario: 'resource_planning',
      personDimensionRequiresExtraPermission: false,
      composition: {
        dataSourceKeys: [
          'organization_resource_pool',
          'resource_skill_matrix',
          'resource_gap_analysis',
          'resource_contention_detection',
        ],
        metricKeys: [
          'resource_utilization_rate',
          'resource_gap_hours',
          'resource_contention_count',
        ],
        dimensionKeys: ['organization', 'team', 'project'],
        defaultFilters: {},
        charts: [
          {
            chartType: 'stat_card',
            title: '资源利用率总览',
            metricKeys: ['resource_utilization_rate'],
            dimensionKey: 'organization',
          },
          {
            chartType: 'bar',
            title: '按团队资源分配',
            metricKeys: ['resource_utilization_rate'],
            dimensionKey: 'team',
          },
          {
            chartType: 'bar',
            title: '资源缺口分布',
            metricKeys: ['resource_gap_hours'],
            dimensionKey: 'project',
          },
          {
            chartType: 'table',
            title: '资源争用明细',
            metricKeys: ['resource_contention_count'],
            dimensionKey: 'project',
          },
        ],
      },
    },
    {
      templateId: 'ptpl_official_team_perf_trend',
      version: 1,
      name: '团队绩效与趋势报告',
      description: '聚合团队粒度绩效、OKR 进展与负载分布，支持时间趋势与个人维度受控下钻',
      category: 'people',
      scenario: 'performance_review',
      personDimensionRequiresExtraPermission: true,
      composition: {
        dataSourceKeys: ['okr_hierarchy', 'organization_dashboard', 'bi_trend_analysis'],
        metricKeys: ['team_task_completion_rate', 'team_workload_distribution', 'okr_progress'],
        dimensionKeys: ['team', 'time', 'person'],
        defaultFilters: {},
        charts: [
          {
            chartType: 'stat_card',
            title: '组织 OKR 达成度',
            metricKeys: ['okr_progress'],
            dimensionKey: 'team',
          },
          {
            chartType: 'bar',
            title: '按团队任务完成率',
            metricKeys: ['team_task_completion_rate'],
            dimensionKey: 'team',
          },
          {
            chartType: 'bar',
            title: '按团队负载分布',
            metricKeys: ['team_workload_distribution'],
            dimensionKey: 'team',
          },
          {
            chartType: 'line',
            title: '团队绩效趋势',
            metricKeys: ['team_task_completion_rate', 'okr_progress'],
            dimensionKey: 'time',
          },
        ],
      },
    },
  ],
}
