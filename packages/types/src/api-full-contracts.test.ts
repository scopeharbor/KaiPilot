import { describe, expect, test } from 'vitest'
import type {
  ApiAiConnectionRef,
  ApiAuditMetadata,
  ApiBatchIdsRequest,
  ApiFileDescriptorDto,
  ApiListEnvelope,
  ApiMutationAck,
  ApiNotificationDto,
  ApiPreviewCommitRequest,
  ApiResourceEnvelope,
  ApiStatusTransitionRequest,
  IdentityUserDto,
  OrganizationDto,
  OrganizationMembershipDto,
} from './api-full-contracts.js'

describe('v2-5 full API shared contracts', () => {
  test('identity and organization DTO groups are stable shared contracts', () => {
    const user: IdentityUserDto = { id: 1, email: 'pm@example.test', fullName: 'PM' }
    const organization: OrganizationDto = { id: 9, name: 'Org', ownerId: user.id }
    const membership: OrganizationMembershipDto = {
      id: 10,
      organizationId: organization.id,
      userId: user.id,
      role: 'owner',
    }
    expect(membership.organizationId).toBe(9)
  })

  test('generic envelopes and mutation DTOs cover endpoint-local SDK use', () => {
    const list: ApiListEnvelope<{ id: number }> = {
      data: [{ id: 1 }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    const resource: ApiResourceEnvelope<{ id: number }> = { data: { id: 1 } }
    const ack: ApiMutationAck = { success: true, id: 1 }
    expect(list.meta.total).toBe(resource.data.id)
    expect(ack.success).toBe(true)
  })

  test('planning, file, notification, audit, and AI helper DTOs remain low-sensitive', () => {
    const transition: ApiStatusTransitionRequest = { status: 'approved', reason: 'reviewed' }
    const batch: ApiBatchIdsRequest = { ids: [1, 2] }
    const preview: ApiPreviewCommitRequest = { previewToken: 'server-issued', commit: false }
    const file: ApiFileDescriptorDto = { id: 1, name: 'plan.pdf', mimeType: 'application/pdf' }
    const notification: ApiNotificationDto = { id: 1, title: '已更新', createdAt: '2026-01-01' }
    const audit: ApiAuditMetadata = { action: 'sdk.coverage.test', organizationId: 9 }
    const ai: ApiAiConnectionRef = { id: 1, provider: 'fixture', status: 'ok' }
    expect({ transition, batch, preview, file, notification, audit, ai }).toMatchObject({
      transition: { status: 'approved' },
      preview: { commit: false },
      ai: { provider: 'fixture' },
    })
  })
})
