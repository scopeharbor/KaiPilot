'use client'

import { Download } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { usePwaInstallPrompt } from '@/hooks/use-pwa-install-prompt'

/**
 * 安装应用菜单项——添加到 UserMenu 的 DropdownMenuContent 中。
 *
 * 只有在浏览器触发 `beforeinstallprompt`（state === 'available'）时才渲染；
 * 已安装/ dismissed/ unsupported 状态不显示。
 *
 * @see design.md D4 / spec pwa-installable-shell
 */
export function PwaInstallAction() {
  const { state, install } = usePwaInstallPrompt()

  if (state !== 'available') return null

  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault()
        install()
      }}
    >
      <Download className="h-4 w-4" aria-hidden />
      <span>安装应用</span>
    </DropdownMenuItem>
  )
}
