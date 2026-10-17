'use client'

import { useRealtime } from '@/hooks/use-realtime'

interface ProjectRealtimeBridgeProps {
  projectId: number | undefined
}

export function ProjectRealtimeBridge({ projectId }: ProjectRealtimeBridgeProps) {
  useRealtime(projectId)
  return null
}
