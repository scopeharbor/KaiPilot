'use client'

import { useParams } from 'next/navigation'
import { WbsTree } from '@/components/views/wbs/WbsTree'

export default function ProjectWbsPage() {
  const params = useParams()
  return <WbsTree projectId={Number(params.id)} />
}
