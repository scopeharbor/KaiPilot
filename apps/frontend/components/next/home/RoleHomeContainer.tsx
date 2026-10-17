'use client'

import * as React from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import {
  getRoleHomeConfig,
  selectCurrentOrganization,
  selectRoleBucket,
} from '@/lib/next/role-bucket'
import { RoleWelcomeBanner } from './RoleWelcomeBanner'
import { RoleSuggestionCards } from './RoleSuggestionCards'
import { RoleSignalQueue } from '../signals/RoleSignalQueue'
import { RolePersonalWorkBucket } from './RolePersonalWorkBucket'
import { GlobalTimelineBar } from '../project-space/GlobalTimelineBar'
import { CrossProjectTasksHudLens } from '../tasks/CrossProjectTasksHudLens'
import { useRoleSuggestionItems } from '@/hooks/use-role-suggestion-items'

/**
 * 角色化首页容器（v3-ui-next-shell-space-map D6/D7 / tasks 3.8 / W5 总装）。
 *
 * - 从 auth-store 实时派生四桶视角（RL-04：双入口共用底层角色体系）；
 * - 组合欢迎横幅、个人工作桶、建议卡槽、信号建议队列与时间主轴全域刻度档；
 * - 嵌入 `nx-space-atmosphere` 深空氛围底座（D18 Layer 1 空间层 C）；
 * - 认证水合前渲染平滑骨架态（design 风险表：角色未就绪不产生视觉撕裂）；
 * - 集成跨项目任务高密度 HUD 镜头（深链 `focus=tasks-hud` 或工作桶入口唤起）。
 */
export function RoleHomeContainer() {
  const [hudOpen, setHudOpen] = React.useState(false)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const bucket = useAuthStore(selectRoleBucket)
  const organization = selectCurrentOrganization(user, currentOrganizationId)

  // 支持深链 ?focus=tasks-hud 或自定义事件呼出 HUD
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      if (window.location.search.includes('focus=tasks-hud')) {
        setHudOpen(true)
      }
      const handleOpenHud = () => setHudOpen(true)
      window.addEventListener('open-tasks-hud', handleOpenHud)
      return () => window.removeEventListener('open-tasks-hud', handleOpenHud)
    }
  }, [])

  const atmosphereClass =
    'nx-space-atmosphere flex min-h-[70dvh] min-w-0 flex-col gap-6 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-space-bg)] p-3 sm:p-6 md:gap-8 md:p-10'

  if (!hasHydrated) {
    return (
      <div data-role-home aria-busy="true" className={atmosphereClass}>
        <p className="text-sm text-[var(--nx-text-muted)]">正在加载角色工作台…</p>
      </div>
    )
  }

  return (
    <div data-role-home data-role-bucket={bucket} className={atmosphereClass}>
      <RoleWelcomeBanner
        bucket={bucket}
        userName={user?.fullName}
        organizationName={organization?.name ?? null}
      />
      <RolePersonalWorkBucket bucket={bucket} onOpenHud={() => setHudOpen(true)} />
      <RoleSuggestionSection bucket={bucket} />
      <RoleSignalQueue />
      <GlobalTimelineBar />
      <CrossProjectTasksHudLens isOpen={hudOpen} onClose={() => setHudOpen(false)} />
    </div>
  )
}

/**
 * 建议卡槽数据接入段：QueryClient 上下文存在时挂真实数据派生（useRoleSuggestionItems），
 * 无 QueryClient 环境（既有静态用例/测试契约）回退静态卡槽骨架，零抛错。
 */
function RoleSuggestionSection({ bucket }: { bucket: ReturnType<typeof selectRoleBucket> }) {
  const queryClient = React.useContext(QueryClientContext)
  if (!queryClient) {
    return <RoleSuggestionCards slots={getRoleHomeConfig(bucket).suggestionSlots} />
  }
  return <RoleSuggestionSectionWithData bucket={bucket} />
}

function RoleSuggestionSectionWithData({
  bucket,
}: {
  bucket: ReturnType<typeof selectRoleBucket>
}) {
  // 建议卡指标真实派生（组织 Dashboard / 审计统计 / 我的任务聚合），加载中「…」失败「暂缺」
  const cards = useRoleSuggestionItems(bucket)
  return <RoleSuggestionCards cards={cards} />
}
