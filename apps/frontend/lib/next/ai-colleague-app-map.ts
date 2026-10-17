/**
 * AI 同事 · 应用地图（从界面自己在用的目录实时生成）。
 *
 * 来源（与界面同一份数据，改了界面这里自动跟着变，不依赖文档）：
 * - 项目视图：`LENS_SWITCHER_OPTIONS`（项目空间顶部镜头切换）；
 * - 空间地图坐标：`PRESET_SPACE_COORDINATES`（只取已上线的 available）；
 * - 图表馆里的每张图表：`PM_CHART_DEFINITIONS`（「AON 网络图在哪里」「打开鱼骨图」）；
 * - 设置分区：`SETTINGS_SECTIONS`（按查看权限过滤）；
 * - 管理后台：`ADMIN_CONSOLES`（按查看权限过滤）。
 * 界面偏好选项取自顶栏外观菜单与文字变体常量。
 */
import type { ColleagueAppDestination, ColleagueUiPreferenceOptions } from '@aiproj/types'
import { LENS_SWITCHER_OPTIONS } from '@/components/next/project-space/LensSwitcher'
import { DENSITY_OPTIONS, THEME_OPTIONS } from '@/components/layout/ThemeDensityMenu'
import { PRESET_SPACE_COORDINATES } from '@/lib/next/space-coordinates'
import {
  SETTINGS_SECTION_GROUPS,
  SETTINGS_SECTIONS,
  canOpenSettingsSection,
} from '@/lib/next/settings/settings-sections'
import { ADMIN_CONSOLE_GROUPS, ADMIN_CONSOLES } from '@/lib/next/admin/admin-consoles'
import { VARIANT_LABELS, type TextVariant } from '@/lib/locale/variant-store'
import { CHART_DOMAINS, PM_CHART_DEFINITIONS } from '@/lib/next/charts/chart-catalog-metadata'

export function buildColleagueAppMap(
  can: (permission: string) => boolean,
): ColleagueAppDestination[] {
  const destinations: ColleagueAppDestination[] = []
  const seenPaths = new Set<string>()
  const push = (destination: ColleagueAppDestination) => {
    if (seenPaths.has(destination.path)) return
    seenPaths.add(destination.path)
    destinations.push(destination)
  }

  for (const lens of LENS_SWITCHER_OPTIONS) {
    if (lens.status !== 'available') continue
    push({
      id: `lens:${lens.id}`,
      title: lens.label,
      group: '项目视图',
      path: `/next/projects/:id?lens=${lens.id}`,
      description: `当前项目的${lens.label}视图`,
    })
  }

  for (const coordinate of PRESET_SPACE_COORDINATES) {
    if (coordinate.status !== 'available') continue
    push({
      id: `space:${coordinate.id}`,
      title: coordinate.title,
      group: coordinate.path.includes(':id') ? '项目空间' : '空间地图',
      path: coordinate.path,
      description: coordinate.description,
    })
  }

  const chartDomainLabel = new Map(CHART_DOMAINS.map((domain) => [domain.id, domain.label]))
  for (const chart of PM_CHART_DEFINITIONS) {
    if (chart.status !== 'available') continue
    push({
      id: `chart:${chart.id}`,
      title: chart.title,
      group: `图表馆 · ${chartDomainLabel.get(chart.domain) ?? chart.domain}`,
      path: `/next/projects/:id/charts/${chart.id}`,
      // 描述会被截到 80 字：别名放前面，便于按「网络图 / 前导图 / 鱼骨图」这类说法找到
      description: `${chart.subtitle}；别名：${chart.tags.slice(0, 8).join('、')}`,
    })
  }

  const settingsGroupLabel = new Map(
    SETTINGS_SECTION_GROUPS.map((group) => [group.group, group.label]),
  )
  for (const section of SETTINGS_SECTIONS) {
    if (!canOpenSettingsSection(section, can)) continue
    push({
      id: `settings:${section.id}`,
      title: section.title,
      group: `设置 · ${settingsGroupLabel.get(section.group) ?? section.group}`,
      path: section.path,
      description: section.description,
    })
  }

  // 新版顶栏没有用户菜单：退出登录在个人资料页底部（也可以直接让 AI 同事退出）
  push({
    id: 'account:sign-out',
    title: '退出登录',
    group: '设置 · 个人',
    path: '/next/settings/profile#sign-out',
    description: '在个人资料页底部退出当前账号；也可以直接对 AI 同事说「帮我退出登录」',
  })

  const adminGroupLabel = new Map(ADMIN_CONSOLE_GROUPS.map((group) => [group.id, group.label]))
  for (const adminConsole of ADMIN_CONSOLES) {
    if (!can(adminConsole.viewPermission)) continue
    push({
      id: `admin:${adminConsole.id}`,
      title: adminConsole.title,
      group: `管理后台 · ${adminGroupLabel.get(adminConsole.group) ?? adminConsole.group}`,
      path: adminConsole.path,
      description: adminConsole.description,
    })
  }

  return destinations
}

/** 界面偏好可选值（与顶栏外观菜单、文字变体完全一致）。 */
export function buildColleagueUiPreferences(): ColleagueUiPreferenceOptions {
  return {
    themes: THEME_OPTIONS.map(({ value, label }) => ({ value, label })),
    densities: DENSITY_OPTIONS.map(({ value, label }) => ({ value, label })),
    textVariants: (Object.keys(VARIANT_LABELS) as TextVariant[]).map((value) => ({
      value,
      label: VARIANT_LABELS[value],
    })),
  }
}

/** 把 `:id` 换成当前项目；不在项目里返回 null（该页需要项目）。 */
export function resolveAppPath(path: string, projectId: number | null): string | null {
  if (!path.includes(':id')) return path
  if (projectId === null) return null
  return path.replace(/:id/g, String(projectId))
}
