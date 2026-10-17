'use client'

import { useTheme } from 'next-themes'
import { Check, Monitor, Moon, Palette, Rows2, Rows3, Sun } from 'lucide-react'
import { useUiStore, type Density } from '@/stores/ui-store'
import { IconButton } from '@/components/ui/IconButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'

export const THEME_OPTIONS: Array<{
  value: 'light' | 'dark' | 'system'
  label: string
  Icon: typeof Sun
}> = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
]

export const DENSITY_OPTIONS: Array<{ value: Density; label: string; Icon: typeof Rows2 }> = [
  { value: 'comfortable', label: '舒适', Icon: Rows3 },
  { value: 'compact', label: '紧凑', Icon: Rows2 },
]

/**
 * 外观菜单（build-app-shell-layout / spec app-shell-navigation §顶栏）。
 *
 * 主题——`next-themes`（`data-mode` 属性，浅/深/跟随系统）；
 * 密度——`ui-store`（`data-density` 属性，舒适/紧凑）。
 * 两套开关正交（design.md D2），此菜单同处集中提供入口。
 */
export function ThemeDensityMenu() {
  const { theme, setTheme } = useTheme()
  const density = useUiStore((state) => state.density)
  const setDensity = useUiStore((state) => state.setDensity)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="外观菜单">
              <Palette className="h-4 w-4" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>外观（主题与密度）</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
        <DropdownMenuLabel>主题</DropdownMenuLabel>
        {THEME_OPTIONS.map((option) => {
          const active = (theme ?? 'system') === option.value
          const OptionIcon = option.Icon
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setTheme(option.value)}
              className="pr-2"
            >
              <OptionIcon className="h-4 w-4" aria-hidden />
              <span className="flex-1">{option.label}</span>
              {active ? <Check className="h-4 w-4 text-primary-500" aria-hidden /> : null}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>密度</DropdownMenuLabel>
        {DENSITY_OPTIONS.map((option) => {
          const active = density === option.value
          const OptionIcon = option.Icon
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setDensity(option.value)}
              className="pr-2"
            >
              <OptionIcon className="h-4 w-4" aria-hidden />
              <span className="flex-1">{option.label}</span>
              {active ? <Check className="h-4 w-4 text-primary-500" aria-hidden /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
