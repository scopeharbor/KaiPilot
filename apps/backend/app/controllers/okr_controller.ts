import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OkrService from '#services/okr_service'
import OkrPolicy from '#policies/okr_policy'
import {
  okrCycleCreateValidator,
  okrCycleUpdateValidator,
  okrObjectiveCreateValidator,
  okrObjectiveUpdateValidator,
  okrKeyResultCreateValidator,
  okrKeyResultUpdateValidator,
  okrProgressUpdateValidator,
  okrAlignmentCreateValidator,
  okrEvidenceLinkCreateValidator,
  okrAiDraftValidator,
  okrAiDraftConfirmationValidator,
  okrCycleListQueryValidator,
  okrObjectiveListQueryValidator,
  okrTreeQueryValidator,
  okrKeyResultListQueryValidator,
  okrEvidenceListQueryValidator,
} from '#validators/okr'
import { ValidationException } from '#exceptions/api_exception'

@inject()
export default class OkrController {
  constructor(
    private readonly okrService: OkrService,
    private readonly policy: OkrPolicy,
  ) {}

  private getOrganizationId(ctx: HttpContext): number {
    const id = Number(ctx.params.organizationId)
    if (!Number.isFinite(id) || id <= 0) {
      throw new ValidationException('无效的组织 ID')
    }
    return id
  }

  // ── Cycles ─────────────────────────────────────────────────────────────

  async listCycles({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrCycleListQueryValidator.validate(request.qs())
    const result = await this.okrService.listCycles(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  async getCycle({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const cycleId = Number(request.params().cycleId)
    const result = await this.okrService.getCycle(cycleId, auth.user!)
    return response.json(result)
  }

  async createCycle({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrCycleCreateValidator.validate(request.body())
    const result = await this.okrService.createCycle(organizationId, input as any, auth.user!)
    return response.status(201).json(result)
  }

  async updateCycle({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const cycleId = Number(request.params().cycleId)
    const input = await okrCycleUpdateValidator.validate(request.body())
    const result = await this.okrService.updateCycle(cycleId, input as any, auth.user!)
    return response.json(result)
  }

  async archiveCycle({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const cycleId = Number(request.params().cycleId)
    const result = await this.okrService.archiveCycle(cycleId, auth.user!)
    return response.json(result)
  }

  async restoreCycle({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const cycleId = Number(request.params().cycleId)
    const result = await this.okrService.restoreCycle(cycleId, auth.user!)
    return response.json(result)
  }

  // ── Objectives ─────────────────────────────────────────────────────────

  async listObjectives({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrObjectiveListQueryValidator.validate(request.qs())
    const result = await this.okrService.listObjectives(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  async getObjective({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const objectiveId = Number(request.params().objectiveId)
    const result = await this.okrService.getObjective(objectiveId, auth.user!)
    return response.json(result)
  }

  async createObjective({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrObjectiveCreateValidator.validate(request.body())
    const result = await this.okrService.createObjective(organizationId, input as any, auth.user!)
    return response.status(201).json(result)
  }

  async updateObjective({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const objectiveId = Number(request.params().objectiveId)
    const input = await okrObjectiveUpdateValidator.validate(request.body())
    const result = await this.okrService.updateObjective(objectiveId, input as any, auth.user!)
    return response.json(result)
  }

  async archiveObjective({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const objectiveId = Number(request.params().objectiveId)
    const result = await this.okrService.archiveObjective(objectiveId, auth.user!)
    return response.json(result)
  }

  async restoreObjective({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const objectiveId = Number(request.params().objectiveId)
    const result = await this.okrService.restoreObjective(objectiveId, auth.user!)
    return response.json(result)
  }

  // ── Tree ───────────────────────────────────────────────────────────────

  async getTree({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrTreeQueryValidator.validate(request.qs())
    const result = await this.okrService.getTree(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  // ── Key Results ────────────────────────────────────────────────────────

  async listKeyResults({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrKeyResultListQueryValidator.validate(request.qs())
    const result = await this.okrService.listKeyResults(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  async getKeyResult({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const krId = Number(request.params().keyResultId)
    const result = await this.okrService.getKeyResult(krId, auth.user!)
    return response.json(result)
  }

  async createKeyResult({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrKeyResultCreateValidator.validate(request.body())
    const result = await this.okrService.createKeyResult(organizationId, input as any, auth.user!)
    return response.status(201).json(result)
  }

  async updateKeyResult({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const krId = Number(request.params().keyResultId)
    const input = await okrKeyResultUpdateValidator.validate(request.body())
    const result = await this.okrService.updateKeyResult(krId, input as any, auth.user!)
    return response.json(result)
  }

  async archiveKeyResult({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const krId = Number(request.params().keyResultId)
    const result = await this.okrService.archiveKeyResult(krId, auth.user!)
    return response.json(result)
  }

  // ── Progress ───────────────────────────────────────────────────────────

  async updateProgress({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const krId = Number(request.params().keyResultId)
    const input = await okrProgressUpdateValidator.validate(request.body())
    const result = await this.okrService.updateProgress(krId, input as any, auth.user!)
    return response.json(result)
  }

  async getProgressHistory({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const krId = Number(request.params().keyResultId)
    const result = await this.okrService.getProgressHistory(krId, auth.user!)
    return response.json(result)
  }

  // ── Alignments ─────────────────────────────────────────────────────────

  async createAlignment({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrAlignmentCreateValidator.validate(request.body())
    const result = await this.okrService.createAlignment(organizationId, input as any, auth.user!)
    return response.status(201).json(result)
  }

  async removeAlignment({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const alignmentId = Number(request.params().alignmentId)
    const result = await this.okrService.removeAlignment(alignmentId, auth.user!)
    return response.json(result)
  }

  async listAlignments({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const objectiveId = Number(request.params().objectiveId)
    const result = await this.okrService.listAlignments(objectiveId, auth.user!)
    return response.json(result)
  }

  // ── Evidence ───────────────────────────────────────────────────────────

  async createEvidence({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrEvidenceLinkCreateValidator.validate(request.body())
    const result = await this.okrService.createEvidenceLink(
      organizationId,
      input as any,
      auth.user!,
    )
    return response.status(201).json(result)
  }

  async listEvidence({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrEvidenceListQueryValidator.validate(request.qs())
    const result = await this.okrService.listEvidence(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  // ── AI Draft ───────────────────────────────────────────────────────────

  async generateAiDraft({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrAiDraftValidator.validate(request.body())
    const result = await this.okrService.generateAiDraft(organizationId, input as any, auth.user!)
    return response.json(result)
  }

  async confirmAiDraft({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrAiDraftConfirmationValidator.validate(request.body())
    const result = await this.okrService.confirmAiDraft(organizationId, input as any, auth.user!)
    return response.status(201).json(result)
  }
}
