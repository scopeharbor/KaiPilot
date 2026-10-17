import { AppShell } from '@/components/layout/AppShell'

/**
 * Dashboard 路由组布局（build-app-shell-layout D1）：
 *
 * - 挂 `AppShell`（Sidebar + Topbar + 内容区）——所有 `(dashboard)` 下页面共用；
 * - 根 `app/layout.tsx` 保持全局 Provider 不动（主题/密度/Query/Toaster）；
 * - 登录/错误等非 dashboard 页面不套此壳。
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
