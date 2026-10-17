/**
 * v3-service-architecture-expansion — architecture boundary check tests.
 * Task 4.7: focused tests for all boundary check categories using small fixture
 * code snippets rather than scanning unrelated historical code.
 */
import { describe, expect, it } from 'vitest'
import {
  checkControllerBoundary,
  checkServiceBoundary,
  checkValidatorPolicyBoundary,
  checkAdapterProviderBoundary,
  checkAuditLedgerBoundary,
  applyAllowlist,
  validateAllowlistEntries,
} from '../../../app/services/service_architecture/boundary_checker.js'
import {
  BOUNDARY_CHECK_CATEGORIES,
  ARCHITECTURE_REASON_CODES,
  type AllowlistEntry,
} from '@aiproj/types'

// ─── Inline fixture code snippets (small, representative) ───────────

const FIXTURE_CONTROLLER_VIOLATION = `
export default class ProjectsController {
  async store({ request, auth }) {
    const data = request.body()
    const project = new Project()
    project.fill(data)
    await project.save()
    const adapter = new AiAdapter()
    await adapter.generate(project)
    project.tenantId = auth.user!.tenantId
    return project
  }
}
`

const FIXTURE_CONTROLLER_CLEAN = `
export default class ProjectsController {
  async store({ request, response }) {
    const data = await this.validator.validate(request.all())
    const project = await this.service.create(data)
    return response.ok(project)
  }
}
`

const FIXTURE_SERVICE_HTTP_VIOLATION = `
export default class ProjectService {
  async create(ctx) {
    const body = ctx.request.body()
    const header = ctx.request.header('x-tenant')
    const cookie = ctx.request.cookie('session')
    ctx.response.status(201)
    return body
  }
}
`

const FIXTURE_SERVICE_CLEAN = `
export default class ProjectService {
  async create(input: CreateProjectInput) {
    return this.model.create(input)
  }
}
`

const FIXTURE_VALIDATOR_SIDE_EFFECT = `
export default class CreateProjectValidator {
  public async validate(data) {
    const db = Database.from('projects')
    await db.insert(data)
    await this.model.save()
    await this.adapter.call()
    return data
  }
}
`

const FIXTURE_VALIDATOR_CLEAN = `
export default class CreateProjectValidator {
  public async validate(data) {
    return {
      name: data.name,
      description: data.description,
    }
  }
}
`

const FIXTURE_ADAPTER_AUTHORITY_VIOLATION = `
import HttpContext from '@adonisjs/core/http_context'
export default class OcrAdapter {
  async execute(ctx) {
    const body = ctx.request.body()
    const tenantId = ctx.request.header('x-tenant')
    const allowed = await RbacService.check(ctx.user, 'ocr:execute')
    await this.model.save(body)
    console.log('prompt', body.prompt)
    return body
  }
}
`

const FIXTURE_ADAPTER_CLEAN = `
export default class OcrAdapter {
  async execute(input: OcrInput): Promise<OcrResult> {
    const response = await this.client.post('/ocr', { image: input.imageBase64 })
    return this.parseResponse(response)
  }
}
`

const FIXTURE_AUDIT_SENSITIVE = `
export default class AuditService {
  log(event) {
    return {
      prompt: event.prompt,
      modelOutput: event.modelOutput,
      rawProviderPayload: event.rawPayload,
      token: event.token,
      apiKey: event.apiKey,
      authorization: event.authorization,
      rawXml: event.rawXml,
      crossTenantDetail: event.crossTenant,
      documentBody: event.documentBody,
    }
  }
}
`

const FIXTURE_AUDIT_CLEAN = `
export default class AuditService {
  log(event) {
    return {
      actorRef: event.actorRef,
      orgRef: event.orgRef,
      resourceRef: event.resourceRef,
      eventCode: event.eventCode,
      status: event.status,
      reasonCode: event.reasonCode,
    }
  }
}
`

