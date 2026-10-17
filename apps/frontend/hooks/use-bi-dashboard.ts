// v3-bi-dashboard-builder §8.1 — BI Dashboard Builder TanStack Query hooks。

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  BiDashboardCreatePayload,
  BiDashboardUpdatePayload,
  BiDashboardPreviewPayload,
} from '@aiproj/types'
import {
  fetchWidgetRegistry,
  fetchDashboardList,
  fetchCurrentDashboard,
  fetchDashboardDetail,
  previewDashboard,
  createDashboard,
  updateDashboard,
  copyDashboard,
  setDefaultDashboard,
  archiveDashboard,
  restoreDashboard,
  deleteDashboard,
} from '@/lib/api/bi-dashboard'

// ─── Registry ──────────────────────────────────────────────────────────────

export function useWidgetRegistry(organizationId: number) {
  return useQuery({
    queryKey: ['bi-dashboard', 'registry', organizationId],
    queryFn: () => fetchWidgetRegistry(organizationId),
    staleTime: 5 * 60 * 1000,
  })
}

// ─── List ──────────────────────────────────────────────────────────────────

export function useDashboardList(
  organizationId: number,
  params?: { page?: number; perPage?: number; scope?: string },
) {
  return useQuery({
    queryKey: ['bi-dashboard', 'list', organizationId, params],
    queryFn: () => fetchDashboardList(organizationId, params),
  })
}

// ─── Current ───────────────────────────────────────────────────────────────

export function useCurrentDashboard(organizationId: number) {
  return useQuery({
    queryKey: ['bi-dashboard', 'current', organizationId],
    queryFn: () => fetchCurrentDashboard(organizationId),
  })
}

// ─── Detail ────────────────────────────────────────────────────────────────

export function useDashboardDetail(organizationId: number, dashboardId: number) {
  return useQuery({
    queryKey: ['bi-dashboard', 'detail', organizationId, dashboardId],
    queryFn: () => fetchDashboardDetail(organizationId, dashboardId),
    enabled: !!dashboardId,
  })
}

// ─── Preview Mutation ──────────────────────────────────────────────────────

export function usePreviewDashboard(organizationId: number) {
  return useMutation({
    mutationFn: (payload: BiDashboardPreviewPayload) => previewDashboard(organizationId, payload),
  })
}

// ─── Create Mutation ───────────────────────────────────────────────────────

export function useCreateDashboard(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: BiDashboardCreatePayload) => createDashboard(organizationId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bi-dashboard'] })
    },
  })
}

// ─── Update Mutation ───────────────────────────────────────────────────────

export function useUpdateDashboard(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      dashboardId,
      payload,
    }: {
      dashboardId: number
      payload: BiDashboardUpdatePayload
    }) => updateDashboard(organizationId, dashboardId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bi-dashboard'] })
    },
  })
}

// ─── Copy Mutation ─────────────────────────────────────────────────────────

export function useCopyDashboard(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dashboardId: number) => copyDashboard(organizationId, dashboardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bi-dashboard'] })
    },
  })
}

// ─── Set Default Mutation ──────────────────────────────────────────────────

export function useSetDefaultDashboard(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dashboardId: number) => setDefaultDashboard(organizationId, dashboardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bi-dashboard'] })
    },
  })
}

// ─── Archive Mutation ──────────────────────────────────────────────────────

export function useArchiveDashboard(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dashboardId: number) => archiveDashboard(organizationId, dashboardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bi-dashboard'] })
    },
  })
}

// ─── Restore Mutation ──────────────────────────────────────────────────────

export function useRestoreDashboard(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dashboardId: number) => restoreDashboard(organizationId, dashboardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bi-dashboard'] })
    },
  })
}

// ─── Delete Mutation ───────────────────────────────────────────────────────

export function useDeleteDashboard(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dashboardId: number) => deleteDashboard(organizationId, dashboardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bi-dashboard'] })
    },
  })
}
