import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  crossProjectAllocationApi,
  crossProjectAllocationKeys,
} from '@/lib/api/cross-project-resource-allocation'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'

/**
 * 跨项目资源调配 hooks（v3-cross-project-resource-allocation §6.1）。
 */

// ── 草案列表 ────────────────────────────────────────────────────────────

export function useListCrossProjectAllocationDrafts(query?: Record<string, unknown>) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: crossProjectAllocationKeys.drafts(organizationId ?? 0, query),
    queryFn: () => crossProjectAllocationApi.listDrafts(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 30_000,
  })
}

// ── 单个草案 ────────────────────────────────────────────────────────────

export function useCrossProjectAllocationDraft(draftId: number | null) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: crossProjectAllocationKeys.draft(organizationId ?? 0, draftId!),
    queryFn: () => crossProjectAllocationApi.getDraft(organizationId as number, draftId!),
    enabled: organizationId !== null && draftId !== null,
    staleTime: 15_000,
  })
}

// ── 候选资源 ────────────────────────────────────────────────────────────

export function useCrossProjectAllocationCandidates(query?: Record<string, unknown>) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: crossProjectAllocationKeys.candidates(organizationId ?? 0, query),
    queryFn: () => crossProjectAllocationApi.listCandidates(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 30_000,
  })
}

// ── 创建草案 ────────────────────────────────────────────────────────────

export function useCreateCrossProjectAllocationDraft() {
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      crossProjectAllocationApi.createDraft(organizationId as number, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: crossProjectAllocationKeys.all(organizationId as number),
      })
    },
  })
}

// ── 更新草案 items ────────────────────────────────────────────────────

export function useUpdateCrossProjectAllocationItems() {
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ draftId, body }: { draftId: number; body: Record<string, unknown> }) =>
      crossProjectAllocationApi.updateItems(organizationId as number, draftId, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: crossProjectAllocationKeys.draft(organizationId as number, variables.draftId),
      })
    },
  })
}

// ── 预览草案 ────────────────────────────────────────────────────────────

export function usePreviewCrossProjectAllocationDraft() {
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (draftId: number) =>
      crossProjectAllocationApi.previewDraft(organizationId as number, draftId),
    onSuccess: (_data, draftId) => {
      queryClient.invalidateQueries({
        queryKey: crossProjectAllocationKeys.draft(organizationId as number, draftId),
      })
    },
  })
}

// ── 确认草案 ────────────────────────────────────────────────────────────

export function useConfirmCrossProjectAllocationDraft() {
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ draftId, body }: { draftId: number; body: Record<string, unknown> }) =>
      crossProjectAllocationApi.confirmDraft(organizationId as number, draftId, body),
    onSuccess: (_data, { draftId }) => {
      queryClient.invalidateQueries({
        queryKey: crossProjectAllocationKeys.draft(organizationId as number, draftId),
      })
    },
  })
}

// ── 应用草案 ────────────────────────────────────────────────────────────

export function useApplyCrossProjectAllocationDraft() {
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ draftId, body }: { draftId: number; body: Record<string, unknown> }) =>
      crossProjectAllocationApi.applyDraft(organizationId as number, draftId, body),
    onSuccess: (_data, { draftId }) => {
      queryClient.invalidateQueries({
        queryKey: crossProjectAllocationKeys.draft(organizationId as number, draftId),
      })
      queryClient.invalidateQueries({
        queryKey: crossProjectAllocationKeys.drafts(organizationId as number),
      })
    },
  })
}

// ── 取消草案 ────────────────────────────────────────────────────────────

export function useCancelCrossProjectAllocationDraft() {
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (draftId: number) =>
      crossProjectAllocationApi.cancelDraft(organizationId as number, draftId),
    onSuccess: (_data, draftId) => {
      queryClient.invalidateQueries({
        queryKey: crossProjectAllocationKeys.draft(organizationId as number, draftId),
      })
    },
  })
}