describe('Controller Boundary Checks (task 4.1)', () => {
  it('flags controller with business logic violations', () => {
    const findings = checkControllerBoundary(
      FIXTURE_CONTROLLER_VIOLATION,
      'app/controllers/projects_controller.ts',
      { moduleKey: 'projects' },
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(
      findings.every((f) => f.reasonCode === ARCHITECTURE_REASON_CODES.CONTROLLER_BUSINESS_LOGIC),
    ).toBe(true)
    expect(findings.every((f) => f.category === BOUNDARY_CHECK_CATEGORIES.CONTROLLER)).toBe(true)
    // Should flag save, adapter call, and tenant decision
    const messages = findings.map((f) => f.message).join(' ')
    expect(messages).toContain('save')
    expect(messages).toContain('provider')
    expect(messages).toContain('tenant')
  })

  it('does not flag clean controller', () => {
    const findings = checkControllerBoundary(
      FIXTURE_CONTROLLER_CLEAN,
      'app/controllers/projects_controller.ts',
      { moduleKey: 'projects' },
    )
    expect(findings).toHaveLength(0)
  })
})

describe('Service Boundary Checks (task 4.2)', () => {
  it('flags service with raw HTTP authority usage', () => {
    const findings = checkServiceBoundary(
      FIXTURE_SERVICE_HTTP_VIOLATION,
      'app/services/project_service.ts',
      { moduleKey: 'projects' },
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(
      findings.every((f) => f.reasonCode === ARCHITECTURE_REASON_CODES.SERVICE_HTTP_AUTHORITY),
    ).toBe(true)
    const messages = findings.map((f) => f.message).join(' ')
    expect(messages).toContain('request body')
    expect(messages).toContain('header')
    expect(messages).toContain('cookie')
    expect(messages).toContain('response')
  })

  it('does not flag clean service', () => {
    const findings = checkServiceBoundary(
      FIXTURE_SERVICE_CLEAN,
      'app/services/project_service.ts',
      { moduleKey: 'projects' },
    )
    expect(findings).toHaveLength(0)
  })
})

describe('Validator/Policy Boundary Checks (task 4.3)', () => {
  it('flags validator with side effects', () => {
    const findings = checkValidatorPolicyBoundary(
      FIXTURE_VALIDATOR_SIDE_EFFECT,
      'app/validators/create_project_validator.ts',
      { moduleKey: 'projects' },
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(
      findings.every(
        (f) => f.reasonCode === ARCHITECTURE_REASON_CODES.VALIDATOR_POLICY_SIDE_EFFECT,
      ),
    ).toBe(true)
    const messages = findings.map((f) => f.message).join(' ')
    expect(messages).toContain('database')
    expect(messages).toContain('mutation')
    expect(messages).toContain('provider')
  })

  it('does not flag clean validator', () => {
    const findings = checkValidatorPolicyBoundary(
      FIXTURE_VALIDATOR_CLEAN,
      'app/validators/create_project_validator.ts',
      { moduleKey: 'projects' },
    )
    expect(findings).toHaveLength(0)
  })
})

describe('Adapter/Provider Boundary Checks (task 4.4)', () => {
  it('flags adapter with authority smell', () => {
    const findings = checkAdapterProviderBoundary(
      FIXTURE_ADAPTER_AUTHORITY_VIOLATION,
      'app/services/adapters/ocr_adapter.ts',
      { moduleKey: 'adapters' },
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(
      findings.every((f) => f.reasonCode === ARCHITECTURE_REASON_CODES.ADAPTER_AUTHORITY_SMELL),
    ).toBe(true)
    const messages = findings.map((f) => f.message).join(' ')
    expect(messages).toContain('HTTP context')
    expect(messages).toContain('RBAC')
    expect(messages).toContain('tenant')
    expect(messages).toContain('domain')
  })

  it('does not flag clean adapter', () => {
    const findings = checkAdapterProviderBoundary(
      FIXTURE_ADAPTER_CLEAN,
      'app/services/adapters/ocr_adapter.ts',
      { moduleKey: 'adapters' },
    )
    expect(findings).toHaveLength(0)
  })
})

describe('Audit/Ledger Boundary Checks (task 4.5)', () => {
  it('rejects sensitive audit payload', () => {
    const findings = checkAuditLedgerBoundary(
      FIXTURE_AUDIT_SENSITIVE,
      'app/services/sso/sso_saml_audit_service.ts',
      { moduleKey: 'sso-saml-audit' },
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(
      findings.every((f) => f.reasonCode === ARCHITECTURE_REASON_CODES.SENSITIVE_AUDIT_PAYLOAD),
    ).toBe(true)
    const messages = findings.map((f) => f.message).join(' ')
    expect(messages).toContain('prompt')
    expect(messages).toContain('model output')
    expect(messages).toContain('token')
    expect(messages).toContain('API key')
    expect(messages).toContain('Authorization')
    expect(messages).toContain('XML')
    expect(messages).toContain('cross-tenant')
    expect(messages).toContain('document body')
  })

  it('does not flag clean audit payload', () => {
    const findings = checkAuditLedgerBoundary(
      FIXTURE_AUDIT_CLEAN,
      'app/services/sso/sso_saml_audit_service.ts',
      { moduleKey: 'sso-saml-audit' },
    )
    expect(findings).toHaveLength(0)
  })
})

describe('Allowlist Support (task 4.6)', () => {
  const validAllowlist: AllowlistEntry[] = [
    {
      id: 'health-controller-exception',
      reason: 'HealthController must read HttpContext for liveness probe',
      owner: 'platform',
      expiryOrFollowUp: 'follow-up-change-v3-controller-cleanup',
      category: BOUNDARY_CHECK_CATEGORIES.CONTROLLER,
    },
  ]

  it('suppresses findings when valid allowlist entry exists', () => {
    const findings = checkControllerBoundary(
      FIXTURE_CONTROLLER_VIOLATION,
      'app/controllers/health_controller.ts',
      { moduleKey: 'health', allowlist: validAllowlist },
    )
    expect(findings).toHaveLength(0)
  })

  it('does not suppress when allowlist entry is for a different category', () => {
    const serviceAllowlist: AllowlistEntry[] = [
      { ...validAllowlist[0], category: BOUNDARY_CHECK_CATEGORIES.SERVICE },
    ]
    const findings = checkControllerBoundary(
      FIXTURE_CONTROLLER_VIOLATION,
      'app/controllers/health_controller.ts',
      { moduleKey: 'health', allowlist: serviceAllowlist },
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it('rejects allowlist entry with missing reason', () => {
    const invalidAllowlist: AllowlistEntry[] = [
      {
        id: 'bad',
        reason: '',
        owner: 'platform',
        expiryOrFollowUp: 'ticket-1',
        category: BOUNDARY_CHECK_CATEGORIES.CONTROLLER,
      },
    ]
    const invalid = validateAllowlistEntries(invalidAllowlist)
    expect(invalid).toHaveLength(1)
    expect(invalid[0].errors.some((e) => e.includes('reason'))).toBe(true)

    // Invalid allowlist does NOT suppress findings.
    const findings = checkControllerBoundary(
      FIXTURE_CONTROLLER_VIOLATION,
      'app/controllers/health_controller.ts',
      { moduleKey: 'health', allowlist: invalidAllowlist },
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it('rejects allowlist entry with missing owner', () => {
    const invalidAllowlist: AllowlistEntry[] = [
      {
        id: 'bad',
        reason: 'framework requires it',
        owner: '',
        expiryOrFollowUp: 'ticket-1',
        category: BOUNDARY_CHECK_CATEGORIES.CONTROLLER,
      },
    ]
    const invalid = validateAllowlistEntries(invalidAllowlist)
    expect(invalid).toHaveLength(1)
    expect(invalid[0].errors.some((e) => e.includes('owner'))).toBe(true)
  })

  it('rejects allowlist entry with missing expiry', () => {
    const invalidAllowlist: AllowlistEntry[] = [
      {
        id: 'bad',
        reason: 'framework requires it',
        owner: 'platform',
        expiryOrFollowUp: '',
        category: BOUNDARY_CHECK_CATEGORIES.CONTROLLER,
      },
    ]
    const invalid = validateAllowlistEntries(invalidAllowlist)
    expect(invalid).toHaveLength(1)
    expect(invalid[0].errors.some((e) => e.includes('expiry'))).toBe(true)
  })

  it('applyAllowlist with empty allowlist returns all findings', () => {
    const findings = checkControllerBoundary(FIXTURE_CONTROLLER_VIOLATION, 'test.ts', {
      moduleKey: 'test',
    })
    const afterSuppress = applyAllowlist(findings, [])
    expect(afterSuppress.length).toBe(findings.length)
  })
})
