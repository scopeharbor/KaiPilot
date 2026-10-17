'use client'

import React from 'react'
import type { ChipDescriptor } from '@aiproj/types'

interface ContextChipProps {
  chip: ChipDescriptor
  onClick: (chip: ChipDescriptor) => void
  className?: string
  disabled?: boolean
}

/**
 * 上下文快捷操作芯片组件。
 *
 * 渲染一个芯片，根据可用性状态显示不同样式。
 * 点击时调用 onClick 回调，由父组件处理点击语义。
 */
export function ContextChip({ chip, onClick, className = '', disabled = false }: ContextChipProps) {
  const isAvailable = chip.availabilityKind === 'available' && !disabled

  // 基础样式
  const baseStyles =
    'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors'

  // 可用性样式
  const availabilityStyles = isAvailable
    ? 'bg-gray-100 text-gray-900 hover:bg-gray-200 cursor-pointer'
    : 'bg-gray-50 text-gray-400 cursor-not-allowed'

  // 不可用时的视觉区分
  const unavailableStyles = !isAvailable ? 'opacity-60' : ''

  // 组合样式
  const chipStyles = `${baseStyles} ${availabilityStyles} ${unavailableStyles} ${className}`

  const handleClick = () => {
    if (isAvailable) {
      onClick(chip)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <button
      type="button"
      className={`${chipStyles} focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={!isAvailable}
      aria-disabled={!isAvailable}
      aria-label={`${chip.label}${!isAvailable && chip.hint ? ` - ${chip.hint}` : ''}`}
      tabIndex={0}
      role="button"
    >
      {chip.label}
      {!isAvailable && chip.hint && <span className="sr-only"> - {chip.hint}</span>}
    </button>
  )
}
