import type {
  AuthOrganization,
  AuthState,
  AuthUser,
  EffectiveTenantContextView,
} from '@/stores/auth-store'

/**
 * RBAC 六角色 → 四桶视角映射（v3-ui-next-shell-space-map D6 / spec「RBAC 角色化首页落点框架」）。
 *
 * 判定优先级（design Decision 6）：
 *   1. `admin`（组织治理桶）：`user.isSuperAdmin` / `effectiveTenantContext.isSuperAdmin` 为真，
 *      或当前组织角色 ∈ owner / admin / system_admin / org_admin；
 *   2. `pm`（项目交付桶）：当前组织角色 ∈ project_manager / 'Project Manager' / 'Project Owner' / pm；
 *   3. `member`（协作聚焦桶）：当前组织角色 ∈ member / 'Member' / external_collaborator /
 *      'External Collaborator' / collaborator；
 *   4. `observer`（洞察只读桶）：当前组织角色 ∈ readonly_observer / 'Read-only Observer' / viewer / observer；
 *   5. `unknown`（兜底通用桶）：未登录、未识别或未知角色——页面 0 报错。
 *
 * 数据源真实形状（auth-store）：`user.isSuperAdmin`、`user.organizations[].role`、
 * `effectiveTenantContext.membershipRole`（服务端事实，优先于本地展示组织角色）。
 * 本模块为纯函数 + zustand selector（RL-04：双入口共用 auth-store 角色体系，不另起炉灶）。
 */
export type RoleBucket = 'admin' | 'pm' | 'member' | 'observer' | 'unknown'

export interface SuggestionSlot {
  id: string
  title: string
  desc: string
  metricLabel: string
}

export interface RoleHomeConfig {
  bucket: RoleBucket
  title: string
  subtitle: string
  suggestionSlots: SuggestionSlot[]
}

/** 角色判定输入（auth-store 状态快照的最小形状，纯函数可测）。 */
export interface RoleBucketSource {
  isAuthenticated: boolean
  user: AuthUser | null
  effectiveTenantContext: Pick<EffectiveTenantContextView, 'membershipRole' | 'isSuperAdmin'> | null
  currentOrganizationId: number | null
}

const ADMIN_ROLE_KEYS = new Set(['owner', 'admin', 'system_admin', 'org_admin'])
const PM_ROLE_KEYS = new Set(['project_manager', 'project manager', 'project owner', 'pm'])
const MEMBER_ROLE_KEYS = new Set([
  'member',
  'external_collaborator',
  'external collaborator',
  'collaborator',
])
const OBSERVER_ROLE_KEYS = new Set([
  'readonly_observer',
  'read-only observer',
  'viewer',
  'observer',
])

/** 归一化角色串（去首尾空白 + 小写）后查桶；未命中返回 null。 */
function classifyRole(role: string | null | undefined): RoleBucket | null {
  if (role == null) return null
  const key = role.trim().toLowerCase()
  if (ADMIN_ROLE_KEYS.has(key)) return 'admin'
  if (PM_ROLE_KEYS.has(key)) return 'pm'
  if (MEMBER_ROLE_KEYS.has(key)) return 'member'
  if (OBSERVER_ROLE_KEYS.has(key)) return 'observer'
  return null
}

/**
 * 当前组织的低敏展示对象：按 `currentOrganizationId` 匹配 `user.organizations`，
 * 失配或未指定时兜底首个组织（展示层宽松处理，安全边界在服务端）。
 */
export function selectCurrentOrganization(
  user: AuthUser | null,
  currentOrganizationId: number | null,
): AuthOrganization | null {
  if (!user || user.organizations.length === 0) return null
  const matched = user.organizations.find((org) => org.id === currentOrganizationId)
  return matched ?? user.organizations[0] ?? null
}

/** 四桶判定主函数：超管标记 → 服务端 membershipRole → 当前组织角色 → unknown。 */
export function resolveRoleBucket(source: RoleBucketSource): RoleBucket {
  if (!source.isAuthenticated || !source.user) return 'unknown'
  if (source.user.isSuperAdmin === true) return 'admin'
  if (source.effectiveTenantContext?.isSuperAdmin === true) return 'admin'

  const viaMembership = classifyRole(source.effectiveTenantContext?.membershipRole)
  if (viaMembership !== null) return viaMembership

  const viaOrganization = classifyRole(
    selectCurrentOrganization(source.user, source.currentOrganizationId)?.role,
  )
  if (viaOrganization !== null) return viaOrganization
  return 'unknown'
}

