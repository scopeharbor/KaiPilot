'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { create } from 'zustand'
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
  /** 可选的操作按钮（如「前往生成剧场」）；点击后执行并关闭提示。 */
  action?: { label: string; onClick: () => void }
}
interface ToastItem extends ToastOptions {
  id: number
}

interface ToastStore {
  toasts: ToastItem[]
  add: (t: ToastOptions) => number
  dismiss: (id: number) => void
}

let counter = 0
const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (t) => {
    const id = ++counter
    set((s) => ({ toasts: [...s.toasts, { id, variant: 'default', duration: 5000, ...t }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

/** 命令式 toast API：`const { toast } = useToast(); toast({ variant:'success', title:'已保存' })`。 */
export function useToast() {
  const add = useToastStore((s) => s.add)
  const dismiss = useToastStore((s) => s.dismiss)
  return { toast: add, dismiss }
}

export function toast(options: ToastOptions) {
  return useToastStore.getState().add(options)
}

const variantMeta: Record<
  ToastVariant,
  { cls: string; Icon: typeof Info | null; iconCls: string }
> = {
  default: { cls: 'bg-gray-0 border-border', Icon: null, iconCls: '' },
  success: { cls: 'bg-success-bg border-success', Icon: CheckCircle2, iconCls: 'text-success' },
  error: { cls: 'bg-danger-bg border-danger', Icon: AlertCircle, iconCls: 'text-danger' },
  warning: { cls: 'bg-warning-bg border-warning', Icon: AlertTriangle, iconCls: 'text-warning' },
  info: { cls: 'bg-info-bg border-info', Icon: Info, iconCls: 'text-info' },
}

/**
 * Toaster——挂一次即可（根 layout）。克制版 Toast：语义图标 + 语义浅底 + **全边框**，
 * 无左色条；成功/错误由图标 + 文字双通道传达，不以颜色单通道承载信息（定稿③）。
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {toasts.map(({ id, title, description, variant = 'default', duration, action }) => {
        const meta = variantMeta[variant]
        return (
          <ToastPrimitive.Root
            key={id}
            duration={duration}
            onOpenChange={(open) => !open && dismiss(id)}
            className={cn(
              'flex items-start gap-3 rounded-[var(--radius-md)] border p-4 shadow-[var(--shadow-md)]',
              'data-[state=open]:animate-toast-enter data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
              meta.cls,
            )}
          >
            {meta.Icon ? (
              <meta.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', meta.iconCls)} aria-hidden />
            ) : null}
            <div className="flex-1 space-y-0.5">
              {title ? (
                <ToastPrimitive.Title className="text-sm font-medium text-gray-800">
                  {title}
                </ToastPrimitive.Title>
              ) : null}
              {description ? (
                <ToastPrimitive.Description className="text-sm text-gray-600">
                  {description}
                </ToastPrimitive.Description>
              ) : null}
              {action ? (
                <ToastPrimitive.Action
                  altText={action.label}
                  data-toast-action
                  onClick={() => {
                    action.onClick()
                    dismiss(id)
                  }}
                  className={cn(
                    'mt-1.5 rounded-[var(--radius-sm)] border border-current px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100',
                    focusRing,
                  )}
                >
                  {action.label}
                </ToastPrimitive.Action>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="关闭"
              className={cn(
                'shrink-0 rounded-[var(--radius-sm)] p-0.5 text-gray-500 hover:text-gray-800',
                focusRing,
              )}
            >
              <X className="h-4 w-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        )
      })}
      <ToastPrimitive.Viewport className="fixed right-0 top-0 z-[var(--z-toast)] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  )
}
