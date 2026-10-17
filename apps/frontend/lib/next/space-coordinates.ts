/**
 * 空间坐标清单与检索（v3-ui-next-shell-space-map D3 / spec「空间地图坐标检索、直达导航与占位项置灰」）。
 *
 * - 静态确定性白名单：可用坐标（available）与规划中坐标（coming-soon）严格区分；
 * - RL-14（确定性 UI 渲染器）：清单为纯静态数据，禁止在运行时注入不可信动态项；
 * - 检索为纯函数、零副作用，供 SpaceMapOverlay 搜索框即时过滤。
 */

export type SpaceStatus = 'available' | 'coming-soon'

export interface SpaceCoordinate {
  id: string
  title: string
  path: string
  description: string
  status: SpaceStatus
  badge?: string
  /** 图标名称（联合类型契约）：与 SpaceMapCard 的 lucide 图标映射保持同步。 */
  iconName:
    | 'Home'
    | 'Sparkles'
    | 'BarChart3'
    | 'FileText'
    | 'Shield'
    | 'GitPullRequest'
    | 'Users'
    | 'FolderArchive'
    | 'BookOpen'
    | 'Database'
    // v3-ui-next-org-portfolio-domains W10 · tasks 10.1：组织/全局坐标图标点亮
    | 'Building2'
    | 'LayoutDashboard'
    | 'Flame'
    | 'TrendingUp'
    | 'Target'
    | 'Gauge'
    | 'Boxes'
    | 'AlertTriangle'
    | 'Scale'
    | 'Activity'
    | 'RefreshCw'
    | 'ArrowLeftRight'
    | 'Package'
    | 'ShieldCheck'
    | 'Layers'
    | 'GraduationCap'
    | 'ShieldAlert'
    // v3-ui-next-pmo-domain W9 · tasks 9.1：PMO 组合层 8 项坐标图标点亮
    | 'TrafficCone'
    | 'LayoutGrid'
    | 'ListOrdered'
    | 'Wand2'
    | 'Gavel'
    | 'Network'
    | 'Radar'
    // v3-ui-next-settings-admin-domains W9 · tasks 9.1：设置空间/管理后台/项目设置图标点亮
    | 'Settings'
    | 'Settings2'
    // v3-ui-next-batch3-global-convergence W5 · tasks 5.3：全域汇聚坐标图标
    | 'Search'
    | 'Bell'
    | 'Calendar'
    | 'CheckSquare'
  keywords: string[]
}

