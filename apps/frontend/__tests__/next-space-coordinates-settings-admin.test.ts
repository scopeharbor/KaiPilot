/**
 * 空间地图坐标检索/解析单测——设置空间 / 管理后台 / 项目设置（W9 · tasks 9.2）。
 *
 * 测试 `filterSpaceCoordinates` 对设置/管理/项目设置关键词命中、`resolveSpaceCoordinatePath`
 * 对三类坐标的路径解析（全局原样返回 / 项目级 `:id` 替换 / 无项目回落 `/next`）、
 * 以及既有坐标归属不被误伤的回归断言。
 */
import { describe, expect, it } from 'vitest'
import {
  filterSpaceCoordinates,
  PRESET_SPACE_COORDINATES,
  resolveSpaceCoordinatePath,
} from '@/lib/next/space-coordinates'

describe('PRESET_SPACE_COORDINATES – settings/admin/project-settings 坐标注册', () => {
  it('白名单包含 settings 坐标', () => {
    const settings = PRESET_SPACE_COORDINATES.find((c) => c.id === 'settings')
    expect(settings).toBeDefined()
    expect(settings!.path).toBe('/next/settings')
    expect(settings!.iconName).toBe('Settings')
    expect(settings!.status).toBe('available')
  })

  it('白名单包含 admin 坐标', () => {
    const admin = PRESET_SPACE_COORDINATES.find((c) => c.id === 'admin')
    expect(admin).toBeDefined()
    expect(admin!.path).toBe('/next/admin')
    expect(admin!.iconName).toBe('ShieldAlert')
    expect(admin!.status).toBe('available')
  })

  it('白名单包含 project-settings 坐标', () => {
    const ps = PRESET_SPACE_COORDINATES.find((c) => c.id === 'project-settings')
    expect(ps).toBeDefined()
    expect(ps!.path).toBe('/next/projects/:id/settings')
    expect(ps!.iconName).toBe('Settings2')
    expect(ps!.status).toBe('available')
  })

  it('三个坐标关键词不含既有专属词（避免归属漂移）', () => {
    const settings = PRESET_SPACE_COORDINATES.find((c) => c.id === 'settings')!
    const admin = PRESET_SPACE_COORDINATES.find((c) => c.id === 'admin')!
    const ps = PRESET_SPACE_COORDINATES.find((c) => c.id === 'project-settings')!
    const allKw = [...settings.keywords, ...admin.keywords, ...ps.keywords]
    // 不引入 首页/工作台/报表/资源/成员/文件/文档/帮助/知识 等既有专属词
    const forbidden = ['首页', '工作台', '报表', '成员', '文件', '文档', '帮助', '知识']
    for (const word of forbidden) {
      expect(allKw).not.toContain(word)
    }
  })
})

describe('filterSpaceCoordinates – settings/admin/project-settings 检索', () => {
  it('「设置」命中 settings 坐标', () => {
    const results = filterSpaceCoordinates('设置')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('settings')
  })

  it('「管理后台」命中 admin 坐标', () => {
    const results = filterSpaceCoordinates('管理后台')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('admin')
  })

  it('「工作日历」命中 project-settings 坐标', () => {
    const results = filterSpaceCoordinates('工作日历')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('project-settings')
  })

  it('「admin」命中 admin 坐标', () => {
    const results = filterSpaceCoordinates('admin')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('admin')
  })

  it('「密钥」命中 settings 坐标（关键词覆盖）', () => {
    const results = filterSpaceCoordinates('密钥')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('settings')
  })

  it('「sso」命中 settings 坐标', () => {
    const results = filterSpaceCoordinates('sso')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('settings')
  })

  it('「节假日」命中 project-settings', () => {
    const results = filterSpaceCoordinates('节假日')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('project-settings')
  })

  it('「用户管理」命中 admin 坐标', () => {
    const results = filterSpaceCoordinates('用户管理')
    const ids = results.map((c) => c.id)
    expect(ids).toContain('admin')
  })
})

describe('filterSpaceCoordinates – 既有坐标回归（防误伤）', () => {
  it('「首页」仍仅命中 home', () => {
    const results = filterSpaceCoordinates('首页')
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('home')
  })

  it('「资源」不误命中 settings 或 admin', () => {
    const results = filterSpaceCoordinates('资源')
    const ids = results.map((c) => c.id)
    expect(ids).not.toContain('settings')
    expect(ids).not.toContain('admin')
  })

  it('「成员」不误命中 settings 或 admin', () => {
    const results = filterSpaceCoordinates('成员')
    const ids = results.map((c) => c.id)
    expect(ids).not.toContain('settings')
    expect(ids).not.toContain('admin')
  })

  it('「报表」不误命中 settings', () => {
    const results = filterSpaceCoordinates('报表')
    const ids = results.map((c) => c.id)
    expect(ids).not.toContain('settings')
  })
})

describe('resolveSpaceCoordinatePath – settings/admin/project-settings 路径解析', () => {
  it('settings 全局坐标原样返回', () => {
    expect(resolveSpaceCoordinatePath('/next/settings', null)).toBe('/next/settings')
    expect(resolveSpaceCoordinatePath('/next/settings', 42)).toBe('/next/settings')
  })

  it('admin 全局坐标原样返回', () => {
    expect(resolveSpaceCoordinatePath('/next/admin', null)).toBe('/next/admin')
    expect(resolveSpaceCoordinatePath('/next/admin', 42)).toBe('/next/admin')
  })

  it('project-settings 有项目 ID 替换 :id', () => {
    expect(resolveSpaceCoordinatePath('/next/projects/:id/settings', 42)).toBe(
      '/next/projects/42/settings',
    )
  })

  it('project-settings 无项目回落 /next', () => {
    expect(resolveSpaceCoordinatePath('/next/projects/:id/settings', null)).toBe('/next')
  })
})
