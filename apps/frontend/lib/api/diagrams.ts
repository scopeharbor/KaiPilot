import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type { DiagramSpec, DiagramType, MermaidExportResult } from '@aiproj/types'

export interface Diagram {
  id: number
  organizationId: number
  projectId: number
  type: DiagramType
  title: string
  spec: DiagramSpec
  sourceHash: string | null
  createdBy: number
  updatedBy: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DiagramListFilters {
  type?: DiagramType
  sort?: string
  page?: number
  perPage?: number
}

export interface DiagramListResponse {
  data: Diagram[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

function qs(filters: DiagramListFilters): string {
  const params = new URLSearchParams()
  if (filters.type) params.set('type', filters.type)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  const s = params.toString()
  return s ? `?${s}` : ''
}

export async function listDiagrams(
  projectId: number,
  filters: DiagramListFilters = {},
): Promise<DiagramListResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/diagrams${qs(filters)}`)
}

export async function getDiagram(diagramId: number): Promise<{ data: Diagram }> {
  return apiFetchEnvelope(`/diagrams/${diagramId}`)
}

export async function createDiagram(
  projectId: number,
  data: { type: DiagramType; title: string; spec: DiagramSpec },
): Promise<{ data: Diagram }> {
  return apiFetchEnvelope(`/projects/${projectId}/diagrams`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateDiagram(
  diagramId: number,
  data: { title?: string; spec?: DiagramSpec },
): Promise<{ data: Diagram }> {
  return apiFetchEnvelope(`/diagrams/${diagramId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteDiagram(diagramId: number): Promise<void> {
  return apiFetch(`/diagrams/${diagramId}`, { method: 'DELETE' })
}

export async function exportMermaid(diagramId: number): Promise<{ data: MermaidExportResult }> {
  return apiFetchEnvelope(`/diagrams/${diagramId}/mermaid`)
}