export const PRESET_SPACE_COORDINATES: readonly SpaceCoordinate[] = [
  {
    id: 'home',
    title: '角色首页',
    path: '/next',
    description: '当前角色的专属工作落点与态势概览',
    status: 'available',
    badge: '已就绪',
    iconName: 'Home',
    keywords: ['首页', '工作台', 'next', 'home', '角色'],
  },
  {
    id: 'create',
    title: '生成剧场',
    path: '/next/create',
    description: '多模态 AI 项目生成与沙盘推演剧场（D5）',
    status: 'available',
    badge: '已就绪',
    iconName: 'Sparkles',
    keywords: ['生成', '剧场', '创建', 'create', 'ai'],
  },
  {
    id: 'charts',
    title: '图表馆',
    path: '/next/charts',
    description: '20项经典项目管理图表与高维分析矩阵（D12/D15）',
    status: 'available',
    badge: '已就绪',
    iconName: 'BarChart3',
    keywords: [
      '图表',
      '甘特',
      '度量',
      'charts',
      '报表',
      'aon',
      '负荷',
      '风险矩阵',
      '鱼骨图',
      'rbs',
      '散布图',
      '里程碑',
    ],
  },
  {
    // 项目级报表中心坐标（v3-ui-next-reports-domain design「通道一」）：
    // 项目域独立工作空间，path 携带 :id 占位符，点击时由 SpaceMapOverlay 以
    // 当前项目解析（resolveSpaceCoordinatePath）；全局视图下引导进入角色首页选项目。
    id: 'reports',
    title: '报表中心',
    path: '/next/projects/:id/reports',
    description: '预设项目报表生成、AI 周期周报/月报管理与版本审阅',
    status: 'available',
    badge: '已就绪',
    iconName: 'FileText',
    keywords: ['报表', '周报', '月报', '进度报告', 'reports', '总结', '报告'],
  },
  {
    // 项目风险管理坐标（v3-ui-next-risk-change-domains W3 · tasks 3.5）：
    // 项目级治理功能域，path 携带 :id 占位符，点击时由 SpaceMapOverlay 以当前项目
    // 解析（resolveSpaceCoordinatePath）；全局视图下引导进入角色首页选项目。
    id: 'risks',
    title: '风险管理',
    path: '/next/projects/:id/risks',
    description: '项目风险辨识、态势评估与应对流转',
    status: 'available',
    badge: '已就绪',
    iconName: 'Shield',
    keywords: ['风险', '隐患', '工作台', '矩阵', '5x5', '复查', 'risks'],
  },
  {
    // 项目变更控制坐标（v3-ui-next-risk-change-domains W3 · tasks 3.5）：同上项目级
    // 治理功能域占位路径规则。
    id: 'change-requests',
    title: '变更请求',
    path: '/next/projects/:id/change-requests',
    description: '项目基线变更申请、六维影响分析与审批决策',
    status: 'available',
    badge: '已就绪',
    iconName: 'GitPullRequest',
    keywords: ['变更', 'cr', '审批', '影响分析', '申请', 'change'],
  },
  // ---------------------------------------------------------------------------
  // 协同管理功能域坐标（v3-ui-next-resource-team-domains W4 · tasks 4.5）：
  // 资源工作台 / 成员与团队 / 项目文件库 —— 与主工作面 LensSwitcher 正交的
  // 协同管理域入口；path 均携带 :id 占位符，点击时由 SpaceMapOverlay 以当前
  // 项目解析（resolveSpaceCoordinatePath），全局视图下引导进入角色首页选项目。
  // 关键词与既有坐标语义核对：不引入 角色/风险/变更/审批/报表/生成 等既有专属词
  // （避免 filterSpaceCoordinates 既有归属断言漂移）；「人员」为资源与成员两域
  // 共享检索词（双命中语义）。
  // ---------------------------------------------------------------------------
  {
    id: 'resources',
    title: '资源工作台',
    path: '/next/projects/:id/resources',
    description: '人员/物料/设备/预算全类型资源调配、分配明细与负荷排查',
    status: 'available',
    badge: '已就绪',
    iconName: 'Users',
    keywords: ['资源', '人员', '负载', '分配', '工时', 'resources', '负荷'],
  },
  {
    id: 'members',
    title: '成员与团队',
    path: '/next/projects/:id/members',
    description: '项目协作者名单、职责与权限的受控调整、所有权转让与成员邀请',
    status: 'available',
    badge: '已就绪',
    iconName: 'Users',
    keywords: ['成员', '团队', '邀请', '权限', 'members', '人员'],
  },
  {
    id: 'files',
    title: '项目文件库',
    path: '/next/projects/:id/files',
    description: '项目交付物归档、附件拖拽上传、安全下载与轻量文档管理',
    status: 'available',
    badge: '已就绪',
    iconName: 'FolderArchive',
    keywords: ['文件', '附件', '文档', '资料', '上传', 'files', '下载'],
  },
  {
    // TRIZ 决策中心项目级坐标（收口补齐）：新轨路由 /next/projects/:id/triz-decision-center
    // 刻意跨轨复用旧轨生产页组件（功能补齐优先）。关键词避让：不引入「决策」（org 决策
    // 工作台专属）、「创新」（TRIZ 分馆图表语义）等既有专属词。
    id: 'triz-decision-center',
    title: 'TRIZ 决策中心',
    path: '/next/projects/:id/triz-decision-center',
    description: 'TRIZ 矛盾/方案聚合审查、人工决策与交付闭环验证追踪',
    status: 'available',
    badge: '已就绪',
    iconName: 'Scale',
    keywords: ['TRIZ', '矛盾', '矛盾矩阵', '发明原理', '发明问题解决', 'triz'],
  },
  // ---------------------------------------------------------------------------
  // 帮助中心 / 知识底座全局坐标（v3-ui-next-help-knowledge-domain W3 · tasks 3.1）：
  // 两者为全局级/组织级独立视窗（design Decision 1「三通道全域融入体系」通道一），
  // 路径不含 :id 占位符，resolveSpaceCoordinatePath 原样返回（任何上下文均可直达，
  // 绝不回退引导首页）；绝不混入 LensSwitcher 单项目主工作面镜头。
  // 关键词与既有坐标语义核对：未引入 首页/工作台/报表/资源/成员/文件/人员/图表
  // 等既有专属词（避免 filterSpaceCoordinates 既有归属断言漂移）；「文档」为帮助
  // 与项目文件库共享检索词（双命中语义，与「人员/负荷」同例）。
  // ---------------------------------------------------------------------------
  {
    id: 'help',
    title: '帮助中心',
    path: '/next/help',
    description: '平台官方帮助中心：功能导览、操作指引与常见问题速查',
    status: 'available',
    badge: '已就绪',
    iconName: 'BookOpen',
    keywords: ['帮助', '文档', '手册', '指南', 'help'],
  },
  {
    id: 'knowledge',
    title: '知识底座',
    path: '/next/knowledge',
    description: '组织四层知识底座：规范、观察、合成与现实知识的统一沉淀治理',
    status: 'available',
    badge: '已就绪',
    iconName: 'Database',
    keywords: ['知识', '知识库', '规范', '经验', 'knowledge'],
  },
  // ---------------------------------------------------------------------------
  // 组织组合层 / 全局视窗坐标（v3-ui-next-org-portfolio-domains W10 · tasks 10.1）：
  // 18 个旧轨组织/全局页面中除 [loopId] 详情动态路由外的 17 条无 :id 占位静态坐标
  // （设计 Decision 1「静态坐标语义」——组织 ID 由 JWT 租户上下文决定，绝不出现在
  // URL，路径无占位符时 resolveSpaceCoordinatePath 原样返回、任何上下文均可直达）。
  // 关键词与既有项目级坐标错峰：组织资源池不用裸「资源」、组织风险热力不用裸
  // 「风险」等，以「组织资源池/风险热力/技能矩阵/插件目录/容量环」等复合词抢占，
  // 避免检索互吞（与「人员/负荷/文档」共享词同例的复合词归属由 10.2 测试锁定）；
  // 描述/关键词不引入 首页/图表/报表/负荷/成员/文件/文档/帮助/知识 等既有专属词
  // （避免 filterSpaceCoordinates 既有归属断言漂移）。
  // ---------------------------------------------------------------------------
  {
    id: 'org_overview',
    title: '组织概览',
    path: '/next/organization',
    description: '组织级态势总览：KPI 指标条、项目状态分布、待关注队列与活动流',
    status: 'available',
    badge: '已就绪',
    iconName: 'Building2',
    keywords: ['组织', '概览', '总览', '态势', 'overview'],
  },
  {
    id: 'org_bi_dashboards',
    title: 'BI 仪表盘',
    path: '/next/organization/bi/dashboards',
    description: '组织 BI 仪表盘编排：我的与组织共享双作用域、widget 网格',
    status: 'available',
    badge: '已就绪',
    iconName: 'LayoutDashboard',
    keywords: ['仪表盘', 'BI', 'bi', 'dashboards', 'widget'],
  },
  {
    id: 'org_bi_risk_heatmap',
    title: '组织风险热力图',
    path: '/next/organization/bi/risk-heatmap',
    description: '组织级风险发生概率×影响的热力矩阵、Top 榜与摘要抽屉',
    status: 'available',
    badge: '已就绪',
    iconName: 'Flame',
    keywords: ['组织风险热力', '风险热力', '热力', 'heatmap'],
  },
  {
    id: 'org_bi_trends',
    title: '趋势分析',
    path: '/next/organization/bi/trends',
    description: '组织级运营趋势时序曲线、异常点标注与解释抽屉',
    status: 'available',
    badge: '已就绪',
    iconName: 'TrendingUp',
    keywords: ['趋势', '趋势分析', 'trends', '时序', '异常'],
  },
  {
    id: 'org_okrs',
    title: 'OKR 层级管理',
    path: '/next/organization/okrs',
    description: '组织目标层级管理：周期、目标树与进度状态',
    status: 'available',
    badge: '已就绪',
    iconName: 'Target',
    keywords: ['组织 OKR', 'OKR', 'okr', '目标', '层级', '周期'],
  },
  {
    id: 'org_okr_dashboard',
    title: 'OKR 仪表盘',
    path: '/next/organization/okrs/dashboard',
    description: '组织 OKR 仪表盘：达成率、进度与对齐分区摘要',
    status: 'available',
    badge: '已就绪',
    iconName: 'Gauge',
    keywords: ['OKR', 'okr', '达成', '对齐', '仪表盘'],
  },
  {
    id: 'org_resource_pool',
    title: '组织资源池',
    path: '/next/organization/resource-pool',
    description: '组织资源池底册与容量矩阵、占用概览',
    status: 'available',
    badge: '已就绪',
    iconName: 'Boxes',
    keywords: ['组织资源池', '资源池', '池', 'capacity', '底册'],
  },
  {
    id: 'org_resource_gaps',
    title: '资源缺口分析',
    path: '/next/organization/resource-gaps',
    description: '按维度透视组织资源缺口：时段、项目与组合分析',
    status: 'available',
    badge: '已就绪',
    iconName: 'AlertTriangle',
    keywords: ['资源缺口', '缺口分析', '缺口', 'gaps'],
  },
  {
    id: 'org_resource_contentions',
    title: '资源争用检测',
    path: '/next/organization/resource-contentions',
    description: '组织资源争用清单与矩阵视图、证据与建议只读抽屉',
    status: 'available',
    badge: '已就绪',
    iconName: 'Scale',
    keywords: ['资源争用', '争用', 'contentions', '证据', '建议'],
  },
  {
    id: 'org_resource_demand',
    title: '资源需求预测',
    path: '/next/organization/resource-demand-forecasting',
    description: '组织资源需求预测：需求曲线、驱动因素与趋势基线',
    status: 'available',
    badge: '已就绪',
    iconName: 'Activity',
    keywords: ['资源需求预测', '需求预测', '预测', 'demand', '曲线'],
  },
  {
    id: 'org_capacity_loops',
    title: '容量闭环',
    path: '/next/organization/resource-capacity-loops',
    description: '组织容量闭环计划：基线模拟、情景比较与移交闭环',
    status: 'available',
    badge: '已就绪',
    iconName: 'RefreshCw',
    keywords: ['容量环', '容量闭环', '闭环', 'loops', '模拟', '情景'],
  },
  {
    id: 'org_cross_project_allocation',
    title: '跨项目调配',
    path: '/next/organization/cross-project-resource-allocation',
    description: '跨项目调配草案编排、候选检索与影响预览',
    status: 'available',
    badge: '已就绪',
    iconName: 'ArrowLeftRight',
    keywords: ['跨项目调配', '跨项目', '调配', '草案', '候选', 'allocation'],
  },
  {
    id: 'org_plugin_directory',
    title: '插件目录',
    path: '/next/organization/plugin-directory',
    description: '组织私有插件发行底册：送审、分发、停止与回滚',
    status: 'available',
    badge: '已就绪',
    iconName: 'Package',
    keywords: ['插件目录', '插件', 'release', '分发', '回滚'],
  },
  {
    id: 'org_plugin_policies',
    title: '插件策略',
    path: '/next/organization/plugin-policies',
    description: '组织插件策略包模板、激活影响与治理闭环',
    status: 'available',
    badge: '已就绪',
    iconName: 'ShieldCheck',
    keywords: ['插件策略', '策略包', '激活', '插件'],
  },
  {
    id: 'global_resources',
    title: '全局资源',
    path: '/next/resources',
    description: '跨项目资源入口：显式选择项目查看摘要与深度链接',
    status: 'available',
    badge: '已就绪',
    iconName: 'Layers',
    keywords: ['全局资源', '资源入口', '项目选择', 'hub'],
  },
  {
    id: 'global_skill_matrix',
    title: '技能矩阵',
    path: '/next/resources/skill-matrix',
    description: '组织技能覆盖情况与候选匹配、明细查阅',
    status: 'available',
    badge: '已就绪',
    iconName: 'GraduationCap',
    keywords: ['技能', '技能矩阵', 'matrix', '覆盖率', '候选'],
  },
  {
    id: 'global_risks',
    title: '问题与风险',
    path: '/next/risks',
    description: '项目问题、项目风险与产品故障的入口导航',
    status: 'available',
    badge: '已就绪',
    iconName: 'ShieldAlert',
    keywords: ['问题与风险', '问题', '风险入口', '风险', '登记册', '故障'],
  },
  // ---------------------------------------------------------------------------
  // PMO 组合层坐标（v3-ui-next-pmo-domain W9 · tasks 9.1）：8 项组织级静态坐标
  // （design Decision 8 按旧页 9 路由注册 8 个静态入口；decisions/[decisionId] 详情
  // 为动态路由不设坐标、由决策列表行内下钻承接，规避全局无组织时的假链接）。
  // 组织 ID 由 JWT 租户上下文决定、URL 无占位符，resolveSpaceCoordinatePath 原样
  // 返回——与 org_*/global_* 同族全域直达语义（Decision 2 组织层与单项目空间正交）。
  // 关键词与既有坐标语义核对：未引入 首页/工作台/风险/变更/审批/申请/资源/成员/
  // 文件/人员/负荷/文档/帮助/知识/报表 等既有专属词（避免 filterSpaceCoordinates
  // 既有归属断言漂移）；「影响分析」为变更请求（六维影响分析）与 PMO 影响分析共享词
  // （双命中语义，与「人员/负荷/文档」共享词同例，由 9.2 测试锁定）；「组合」与
  // 「AI」为组合仪表盘与 AI 优先级推荐坐标专属簇。
  // ---------------------------------------------------------------------------
  {
    id: 'pmo',
    title: '组合仪表盘',
    path: '/next/pmo',
    description: 'PMO 组合层入口：组织项目组合 KPI、健康态势与投入分布',
    status: 'available',
    badge: '已就绪',
    iconName: 'Gauge',
    keywords: ['组合', '组合仪表盘', '组合总览', '总览', 'pmo', 'portfolio'],
  },
  {
    id: 'pmo-traffic-light',
    title: '红绿灯报告',
    path: '/next/pmo/traffic-light',
    description: '组织项目红绿灯底册、四色统计与人工复核标记',
    status: 'available',
    badge: '已就绪',
    iconName: 'TrafficCone',
    keywords: ['红绿灯', '交通灯', 'traffic', '四色'],
  },
  {
    id: 'pmo-grouping-views',
    title: '分组视图',
    path: '/next/pmo/grouping-views',
    description: '按状态与健康度等维度分组组织项目，预览分组结果并保存为自定义视图',
    status: 'available',
    badge: '已就绪',
    iconName: 'LayoutGrid',
    keywords: ['分组', '分组视图', 'grouping', '视图'],
  },
  {
    id: 'pmo-priority-scoring',
    title: '优先级评分',
    path: '/next/pmo/priority-scoring',
    description: '组织项目优先级评分表、权重版本与评分明细（只读）',
    status: 'available',
    badge: '已就绪',
    iconName: 'ListOrdered',
    keywords: ['优先级', '优先级评分', '评分', 'priority', '评分表'],
  },
  {
    id: 'pmo-ai-priority-recommendations',
    title: 'AI 优先级推荐',
    path: '/next/pmo/ai-priority-recommendations',
    description: 'AI 依据组织项目数据产出的优先级推荐队列与人工审阅采纳',
    status: 'available',
    badge: '已就绪',
    iconName: 'Wand2',
    keywords: ['推荐', '优先级推荐', 'ai', 'priority', 'recommendation'],
  },
  {
    id: 'pmo-decisions',
    title: '决策工作台',
    path: '/next/pmo/decisions',
    description: '组织决策议题的队列、建卡与详情审阅（决策工作台）',
    status: 'available',
    badge: '已就绪',
    iconName: 'Gavel',
    keywords: ['决策', '决策工作台', '议题', 'decision'],
  },
  {
    id: 'pmo-dependencies',
    title: '跨项目依赖',
    path: '/next/pmo/dependencies',
    description: '跨项目依赖底册、依赖图谱与人工确认式维护',
    status: 'available',
    badge: '已就绪',
    iconName: 'Network',
    keywords: ['依赖', '跨项目依赖', 'dependency', 'dependencies', '耦合'],
  },
  {
    id: 'pmo-impact-analysis',
    title: '影响分析',
    path: '/next/pmo/impact-analysis',
    description: '多项目影响分析快照、试算回放与解释说明',
    status: 'available',
    badge: '已就绪',
    iconName: 'Radar',
    keywords: ['影响分析', 'impact', '快照'],
  },
  // ---------------------------------------------------------------------------
  // 设置与管理后台域坐标（v3-ui-next-settings-admin-domains W9 · tasks 9.1）：
  // - settings：设置空间（全局 /next/settings，个人偏好/组织治理/安全合规/AI 集成总览）
  // - admin：管理后台（全局 /next/admin，平台治理/运营与信任控制台门户，面向管理员）
  // - project-settings：项目设置（/next/projects/:id/settings，项目级工作日历与节假日配置）
  // ---------------------------------------------------------------------------
  {
    id: 'settings',
    title: '设置空间',
    path: '/next/settings',
    description: '个人偏好、组织设置、安全凭据、集成与审计日志等全域设置总览',
    status: 'available',
    badge: '已就绪',
    iconName: 'Settings',
    keywords: [
      '设置',
      '设置空间',
      '偏好',
      '个人资料',
      '组织设置',
      '安全',
      '集成',
      '审计',
      '密钥',
      'settings',
      'profile',
      '2fa',
      'sso',
      'kms',
      'dlp',
      '合规',
    ],
  },
  {
    id: 'admin',
    title: '管理后台',
    path: '/next/admin',
    description: '平台治理控制台、全局审计、多租户管理、用户底册与信任中心',
    status: 'available',
    badge: '已就绪',
    iconName: 'ShieldAlert',
    keywords: [
      '管理后台',
      '治理',
      '用户',
      '控制台',
      'admin',
      '用户管理',
      '全局审计',
      '平台管理',
      '信任中心',
    ],
  },
  {
    id: 'project-settings',
    title: '项目设置',
    path: '/next/projects/:id/settings',
    description: '项目工作日历、工作日规则与节假日/调休配置',
    status: 'available',
    badge: '已就绪',
    iconName: 'Settings2',
    keywords: ['项目设置', '工作日历', '节假日', '调休', 'calendar', '工作日'],
  },
  {
    // 战略执行驾驶舱坐标（v3-ui-next-batch1-strategy-launch-tasks W5 · tasks 5.1）：
    // 组织级战略阅览面，path 恒指向 /next/strategy-execution-cockpit。
    id: 'strategy-execution-cockpit',
    title: '战略执行驾驶舱',
    path: '/next/strategy-execution-cockpit',
    description: '出版级纸光长卷高管战略复盘、OKR 目标与项目执行对齐矩阵及智能归因',
    status: 'available',
    badge: '已就绪',
    iconName: 'Gauge',
    keywords: [
      '战略',
      '驾驶舱',
      '战略执行',
      '战略驾驶舱',
      '战略执行驾驶舱',
      'cockpit',
      'strategy',
      'okr',
      '对齐',
      '目标对齐',
    ],
  },
  // ---------------------------------------------------------------------------
  // 全域汇聚坐标（v3-ui-next-batch3-global-convergence W5 · tasks 5.3）：
  // 全域搜索、通知中心、全域时间主轴、跨项目任务 HUD
  // ---------------------------------------------------------------------------
  {
    id: 'global-search',
    title: '全域搜索',
    path: '/next/search',
    description: '全域跨实体检索与毫秒级直达（多类型实体与项目直达）',
    status: 'available',
    badge: '已就绪',
    iconName: 'Search',
    keywords: ['全域搜索', '搜索', '查找', '检索', '跨实体', 'search', 'find'],
  },
  {
    id: 'notifications',
    title: '通知中心',
    path: '/next/notifications',
    description: '高优通知态势聚合、分类抽屉与晨报简报直达',
    status: 'available',
    badge: '已就绪',
    iconName: 'Bell',
    keywords: ['通知', '通知中心', '消息', '提醒', '晨报', 'notifications', 'alerts'],
  },
  {
    id: 'global-timeline',
    title: '全域时间主轴',
    path: '/next/calendar',
    description: '跨项目多泳道分层着色时间主轴与刻度缩放',
    status: 'available',
    badge: '已就绪',
    iconName: 'Calendar',
    keywords: ['时间主轴', '全域主轴', '日历', '日程', '排程', 'timeline', 'calendar'],
  },
  {
    id: 'cross-project-tasks',
    title: '全域任务 HUD',
    path: '/next/tasks',
    description: '跨项目任务高密度仪器扫视与个人工作桶全景',
    status: 'available',
    badge: '已就绪',
    iconName: 'CheckSquare',
    keywords: ['全域任务', '跨项目任务', '任务', 'hud', '待办', 'tasks', 'todo'],
  },
  // 日历第 3 批：「我的日历」——跨项目只看指派给我的任务 + 我的休假
  {
    id: 'my-calendar',
    title: '我的日历',
    path: '/next/my-calendar',
    description: '跨项目查看指派给我的任务与我的休假，可直接在日历上新建',
    status: 'available',
    badge: '已就绪',
    iconName: 'Calendar',
    keywords: ['我的日历', '个人日历', '日历', '休假', '请假', 'my calendar', 'calendar'],
  },
  // ---------------------------------------------------------------------------
  // 批 4 组织报表分馆、PMO 组合报表与全局变更审批队列坐标
  // （v3-ui-next-batch4-reports-change-queue W5 · tasks 5.3）
  // ---------------------------------------------------------------------------
  {
    id: 'org-reports-wing',
    title: '组织报表分馆',
    path: '/next/charts?tab=reports-wing',
    description: '跨项目报表聚合与组织级统计导出（进度/延期/工时/里程碑预设模板快照）',
    status: 'available',
    badge: '已就绪',
    iconName: 'BarChart3',
    keywords: ['组织报表', '报表分馆', '组织报表分馆', '报表', '快照', 'reports-wing'],
  },
  {
    id: 'pmo-reports',
    title: 'PMO 组合报表',
    path: '/next/pmo/reports',
    description: 'PMO 组合报表镜头：交付健康、工期偏差、资源负荷与变更冲击四大治理大盘',
    status: 'available',
    badge: '已就绪',
    iconName: 'BarChart3',
    keywords: [
      'PMO 组合报表',
      '组合报表',
      'pmo报表',
      '态势大盘',
      '组合态势',
      '偏差分析',
      '报表',
      'pmo-reports',
    ],
  },
  {
    id: 'pmo-change-queue',
    title: 'PMO 变更审批队列',
    path: '/next/pmo/change-queue',
    description: 'PMO 全局变更审批队列高密度工作台与两阶段受控审批决策',
    status: 'available',
    badge: '已就绪',
    iconName: 'GitPullRequest',
    keywords: [
      'PMO 变更审批队列',
      '变更审批队列',
      '全局变更',
      '变更审批',
      '审批队列',
      '变更',
      '审批',
      'cr',
      'pmo-change-queue',
    ],
  },
]

