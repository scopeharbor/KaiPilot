'use client'

import { Building2, ChevronsUpDown, Check, UserRound } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { isSaasPersonalWorkspace, resolveWorkspaceEdition } from '@/lib/workspace-edition'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { useToast } from '@/components/ui/Toast'

export interface WorkspaceSwitcherProps {
  /** 折叠态仅显图标，不显名称。 */
  collapsed?: boolean
}

/**
 * 工作区选择器——侧栏顶部品牌下方，展示当前组织并允许切换到用户所属其他组织。
 * 数据源：`auth-store` 的 `user.organizations` 与 `currentOrganizationId`。
 */
export function WorkspaceSwitcher({ collapsed = false }: WorkspaceSwitcherProps) {
  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const sessionPlanTier = useAuthStore((state) => state.planTier)
  const switchOrganization = useAuthStore((state) => state.switchOrganization)
  const { toast } = useToast()

  const organizations = user?.organizations ?? []
  const current = organizations.find((org) => org.id === currentOrganizationId) ?? organizations[0]
  const currentEdition = resolveWorkspaceEdition(current?.planTier ?? sessionPlanTier)
  const isPersonal = isSaasPersonalWorkspace(current?.planTier ?? sessionPlanTier)
  const currentLabel = isPersonal ? '个人空间' : (current?.name ?? '未选择工作区')
  const EditionIcon = isPersonal ? UserRound : Building2

  if (isPersonal && organizations.length <= 1) {
    return (
      <div
        className={cn(
          'flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-border bg-gray-0 px-2 py-1.5 text-sm text-gray-700',
          collapsed && 'justify-center px-0',
        )}
        aria-label="当前为个人空间"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-primary-50 text-primary-600">
          <UserRound className="h-4 w-4" aria-hidden />
        </span>
        {collapsed ? null : <span className="min-w-0 flex-1 truncate">个人空间</span>}
      </div>
    )
  }

  async function onSwitch(organizationId: number) {
    try {
      await switchOrganization(organizationId)
      toast({ variant: 'success', title: '已切换工作区' })
    } catch (error) {
      toast({
        variant: 'error',
        title: '切换失败',
        description: error instanceof Error ? error.message : '未知错误',
      })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-border bg-gray-0 px-2 py-1.5 text-left text-sm',
          'text-gray-700 transition-colors hover:bg-gray-50',
          collapsed && 'justify-center px-0',
          focusRing,
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-primary-50 text-primary-600">
          <EditionIcon className="h-4 w-4" aria-hidden />
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-56">
        <DropdownMenuLabel>切换工作区</DropdownMenuLabel>
        {organizations.length === 0 ? (
          <DropdownMenuItem disabled>暂无可用工作区</DropdownMenuItem>
        ) : (
          organizations.map((organization) => {
            const active = organization.id === currentOrganizationId
            return (
              <DropdownMenuItem
                key={organization.id}
                onSelect={() => {
                  if (!active) void onSwitch(organization.id)
                }}
                className="pr-2"
              >
                <span className="flex-1 truncate">
                  {isSaasPersonalWorkspace(organization.planTier) ? '个人空间' : organization.name}
                </span>
                {active ? <Check className="h-4 w-4 text-primary-500" aria-hidden /> : null}
              </DropdownMenuItem>
            )
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-gray-500">
          当前版本：
          {currentEdition === 'personal'
            ? '个人版'
            : currentEdition === 'team'
              ? '团队版'
              : '企业版'}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
