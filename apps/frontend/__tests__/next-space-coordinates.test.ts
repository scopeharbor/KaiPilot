/**
 * v3-ui-next-shell-space-map tasks 2.1/2.2 —— 空间坐标数据模型与检索算法。
 */
import { describe, expect, test } from 'vitest'
import {
  PRESET_SPACE_COORDINATES,
  filterSpaceCoordinates,
  resolveSpaceCoordinatePath,
} from '@/lib/next/space-coordinates'

describe('lib/next/space-coordinates（空间坐标静态白名单）', () => {
  test('白名单含 47 个预置坐标（11 既有 + 17 组织/全局 + 8 PMO 组合层 + 3 设置/管理后台/项目设置 + 1 战略执行驾驶舱 + 4 批 3 全域汇聚 + 3 批 4 组织报表分馆/PMO 组合报表/PMO 变更审批队列 + 1 我的日历），字段符合 design D3 契约', () => {
    expect(PRESET_SPACE_COORDINATES).toHaveLength(49)
    expect(PRESET_SPACE_COORDINATES.map((c) => c.id)).toEqual([
      'home',
      'create',
      'charts',
      'reports',
      'risks',
      'change-requests',
      'resources',
      'members',
      'files',
      // 收口补齐：TRIZ 决策中心项目级坐标（跨轨复用旧轨生产页）
      'triz-decision-center',
      // v3-ui-next-help-knowledge-domain 3.1：帮助中心/知识底座全局坐标追加
      'help',
      'knowledge',
      // v3-ui-next-org-portfolio-domains 10.1：17 条组织/全局坐标追加（无 :id 占位）
      'org_overview',
      'org_bi_dashboards',
      'org_bi_risk_heatmap',
      'org_bi_trends',
      'org_okrs',
      'org_okr_dashboard',
      'org_resource_pool',
      'org_resource_gaps',
      'org_resource_contentions',
      'org_resource_demand',
      'org_capacity_loops',
      'org_cross_project_allocation',
      'org_plugin_directory',
      'org_plugin_policies',
      'global_resources',
      'global_skill_matrix',
      'global_risks',
      // v3-ui-next-pmo-domain 9.1：8 条 PMO 组合层坐标追加（无 :id 占位）
      'pmo',
      'pmo-traffic-light',
      'pmo-grouping-views',
      'pmo-priority-scoring',
      'pmo-ai-priority-recommendations',
      'pmo-decisions',
      'pmo-dependencies',
      'pmo-impact-analysis',
      // v3-ui-next-settings-admin-domains 9.1：设置空间/管理后台/项目设置坐标追加
      'settings',
      'admin',
      'project-settings',
      // v3-ui-next-batch1-strategy-launch-tasks W5 · tasks 5.1：战略执行驾驶舱坐标追加
      'strategy-execution-cockpit',
      // v3-ui-next-batch3-global-convergence W5 · tasks 5.3：批 3 全域汇聚坐标追加
      'global-search',
      'notifications',
      'global-timeline',
      'cross-project-tasks',
      // 日历第 3 批：我的日历
      'my-calendar',
      // v3-ui-next-batch4-reports-change-queue W5 · tasks 5.3：批 4 组织报表分馆、
      // PMO 组合报表与全局变更审批队列坐标追加
      'org-reports-wing',
      'pmo-reports',
      'pmo-change-queue',
    ])

    const [home, create, charts, reports] = [
      PRESET_SPACE_COORDINATES[0]!,
      PRESET_SPACE_COORDINATES[1]!,
      PRESET_SPACE_COORDINATES[2]!,
      PRESET_SPACE_COORDINATES[3]!,
    ]
    expect(home.status).toBe('available')
    expect(home.path).toBe('/next')
    expect(home.badge).toBe('已就绪')
    expect(home.iconName).toBe('Home')

    // v3-ui-next-theater-intent-clarify 3.4：生成剧场提升为 available / 已就绪
    expect(create.status).toBe('available')
    expect(create.path).toBe('/next/create')
    expect(create.badge).toBe('已就绪')
    expect(create.iconName).toBe('Sparkles')

    // v3-ui-next-chart-gallery 1.4：图表馆由 coming-soon 点亮为 available / 已就绪
    expect(charts.status).toBe('available')
    expect(charts.path).toBe('/next/charts')
    expect(charts.badge).toBe('已就绪')
    expect(charts.iconName).toBe('BarChart3')
    // 描述随 D12/D15 承诺更新为 20 项全景语义
    expect(charts.description).toContain('20项')
    expect(charts.keywords.length).toBeGreaterThanOrEqual(11)

    // v3-ui-next-reports-domain 3.4：报表中心项目级坐标点亮为 available / 已就绪
    expect(reports.status).toBe('available')
    expect(reports.badge).toBe('已就绪')
    expect(reports.iconName).toBe('FileText')
    expect(reports.path).toBe('/next/projects/:id/reports')
    expect(reports.title).toBe('报表中心')
    expect(reports.description).toContain('周报')
    expect(reports.keywords.length).toBeGreaterThanOrEqual(6)

    // v3-ui-next-risk-change-domains 3.5：风险域 / 变更域项目级坐标点亮为 available / 已就绪
    const risks = PRESET_SPACE_COORDINATES[4]!
    const changeRequests = PRESET_SPACE_COORDINATES[5]!
    expect(risks.status).toBe('available')
    expect(risks.badge).toBe('已就绪')
    expect(risks.iconName).toBe('Shield')
    expect(risks.path).toBe('/next/projects/:id/risks')
    expect(risks.title).toBe('风险管理')
    expect(risks.description).toContain('风险辨识')
    expect(risks.keywords).toEqual(
      expect.arrayContaining(['风险', '隐患', '工作台', '矩阵', '5x5', '复查', 'risks']),
    )
    expect(changeRequests.status).toBe('available')
    expect(changeRequests.badge).toBe('已就绪')
    expect(changeRequests.iconName).toBe('GitPullRequest')
    expect(changeRequests.path).toBe('/next/projects/:id/change-requests')
    expect(changeRequests.title).toBe('变更请求')
    expect(changeRequests.description).toContain('影响分析')
    expect(changeRequests.keywords).toEqual(
      expect.arrayContaining(['变更', 'cr', '审批', '影响分析', '申请', 'change']),
    )

    // v3-ui-next-resource-team-domains 4.5：资源/成员/文件三域坐标点亮为 available / 已就绪
    const resources = PRESET_SPACE_COORDINATES[6]!
    const members = PRESET_SPACE_COORDINATES[7]!
    const files = PRESET_SPACE_COORDINATES[8]!
    expect(resources.status).toBe('available')
    expect(resources.badge).toBe('已就绪')
    expect(resources.iconName).toBe('Users')
    expect(resources.path).toBe('/next/projects/:id/resources')
    expect(resources.title).toBe('资源工作台')
    expect(resources.keywords).toEqual(
      expect.arrayContaining(['资源', '负载', '工时', '分配', 'resources']),
    )
    expect(members.status).toBe('available')
    expect(members.badge).toBe('已就绪')
    expect(members.iconName).toBe('Users')
    expect(members.path).toBe('/next/projects/:id/members')
    expect(members.title).toBe('成员与团队')
    expect(members.keywords).toEqual(expect.arrayContaining(['成员', '团队', '邀请', 'members']))
    expect(files.status).toBe('available')
    expect(files.badge).toBe('已就绪')
    expect(files.iconName).toBe('FolderArchive')
    expect(files.path).toBe('/next/projects/:id/files')
    expect(files.title).toBe('项目文件库')
    expect(files.keywords).toEqual(
      expect.arrayContaining(['文件', '附件', '上传', '下载', 'files']),
    )
  })

  test('字段完整性：id/title/path/description/keywords 非空，keywords 覆盖中英文词', () => {
    for (const coordinate of PRESET_SPACE_COORDINATES) {
      expect(coordinate.id).toBeTruthy()
      expect(coordinate.title).toBeTruthy()
      expect(coordinate.path).toBeTruthy()
      expect(coordinate.description).toBeTruthy()
      expect(coordinate.keywords.length).toBeGreaterThan(0)
    }
    // keywords 同时容纳中文别名与英文路径词，保证拼音/英文检索可达。
    expect(
      ['home', 'create', 'charts', 'reports'].every((id) =>
        PRESET_SPACE_COORDINATES.find((c) => c.id === id)?.keywords.includes(id),
      ),
    ).toBe(true)
  })
})

