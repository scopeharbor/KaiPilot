'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

/**
 * 周期报表导出页 — 通知"导出完成"目标。重定向到 V2 报表工作台。
 */
export default function PeriodicExportsRedirect() {
  const params = useParams()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/projects/${params.id}/reports-v2`)
  }, [params.id, router])
  return null
}
