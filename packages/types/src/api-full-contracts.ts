// v2-5-typescript-sdk-full-api-coverage -- broad shared API DTO groups.
//
// These are low-risk cross-client contracts used by SDK full coverage. They describe
// stable API envelopes, references, common timestamps, and domain-neutral request shapes.

export type ApiId = number
export type ApiTimestamp = string
export type ApiNullableTimestamp = ApiTimestamp | null

export interface ApiEntityRef {
  id: ApiId
  name?: string | null
}

export interface ApiActorRef {
  id: ApiId
  email?: string | null
  fullName?: string | null
}

export interface ApiAuditMetadata {
  action: string
  actorId?: ApiId | null
  organizationId?: ApiId | null
  projectId?: ApiId | null
  createdAt?: ApiTimestamp
}

export interface ApiPaginationQuery {
  page?: number
  perPage?: number
  sort?: string
}

export interface ApiSearchQuery extends ApiPaginationQuery {
  search?: string
}

export interface ApiMutationAck {
  success: boolean
  id?: ApiId
  message?: string
}

export interface IdentityUserDto {
  id: ApiId
  email: string
  fullName: string | null
  role?: string | null
  organizationId?: ApiId | null
  createdAt?: ApiNullableTimestamp
  updatedAt?: ApiNullableTimestamp
}

export interface OrganizationDto {
  id: ApiId
  name: string
  ownerId?: ApiId | null
  createdAt?: ApiNullableTimestamp
  updatedAt?: ApiNullableTimestamp
}

export interface OrganizationMembershipDto {
  id: ApiId
  organizationId: ApiId
  userId: ApiId
  role: string
  status?: string
}

export interface ApiListEnvelope<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface ApiResourceEnvelope<T> {
  data: T
}

export interface ApiStatusTransitionRequest {
  status: string
  reason?: string
}

export interface ApiBatchIdsRequest {
  ids: ApiId[]
}

export interface ApiPreviewCommitRequest {
  previewToken?: string
  commit?: boolean
}

export interface ApiFileDescriptorDto {
  id: ApiId
  name: string
  mimeType?: string | null
  sizeBytes?: number | null
  createdAt?: ApiNullableTimestamp
}

export interface ApiNotificationDto {
  id: ApiId
  title: string
  body?: string | null
  readAt?: ApiNullableTimestamp
  createdAt: ApiTimestamp
}

export interface ApiAiConnectionRef {
  id: ApiId
  provider: string
  model?: string | null
  status?: string | null
}
