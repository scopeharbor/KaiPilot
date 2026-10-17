'use client'

// 跨项目依赖 CRUD TanStack Query hooks（v3-multi-project-dependency-crud §8.2）。

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mpdApi, mpdKeys } from '@/lib/api/multi-project-dependencies'
import type {
  DepListFilters,
  DepCreatePreviewInput,
  DepUpdatePreviewInput,
  DepConfirmRequest,
  MultiProjectGraphQuery,
} from '@aiproj/types'

// ── 列表 ──

export function useMpdList(organizationId: number | string, filters?: DepListFilters) {
  return useQuery({
    queryKey: mpdKeys.list(organizationId, filters),
    queryFn: () => mpdApi.list(organizationId, filters),
  })
}

// ── 详情 ──

export function useMpdDetail(organizationId: number | string, depId: string | null) {
  return useQuery({
    queryKey: mpdKeys.detail(organizationId, depId!),
    queryFn: () => mpdApi.detail(organizationId, depId!),
    enabled: !!depId,
  })
}

// ── 创建 ──

export function useMpdCreatePreview(organizationId: number | string) {
  return useMutation({
    mutationFn: (body: DepCreatePreviewInput) => mpdApi.previewCreate(organizationId, body),
  })
}

export function useMpdConfirmCreate(organizationId: number | string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DepConfirmRequest) => mpdApi.confirmCreate(organizationId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mpdKeys.all(organizationId) })
    },
  })
}

// ── 更新 ──

export function useMpdUpdatePreview(organizationId: number | string) {
  return useMutation({
    mutationFn: (body: DepUpdatePreviewInput) => mpdApi.previewUpdate(organizationId, body),
  })
}

export function useMpdConfirmUpdate(organizationId: number | string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DepConfirmRequest) => mpdApi.confirmUpdate(organizationId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mpdKeys.all(organizationId) })
    },
  })
}

// ── 归档 ──

export function useMpdArchivePreview(organizationId: number | string) {
  return useMutation({
    mutationFn: (depId: string) => mpdApi.previewArchive(organizationId, depId),
  })
}

export function useMpdConfirmArchive(organizationId: number | string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DepConfirmRequest) => mpdApi.confirmArchive(organizationId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mpdKeys.all(organizationId) })
    },
  })
}

// ── 恢复 ──

export function useMpdRestorePreview(organizationId: number | string) {
  return useMutation({
    mutationFn: (depId: string) => mpdApi.previewRestore(organizationId, depId),
  })
}

export function useMpdConfirmRestore(organizationId: number | string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DepConfirmRequest) => mpdApi.confirmRestore(organizationId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mpdKeys.all(organizationId) })
    },
  })
}

// ── 删除 ──

export function useMpdDeletePreview(organizationId: number | string) {
  return useMutation({
    mutationFn: (depId: string) => mpdApi.previewDelete(organizationId, depId),
  })
}

export function useMpdConfirmDelete(organizationId: number | string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DepConfirmRequest) => mpdApi.confirmDelete(organizationId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mpdKeys.all(organizationId) })
    },
  })
}

// ── 图谱 ──

/**
 * 图谱查询 hook。
 * 仅在 feature flag 启用且有 organizationId 时启用。
 * 支持稳定 query key、错误传播、与 CRUD 写入的 invalidation 兼容。
 */
export function useMpdGraph(
  organizationId: number | string | null,
  query: MultiProjectGraphQuery | null,
  enabled = true,
) {
  return useQuery({
    queryKey: mpdKeys.graph(organizationId!, query ?? undefined),
    queryFn: () => mpdApi.graph(organizationId!, query!),
    enabled: !!organizationId && !!query && enabled,
    staleTime: 60_000, // 1 分钟内不重新请求
  })
}
