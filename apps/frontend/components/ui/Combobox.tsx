'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNextLegacyThemeScope } from './NextLegacyThemeScope'
import { focusRing, invalidCls } from '@/lib/variants'

export interface ComboboxOption {
  label: string
  value: string
  disabled?: boolean
}

export interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  'aria-invalid'?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * Combobox——可搜索单选（不依赖 cmdk，属后续 change）。基于 Radix Popover 自实现
 * 搜索过滤 + ↑/↓/Enter/Esc 键盘导航；触发器样式对齐 Input，含 default/focus/error/disabled。
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = '请选择…',
  searchPlaceholder = '搜索…',
  emptyText = '无匹配项',
  disabled,
  className,
  ...aria
}: ComboboxProps) {
  const themeScope = useNextLegacyThemeScope()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)

  const filtered = React.useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  )
  const selected = options.find((o) => o.value === value)

  React.useEffect(() => setActiveIndex(0), [query, open])

  function commit(option?: ComboboxOption) {
    if (!option || option.disabled) return
    onValueChange?.(option.value)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(filtered[activeIndex])
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={aria['aria-invalid']}
          aria-label={aria['aria-label']}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 text-sm',
            'transition-[border-color,box-shadow] duration-150',
            selected ? 'text-gray-800' : 'text-placeholder',
            focusRing,
            invalidCls,
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className="line-clamp-1 text-left">{selected ? selected.label : placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          {...themeScope}
          align="start"
          sideOffset={4}
          className={cn(
            'z-[var(--z-popover)] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-gray-0 shadow-[var(--shadow-md)]',
            'data-[state=open]:animate-dropdown-enter',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="h-9 w-full bg-transparent text-sm text-gray-800 placeholder:text-placeholder focus-visible:outline-none"
            />
          </div>
          <div role="listbox" className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-gray-500">{emptyText}</div>
            ) : (
              filtered.map((option, i) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(option)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm text-gray-800',
                    i === activeIndex && 'bg-primary-50 text-primary-700',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0 text-primary-500',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="line-clamp-1">{option.label}</span>
                </button>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