/**
 * 项目级坐标点击导航路径解析（design「path: /next/projects/:id/reports 在具体项目中
 * 解析为当前项目路径，在全局视图中引导选择项目」）：
 * - 路径不含 `:id` 占位（全局坐标）→ 原样返回；
 * - 含占位且当前存在项目空间实体（ProjectSpaceContainer 注册）→ 替换为项目 ID；
 * - 含占位但处于全局视图（无活跃项目）→ 回退角色首页 `/next` 引导用户进入目标项目，
 *   绝不向不存在项目拼装假链接。
 */
export function resolveSpaceCoordinatePath(path: string, projectId: number | null): string {
  if (!path.includes(':id')) return path
  if (projectId === null) return '/next'
  return path.replace(/:id/g, String(projectId))
}

/**
 * 多字段模糊检索（design D3 / spec「搜索关键词即时过滤坐标清单」）：
 * - 去掉首尾空白；空查询返回完整白名单（搜索框初始态展示全部坐标）；
 * - 按空白切分为多个词项，对 `title` / `description` / `keywords` 做不区分大小写的
 *   子串匹配，多词之间为 AND 语义（每个词项都必须命中某字段）；
 * - `path` 走确定性「段匹配」而非子串匹配：词项须等于完整路径（去前导 `/`）或末段
 *   （如 `next` 命中 `/next`、`create` 命中 `/next/create`）。共享前缀 `/next` 若做
 *   子串匹配会误伤全部坐标，与 spec「输入 next 仅保留首页」场景冲突；
 * - 无匹配返回空数组，调用方渲染空状态，绝不抛错。
 */
export function filterSpaceCoordinates(query: string): SpaceCoordinate[] {
  const trimmed = query.trim()
  if (trimmed === '') return [...PRESET_SPACE_COORDINATES]

  const terms = trimmed.toLowerCase().split(/\s+/)
  return PRESET_SPACE_COORDINATES.filter((coordinate) =>
    terms.every((term) => matchesCoordinate(coordinate, term)),
  )
}

function matchesCoordinate(coordinate: SpaceCoordinate, term: string): boolean {
  if (
    coordinate.title.toLowerCase().includes(term) ||
    coordinate.description.toLowerCase().includes(term) ||
    coordinate.keywords.some((keyword) => keyword.toLowerCase().includes(term))
  ) {
    return true
  }
  const normalizedTerm = term.replace(/^\/+/, '')
  const normalizedPath = coordinate.path.replace(/^\/+/, '').toLowerCase()
  return normalizedPath === normalizedTerm || normalizedPath.endsWith(`/${normalizedTerm}`)
}
