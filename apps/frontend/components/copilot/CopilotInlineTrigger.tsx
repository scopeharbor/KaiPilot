'use client'

/**
 * v3-copilot-inline-triggers —— 共享内联触发组件。
 *
 * 四处挂载点只提供实体身份，本组件负责：
 * 1. 构造结构化 MentionReference（不产生文本）
 * 2. 判断可用性（复用 deriveChips / deriveCommands 同源派生）
 * 3. 触发行为：打开面板 + 预置引用 + 预置当前路由
 * 4. 三类不可用处理（沿用既有枚举）
 *
 * 设计决策（D1）：内联触发 = 打开面板 + 预置引用，不是第二个对话入口。
 * 设计决策（D2）：实体身份走结构化引用，不走文本。
 * 设计决策（D3）：可用性三处同源（内联入口、面板芯片、斜杠命令）。
 */

import React from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import { useCopilotStore } from '@/stores/copilot-store'
import { cn } from '@/lib/utils'
import type { MentionReference, MentionableEntityType } from '@aiproj/types'
import { usePathname } from 'next/navigation'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'

// ===========================================================================
// 类型
// ===========================================================================

/** 内联触发器接收的实体身份。 */
export interface InlineTriggerEntity {
  /** 实体类型（如 'task', 'milestone', 'risk', 'wbs_node'）。 */
  entityType: MentionableEntityType
  /** 实体 ID。 */
  entityId: number
  /** 可读标签（如 "首页设计（T-1042）"）。 */
  label: string
  /** 项目 ID（可选）。 */
  projectId?: number
}

/** 可用性类型（沿用既有枚举，不新增第四类）。 */
export type InlineAvailabilityKind = 'available' | 'not-enabled' | 'authorization-gated'

export interface CopilotInlineTriggerProps {
  /** 实体身份。 */
  entity: InlineTriggerEntity
  /** 可用性（由父组件根据 deriveChips 结果传入）。 */
  availability?: InlineAvailabilityKind
  /** 不可用时的提示文案。 */
  availabilityHint?: string
  /** 附加 CSS 类名。 */
  className?: string
  /** 按钮尺寸变体。 */
  size?: 'default' | 'sm' | 'lg' | 'icon'
  /** 按钮外观变体。 */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link'
  /** 是否禁用。 */
  disabled?: boolean
}

// ===========================================================================
// 组件
// ===========================================================================

/**
 * 内联触发按钮。
 *
 * 点击后：
 * 1. 打开 Copilot 侧栏面板（setOpen(true)）
 * 2. 构造 MentionReference 并注入面板输入
 * 3. 预置当前路由（currentRoute）
 *
 * 不产生任何业务写入（红线 7.1）。
 * 不创建第二套消息渲染或流式状态（spec REQ）。
 */
export function CopilotInlineTrigger({
  entity,
  availability = 'available',
  availabilityHint,
  className,
  size = 'icon',
  variant = 'ghost',
  disabled = false,
}: CopilotInlineTriggerProps) {
  const setOpen = useCopilotStore((s) => s.setOpen)
  const pathname = usePathname()
  const organizationId = useCurrentOrganizationId()

  // 构造结构化引用（D2：不产生文本）
  const buildMentionReference = React.useCallback((): MentionReference => {
    return {
      entityType: entity.entityType as MentionableEntityType,
      entityId: entity.entityId,
      label: entity.label,
      organizationId: organizationId ?? 0,
      projectId: entity.projectId,
    }
  }, [entity, organizationId])

  // 触发行为：打开面板 + 预置引用（D1）
  const handleTrigger = React.useCallback(() => {
    if (disabled || availability !== 'available') return

    // 打开面板
    setOpen(true)

    // 构造引用并注入（通过 store 事件总线或直接操作 DOM）
    // 内联触发只负责"我是谁"，面板输入组件负责接收引用
    const reference = buildMentionReference()
    const event = new CustomEvent('copilot:inline-trigger', {
      detail: {
        mention: reference,
        currentRoute: pathname,
      },
    })
    window.dispatchEvent(event)
  }, [disabled, availability, setOpen, buildMentionReference, pathname])

  // 键盘可达性（spec REQ）：可聚焦、可 Enter 触发、可 Esc 退出
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleTrigger()
      }
      // Esc 由面板焦点陷阱处理
    },
    [handleTrigger],
  )

  // 不可用时的处理（D6：三类不可用，沿用既有枚举）
  if (availability === 'authorization-gated') {
    // 授权门入口可见带说明，但点击不发起任何外部请求（spec REQ）
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size={size}
              variant={variant}
              className={cn('h-7 w-7', className)}
              onClick={() => {
                // 授权门入口点击不发起任何外部请求
                // 可以显示一个提示但不打开面板
              }}
              onKeyDown={handleKeyDown}
              aria-label={`${entity.label} — 需要授权`}
              aria-disabled="true"
            >
              <MessageSquarePlus className="h-4 w-4 opacity-50" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{availabilityHint ?? '需要用户授权后才能使用该能力'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (availability === 'not-enabled') {
    // 未启用可见带提示
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size={size}
              variant={variant}
              className={cn('h-7 w-7', className)}
              onClick={() => {
                // 未启用时不打开面板
              }}
              onKeyDown={handleKeyDown}
              aria-label={`${entity.label} — 该能力未启用`}
              aria-disabled="true"
            >
              <MessageSquarePlus className="h-4 w-4 opacity-50" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{availabilityHint ?? '该能力未启用，可在设置中开启'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // 可用状态
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size={size}
            variant={variant}
            className={cn('h-7 w-7', className)}
            onClick={handleTrigger}
            onKeyDown={handleKeyDown}
            aria-label={`向 Copilot 询问 ${entity.label}`}
            tabIndex={0}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>向 Copilot 询问 {entity.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
