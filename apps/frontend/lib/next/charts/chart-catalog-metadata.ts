/**
 * 图表馆 20 项经典 PM 图表静态元数据与检索纯函数
 * （v3-ui-next-chart-gallery design §2.2 / spec「图表馆独立空间与 20 项全景目录」）。
 *
 * 契约要点：
 * - RL-14（确定性 UI 渲染器）：目录为纯静态元数据数组，禁止运行时注入不可信项；
 * - 全部 24 项（20 经典 PM + 4 TRIZ 分馆）状态 available（「已就绪」）；
 *   coming-soon（「即将上线」）机制保留为后续新增图表的占位基础设施（与空间地图
 *   coming-soon 语义一致），当前目录无占位项；
 * - `iconName` 为确定性字符串键，lucide 图标映射在组件侧收敛；
 * - 过滤为纯函数、零副作用，供 ChartGalleryCatalog 即时检索；
 * - coming-soon 项附带 `upcoming` 规划说明（管理价值 / B6a 已上线端点对应 / 演进路线），
 *   供 ChartUpcomingDrawer 陈列。
 */

export const CHART_DOMAINS = [
  { id: 'governance', label: '立项治理' },
  { id: 'schedule', label: '进度网络' },
  { id: 'balancing', label: '工期平衡' },
  { id: 'structure', label: '结构质量' },
  { id: 'triz', label: 'TRIZ创新' },
] as const

export type ChartDomainId = (typeof CHART_DOMAINS)[number]['id']

export type ChartStatus = 'available' | 'coming-soon'

/** 图标名契约（与 ChartGalleryCatalog / ChartUpcomingDrawer 的 lucide 映射同步）。 */
export type ChartIconName =
  | 'chart-column'
  | 'shield'
  | 'network'
  | 'flag'
  | 'fish'
  | 'trees'
  | 'chart-scatter'
  | 'kanban'
  | 'book'
  | 'list-checks'
  | 'columns'
  | 'circle-alert'
  | 'users'
  | 'share-2'
  | 'chart-line'
  | 'activity'
  | 'flame'
  | 'percent'
  | 'building'
  | 'chart-spline'
  | 'layout-grid'

/** 第二层图表的预告规划说明（业务价值 / 数据依赖与端点规划 / 演进路线）。 */
export interface ChartUpcomingPlan {
  /** 管理应用价值（每行一条要点） */
  value: string[]
  /** 与 B6a 已上线后端端点的规划对应关系 */
  endpoints: string[]
  /** 未来演进路线 */
  roadmap: string[]
}

export interface PmChartDefinition {
  /** 路由标识（/charts/:chartId 或规划占位 id） */
  id: string
  /** 图表中文名称 */
  title: string
  /** 英文/缩写副标题（搜索与卡片副行） */
  subtitle: string
  /** PM 知识领域（决定分类 Tab） */
  domain: ChartDomainId
  /** 交付层：1 = 第一层已就绪；2 = 第二层规划 */
  tier: 1 | 2
  status: ChartStatus
  /** 状态徽标文案（与空间地图 badge 语义一致） */
  badge: string
  /** 图表价值简介 */
  description: string
  /** 检索标签（中文别名 / 英文缩写 / 关键术语） */
  tags: string[]
  iconName: ChartIconName
  /** 仅 tier 2：预告抽屉规划内容 */
  upcoming?: ChartUpcomingPlan
}

