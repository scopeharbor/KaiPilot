'use client'

import { AuditLogPageContent } from '@/components/audit/AuditLogPageContent'
import PermissionGuard from '@/components/PermissionGuard'
import { Alert } from '@/components/ui/Alert'
import { Suspense } from 'react'

export default function OrgAuditLogsPage() {
  return (
    <PermissionGuard
      require="audit:view"
      fallback={<Alert className="my-8">无权访问审计日志</Alert>}
    >
      <Suspense>
        <AuditLogPageContent scope="org" />
      </Suspense>
    </PermissionGuard>
  )
}
