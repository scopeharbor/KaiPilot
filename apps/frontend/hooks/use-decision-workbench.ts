import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  checkDecisionReadiness,
  createDecisionCase,
  createDecisionHandoff,
  createDecisionOption,
  decisionWorkbenchKeys,
  fetchDecisionCases,
  fetchDecisionCase,
  fetchDecisionComparison,
  fetchDecisionHandoffs,
  fetchDecisionOptions,
  fetchDecisionOutcomes,
  fetchDecisionPositions,
  fetchDecisionSnapshots,
  recordDecisionPosition,
  refreshDecisionEvidence,
  submitDecisionOutcome,
  transitionDecisionCase,
} from '@/lib/api/decision-workbench'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import type { PmoDecisionCaseListQuery, PmoDecisionOutcomeAction } from '@aiproj/types'

/**
 * PMO 决策工作台服务端状态（v3-pmo-decision-intelligence-workbench §5.10.1）。
 *
 * 无当前组织时不发请求；query key 绑定 organization/case/filter/revision；
 * mutation 后精确失效对应 key，不做全量 invalidate。
 */
export function useDecisionCases(query?: PmoDecisionCaseListQuery) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.cases(organizationId, query),
    queryFn: () => fetchDecisionCases(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 15_000,
  })
}

export function useDecisionCase(decisionId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.caseDetail(organizationId, decisionId),
    queryFn: () => fetchDecisionCase(organizationId as number, decisionId as number),
    enabled: organizationId !== null && decisionId !== null,
  })
}

export function useDecisionOptions(decisionId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.options(organizationId, decisionId),
    queryFn: () => fetchDecisionOptions(organizationId as number, decisionId as number),
    enabled: organizationId !== null && decisionId !== null,
  })
}

export function useDecisionPositions(decisionId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.positions(organizationId, decisionId),
    queryFn: () => fetchDecisionPositions(organizationId as number, decisionId as number),
    enabled: organizationId !== null && decisionId !== null,
  })
}

export function useDecisionSnapshots(decisionId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.snapshots(organizationId, decisionId),
    queryFn: () => fetchDecisionSnapshots(organizationId as number, decisionId as number),
    enabled: organizationId !== null && decisionId !== null,
  })
}

export function useDecisionComparison(decisionId: number | null, revision: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.comparison(organizationId, decisionId, revision),
    queryFn: () => fetchDecisionComparison(organizationId as number, decisionId as number),
    enabled: organizationId !== null && decisionId !== null,
  })
}

export function useDecisionOutcomes(decisionId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.outcomes(organizationId, decisionId),
    queryFn: () => fetchDecisionOutcomes(organizationId as number, decisionId as number),
    enabled: organizationId !== null && decisionId !== null,
  })
}

export function useDecisionHandoffs(decisionId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: decisionWorkbenchKeys.handoffs(organizationId, decisionId),
    queryFn: () => fetchDecisionHandoffs(organizationId as number, decisionId as number),
    enabled: organizationId !== null && decisionId !== null,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

function useInvalidator() {
  const queryClient = useQueryClient()
  return (keys: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: [...keys] })
}

export function useCreateDecisionCase() {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (input: {
      title: string
      decisionQuestion: string
      scopeSummary?: string
      ownerId?: number
    }) => createDecisionCase(organizationId as number, input),
    onSuccess: () => invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'cases']),
  })
}

export function useTransitionDecisionCase(decisionId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (input: { to: string; expectedRevision: number }) =>
      transitionDecisionCase(organizationId as number, decisionId, input),
    onSuccess: () => {
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'case', decisionId])
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'cases'])
    },
  })
}

export function useCreateDecisionOption(decisionId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (input: { label: string; proposedOutcomeCategory: string }) =>
      createDecisionOption(organizationId as number, decisionId, input),
    onSuccess: () => {
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'options', decisionId])
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'case', decisionId])
    },
  })
}

export function useRecordDecisionPosition(decisionId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (input: { stance: 'support' | 'oppose' | 'abstain'; note?: string }) =>
      recordDecisionPosition(organizationId as number, decisionId, input),
    onSuccess: () =>
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'positions', decisionId]),
  })
}

export function useRefreshDecisionEvidence(decisionId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: () => refreshDecisionEvidence(organizationId as number, decisionId),
    onSuccess: () => {
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'snapshots', decisionId])
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'comparison', decisionId])
    },
  })
}

/** readiness 是显式检查动作：结果直接返回给调用方，不进缓存。 */
export function useCheckReadinessOnce() {
  const organizationId = useCurrentOrganizationId()
  return useMutation({
    mutationFn: (input: { decisionId: number; acknowledgedWarnings?: string[] }) =>
      checkDecisionReadiness(
        organizationId as number,
        input.decisionId,
        input.acknowledgedWarnings ?? [],
      ),
  })
}

export function useSubmitDecisionOutcome(decisionId: number) {
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()
  const orgPrefix = [...decisionWorkbenchKeys.all, organizationId ?? 'none']
  return useMutation({
    mutationFn: (input: {
      action: PmoDecisionOutcomeAction
      selectedOptionId?: number | null
      reviewFingerprint: string
      rationale?: string
      acknowledgedWarnings?: string[]
      supersededByCaseId?: number | null
    }) => submitDecisionOutcome(organizationId as number, decisionId, input),
    onSuccess: () => {
      for (const key of ['case', 'outcomes', 'handoffs', 'snapshots']) {
        void queryClient.invalidateQueries({ queryKey: [...orgPrefix, key, decisionId] })
      }
      void queryClient.invalidateQueries({ queryKey: [...orgPrefix, 'cases'] })
    },
  })
}

export function useCreateDecisionHandoff(decisionId: number) {
  const organizationId = useCurrentOrganizationId()
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (input: { target: string; idempotencyKey: string }) =>
      createDecisionHandoff(organizationId as number, decisionId, input),
    onSuccess: () =>
      invalidate([...decisionWorkbenchKeys.all, organizationId ?? 'none', 'handoffs', decisionId]),
  })
}
