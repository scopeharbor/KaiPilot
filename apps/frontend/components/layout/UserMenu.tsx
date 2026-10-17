'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn, LogOut, Settings, UserRound } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Avatar, AvatarFallback } from '@/components/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { useToast } from '@/components/ui/Toast'
import { PwaInstallAction } from './PwaInstallAction'
import { signOutSession } from '@/lib/auth/sign-out'

export interface UserMenuProps {
  /** 折叠/图标态：仅显示头像。 */
  compact?: boolean
}

/**
 * 用户菜单——侧栏底部（compact=false，头像+姓名+邮箱触发）与顶栏右侧（compact=true，仅头像）。
 * 菜单内含：个人资料、账户设置、退出登录（占位/跳转，账户后端接线沿用既有 `logoutSession`）。
 */
export function UserMenu({ compact = false }: UserMenuProps) {
  const user = useAuthStore((state) => state.user)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const pathname = usePathname()
  const { toast } = useToast()

  async function onLogout() {
    await signOutSession()
    toast({ variant: 'success', title: '已退出登录' })
  }

  if (!hasHydrated) {
    return <div className={cn('h-10 rounded-md bg-gray-100', compact ? 'w-10' : 'w-full')} />
  }

  if (!user) {
    const next = pathname && pathname !== '/login' ? pathname : '/dashboard'
    return (
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className={cn(
          'flex min-h-10 items-center gap-3 rounded-[var(--radius-md)] p-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100',
          compact && 'justify-center gap-0 p-1',
          focusRing,
        )}
      >
        <LogIn className="h-5 w-5" aria-hidden />
        {compact ? <span className="sr-only">登录</span> : <span>登录</span>}
      </Link>
    )
  }

  const displayName = user?.fullName?.trim() || user?.email || '未登录'
  const initials =
    user?.initials ||
    (user?.fullName ? user.fullName.slice(0, 2) : user?.email?.slice(0, 2))?.toUpperCase() ||
    '用户'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-md)] p-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100',
          compact && 'gap-0 p-1',
          focusRing,
        )}
      >
        <Avatar className={cn('h-8 w-8', compact && 'h-8 w-8')}>
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        {compact ? null : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-800">{displayName}</div>
            {user?.email ? (
              <div className="truncate text-xs text-gray-500">{user.email}</div>
            ) : null}
          </div>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
        <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile" className="cursor-pointer">
            <UserRound className="h-4 w-4" aria-hidden />
            <span>个人资料</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <Settings className="h-4 w-4" aria-hidden />
            <span>账户设置</span>
          </Link>
        </DropdownMenuItem>
        <PwaInstallAction />
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onLogout}>
          <LogOut className="h-4 w-4" aria-hidden />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
