import type { Metadata } from 'next'
import { AiConnectionsAccess } from '@/components/ai/AiConnectionsAccess'

/**
 * `/settings/ai-connections` —— AI 模型连接正式管理页(ai-gateway-abstraction / T034)。
 *
 * RBAC:`ai:connection:manage` 可管理(org_admin / project_manager);其他人 PermissionGuard fallback。
 * 后端 RBAC 是安全边界,前端 PermissionGuard 仅体验层。
 */
export const metadata: Metadata = {
  title: 'AI 模型连接',
  robots: { index: false, follow: false },
}

export default function AiConnectionsSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <AiConnectionsAccess />
    </div>
  )
}
