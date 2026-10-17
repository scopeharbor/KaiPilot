/**
 * 利害关系人登记与四象限适配器（v3-chart-gallery-tier2-governance-matrices W1 · task 1.4）。
 *
 * 职责：
 * 1. 纯函数解析后端 `?view=quadrant` 象限与登记列表信封；
 * 2. 映射 2×2 权力-利益四象限桶（manageClosely/keepSatisfied/keepInformed/monitor）；
 * 3. 装配结构化登记底册表格行模型；
 * 4. 映射中性态度标签与策略文案，严格遵循 DOM 中性规范；
 * 5. 处理无干系人记录时的空态安全回退。
 */
import type {
  QuadrantBucketKey,
  StakeholderAttitude,
  StakeholderItem,
  StakeholderLevel,
  StakeholderQuadrantData,
  StakeholderStrategy,
  StakeholderType,
} from '@/lib/api/stakeholders'
import {
  QUADRANT_BUCKET_TITLES,
  STAKEHOLDER_ATTITUDE_LABELS,
  STAKEHOLDER_STRATEGY_LABELS,
} from '@/lib/api/stakeholders'

export type { QuadrantBucketKey }

export interface StakeholderCardViewModel {
  id: number
  name: string
  organizationName: string
  roleTitle: string
  stakeholderType: StakeholderType
  stakeholderTypeLabel: string
  powerLevel: StakeholderLevel
  powerLevelLabel: string
  interestLevel: StakeholderLevel
  interestLevelLabel: string
  attitude: StakeholderAttitude
  attitudeLabel: string
  attitudeClassName: string
  strategy: StakeholderStrategy
  strategyLabel: string
  expectations: string
}

export interface StakeholderQuadrantBucketViewModel {
  key: QuadrantBucketKey
  title: string
  subtitle: string
  count: number
  stakeholders: StakeholderCardViewModel[]
}

export interface StakeholderViewModel {
  totalCount: number
  summary: Record<QuadrantBucketKey, number>
  quadrantBuckets: Record<QuadrantBucketKey, StakeholderQuadrantBucketViewModel>
  tableRows: StakeholderCardViewModel[]
  isEmpty: boolean
}

export const STAKEHOLDER_LEVEL_LABELS: Record<StakeholderLevel, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export const STAKEHOLDER_TYPE_LABELS: Record<StakeholderType, string> = {
  internal: '内部',
  external: '外部',
}

export const STAKEHOLDER_ATTITUDE_BADGES: Record<
  StakeholderAttitude,
  { label: string; className: string }
> = {
  supportive: {
    label: '支持',
    className: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  },
  neutral: {
    label: '中立',
    className: 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30',
  },
  resistant: {
    label: '抵制',
    className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  },
  leading: {
    label: '主导',
    className: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30',
  },
}

export const QUADRANT_SUBTITLES: Record<QuadrantBucketKey, string> = {
  manageClosely: '高权力 · 高利益（核心决策与交付共建者）',
  keepSatisfied: '高权力 · 低利益（关键约束与审批相关方）',
  keepInformed: '低权力 · 高利益（受影响用户与执行伙伴）',
  monitor: '低权力 · 低利益（常规通报与观察相关方）',
}

export function formatStakeholderCard(item: StakeholderItem): StakeholderCardViewModel {
  const attitudeCfg =
    STAKEHOLDER_ATTITUDE_BADGES[item.attitude] || STAKEHOLDER_ATTITUDE_BADGES.neutral

  return {
    id: item.id,
    name: item.name,
    organizationName: item.organizationName || '当前组织',
    roleTitle: item.roleTitle || '利害关系人',
    stakeholderType: item.stakeholderType,
    stakeholderTypeLabel: STAKEHOLDER_TYPE_LABELS[item.stakeholderType] || item.stakeholderType,
    powerLevel: item.powerLevel,
    powerLevelLabel: STAKEHOLDER_LEVEL_LABELS[item.powerLevel] || item.powerLevel,
    interestLevel: item.interestLevel,
    interestLevelLabel: STAKEHOLDER_LEVEL_LABELS[item.interestLevel] || item.interestLevel,
    attitude: item.attitude,
    attitudeLabel: STAKEHOLDER_ATTITUDE_LABELS[item.attitude] || item.attitude,
    attitudeClassName: attitudeCfg.className,
    strategy: item.managementStrategy,
    strategyLabel: STAKEHOLDER_STRATEGY_LABELS[item.managementStrategy] || item.managementStrategy,
    expectations: item.expectations || '无明确诉求记录',
  }
}

/**
 * 构建利害关系人视图模型纯函数。
 */
export function buildStakeholderViewModel(
  quadrantData: StakeholderQuadrantData | null | undefined,
  listData?: StakeholderItem[] | null,
): StakeholderViewModel {
  const emptySummary: Record<QuadrantBucketKey, number> = {
    manageClosely: 0,
    keepSatisfied: 0,
    keepInformed: 0,
    monitor: 0,
  }

  const bucketKeys: QuadrantBucketKey[] = [
    'manageClosely',
    'keepSatisfied',
    'keepInformed',
    'monitor',
  ]

  if (!quadrantData) {
    const emptyBuckets = {} as Record<QuadrantBucketKey, StakeholderQuadrantBucketViewModel>
    for (const k of bucketKeys) {
      emptyBuckets[k] = {
        key: k,
        title: QUADRANT_BUCKET_TITLES[k],
        subtitle: QUADRANT_SUBTITLES[k],
        count: 0,
        stakeholders: [],
      }
    }
    return {
      totalCount: 0,
      summary: emptySummary,
      quadrantBuckets: emptyBuckets,
      tableRows: [],
      isEmpty: true,
    }
  }

  const summary = {
    manageClosely: quadrantData.summary?.manageClosely ?? 0,
    keepSatisfied: quadrantData.summary?.keepSatisfied ?? 0,
    keepInformed: quadrantData.summary?.keepInformed ?? 0,
    monitor: quadrantData.summary?.monitor ?? 0,
  }

  const rawQuadrants = quadrantData.quadrants || {}
  const quadrantBuckets = {} as Record<QuadrantBucketKey, StakeholderQuadrantBucketViewModel>
  const allCardList: StakeholderCardViewModel[] = []

  for (const key of bucketKeys) {
    const rawItems = rawQuadrants[key] || []
    const cards = rawItems.map(formatStakeholderCard)
    quadrantBuckets[key] = {
      key,
      title: QUADRANT_BUCKET_TITLES[key],
      subtitle: QUADRANT_SUBTITLES[key],
      count: cards.length,
      stakeholders: cards,
    }
    allCardList.push(...cards)
  }

  // 若提供了完整的独立列表数据则使用，否则直接由象限聚合展平
  const tableRows =
    listData && listData.length > 0 ? listData.map(formatStakeholderCard) : allCardList

  const totalCount =
    summary.manageClosely + summary.keepSatisfied + summary.keepInformed + summary.monitor

  return {
    totalCount: totalCount > 0 ? totalCount : tableRows.length,
    summary,
    quadrantBuckets,
    tableRows,
    isEmpty: totalCount === 0 && tableRows.length === 0,
  }
}