export const PM_CHART_DEFINITIONS: readonly PmChartDefinition[] = [
  // -------------------------------------------------------------------------
  // 第一层 8 项：数据源与排程算法已就绪（design §2.1 顺序）
  // -------------------------------------------------------------------------
  {
    id: 'resource-load',
    title: '资源负荷表',
    subtitle: 'Resource Load Histogram',
    domain: 'balancing',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '按日直方图透视成员容量与已分配工时的超额负荷，100% 容量警戒线即时预警。',
    tags: ['资源负荷', '负荷', '直方图', '人员负荷', '工时', '容量', 'load', 'resource'],
    iconName: 'chart-column',
  },
  {
    id: 'risk-register',
    title: '风险登记表 + 5×5 矩阵',
    subtitle: 'Risk Register & Matrix',
    domain: 'governance',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '5×5 概率-影响热力矩阵联动风险登记底册，支持受控增删改与矩阵联动过滤。',
    tags: ['风险', '风险登记', '风险矩阵', '概率', '影响', '5x5', 'risk', 'register', 'matrix'],
    iconName: 'shield',
  },
  {
    id: 'aon-network',
    title: 'AON 紧前节点网络图',
    subtitle: 'Activity-on-Node Network',
    domain: 'schedule',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: 'CPM 六格节点拓扑网络：ES/EF/LS/LF 时差解算，关键路径红色贯穿高亮。',
    tags: [
      'AON',
      '网络图',
      '前导图',
      '节点式网络图',
      '紧前节点',
      '单代号',
      'PDM',
      '关键路径',
      'CPM',
      '依赖',
      'network',
      'aon',
    ],
    iconName: 'network',
  },
  {
    id: 'milestone-timeline',
    title: '里程碑时间轴泳道',
    subtitle: 'Milestone Timeline',
    domain: 'schedule',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '日历标尺上的菱形旗帜泳道，五状态机（达成/风险/逾期）与关联任务进度一目了然。',
    tags: ['里程碑', '里程碑图', '时间轴', '泳道', 'milestone', 'timeline'],
    iconName: 'flag',
  },
  {
    id: 'fishbone',
    title: '鱼骨图 / 因果分析',
    subtitle: 'Fishbone / Ishikawa Diagram',
    domain: 'structure',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '经典 6M（人机料法环测）因果骨架，在线编辑要因分支并作为 Diagram 实体持久化。',
    tags: ['鱼骨图', '因果图', '石川图', '6M', '根因', 'fishbone', 'ishikawa'],
    iconName: 'fish',
  },
  {
    id: 'rbs',
    title: '资源分解结构 RBS',
    subtitle: 'Resource Breakdown Structure',
    domain: 'structure',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: 'L1 总库 → 大类 → 角色 → 实例的四级资源树，按技能标签即时高亮检索。',
    tags: ['RBS', '资源分解结构', '资源树', '技能', 'rbs', 'resource'],
    iconName: 'trees',
  },
  {
    id: 'scatter-plot',
    title: '双变量散布图',
    subtitle: 'Bivariate Scatter Plot',
    domain: 'structure',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '工时/成本估算偏差与风险敞口三维度散点，45° 理想基准线与均值象限辅助诊断。',
    tags: ['散布图', '散点图', '偏差', '工时', '成本', '相关性', 'scatter'],
    iconName: 'chart-scatter',
  },
  {
    id: 'kanban',
    title: '看板',
    subtitle: 'Kanban Board',
    domain: 'schedule',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '敏捷流转与 WIP 列容量监控入口，直达项目空间看板主工作面（lens=kanban）。',
    tags: ['看板', 'kanban', '敏捷', '流转', 'WIP', '列容量'],
    iconName: 'kanban',
  },
  // -------------------------------------------------------------------------
  // 以下各项原为第二层预告占位；批 G1~G4 已全部落地为已就绪镜头（数据端点 B6a 既有）
  // -------------------------------------------------------------------------
  {
    id: 'charter',
    title: '项目章程',
    subtitle: 'Project Charter',
    domain: 'governance',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '项目启动的契约总纲：目标、成功准则、范围边界与审批链路的仪表化呈现。',
    tags: ['章程', 'charter', '立项', '目标', '契约'],
    iconName: 'book',
  },
  {
    id: 'rtm',
    title: '需求追踪矩阵 RTM',
    subtitle: 'Requirements Traceability Matrix',
    domain: 'governance',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '需求 ↔ 任务双向追溯矩阵，验收覆盖缺口与交付状态一目了然。',
    tags: ['需求', 'RTM', '追踪矩阵', '追溯', '验收', 'requirements', 'traceability'],
    iconName: 'list-checks',
  },
  {
    id: 'raci',
    title: 'RACI 责任分配矩阵',
    subtitle: 'RACI Assignment Matrix',
    domain: 'governance',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '任务 × 干系人的 R/A/C/I 交叉矩阵，职责缺口与多重负责自动识别。',
    tags: ['RACI', '责任分配', '矩阵', '职责', 'raci', 'assignment'],
    iconName: 'columns',
  },
  {
    id: 'issues',
    title: '议题与变更追踪',
    subtitle: 'Issues & Change Tracking',
    domain: 'governance',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '议题缺陷从登记、指派、根因到关闭的全生命周期追踪与趋势统计。',
    tags: ['议题', '缺陷', '问题', '变更', 'issues', 'bug', '追踪'],
    iconName: 'circle-alert',
  },
  {
    id: 'stakeholder',
    title: '利害关系人登记表',
    subtitle: 'Stakeholder Register',
    domain: 'governance',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '干系人权力-利益四象限登记与应对策略矩阵，重点管理对象聚焦呈现。',
    tags: ['干系人', '利害关系人', 'stakeholder', '权力', '利益', '四象限'],
    iconName: 'users',
  },
  {
    id: 'communication',
    title: '沟通管理计划',
    subtitle: 'Communication Plan',
    domain: 'governance',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '沟通事项、频次、渠道与受众的计划矩阵，启停状态与周期报表挂钩。',
    tags: ['沟通', 'communication', '计划', '渠道', '频次', '会议'],
    iconName: 'share-2',
  },
  {
    id: 'evm',
    title: '实值管理 EVM',
    subtitle: 'Earned Value Management',
    domain: 'balancing',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '挣值三曲线与 CV/SV/CPI/SPI 指标体系，进度-成本偏离的量化仪表。',
    tags: ['EVM', '挣值', '实值', 'SPI', 'CPI', 'evm', 'earned', 'value'],
    iconName: 'chart-line',
  },
  {
    id: 'lob',
    title: '线条平衡图 LOB',
    subtitle: 'Line of Balance',
    domain: 'schedule',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '重复性流水工序的推进速率斜率对比，识别滞后工序与节拍失衡。',
    tags: ['LOB', '线条平衡', '流水', '节拍', 'lob', 'line', 'balance'],
    iconName: 'activity',
  },
  {
    id: 'burndown',
    title: '燃尽 / 燃起图',
    subtitle: 'Burndown / Burnup Chart',
    domain: 'schedule',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '迭代剩余工作燃尽与范围燃起双线对比，范围蔓延（Scope Creep）显形。',
    tags: ['燃尽', '燃起', 'burndown', 'burnup', '迭代', '范围'],
    iconName: 'flame',
  },
  {
    id: 'pareto',
    title: '柏拉图',
    subtitle: 'Pareto Analysis',
    domain: 'structure',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '缺陷/风险/成本归因的 80/20 排序，直方降序 + 累积百分比曲线双轴呈现。',
    tags: ['柏拉图', '帕累托', 'pareto', '80', '20', '累积', 'abc'],
    iconName: 'percent',
  },
  {
    id: 'obs',
    title: '组织分解结构 OBS',
    subtitle: 'Organization Breakdown Structure',
    domain: 'structure',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '部门树 × 成员工时的组织责任视图，负荷挂载到部门节点的树状盘点。',
    tags: ['OBS', '组织', '部门', 'obs', 'organization', '结构'],
    iconName: 'building',
  },
  {
    id: 'control-chart',
    title: '控制图 SPC',
    subtitle: 'Statistical Process Control',
    domain: 'structure',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '周期时间与交付提前期的 X̄ 控制图：中心线、±2σ 警告限与 ±3σ 控制限。',
    tags: ['控制图', 'SPC', 'sigma', '控制限', '统计过程', 'control', 'chart'],
    iconName: 'chart-spline',
  },
  // -------------------------------------------------------------------------
  // TRIZ 分馆四件（v3-triz-contradiction-copilot W7 · tasks 7.1-7.6）
  // -------------------------------------------------------------------------
  {
    id: 'triz-contradiction-matrix',
    title: 'TRIZ 矛盾矩阵',
    subtitle: 'Contradiction Matrix',
    domain: 'triz',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '39项工程参数交叉检索与40项发明原理映射推荐，快速定位冲突解决方向。',
    tags: ['TRIZ', '矛盾矩阵', '发明原理', '工程参数', '技术矛盾', 'matrix', 'contradiction'],
    iconName: 'columns',
  },
  {
    id: 'triz-nine-windows',
    title: '九屏幕法',
    subtitle: '9-Screen Diagram',
    domain: 'triz',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '时间与系统层级三乘三多维推演，跳出点状思维审视系统演进脉络。',
    tags: ['TRIZ', '九屏幕', '九宫格', '多屏幕法', '系统思维', 'nine-windows'],
    iconName: 'layout-grid',
  },
  {
    id: 'triz-function-analysis',
    title: '功能分析图',
    subtitle: 'Function Analysis',
    domain: 'triz',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '组件间有用、有害、不足与过度功能拓扑建模，定位系统有害载荷与瓶颈。',
    tags: ['TRIZ', '功能分析', '组件模型', '物质场', '功能拓扑', 'function-analysis'],
    iconName: 'network',
  },
  {
    id: 'triz-evolution-scurve',
    title: '进化 S 曲线',
    subtitle: 'Evolution S-Curve',
    domain: 'triz',
    tier: 1,
    status: 'available',
    badge: '已就绪',
    description: '技术系统生命周期四阶段定位与成熟度描述，指引系统跃迁与替代时机。',
    tags: ['TRIZ', 'S曲线', '技术进化', '生命周期', '成熟度', 's-curve', 'evolution'],
    iconName: 'chart-spline',
  },
] as const satisfies readonly PmChartDefinition[]

