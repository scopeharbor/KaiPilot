/**
 * Page readiness registry 测试（v3-help-and-operational-issues-center 3.3）。
 *
 * - 覆盖 7 条路由；状态合法；planned/partial 必须提供替代路径或明确说明；
 * - 帮助文章 id 必须能在真实内容树中解析（与 navigation.yaml 一致）。
 */
import { describe, it, expect } from 'vitest'
import {
  PAGE_READINESS,
  readinessFor,
  normalizeRoute,
  isNavVisible,
  type PageReadiness,
  type PageStatus,
} from '@/lib/help/readiness'
import { resolveHelpContentDir } from '@/lib/help/load'
import { lintContent } from '@/lib/help/lint'
import { ISSUE_RISK_TAXONOMY } from '@/lib/help/taxonomy'
import { allNavItems } from '@/lib/navigation'

const REQUIRED_ROUTES = [
  '/risks',
  '/tasks',
  '/calendar',
  '/resources',
  '/reports',
  '/recommendations',
  '/change-requests',
]

const VALID_STATUSES: PageStatus[] = ['ready', 'partial', 'planned', 'degraded']

describe('page readiness registry', () => {
  it('覆盖全部 7 条占位/半完成路由', () => {
    const routes = PAGE_READINESS.map((r) => r.routePattern)
    for (const route of REQUIRED_ROUTES) {
      expect(routes).toContain(route)
    }
  })

  it('状态合法，且 planned/partial 提供替代路径或诚实说明', () => {
    for (const r of PAGE_READINESS) {
      expect(VALID_STATUSES).toContain(r.status)
      expect(r.helpArticleId.length).toBeGreaterThan(0)
      expect(r.note.length).toBeGreaterThan(0)
      if (r.status === 'planned') {
        expect(r.alternativeRoute).toBeTruthy()
      }
      if (r.status === 'partial') {
        expect(r.alternativeRoute || r.note.includes('后续')).toBe(true)
      }
    }
  })

  it('readinessFor 精确与前缀匹配、忽略尾斜杠与 query', () => {
    expect(readinessFor('/tasks')?.routePattern).toBe('/tasks')
    expect(readinessFor('/tasks/')?.routePattern).toBe('/tasks')
    expect(readinessFor('/tasks?x=1')?.routePattern).toBe('/tasks')
    expect(readinessFor('/projects/42')).toBeUndefined()
    expect(normalizeRoute('/a//')).toBe('/a/')
  })

  it('已交付页面在生产导航可见（registry 不再含 planned 条目）', () => {
    expect(PAGE_READINESS.some((r) => r.status === 'planned')).toBe(false)
    expect(isNavVisible('/tasks')).toBe(true)
    expect(isNavVisible('/calendar')).toBe(true)
    expect(isNavVisible('/risks')).toBe(true)
    expect(isNavVisible('/reports')).toBe(true)
  })

  it('registry 引用的帮助文章在真实内容树中可解析（含 orphan/链接 lint 一致性）', () => {
    const dir = resolveHelpContentDir()
    const issues = lintContent(dir)
    const referenced = PAGE_READINESS.map((r: PageReadiness) => r.helpArticleId)
    for (const id of referenced) {
      const missing = issues.find((i) => i.code === 'orphan.nav-missing' && i.message.includes(id))
      expect(missing, `帮助文章 ${id} 未被 navigation.yaml 收录`).toBeUndefined()
    }
    expect(issues.filter((i) => i.severity === 'error').length).toBe(0)
  })

  it('旧 /risks URL 在应用导航中仍有效（路由兼容，3.1）', () => {
    const navHrefs = allNavItems.map((i) => i.href)
    expect(navHrefs).toContain('/risks')
    expect(readinessFor('/risks')?.status).toBe('ready')
  })

  it('taxonomy 四种概念定义互斥且落点不混淆（3.1）', () => {
    const kinds = ISSUE_RISK_TAXONOMY.map((t) => t.kind)
    expect(new Set(kinds).size).toBe(4)
    const issue = ISSUE_RISK_TAXONOMY.find((t) => t.kind === 'issue')!
    const risk = ISSUE_RISK_TAXONOMY.find((t) => t.kind === 'risk')!
    const incident = ISSUE_RISK_TAXONOMY.find((t) => t.kind === 'incident')!
    // 产品故障不进入项目风险记录，且不把 Copilot 报错当风险
    expect(incident.where).not.toMatch(/风险登记/)
    expect(incident.where).toMatch(/故障排查/)
    expect(issue.implemented).toBe(true)
    expect(risk.implemented).toBe(true)
    // 示例语义区分：描述里「可能」属于风险，已发生属于问题
    expect(risk.example).toContain('可能')
    expect(issue.example).not.toContain('可能')
  })
})
