'use client'

import {
  AiProjectIntentReadOnlyFallback,
  AiProjectIntentWorkspace,
} from '@/components/ai-copilot/AiProjectIntentWorkspace'
import { PermissionGuard } from '@/components/PermissionGuard'

export default function AiCreatePage() {
  return (
    <PermissionGuard require="ai:trigger" fallback={<AiProjectIntentReadOnlyFallback />}>
      <AiProjectIntentWorkspace />
    </PermissionGuard>
  )
}