export type PmChartId = (typeof PM_CHART_DEFINITIONS)[number]['id']

/** 既有 20 项经典 PM 图表切片（批 G1~G4 后 20 项全量已就绪；TRIZ 分馆 4 项在后续切片） */
export const CLASSIC_PM_CHART_DEFINITIONS = PM_CHART_DEFINITIONS.slice(0, 20)

/** TRIZ 分馆 4 项已就绪图表切片 */
export const TRIZ_CHART_DEFINITIONS = PM_CHART_DEFINITIONS.slice(20)

export const AVAILABLE_CHART_DEFINITIONS = PM_CHART_DEFINITIONS.filter(
  (definition) => definition.status === 'available',
)

export const COMING_SOON_CHART_DEFINITIONS = PM_CHART_DEFINITIONS.filter(
  (definition) => definition.status === 'coming-soon',
)

const chartById = new Map(PM_CHART_DEFINITIONS.map((definition) => [definition.id, definition]))

/** 按 id 查图表定义（未知 id 返回 undefined，调用方决定空态/回退）。 */
export function getChartDefinition(chartId: string): PmChartDefinition | undefined {
  return chartById.get(chartId)
}

/** 判定 chartId 是否为已就绪的第一层图表（含看板直达入口）。 */
export function isAvailableChartId(chartId: string): chartId is PmChartId {
  return getChartDefinition(chartId)?.status === 'available'
}

