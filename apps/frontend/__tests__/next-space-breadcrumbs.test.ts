import { describe, expect, test } from 'vitest'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'

describe('lib/next/space-breadcrumbs（v3-ui-next-shell-space-map D4 / tasks 3.3）', () => {
  test('预置坐标路径回显「路径 · 标签」', () => {
    expect(resolveSpaceBreadcrumb('/next')).toBe('/next · 角色首页')
    expect(resolveSpaceBreadcrumb('/next/create')).toBe('/next/create · 生成剧场')
    expect(resolveSpaceBreadcrumb('/next/charts')).toBe('/next/charts · 图表馆')
  })

  test('未完全匹配的深层子路由 → 「空间探索」兜底', () => {
    expect(resolveSpaceBreadcrumb('/next/create/steps')).toBe('/next/create/steps · 空间探索')
    expect(resolveSpaceBreadcrumb('/next/misc')).toBe('/next/misc · 空间探索')
  })

  test('未知路由原样回显（不落入新轨前缀兜底）', () => {
    expect(resolveSpaceBreadcrumb('/dashboard')).toBe('/dashboard')
    expect(resolveSpaceBreadcrumb('/next-login')).toBe('/next-login')
    expect(resolveSpaceBreadcrumb('')).toBe('')
  })

  test('边界：/next 精确匹配优先于前缀兜底，带斜杠形如深层路径', () => {
    expect(resolveSpaceBreadcrumb('/next')).toBe('/next · 角色首页')
    expect(resolveSpaceBreadcrumb('/next/')).toBe('/next/ · 空间探索')
  })
})

describe('lib/next/space-breadcrumbs 项目空间动态标题（v3-ui-next-project-space design D2 / tasks 1.1）', () => {
  test('/next/projects/:id 带实体标题回显「路径 · 标题」', () => {
    expect(resolveSpaceBreadcrumb('/next/projects/42', '智能车载系统研发')).toBe(
      '/next/projects/42 · 智能车载系统研发',
    )
    expect(resolveSpaceBreadcrumb('/next/projects/101', '开项核心引擎')).toBe(
      '/next/projects/101 · 开项核心引擎',
    )
  })

  test('/next/projects/:id 未提供标题（数据加载中或缺省）→「项目空间」兜底', () => {
    expect(resolveSpaceBreadcrumb('/next/projects/42')).toBe('/next/projects/42 · 项目空间')
    expect(resolveSpaceBreadcrumb('/next/projects/101', '')).toBe('/next/projects/101 · 项目空间')
    expect(resolveSpaceBreadcrumb('/next/projects/101', '   ')).toBe(
      '/next/projects/101 · 项目空间',
    )
  })

  test('/next/projects/:id 深层子路由沿用项目空间坐标（归一为项目空间路径）', () => {
    expect(resolveSpaceBreadcrumb('/next/projects/42/tasks', '智能车载系统研发')).toBe(
      '/next/projects/42 · 智能车载系统研发',
    )
  })

  test('非数字 id 不匹配项目空间模式 → 既有「空间探索」兜底', () => {
    expect(resolveSpaceBreadcrumb('/next/projects/abc')).toBe('/next/projects/abc · 空间探索')
    expect(resolveSpaceBreadcrumb('/next/projects/')).toBe('/next/projects/ · 空间探索')
  })

  test('非项目路由不受 entityTitle 参数影响（维持既有映射）', () => {
    expect(resolveSpaceBreadcrumb('/next', '任意标题')).toBe('/next · 角色首页')
    expect(resolveSpaceBreadcrumb('/next/create', '任意标题')).toBe('/next/create · 生成剧场')
    expect(resolveSpaceBreadcrumb('/dashboard', '任意标题')).toBe('/dashboard')
  })
})
