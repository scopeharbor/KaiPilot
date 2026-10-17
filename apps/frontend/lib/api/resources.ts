import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

export type ResourceType = 'human' | 'material' | 'equipment' | 'budget'
export type ResourceRole = 'owner' | 'project_manager' | 'team_lead' | 'member' | 'viewer'
export type ResourceStatus = 'active' | 'inactive'
export type AllocationType = 'assigned' | 'allocated' | 'reserved'
export type ResourceLoadStatus = 'idle' | 'available' | 'full' | 'overloaded' | 'unavailable'
export type ResourceRequirementPriority = 'low' | 'medium' | 'high' | 'critical'
export type ResourceRequirementStatus = 'open' | 'matched' | 'fulfilled' | 'cancelled'
export type ResourceRequirementSourceKind =
  'manual' | 'compiler' | 'ai_candidate' | 'rule_suggestion'
export type AvailabilityExceptionStatus = 'planned' | 'confirmed' | 'cancelled'

export interface Resource {
  id: number
  projectId: number
  userId: number | null
  name: string
  email: string | null
  resourceType: ResourceType
  role: ResourceRole
  status: ResourceStatus
  dailyCapacityHours: number
  skillTags: string | null
  workDays: string
  timezone: string
  costPerUnitCents: number | null
  createdAt: string
  updatedAt: string | null
}

export interface ResourceAllocation {
  id: number
  resourceId: number
  taskId: number
  allocationType: AllocationType
  allocationPercent: number
  startDate: string | null
  endDate: string | null
  plannedUnits: number | null
  actualUnits: number | null
  createdAt: string
  updatedAt: string | null
}

export interface ResourcePlanningFilters {
  from: string
  to: string
  resourceId?: number
  role?: string
  skill?: string
  resourceStatus?: ResourceStatus
  loadStatus?: ResourceLoadStatus
}

export interface ResourcePlanningDay {
  date: string
  capacityHours: number
  allocatedHours: number
  remainingHours: number
  loadPercent: number
  loadStatus: ResourceLoadStatus
  conflictFlags: string[]
}

export interface ResourceMatrixRow {
  resourceId: number
  resourceName: string
  resourceType: ResourceType
  role: string
  status: ResourceStatus
  skillTags: string[]
  totalCapacityHours: number
  totalAllocatedHours: number
  totalRemainingHours: number
  utilizationPercent: number
  loadStatus: ResourceLoadStatus
  days: ResourcePlanningDay[]
}

export interface ResourcePlanningResult {
  from: string
  to: string
  summary: {
    totalResources: number
    activeResources: number
    totalCapacityHours: number
    totalAllocatedHours: number
    totalRemainingHours: number
    averageUtilizationPercent: number
    overloadedResources: number
    unavailableAllocations: number
    unmetRequirements: number
  }
  matrix: ResourceMatrixRow[]
  roleAggregates: Array<{ role: string; resourceCount: number; capacityHours: number }>
  skillAggregates: Array<{ skill: string; resourceCount: number; capacityHours: number }>
  trend: Array<{
    date: string
    capacityHours: number
    allocatedHours: number
    utilizationPercent: number
  }>
}

export interface TaskResourceRequirement {
  id: number
  organizationId: number
  projectId: number
  taskId: number
  role: string
  skillTags: string[]
  allocationPercent: number | null
  estimatedPersonDays: number | null
  startDate: string
  endDate: string
  priority: ResourceRequirementPriority
  status: ResourceRequirementStatus
  sourceKind: ResourceRequirementSourceKind
  sourceRef: string | null
  createdBy: number | null
  createdAt: string
  updatedAt: string | null
}

export interface TaskResourceRequirementFilters {
  taskId?: number
  role?: string
  status?: ResourceRequirementStatus
  from?: string
  to?: string
  page?: number
  perPage?: number
}

export interface CreateTaskResourceRequirementInput {
  taskId: number
  role: string
  skillTags?: string[]
  allocationPercent?: number | null
  estimatedPersonDays?: number | null
  startDate: string
  endDate: string
  priority?: ResourceRequirementPriority
  status?: ResourceRequirementStatus
  sourceKind?: ResourceRequirementSourceKind
  sourceRef?: string | null
}

export type UpdateTaskResourceRequirementInput = Partial<CreateTaskResourceRequirementInput>

