/**
 * 帮助中心内容 schema（v3-help-and-operational-issues-center）。
 *
 * 单一事实来源：`apps/frontend/content/help/<locale>/` 下 Markdown/MDX 文章 +
 * `navigation.yaml` 导航清单。网页渲染、复制 Markdown 与 Agent endpoint 均从
 * 同一正文派生（spec `product-support-and-operational-issues-center`）。
 */

export const HELP_CONTENT_TYPES = [
  'getting-started',
  'concept',
  'how-to',
  'tutorial',
  'reference',
  'troubleshooting',
  'faq',
  'release-notes',
  'support',
] as const
export type HelpContentType = (typeof HELP_CONTENT_TYPES)[number]

/** 六规范角色（backend start/rbac/roles.ts CanonicalRole）+ 组织成员角色（owner/admin/viewer）。 */
export const HELP_ROLES = [
  'system_admin',
  'org_admin',
  'project_manager',
  'member',
  'external_collaborator',
  'readonly_observer',
  'owner',
  'admin',
  'viewer',
] as const
export type HelpRole = (typeof HELP_ROLES)[number]

export const HELP_EDITIONS = ['free', 'team', 'enterprise'] as const
export type HelpEdition = (typeof HELP_EDITIONS)[number]

/**
 * 正文完成度。`skeleton`（骨架：结构齐全、细节待补）在首发前必须全部转为
 * `complete`，lint 对 complete 文章强制校验设计 D 的固定结构。
 */
export const HELP_CONTENT_STATUSES = ['skeleton', 'complete'] as const
export type HelpContentStatus = (typeof HELP_CONTENT_STATUSES)[number]

export interface HelpArticleFrontmatter {
  id: string
  title: string
  summary: string
  contentType: HelpContentType
  roles: HelpRole[]
  permissions: string[]
  editions: HelpEdition[]
  productVersion: string
  featureFlags: string[]
  owner: string
  updatedAt: string
  reviewAfter: string
  related: string[]
  screenshots: string[]
  keywords?: string[]
  contentStatus: HelpContentStatus
}

export interface HelpHeading {
  level: number
  text: string
  id: string
}

export interface HelpArticle {
  /** 文章 id（`<area>.<slug>`，全局唯一）。 */
  id: string
  /** 所属 area id。 */
  area: string
  /** 文件名 slug。 */
  slug: string
  frontmatter: HelpArticleFrontmatter
  /** 规范正文（文件 body，仅在 md 分隔线以内）。 */
  body: string
  headings: HelpHeading[]
  /** 磁盘路径（内部使用，Agent export 不得暴露）。 */
  path: string
}

export interface HelpArea {
  id: string
  label: string
  description?: string
  /** 树中显示顺序。 */
  order: number
  /** 该 area 下文章顺序（navigation.yaml 顺序即树顺序）。 */
  articleIds: string[]
}

export interface HelpLearningPath {
  id: string
  label: string
  description?: string
  roles: HelpRole[]
  articleIds: string[]
}

export interface HelpNav {
  locale: string
  productVersion: string
  areas: HelpArea[]
  learningPaths: HelpLearningPath[]
}

/** 搜索结果的最小文档形态。body 用于正文索引（design E：索引 title/summary/headings/body/tags）。 */
export interface HelpSearchDocument {
  id: string
  title: string
  summary: string
  contentType: HelpContentType
  area: string
  roles: HelpRole[]
  updatedAt: string
  headings: string[]
  keywords: string[]
  /** 规范正文（与网页渲染同一 body；仅用于索引与命中摘要）。 */
  body: string
}

/** lint 配置（content/help/lint-config.yaml）。 */
export interface HelpLintConfig {
  /** 允许外链的 host（默认全放行可配置收紧，见 lint-config）。 */
  allowedExternalHosts?: string[]
  /** updatedAt 早于此天数视为过期警告。 */
  staleUpdatedAtDays?: number
  /** 禁止出现在正文中（防止内部注记/secret 泄露到 Agent 出口）。 */
  forbiddenTerms?: string[]
}
