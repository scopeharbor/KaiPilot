/**
 * plugin-template-pack-fixtures —— 模板包正例与负例测试夹具。
 */

import { type TemplatePackPayload, PILOT_TEMPLATE_PACK_PAYLOAD } from './plugin-template-pack.js'

export const VALID_TEMPLATE_PACK_FIXTURE: TemplatePackPayload = {
  ...PILOT_TEMPLATE_PACK_PAYLOAD,
}

const baseTemplate0 = VALID_TEMPLATE_PACK_FIXTURE.templates[0]!
const baseTemplate1 = VALID_TEMPLATE_PACK_FIXTURE.templates[1]!
const baseChart0 = baseTemplate0.composition!.charts[0]!

export const NEGATIVE_TEMPLATE_PACK_FIXTURES = {
  unknownDomain: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    domain: 'unknown-domain' as any,
  },
  invalidSemver: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    version: '1.0',
  },
  unallowedPayloadField: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    maliciousField: 'exploit',
  },
  invalidIdPrefix: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        templateId: 'bad_prefix_overview',
      },
    ],
  },
  duplicateTemplateId: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        templateId: 'ptpl_duplicate_id',
      },
      {
        ...baseTemplate1,
        templateId: 'ptpl_duplicate_id',
      },
    ],
  },
  danglingDataSourceKey: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        composition: {
          ...baseTemplate0.composition,
          dataSourceKeys: ['non_existent_datasource_key' as any],
        },
      },
    ],
  },
  idConflictBuiltin: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        templateId: 'project_execution_overview',
      },
    ],
  },
  sqlInjectionInName: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        name: 'SELECT * FROM organizations WHERE id = 1',
      },
    ],
  },
  externalUrlInDescription: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        description: 'Read documentation at https://external-leak.com/docs',
      },
    ],
  },
  scriptInChartTitle: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        composition: {
          ...baseTemplate0.composition,
          charts: [
            {
              ...baseChart0,
              title: '<script>alert("xss")</script>',
            },
          ],
        },
      },
    ],
  },
  secretInDescription: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    description: 'sk-123456789012345678901234567890abcdef',
  },
  countLimitExceeded: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: Array.from({ length: 21 }, (_, i) => ({
      ...baseTemplate0,
      templateId: `ptpl_item_${i + 1}`,
      name: `Template ${i + 1}`,
    })),
  },
  unallowedEntryField: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        extraFieldForbidden: true,
      } as any,
    ],
  },
  invalidCategoryEnum: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [
      {
        ...baseTemplate0,
        category: 'unsupported_category' as any,
      },
    ],
  },
  emptyTemplates: {
    ...VALID_TEMPLATE_PACK_FIXTURE,
    templates: [],
  },
}
