'use client'

import { useSyncExternalStore } from 'react'
import { Check, Languages } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import {
  getServerVariant,
  getVariant,
  setVariant,
  subscribeVariant,
  type TextVariant,
} from '@/lib/locale/variant-store'

/**
 * 界面文字变体选项。选项名是语言自指名，必须保持原文、不随变体转换：
 * label 包在带 `data-no-cc` 的 span 内，cc-loader 与 runtime DOM 转换都会跳过
 * （与设置页「界面文字」卡片的选项写法一致）。
 */
const TEXT_VARIANT_OPTIONS: ReadonlyArray<{ value: TextVariant; label: string }> = [
  { value: 'cn', label: '简体中文' },
  { value: 'tw', label: '台灣繁體' },
  { value: 'hk', label: '香港繁體' },
]

export interface TextVariantSwitcherProps {
  /** 触发按钮样式：ghost 用于页头/工具列，outline 用于浅色区域。默认 ghost。 */
  variant?: 'ghost' | 'outline'
  /** 透传给触发按钮的类名（如 `ml-auto` 推到右侧）。 */
  className?: string
  /** 下拉面板水平对齐；默认 end，适合右上角触发。 */
  align?: 'start' | 'center' | 'end'
}

/**
 * 界面文字变体切换按钮（简体 / 台湾繁体 / 香港繁体），供登录页、帮助中心等
 * 非设置页场合复用。
 * - SSR 恒为 'cn'（getServerSnapshot），hydration 后才呈现 localStorage 保存的变体；
 * - 选项 label 均带 `data-no-cc`，各语言原文不被 cc-loader / runtime DOM 转换；
 * - 点击选项即调 setVariant：写 localStorage、同步 <html lang> 与
 *   data-text-variant，VariantRuntime 随即转换整页 DOM。
 */
export function TextVariantSwitcher({
  variant = 'ghost',
  className,
  align = 'end',
}: TextVariantSwitcherProps) {
  const current = useSyncExternalStore(subscribeVariant, getVariant, getServerVariant)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="icon"
          className={className}
          aria-label="切换界面文字"
          data-testid="text-variant-switcher-trigger"
        >
          <Languages className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {TEXT_VARIANT_OPTIONS.map((option) => {
          const active = current === option.value
          return (
            <DropdownMenuItem key={option.value} onSelect={() => setVariant(option.value)}>
              <span data-no-cc className="flex-1">
                {option.label}
              </span>
              {active ? (
                <Check
                  className="h-4 w-4 text-primary-500"
                  aria-hidden
                  data-testid="text-variant-switcher-active"
                />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