describe('resolveSpaceCoordinatePath（项目级坐标 :id 解析，v3-ui-next-reports-domain）', () => {
  test('无占位符路径原样返回（全局坐标不受影响）', () => {
    expect(resolveSpaceCoordinatePath('/next', 42)).toBe('/next')
    expect(resolveSpaceCoordinatePath('/next/create', null)).toBe('/next/create')
  })

  test('含 :id 占位且处于项目空间 → 替换为当前项目 ID', () => {
    expect(resolveSpaceCoordinatePath('/next/projects/:id/reports', 42)).toBe(
      '/next/projects/42/reports',
    )
  })

  test('含 :id 占位但全局无项目 → 回退角色首页引导选择项目（绝不拼装假链接）', () => {
    expect(resolveSpaceCoordinatePath('/next/projects/:id/reports', null)).toBe('/next')
  })
})

describe('filterSpaceCoordinates（多字段模糊检索）', () => {
  test('空查询与纯空白查询返回完整白名单，且不突变原数组', () => {
    expect(filterSpaceCoordinates('')).toHaveLength(49)
    expect(filterSpaceCoordinates('   ')).toHaveLength(49)
    // 原白名单保持 47 项（readonly 语义不被破坏）。
    expect(PRESET_SPACE_COORDINATES).toHaveLength(49)
  })

  test('不区分大小写命中标题/路径/关键词/描述', () => {
    expect(filterSpaceCoordinates('首页').map((c) => c.id)).toEqual(['home'])
    // `next` 只命中首页（共享前缀 '/next' 不做子串误伤，见 filter 实现注释）
    expect(filterSpaceCoordinates('NEXT').map((c) => c.id)).toEqual(['home'])
    expect(filterSpaceCoordinates('角色').map((c) => c.id)).toEqual(['home'])
    // 描述字段命中（「专属工作落点」）
    expect(filterSpaceCoordinates('专属').map((c) => c.id)).toEqual(['home'])

    // 「生成 / AI」：生成剧场标题关键词 + 报表中心描述「报表生成 / AI 周期周报」
    // + AI 优先级推荐坐标（AI 令牌）多命中
    expect(filterSpaceCoordinates('生成').map((c) => c.id)).toEqual(['create', 'reports'])
    expect(filterSpaceCoordinates('AI').map((c) => c.id)).toEqual([
      'create',
      'reports',
      'pmo-ai-priority-recommendations',
    ])

    expect(filterSpaceCoordinates('图表').map((c) => c.id)).toEqual(['charts'])
    expect(filterSpaceCoordinates('甘特').map((c) => c.id)).toEqual(['charts'])
    expect(filterSpaceCoordinates('CHARTs').map((c) => c.id)).toEqual(['charts'])

    // v3-ui-next-reports-domain 3.4：报表中心注册后关键词精确归属
    expect(filterSpaceCoordinates('周报').map((c) => c.id)).toEqual(['reports'])
    expect(filterSpaceCoordinates('月报').map((c) => c.id)).toEqual(['reports'])
    expect(filterSpaceCoordinates('进度报告').map((c) => c.id)).toEqual(['reports'])
    expect(filterSpaceCoordinates('总结').map((c) => c.id)).toEqual(['reports'])
    // 「报表」为图表馆历史关键词与报表中心标题/关键词的共享词，
    // 批4 org-reports-wing/pmo-reports 关键词亦含「报表」→ 四项均命中
    expect(filterSpaceCoordinates('报表').map((c) => c.id)).toEqual([
      'charts',
      'reports',
      'org-reports-wing',
      'pmo-reports',
    ])

    // v3-ui-next-resource-team-domains 4.5：协同三域坐标检索归属（既有归属零漂移）
    // v3-ui-next-org-portfolio-domains 10.2：组织/全局资源系坐标注册后，裸「资源」
    // 为项目资源工作台与组织/全局资源系坐标的共享词（子串命中，与「人员/负荷」
    // 共享词同例）；复合词「组织资源池」等仍精准归属（见 10.2 互斥断言）。
    // 批4 pmo-reports 描述含「资源负荷」，一并共存
    expect(filterSpaceCoordinates('资源').map((c) => c.id)).toEqual([
      'resources',
      'org_resource_pool',
      'org_resource_gaps',
      'org_resource_contentions',
      'org_resource_demand',
      'global_resources',
      'pmo-reports',
    ])
    expect(filterSpaceCoordinates('负载').map((c) => c.id)).toEqual(['resources'])
    // 批4 org-reports-wing 描述含「工时」，与既有资源坐标共享词共存
    expect(filterSpaceCoordinates('工时').map((c) => c.id)).toEqual([
      'resources',
      'org-reports-wing',
    ])
    expect(filterSpaceCoordinates('成员').map((c) => c.id)).toEqual(['members'])
    expect(filterSpaceCoordinates('团队').map((c) => c.id)).toEqual(['members'])
    expect(filterSpaceCoordinates('邀请').map((c) => c.id)).toEqual(['members'])
    expect(filterSpaceCoordinates('文件').map((c) => c.id)).toEqual(['files'])
    expect(filterSpaceCoordinates('附件').map((c) => c.id)).toEqual(['files'])
    expect(filterSpaceCoordinates('上传').map((c) => c.id)).toEqual(['files'])
    expect(filterSpaceCoordinates('下载').map((c) => c.id)).toEqual(['files'])
    // v3-ui-next-org-portfolio-domains 10.2：全局资源坐标路径 /next/resources 与项目
    // 资源工作台共享末段 resources → 双命中（路径段匹配语义不变）
    expect(filterSpaceCoordinates('resources').map((c) => c.id)).toEqual([
      'resources',
      'global_resources',
    ])
    expect(filterSpaceCoordinates('files').map((c) => c.id)).toEqual(['files'])
    // 「人员」为资源与成员两域共享检索词 → 双命中（互不吞没）
    expect(filterSpaceCoordinates('人员').map((c) => c.id)).toEqual(['resources', 'members'])
    // 「负荷」为图表馆与资源工作台共享词，批4 pmo-reports 描述含「资源负荷」→ 三卡共存
    expect(filterSpaceCoordinates('负荷').map((c) => c.id)).toEqual([
      'charts',
      'resources',
      'pmo-reports',
    ])
  })

  test('路径段匹配：整段路径与末段可命中，共享前缀不误伤', () => {
    // 末段命中：create / charts 是其路径的末段
    expect(filterSpaceCoordinates('create').map((c) => c.id)).toEqual(['create'])
    expect(filterSpaceCoordinates('charts').map((c) => c.id)).toEqual(['charts'])
    // 完整路径（去前导斜杠）命中
    expect(filterSpaceCoordinates('next/create').map((c) => c.id)).toEqual(['create'])
    expect(filterSpaceCoordinates('/next').map((c) => c.id)).toEqual(['home'])
  })

  test('多词查询为 AND 语义：每个词项都必须命中某个字段', () => {
    expect(filterSpaceCoordinates('next 首页').map((c) => c.id)).toEqual(['home'])
    expect(filterSpaceCoordinates('next home').map((c) => c.id)).toEqual(['home'])
    // 「图书」无字段命中 → 空结果（AND 语义下不因「馆」单字段命中而误放行）。
    expect(filterSpaceCoordinates('图书 馆')).toEqual([])
  })

  test('未知关键词返回空数组（搜索框空状态的数据源，绝不抛错）', () => {
    expect(filterSpaceCoordinates('未知坐标XYZ')).toEqual([])
    expect(filterSpaceCoordinates('qwerty 不存在')).toEqual([])
  })
})