export interface PaginatedRequirements {
  data: TaskResourceRequirement[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ResourceConflict {
  type: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  resourceId?: number | null
  taskId?: number | null
  requirementId?: number | null
  date?: string | null
  message: string
}

/** 资源冲突类型 code → 简体中文标签，对齐后端 ResourceConflictService 全部 code。 */
export const RESOURCE_CONFLICT_TYPE_LABELS: Record<string, string> = {
  overload: '分配比例超载',
  unavailable_allocation: '不可用期间分配',
  requirement_gap: '需求缺口',
  allocation_window_overflow: '分配窗口超出任务日期',
  illegal_reference: '非法资源引用',
}

/** 冲突类型渲染：命中映射返回中文标签，未知 code 兜底显示原始码。 */
export function resourceConflictTypeLabel(type: string | null | undefined): string {
  if (!type) return ''
  return RESOURCE_CONFLICT_TYPE_LABELS[type] ?? type
}

export interface PaginatedResourceConflicts {
  data: ResourceConflict[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ResourceMatchCandidate {
  resourceId: number
  resourceName: string
  role: string
  skillTags: string[]
  score: number
  availableCapacityHours: number
  requiredCapacityHours: number
  conflictSummary: string[]
  explanations: string[]
}

export interface ResourceMatchResult {
  requirementId: number
  taskId: number
  from: string
  to: string
  candidates: ResourceMatchCandidate[]
  meta: { totalCandidates: number; generatedAt: string; writesApplied: false }
}

export interface ResourceAvailabilityException {
  id: number
  organizationId: number
  projectId: number
  resourceId: number
  startDate: string
  endDate: string
  capacityOverrideHours: number
  reason: string
  status: AvailabilityExceptionStatus
  auditLogId: number | null
  createdBy: number | null
  createdAt: string
  updatedAt: string | null
}

export interface CreateAvailabilityExceptionInput {
  startDate: string
  endDate: string
  capacityOverrideHours: number
  reason: string
  status?: AvailabilityExceptionStatus
}

export type UpdateAvailabilityExceptionInput = Partial<CreateAvailabilityExceptionInput>

export interface PaginatedAvailabilityExceptions {
  data: ResourceAvailabilityException[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ResourceSuggestionOperation {
  id: string
  type:
    | 'create_requirement'
    | 'update_requirement'
    | 'delete_requirement'
    | 'create_resource_allocation'
  entityType: 'task_resource_requirement' | 'resource_allocation'
  action: 'create' | 'update' | 'delete'
  requirementId?: number
  resourceId?: number
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  input?: Record<string, unknown>
}

export interface ResourceSuggestionPreviewInput {
  requirementOperations?: Array<{
    type: 'create_requirement' | 'update_requirement' | 'delete_requirement'
    requirementId?: number
    input?: Record<string, unknown>
  }>
  allocationCandidates?: Array<{ requirementId: number; resourceId?: number }>
  from?: string
  to?: string
}

export interface ResourceSuggestionPreview {
  previewHash: string
  operations: ResourceSuggestionOperation[]
  diff: { creates: number; updates: number; deletes: number }
  deterministicFacts: {
    source: string
    generatedAt: string
    writesApplied: false
    trustedClientComputedLoadFields: false
    window: { from: string; to: string }
    summary: ResourcePlanningResult['summary']
  }
  evidence?: {
    compilerRunId: number
    artifactId: string | null
    kind: string
    summaryLevel: string | null
  }
}

export interface PaginatedResources {
  data: Resource[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface PaginatedAllocations {
  data: ResourceAllocation[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ResourceListFilters {
  resourceType?: ResourceType
  status?: ResourceStatus
  role?: ResourceRole
  search?: string
  sort?: string
  page?: number
  perPage?: number
}

export interface CreateResourceInput {
  name: string
  email?: string | null
  resourceType?: ResourceType
  role?: ResourceRole
  status?: ResourceStatus
  dailyCapacityHours?: number
  skillTags?: string[]
  workDays?: number[]
  timezone?: string
  costPerUnitCents?: number | null
  userId?: number | null
}

export type UpdateResourceInput = Partial<CreateResourceInput>

export interface CreateAllocationInput {
  taskId: number
  allocationType?: AllocationType
  allocationPercent?: number
  startDate?: string
  endDate?: string
  plannedUnits?: number | null
  actualUnits?: number | null
}

export type UpdateAllocationInput = Partial<CreateAllocationInput>

export interface ResourceLoadFilters {
  from: string
  to: string
  view?: 'personal' | 'team' | 'trend'
  resourceId?: number
}

export interface DateAllocationSummary {
  date: string
  totalAllocatedPercent: number
  allocatedHours: number
  capacityHours: number
}

export interface ResourceLoadItem {
  resourceId: number
  resourceName: string
  role: string
  dailyCapacityHours: number
  days: DateAllocationSummary[]
  overallUtilizationPercent: number
}

export interface ResourceLoadResult {
  from: string
  to: string
  resources: ResourceLoadItem[]
  teamAverageUtilizationPercent: number
}

export interface TrendDay {
  date: string
  totalHours: number
  capacityHours: number
  utilizationPercent: number
}

export interface TrendResult {
  from: string
  to: string
  totalResources: number
  days: TrendDay[]
}

function buildQuery(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  return query.size ? `?${query.toString()}` : ''
}

const projectResources = (projectId: number) => `/projects/${projectId}/resources`
const projectAllocations = (projectId: number, resourceId: number) =>
  `/projects/${projectId}/resources/${resourceId}/allocations`

export const resourcesApi = {
  list: (projectId: number, filters: ResourceListFilters = {}) =>
    apiFetchEnvelope<PaginatedResources>(
      `${projectResources(projectId)}${buildQuery(filters as Record<string, string | number | undefined>)}`,
    ),
  get: (projectId: number, resourceId: number) =>
    apiFetch<{ data: Resource & { allocations: ResourceAllocation[] } }>(
      `${projectResources(projectId)}/${resourceId}`,
    ),
  create: (projectId: number, input: CreateResourceInput) =>
    apiFetch<Resource>(projectResources(projectId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (projectId: number, resourceId: number, input: UpdateResourceInput) =>
    apiFetch<Resource>(`${projectResources(projectId)}/${resourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (projectId: number, resourceId: number) =>
    apiFetch<void>(`${projectResources(projectId)}/${resourceId}`, { method: 'DELETE' }),
  load: (projectId: number, filters: ResourceLoadFilters) =>
    apiFetch<ResourceLoadResult | TrendResult>(
      `${projectResources(projectId)}/load${buildQuery(filters as unknown as Record<string, unknown>)}`,
    ),
  planning: (projectId: number, filters: ResourcePlanningFilters) =>
    apiFetch<ResourcePlanningResult>(
      `${projectResources(projectId)}/planning${buildQuery(filters as unknown as Record<string, unknown>)}`,
    ),
  conflicts: (projectId: number, filters: ResourcePlanningFilters) =>
    apiFetchEnvelope<PaginatedResourceConflicts>(
      `${projectResources(projectId)}/conflicts${buildQuery(filters as unknown as Record<string, unknown>)}`,
    ),
  requirements: (projectId: number, filters: TaskResourceRequirementFilters = {}) =>
    apiFetchEnvelope<PaginatedRequirements>(
      `${projectResources(projectId)}/requirements${buildQuery(filters as unknown as Record<string, unknown>)}`,
    ),
  createRequirement: (projectId: number, input: CreateTaskResourceRequirementInput) =>
    apiFetch<TaskResourceRequirement>(`${projectResources(projectId)}/requirements`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateRequirement: (
    projectId: number,
    requirementId: number,
    input: UpdateTaskResourceRequirementInput,
  ) =>
    apiFetch<TaskResourceRequirement>(
      `${projectResources(projectId)}/requirements/${requirementId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    ),
  deleteRequirement: (projectId: number, requirementId: number) =>
    apiFetch<void>(`${projectResources(projectId)}/requirements/${requirementId}`, {
      method: 'DELETE',
    }),
  matchRequirement: (projectId: number, requirementId: number, limit = 5) =>
    apiFetch<ResourceMatchResult>(
      `${projectResources(projectId)}/requirements/${requirementId}/matches${buildQuery({ limit })}`,
    ),
  previewSuggestions: (projectId: number, input: ResourceSuggestionPreviewInput) =>
    apiFetch<ResourceSuggestionPreview>(`${projectResources(projectId)}/suggestions/preview`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  applySuggestions: (
    projectId: number,
    input: { confirm: true; previewHash: string; operations: ResourceSuggestionOperation[] },
  ) =>
    apiFetch<{
      previewHash: string
      applied: Array<{ operationId: string; entityType: string; entityId?: number }>
      meta: {
        writesApplied: true
        appliedAt: string
        evidence?: {
          compilerRunId: number
          artifactId: string | null
          kind: string
          summaryLevel: string | null
        }
      }
    }>(`${projectResources(projectId)}/suggestions/apply`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

export const allocationsApi = {
  list: (
    projectId: number,
    resourceId: number,
    filters: { allocationType?: AllocationType; page?: number; perPage?: number } = {},
  ) =>
    apiFetchEnvelope<PaginatedAllocations>(
      `${projectAllocations(projectId, resourceId)}${buildQuery(filters as Record<string, string | number | undefined>)}`,
    ),
  create: (projectId: number, resourceId: number, input: CreateAllocationInput) =>
    apiFetch<ResourceAllocation>(projectAllocations(projectId, resourceId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (
    projectId: number,
    resourceId: number,
    allocationId: number,
    input: UpdateAllocationInput,
  ) =>
    apiFetch<ResourceAllocation>(`${projectAllocations(projectId, resourceId)}/${allocationId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (projectId: number, resourceId: number, allocationId: number) =>
    apiFetch<void>(`${projectAllocations(projectId, resourceId)}/${allocationId}`, {
      method: 'DELETE',
    }),
}

export const resourceKeys = {
  all: ['resources'] as const,
  lists: (projectId: number) => [...resourceKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: ResourceListFilters) =>
    [...resourceKeys.lists(projectId), filters] as const,
  details: () => [...resourceKeys.all, 'detail'] as const,
  detail: (projectId: number, resourceId: number) =>
    [...resourceKeys.details(), projectId, resourceId] as const,
  load: (projectId: number, filters: ResourceLoadFilters) =>
    [...resourceKeys.all, 'load', projectId, filters] as const,
}

export const allocationKeys = {
  all: ['allocations'] as const,
  lists: (projectId: number, resourceId: number) =>
    [...allocationKeys.all, 'list', projectId, resourceId] as const,
  list: (projectId: number, resourceId: number, filters: { allocationType?: string }) =>
    [...allocationKeys.lists(projectId, resourceId), filters] as const,
}

export const availabilityApi = {
  list: (
    projectId: number,
    resourceId: number,
    filters: {
      from?: string
      to?: string
      status?: AvailabilityExceptionStatus
      page?: number
      perPage?: number
    } = {},
  ) =>
    apiFetchEnvelope<PaginatedAvailabilityExceptions>(
      `${projectResources(projectId)}/${resourceId}/availability-exceptions${buildQuery(filters)}`,
    ),
  create: (projectId: number, resourceId: number, input: CreateAvailabilityExceptionInput) =>
    apiFetch<ResourceAvailabilityException>(
      `${projectResources(projectId)}/${resourceId}/availability-exceptions`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  update: (
    projectId: number,
    resourceId: number,
    exceptionId: number,
    input: UpdateAvailabilityExceptionInput,
  ) =>
    apiFetch<ResourceAvailabilityException>(
      `${projectResources(projectId)}/${resourceId}/availability-exceptions/${exceptionId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  delete: (projectId: number, resourceId: number, exceptionId: number) =>
    apiFetch<void>(
      `${projectResources(projectId)}/${resourceId}/availability-exceptions/${exceptionId}`,
      { method: 'DELETE' },
    ),
}

export const requirementKeys = {
  all: ['resource-requirements'] as const,
  lists: (projectId: number) => [...requirementKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: TaskResourceRequirementFilters) =>
    [...requirementKeys.lists(projectId), filters] as const,
  matches: (projectId: number, requirementId: number) =>
    [...requirementKeys.all, 'matches', projectId, requirementId] as const,
}

export const resourcePlanningKeys = {
  all: ['resource-planning'] as const,
  planning: (projectId: number, filters: ResourcePlanningFilters) =>
    [...resourcePlanningKeys.all, 'planning', projectId, filters] as const,
  conflicts: (projectId: number, filters: ResourcePlanningFilters) =>
    [...resourcePlanningKeys.all, 'conflicts', projectId, filters] as const,
  suggestions: (projectId: number) =>
    [...resourcePlanningKeys.all, 'suggestions', projectId] as const,
}

export const availabilityKeys = {
  all: ['resource-availability'] as const,
  list: (projectId: number, resourceId: number) =>
    [...availabilityKeys.all, 'list', projectId, resourceId] as const,
}
