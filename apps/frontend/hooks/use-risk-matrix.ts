'use client'

import { useQuery } from '@tanstack/react-query'
import { getRiskMatrix } from '@/lib/api/risks'

const matrixKeys = {
  all: ['risk-matrix'] as const,
  matrix: (projectId: number, basis: string) => [...matrixKeys.all, projectId, basis] as const,
}

export function useRiskMatrix(projectId: number, basis: 'inherent' | 'residual' = 'inherent') {
  return useQuery({
    queryKey: matrixKeys.matrix(projectId, basis),
    queryFn: () => getRiskMatrix(projectId, basis),
    enabled: !!projectId,
  })
}
