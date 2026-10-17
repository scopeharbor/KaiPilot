/**
 * RBS 资源分解结构四级聚合纯函数（v3-ui-next-chart-gallery tasks 4.4）。
 *
 * 消费 `GET /projects/:projectId/resources` 的扁平资源清单，在前端纯函数自动构建
 * 四级树状分解并向上递归卷算容量：
 *
 * - L1 根节点：项目资源总库（Project Resources）
 * - L2 资源大类（resourceType）：人力资源 human / 物料资源 material / 设备资源
 *   equipment / 预算资源 budget
 * - L3 角色工种（role）：项目经理、团队负责人、成员、观察者等
 * - L4 资源实例：姓名/编号、状态、日容量工时、技能标签（skillTags）
 *
 * 契约：
 * - 零 DOM / 零网络 / 零副作用，输入仅依赖清单本身（顺序稳定，重复调用结果一致）；
 * - `skillTags` 为后端 JSON 数组字符串（如 `["React","TypeScript"]`），
 *   parseSkillTags 做防御解析（JSON 数组 / 逗号分隔 / 纯文本单标签兜底）；
 * - 容量卷算：capacityHoursPerDay = Σ dailyCapacityHours（工时/日），
 *   capacityPersonDays = 容量工时 ÷ 8（1 人天 = 8 标准工时，与既有容量口径一致）。
 */

/** 纯函数最小输入契约：结构满足 `Resource` 的子集，调用方传完整实体即可。 */
export interface RbsResourceInput {
  id: number
  name: string
  email?: string | null
  resourceType: string
  role: string
  status: string
  dailyCapacityHours: number
  skillTags?: string | null
}

/** 标准工作日口径：1 人天 = 8 工时。 */
export const RBS_STANDARD_HOURS_PER_DAY = 8

/** 资源大类固定展示顺序与中文标签。 */
export const RBS_CATEGORY_ORDER = ['human', 'material', 'equipment', 'budget'] as const
export const RBS_CATEGORY_LABELS: Record<string, string> = {
  human: '人力资源',
  material: '物料资源',
  equipment: '设备资源',
  budget: '预算资源',
}

/** 角色工种中文标签（未知角色兜底原值）。 */
export const RBS_ROLE_LABELS: Record<string, string> = {
  owner: '负责人',
  project_manager: '项目经理',
  team_lead: '团队负责人',
  member: '成员',
  viewer: '观察者',
}

export function rbsRoleLabel(role: string): string {
  return RBS_ROLE_LABELS[role] ?? role
}

export function rbsCategoryLabel(resourceType: string): string {
  return RBS_CATEGORY_LABELS[resourceType] ?? resourceType
}

export const RBS_STATUS_LABELS: Record<string, string> = {
  active: '启用',
  inactive: '停用',
}

