import { beforeEach, describe, expect, test } from 'vitest'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { buildNavigationCommands } from '@/lib/command-registry/built-in/navigation'
import { buildThemeCommands } from '@/lib/command-registry/built-in/theme'
import { buildDensityCommands } from '@/lib/command-registry/built-in/density'
import { allNavItems } from '@/lib/navigation'

beforeEach(() => {
  useCommandRegistryStore.getState().clear()
})

describe('built-in/navigation', () => {
  test('导航命令数与 allNavItems 一致', () => {
    const cmds = buildNavigationCommands()
    expect(cmds).toHaveLength(allNavItems.length)
  })

  test('导航命令 effect 均为 navigate', () => {
    for (const cmd of buildNavigationCommands()) {
      expect(cmd.effect).toBe('navigate')
      expect(cmd.group).toBe('navigation')
    }
  })

  test('导航命令权限元数据透传 requiresPermission', () => {
    const projectsCmd = buildNavigationCommands().find((c) => c.id === 'nav./projects')
    expect(projectsCmd).toBeDefined()
    expect(projectsCmd!.requiresPermission).toEqual(['project:view'])
  })

  test('无权限门槛项 requiresPermission 为 undefined', () => {
    const dashboardCmd = buildNavigationCommands().find((c) => c.id === 'nav./dashboard')
    expect(dashboardCmd).toBeDefined()
    expect(dashboardCmd!.requiresPermission).toBeUndefined()
  })
})

describe('built-in/theme', () => {
  test('三条主题命令 effect 均为 ui-setting', () => {
    const cmds = buildThemeCommands()
    expect(cmds).toHaveLength(3)
    for (const cmd of cmds) {
      expect(cmd.effect).toBe('ui-setting')
      expect(cmd.group).toBe('theme')
    }
  })

  test('主题命令 id 稳定', () => {
    const ids = buildThemeCommands().map((c) => c.id)
    expect(ids).toEqual(['theme.light', 'theme.dark', 'theme.system'])
  })
})

describe('built-in/density', () => {
  test('两条密度命令 effect 均为 ui-setting', () => {
    const cmds = buildDensityCommands()
    expect(cmds).toHaveLength(2)
    for (const cmd of cmds) {
      expect(cmd.effect).toBe('ui-setting')
      expect(cmd.group).toBe('density')
    }
  })

  test('密度命令 id 稳定', () => {
    const ids = buildDensityCommands().map((c) => c.id)
    expect(ids).toEqual(['density.comfortable', 'density.compact'])
  })
})
