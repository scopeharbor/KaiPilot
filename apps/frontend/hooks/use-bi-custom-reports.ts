/**
 * BI 自定义报表构建器 TanStack Query hooks（v3-bi-custom-report-builder §8.1）。
 *
 * 分层 query keys，覆盖 registry、definitions、preview、创建/更新/复制/默认/归档/恢复/版本历史。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listRegistry,
  previewDefinition,
  listDefinitions,
  getDefinition,
  createDefinition,
  updateDefinition,
  copyDefinition,
  setDefaultDefinition,
  archiveDefinition,
  restoreDefinition,
  listVersions,
} from '@/lib/api/bi-custom-reports'
import type {
  PreviewInput,
  CreateDefinitionInput,
  UpdateDefinitionInput,
} from '@/lib/api/bi-custom-reports'

// ─── Query Keys ────────────────────────────────────────────────────────────

export const biCustomReportKeys = {
  all: ['bi', 'custom-reports'] as const,
  registry: (orgId: number) => [...biCustomReportKeys.all, 'registry', orgId] as const,
  previews: (orgId: number) => [...biCustomReportKeys.all, 'preview', orgId] as const,
  definitions: {
    all: (orgId: number) => [...biCustomReportKeys.all, 'definitions', orgId] as const,
    lists: (orgId: number) => [...biCustomReportKeys.definitions.all(orgId), 'list'] as const,
    list: (orgId: number, params?: Record<string, unknown>) =>
      [...biCustomReportKeys.definitions.lists(orgId), params] as const,
    details: (orgId: number) => [...biCustomReportKeys.definitions.all(orgId), 'detail'] as const,
    detail: (orgId: number, definitionId: string) =>
      [...biCustomReportKeys.definitions.details(orgId), definitionId] as const,
    versions: (orgId: number, definitionId: string) =>
      [...biCustomReportKeys.definitions.detail(orgId, definitionId), 'versions'] as const,
  },
}

// ─── 只读 Hooks ─────────────────────────────────────────────────────────────

/** 数据源注册表 */
export function useBiCustomReportRegistry(orgId: number) {
  return useQuery({
    queryKey: biCustomReportKeys.registry(orgId),
    queryFn: () => listRegistry(orgId),
    staleTime: 5 * 60 * 1000, // 5min 缓存
  })
}

/** 定义列表 */
export function useBiCustomReportDefinitions(
  orgId: number,
  params?: {
    page?: number
    perPage?: number
    scope?: string
    visibility?: string
    search?: string
    sort?: string
    includeArchived?: boolean
    projectId?: number
    portfolioId?: number
  },
) {
  return useQuery({
    queryKey: biCustomReportKeys.definitions.list(orgId, params),
    queryFn: () => listDefinitions(orgId, params),
  })
}

/** 定义详情 */
export function useBiCustomReportDefinition(orgId: number, definitionId: string) {
  return useQuery({
    queryKey: biCustomReportKeys.definitions.detail(orgId, definitionId),
    queryFn: () => getDefinition(orgId, definitionId),
    enabled: !!definitionId,
  })
}

/** 版本历史 */
export function useBiCustomReportVersions(orgId: number, definitionId: string) {
  return useQuery({
    queryKey: biCustomReportKeys.definitions.versions(orgId, definitionId),
    queryFn: () => listVersions(orgId, definitionId),
    enabled: !!definitionId,
  })
}

// ─── 预览 Mutation ──────────────────────────────────────────────────────────

export function useBiCustomReportPreview(orgId: number) {
  return useMutation({
    mutationFn: (input: PreviewInput) => previewDefinition(orgId, input),
  })
}

// ─── 创建 Mutation ──────────────────────────────────────────────────────────

export function useCreateBiCustomReport(orgId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateDefinitionInput) => createDefinition(orgId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: biCustomReportKeys.definitions.lists(orgId) })
    },
  })
}

// ─── 更新 Mutation ──────────────────────────────────────────────────────────

export function useUpdateBiCustomReport(orgId: number, definitionId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateDefinitionInput) => updateDefinition(orgId, definitionId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: biCustomReportKeys.definitions.detail(orgId, definitionId),
      })
      queryClient.invalidateQueries({ queryKey: biCustomReportKeys.definitions.lists(orgId) })
      queryClient.invalidateQueries({
        queryKey: biCustomReportKeys.definitions.versions(orgId, definitionId),
      })
    },
  })
}

// ─── 复制 Mutation ──────────────────────────────────────────────────────────

export function useCopyBiCustomReport(orgId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      definitionId,
      input,
    }: {
      definitionId: string
      input?: { title?: string; scope?: string; visibility?: string }
    }) => copyDefinition(orgId, definitionId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: biCustomReportKeys.definitions.lists(orgId) })
    },
  })
}

// ─── 设为默认 Mutation ──────────────────────────────────────────────────────

export function useSetDefaultBiCustomReport(orgId: number, definitionId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (expectedVersion: number) =>
      setDefaultDefinition(orgId, definitionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: biCustomReportKeys.definitions.lists(orgId) })
      queryClient.invalidateQueries({
        queryKey: biCustomReportKeys.definitions.detail(orgId, definitionId),
      })
    },
  })
}

// ─── 归档 Mutation ──────────────────────────────────────────────────────────

export function useArchiveBiCustomReport(orgId: number, definitionId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (expectedVersion: number) =>
      archiveDefinition(orgId, definitionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: biCustomReportKeys.definitions.lists(orgId) })
      queryClient.invalidateQueries({
        queryKey: biCustomReportKeys.definitions.detail(orgId, definitionId),
      })
    },
  })
}

// ─── 恢复 Mutation ──────────────────────────────────────────────────────────

export function useRestoreBiCustomReport(orgId: number, definitionId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (expectedVersion: number) =>
      restoreDefinition(orgId, definitionId, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: biCustomReportKeys.definitions.lists(orgId) })
      queryClient.invalidateQueries({
        queryKey: biCustomReportKeys.definitions.detail(orgId, definitionId),
      })
    },
  })
}