/** 防御解析技能标签（JSON 数组字符串 / 逗号分隔 / 纯文本单标签），恒返回去空字符串数组。 */
export function parseSkillTags(skillTags: string | null | undefined): string[] {
  if (!skillTags) return []
  const trimmed = skillTags.trim()
  if (trimmed === '') return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter((item) => item.length > 0)
      }
    } catch {
      /* 落入下方兜底分支 */
    }
    return []
  }
  // 逗号 / 顿号分隔或纯文本单标签
  return trimmed
    .split(/[,，;；]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** 工时 → 人天（1 人天 = 8 工时），保留两位小数。 */
export function capacityToPersonDays(hours: number): number {
  return Math.round((hours / RBS_STANDARD_HOURS_PER_DAY) * 100) / 100
}

// ---------------------------------------------------------------------------
// 四级树结构类型
// ---------------------------------------------------------------------------

export type RbsNode = RbsRootNode | RbsCategoryNode | RbsRoleNode | RbsInstanceNode

export interface RbsInstanceNode {
  kind: 'instance'
  level: 4
  key: string
  resourceId: number
  name: string
  email: string | null
  status: string
  resourceType: string
  role: string
  capacityHoursPerDay: number
  capacityPersonDays: number
  skillTags: string[]
}

export interface RbsRoleNode {
  kind: 'role'
  level: 3
  key: string
  resourceType: string
  role: string
  label: string
  resourceCount: number
  capacityHoursPerDay: number
  capacityPersonDays: number
  children: RbsInstanceNode[]
}

export interface RbsCategoryNode {
  kind: 'category'
  level: 2
  key: string
  resourceType: string
  label: string
  resourceCount: number
  capacityHoursPerDay: number
  capacityPersonDays: number
  children: RbsRoleNode[]
}

export interface RbsRootNode {
  kind: 'root'
  level: 1
  key: string
  label: string
  resourceCount: number
  capacityHoursPerDay: number
  capacityPersonDays: number
  children: RbsCategoryNode[]
}

export interface RbsAggregateTotals {
  resourceCount: number
  capacityHoursPerDay: number
  capacityPersonDays: number
}

export const EMPTY_RBS_TOTALS: RbsAggregateTotals = {
  resourceCount: 0,
  capacityHoursPerDay: 0,
  capacityPersonDays: 0,
}

function sumTotals(list: RbsAggregateTotals[]): RbsAggregateTotals {
  return list.reduce<RbsAggregateTotals>(
    (acc, item) => ({
      resourceCount: acc.resourceCount + item.resourceCount,
      capacityHoursPerDay: acc.capacityHoursPerDay + item.capacityHoursPerDay,
      capacityPersonDays: acc.capacityPersonDays + item.capacityPersonDays,
    }),
    { ...EMPTY_RBS_TOTALS },
  )
}

/** 构建资源实例节点（L4），并附技能标签解析结果。 */
export function toRbsInstance(resource: RbsResourceInput): RbsInstanceNode {
  const skillTags = parseSkillTags(resource.skillTags)
  return {
    kind: 'instance',
    level: 4,
    key: `l4:${resource.id}`,
    resourceId: resource.id,
    name: resource.name,
    email: resource.email ?? null,
    status: resource.status,
    resourceType: resource.resourceType,
    role: resource.role,
    capacityHoursPerDay: resource.dailyCapacityHours || 0,
    capacityPersonDays: capacityToPersonDays(resource.dailyCapacityHours || 0),
    skillTags,
  }
}

/** 由扁平资源清单构建四级 RBS 树（确定性：大类按固定顺序、组内保持入参顺序）。 */
export function buildRbsTree(resources: readonly RbsResourceInput[]): RbsRootNode {
  const categories = new Map<string, RbsCategoryNode>()
  for (const item of resources) {
    const type = item.resourceType || 'other'
    let category = categories.get(type)
    if (!category) {
      category = {
        kind: 'category',
        level: 2,
        key: `l2:${type}`,
        resourceType: type,
        label: rbsCategoryLabel(type),
        ...EMPTY_RBS_TOTALS,
        children: [],
      }
      categories.set(type, category)
    }
    const roles = category.children
    let roleNode = roles.find((node) => node.role === item.role)
    if (!roleNode) {
      roleNode = {
        kind: 'role',
        level: 3,
        key: `l3:${type}:${item.role}`,
        resourceType: type,
        role: item.role,
        label: rbsRoleLabel(item.role),
        ...EMPTY_RBS_TOTALS,
        children: [],
      }
      roles.push(roleNode)
    }
    const instance = toRbsInstance(item)
    roleNode.children.push(instance)
    roleNode.resourceCount += 1
    roleNode.capacityHoursPerDay += instance.capacityHoursPerDay
    roleNode.capacityPersonDays += instance.capacityPersonDays
  }

  // 大类按固定顺序输出（RBS_CATEGORY_ORDER），不存在的类型跳过
  const orderedTypes = [
    ...RBS_CATEGORY_ORDER.filter((type) => categories.has(type)),
    ...[...categories.keys()].filter(
      (type) => !(RBS_CATEGORY_ORDER as readonly string[]).includes(type),
    ),
  ]

  const categoryNodes = orderedTypes.map((type) => categories.get(type)!)

  for (const category of categoryNodes) {
    const totals = sumTotals(category.children)
    category.resourceCount = totals.resourceCount
    category.capacityHoursPerDay = totals.capacityHoursPerDay
    category.capacityPersonDays = totals.capacityPersonDays
  }

  const rootTotals = sumTotals(categoryNodes)
  return {
    kind: 'root',
    level: 1,
    key: 'root',
    label: '项目资源总库',
    resourceCount: rootTotals.resourceCount,
    capacityHoursPerDay: rootTotals.capacityHoursPerDay,
    capacityPersonDays: rootTotals.capacityPersonDays,
    children: categoryNodes,
  }
}

/** 以固定顺序收集树内全部节点 key（root → L2 → L3 → L4，展开顺序与 UI 层级一致）。 */
export function collectAllNodeKeys(root: RbsRootNode): string[] {
  const keys: string[] = [root.key]
  for (const category of root.children) {
    keys.push(category.key)
    for (const role of category.children) {
      keys.push(role.key)
      for (const instance of role.children) keys.push(instance.key)
    }
  }
  return keys
}

/** 技能关键词匹配单个实例（大小写不敏感的子串包含匹配，命中任一项技能即可）。 */
export function matchesSkillKeyword(resource: RbsResourceInput, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (kw === '') return false
  return parseSkillTags(resource.skillTags).some((tag) => tag.toLowerCase().includes(kw))
}

/** 依据技能关键词收集命中的资源实例 id 集合（供树组件高亮/弱化判定）。 */
export function collectSkillMatchIds(root: RbsRootNode, keyword: string): Set<number> {
  const kw = keyword.trim().toLowerCase()
  const matched = new Set<number>()
  if (kw === '') return matched
  for (const category of root.children) {
    for (const role of category.children) {
      for (const instance of role.children) {
        if (instance.skillTags.some((tag) => tag.toLowerCase().includes(kw))) {
          matched.add(instance.resourceId)
        }
      }
    }
  }
  return matched
}

export function formatRbsHours(hours: number): string {
  return `${hours} 工时/日`
}

export function formatRbsPersonDays(personDays: number): string {
  return `约 ${personDays} 人天`
}