/** 判定 chartId 是否为第二层「即将上线」占位图表（可弹出预告抽屉）。 */
export function isComingSoonChartId(chartId: string): boolean {
  return getChartDefinition(chartId)?.status === 'coming-soon'
}

export const CHART_DOMAIN_LABELS: Record<ChartDomainId, string> = {
  governance: '立项治理',
  schedule: '进度网络',
  balancing: '工期平衡',
  structure: '结构质量',
  triz: 'TRIZ创新',
}

export interface ChartFilterState {
  query?: string
  domain?: ChartDomainId | 'all'
}

/**
 * 分类 + 多词项模糊过滤（design §2.2 / spec「即时过滤与分类筛选」）：
 * - 空 query 返回当前分类全集；多词项为 AND 语义（每词须命中 title/subtitle/
 *   description/tags/domain 标签之一，不区分大小写）；
 * - 返回新数组（原静态白名单 readonly 不可变，绝不突变）。
 */
export function filterChartDefinitions(state: ChartFilterState = {}): PmChartDefinition[] {
  const query = (state.query ?? '').trim()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return PM_CHART_DEFINITIONS.filter((definition) => {
    if (state.domain && state.domain !== 'all' && definition.domain !== state.domain) {
      return false
    }
    if (terms.length === 0) return true
    const haystack = [
      definition.title,
      definition.subtitle,
      definition.description,
      CHART_DOMAIN_LABELS[definition.domain],
      ...definition.tags,
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