/** 从 auth-store 状态快照派生视角桶（zustand selector，返回稳定原语）。 */
export function selectRoleBucket(state: AuthState): RoleBucket {
  return resolveRoleBucket({
    isAuthenticated: state.isAuthenticated,
    user: state.user,
    effectiveTenantContext: state.effectiveTenantContext,
    currentOrganizationId: state.currentOrganizationId,
  })
}

export const ROLE_BUCKET_LABELS: Record<RoleBucket, string> = {
  admin: '管理员',
  pm: '项目经理',
  member: '成员',
  observer: '观察员',
  unknown: '访客',
}

/** 四桶（含未知兜底）的角色首页配置：欢迎语 + 建议卡信息架构（id/标题/描述）。
 *  卡片的量化指标由 `role-suggestion-metrics` 从真实只读端点派生（组织 Dashboard /
 *  审计统计 / 我的任务聚合）；本文件不再承载「待接入」占位文案。 */
export const ROLE_HOME_CONFIGS: Record<RoleBucket, RoleHomeConfig> = {
  admin: {
    bucket: 'admin',
    title: '组织治理与系统效能',
    subtitle: '俯瞰组织租户资源、权限矩阵与审计概览，守住组织治理基线。',
    suggestionSlots: [
      {
        id: 'tenant-resources',
        title: '租户资源',
        desc: '组织工作区、席位与套餐资源态势',
        metricLabel: '—',
      },
      {
        id: 'permission-matrix',
        title: '权限矩阵',
        desc: '六角色权限覆盖与成员-角色分布',
        metricLabel: '—',
      },
      {
        id: 'audit-overview',
        title: '审计概览',
        desc: '关键操作与审计事件的态势窗口',
        metricLabel: '—',
      },
    ],
  },
  pm: {
    bucket: 'pm',
    title: '项目组合与交付态势',
    subtitle: '以交付为轴心，巡检项目健康度、关键路径风险与排程偏离。',
    suggestionSlots: [
      {
        id: 'health-inspection',
        title: '健康度巡检',
        desc: '项目健康度基线扫描与趋势',
        metricLabel: '—',
      },
      {
        id: 'critical-path-risk',
        title: '关键路径风险',
        desc: '关键链上的风险与预警信号',
        metricLabel: '—',
      },
      {
        id: 'schedule-drift',
        title: '排程偏离',
        desc: '计划 vs 实际的漂移监测',
        metricLabel: '—',
      },
    ],
  },
  member: {
    bucket: 'member',
    title: '今日任务与协作焦点',
    subtitle: '聚焦手头任务、协作焦点与前置阻塞，执行清单一目了然。',
    suggestionSlots: [
      {
        id: 'today-focus',
        title: '今日聚焦',
        desc: '今日待办与截止逼近的任务',
        metricLabel: '—',
      },
      {
        id: 'collaboration-focus',
        title: '协作焦点',
        desc: '与我相关的协作与评论动态',
        metricLabel: '—',
      },
      {
        id: 'blocking-ahead',
        title: '前置阻塞',
        desc: '等待他人或被阻塞的环节',
        metricLabel: '—',
      },
    ],
  },
  observer: {
    bucket: 'observer',
    title: '只读洞察与报表概览',
    subtitle: '以旁观视角审视里程碑进度与健康态势，只读不写。',
    suggestionSlots: [
      {
        id: 'report-overview',
        title: '报表概览',
        desc: '预设报表与导出入口',
        metricLabel: '—',
      },
      {
        id: 'milestone-progress',
        title: '里程碑进度',
        desc: '里程碑达成与剩余工作量',
        metricLabel: '—',
      },
      {
        id: 'health-trend',
        title: '健康态势',
        desc: '项目健康度与风险态势快照',
        metricLabel: '—',
      },
    ],
  },
  unknown: {
    bucket: 'unknown',
    title: '开项项目空间',
    subtitle: '一句话启动项目，AI 生成完整计划——专业 PM 可控，新手也能用。',
    suggestionSlots: [
      {
        id: 'space-guide',
        title: '空间导览',
        desc: '认识新 UI 的空间坐标与工作落点',
        metricLabel: '—',
      },
      {
        id: 'coordinate-index',
        title: '坐标索引',
        desc: '呼出空间地图，检索全部可用坐标',
        metricLabel: '—',
      },
      {
        id: 'immersion-guide',
        title: '沉浸档位',
        desc: '在沉浸 / 轻量 / 精确三档间调节呈现浓度',
        metricLabel: '—',
      },
    ],
  },
}

/** 取指定视角的首页配置；未知桶安全兜底，永不抛错。 */
export function getRoleHomeConfig(bucket: RoleBucket): RoleHomeConfig {
  return ROLE_HOME_CONFIGS[bucket] ?? ROLE_HOME_CONFIGS.unknown
}
