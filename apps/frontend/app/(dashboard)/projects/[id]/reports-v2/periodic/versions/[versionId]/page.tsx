'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

/**
 * 周期报表版本详情页 — 通知"已确认"目标。
 * 重定向到审阅页，由审阅页根据审核状态展示确认信息。
 */
export default function PeriodicVersionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const versionId = params.versionId as string

  useEffect(() => {
    router.replace(`/projects/${id}/reports-v2/periodic/versions/${versionId}/review`)
  }, [id, versionId, router])

  return null
}
