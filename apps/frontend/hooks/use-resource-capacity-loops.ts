import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchRcclLoops,
  fetchRcclLoopDetail,
  createRcclScenario,
  simulateRcclLoop,
  selectRcclScenario,
  handoffRcclSelection,
  reviewRcclLoop,
  closeRcclLoop,
  cancelRcclLoop,
  refreshRcclBaseline,
  resourceCapacityLoopKeys,
} from '@/lib/api/resource-capacity-loops'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'

/**
 * 资源容量闭环服务端状态（§8.1）。
 * - query key 绑定 organization / loop / filters，缓存隔离、stale 不串；
 * - 无当前组织时 enabled=false，页面渲染空态而非打无效请求；
 * - mutation 成功后按 key 前缀失效；服务端态不进 Zustand。
 */

export function useRcclLoops(filters?: { state?: string; page?: number }) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: resourceCapacityLoopKeys.list(organizationId, filters ?? {}),
    queryFn: () => fetchRcclLoops(organizationId as number, filters),
    enabled: organizationId !== null,
    staleTime: 30_000,
  })
}

export function useRcclLoopDetail(loopId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: resourceCapacityLoopKeys.detail(organizationId, loopId),
    queryFn: () => fetchRcclLoopDetail(organizationId as number, loopId as number),
    enabled: organizationId !== null && loopId !== null,
    staleTime: 30_000,
  })
}

function useInvalidateRccl() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: resourceCapacityLoopKeys.all })
  }
}

export function useCreateRcclScenario(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: (args: { name: string; overlays: unknown[]; expectedRevision: number }) =>
      createRcclScenario(organizationId as number, loopId, args),
    onSuccess: invalidate,
  })
}

export function useSimulateRcclLoop(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: (expectedRevision: number) =>
      simulateRcclLoop(organizationId as number, loopId, expectedRevision),
    onSuccess: invalidate,
  })
}

export function useSelectRcclScenario(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: (args: {
      scenarioId: number
      simulationSnapshotId: number
      acknowledgedWarnings?: string[]
    }) =>
      selectRcclScenario(organizationId as number, loopId, { ...args, actorType: 'human_user' }),
    onSuccess: invalidate,
  })
}

export function useHandoffRcclSelection(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: (args: {
      target: string
      idempotencyKey: string
      requestedRefs: string[]
      authorizedVisibleRefIds: string[]
    }) => handoffRcclSelection(organizationId as number, loopId, args),
    onSuccess: invalidate,
  })
}

export function useReviewRcclLoop(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: (args: {
      observationSnapshotId: number
      outcome: string
      boundedRationale: string
      acknowledgedWarnings?: string[]
    }) => reviewRcclLoop(organizationId as number, loopId, args),
    onSuccess: invalidate,
  })
}

export function useRefreshRcclBaseline(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: () => refreshRcclBaseline(organizationId as number, loopId),
    onSuccess: invalidate,
  })
}

export function useCloseRcclLoop(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: (args: { expectedRevision: number }) =>
      closeRcclLoop(organizationId as number, loopId, args),
    onSuccess: invalidate,
  })
}

export function useCancelRcclLoop(loopId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidateRccl()
  return useMutation({
    mutationFn: (args: { reason?: string }) =>
      cancelRcclLoop(organizationId as number, loopId, args),
    onSuccess: invalidate,
  })
}
