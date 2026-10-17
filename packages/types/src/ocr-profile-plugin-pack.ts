/** Declarative OCR profile plugin pack contract (no provider or executable authority). */
export const PLUGIN_SEAM_OCR_PROFILE = 'ocr-profile.content-bundle' as const
export const OCR_PLUGIN_PROFILE_REF_PATTERN =
  /^plugin:[a-z0-9]+(?:[.-][a-z0-9]+)+\/[a-z][a-z0-9_-]{1,63}$/

export type OcrPluginProfileSource = 'builtin' | 'plugin' | 'organization'
export type OcrReviewComponentKey =
  'field-list' | 'table-grid' | 'entity-links' | 'confidence-badge'

export interface OcrPluginFieldDefinition {
  key: string
  label: string
  type: 'string' | 'number' | 'date' | 'boolean'
  required?: boolean
}

export interface OcrPluginEntityDefinition {
  key: string
  label: string
  entityType: 'task' | 'wbs_node' | 'milestone' | 'risk' | 'project_member' | 'project' | 'file'
  matchFields: readonly string[]
}

export interface OcrPluginReviewGroup {
  key: string
  label: string
  component: OcrReviewComponentKey
  fieldKeys: readonly string[]
}

export interface OcrPluginProfileDefinition {
  profileKey: string
  name: string
  version: string
  description?: string
  fields: readonly OcrPluginFieldDefinition[]
  entities?: readonly OcrPluginEntityDefinition[]
  review: { groups: readonly OcrPluginReviewGroup[] }
}

export interface OcrProfilePluginPackPayload {
  schemaVersion: '1.0'
  profiles: readonly OcrPluginProfileDefinition[]
}

export interface OcrProfilePluginFinding {
  code:
    | 'ocr-profile-schema-invalid'
    | 'ocr-profile-unknown-field'
    | 'ocr-profile-duplicate-key'
    | 'ocr-profile-executable-content'
    | 'ocr-profile-provider-override'
    | 'ocr-profile-sensitive-content'
    | 'ocr-profile-limit-exceeded'
    | 'ocr-profile-review-component-unknown'
  severity: 'blocking' | 'warning'
  path: string
  message: string
}

export interface OcrProfilePluginValidationResult {
  valid: boolean
  findings: readonly OcrProfilePluginFinding[]
  normalizedPayload?: OcrProfilePluginPackPayload
  digest?: string
}

export interface OcrProfileProjection {
  profileRef: string
  source: OcrPluginProfileSource
  name: string
  version: string
  description?: string
  pluginRef?: { pluginId: string; pluginVersion: string; payloadDigest: string }
  schemaSnapshot: {
    fields: readonly OcrPluginFieldDefinition[]
    entities: readonly OcrPluginEntityDefinition[]
  }
  reviewSnapshot: { groups: readonly OcrPluginReviewGroup[] }
}

const PACK_KEYS = new Set(['schemaVersion', 'profiles'])
const PROFILE_KEYS = new Set([
  'profileKey',
  'name',
  'version',
  'description',
  'fields',
  'entities',
  'review',
])
const FIELD_KEYS = new Set(['key', 'label', 'type', 'required'])
const ENTITY_KEYS = new Set(['key', 'label', 'entityType', 'matchFields'])
const REVIEW_KEYS = new Set(['groups'])
const GROUP_KEYS = new Set(['key', 'label', 'component', 'fieldKeys'])
const COMPONENTS: readonly OcrReviewComponentKey[] = [
  'field-list',
  'table-grid',
  'entity-links',
  'confidence-badge',
]
const SENSITIVE = /secret|token|password|api[_-]?key|credential|authorization/i
const EXECUTABLE =
  /<script|javascript:|https?:\/\/|(?:^|[.])(js|tsx?|html)$|prompt|provider|model|sql|webhook/i

function stable(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function hash(input: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(16).padStart(8, '0')
}

export function computeOcrProfilePackDigest(payload: OcrProfilePluginPackPayload): string {
  return `sha256:${hash(stable(normalizeOcrProfilePack(payload)))}`
}

export function makePluginOcrProfileRef(pluginId: string, profileKey: string): string {
  return `plugin:${pluginId}/${profileKey}`
}

export function isPluginOcrProfileRef(value: unknown): value is string {
  return typeof value === 'string' && OCR_PLUGIN_PROFILE_REF_PATTERN.test(value)
}

function normalizeOcrProfilePack(
  payload: OcrProfilePluginPackPayload,
): OcrProfilePluginPackPayload {
  return {
    schemaVersion: '1.0',
    profiles: [...payload.profiles]
      .map((profile) => ({
        profileKey: profile.profileKey.trim(),
        name: profile.name.trim(),
        version: profile.version.trim(),
        ...(profile.description ? { description: profile.description.trim() } : {}),
        fields: [...profile.fields]
          .map((field) => ({ ...field, key: field.key.trim(), label: field.label.trim() }))
          .sort((a, b) => a.key.localeCompare(b.key)),
        entities: [...(profile.entities ?? [])]
          .map((entity) => ({
            ...entity,
            key: entity.key.trim(),
            label: entity.label.trim(),
            matchFields: [...entity.matchFields].sort(),
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
        review: {
          groups: [...profile.review.groups]
            .map((group) => ({
              ...group,
              key: group.key.trim(),
              label: group.label.trim(),
              fieldKeys: [...group.fieldKeys].sort(),
            }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        },
      }))
      .sort((a, b) => a.profileKey.localeCompare(b.profileKey)),
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function validateOcrProfilePluginPack(input: unknown): OcrProfilePluginValidationResult {
  const findings: OcrProfilePluginFinding[] = []
  const add = (code: OcrProfilePluginFinding['code'], path: string, message: string) =>
    findings.push({ code, severity: 'blocking', path, message })
  const closed = (value: Record<string, unknown>, allowed: Set<string>, path: string) => {
    for (const key of Object.keys(value))
      if (!allowed.has(key))
        add('ocr-profile-unknown-field', `${path}.${key}`, 'Unknown field is not allowed')
  }
  if (!object(input))
    return {
      valid: false,
      findings: [
        {
          code: 'ocr-profile-schema-invalid',
          severity: 'blocking',
          path: '$',
          message: 'Payload must be an object',
        },
      ],
    }
  closed(input, PACK_KEYS, '$')
  if (input.schemaVersion !== '1.0' || !Array.isArray(input.profiles))
    add('ocr-profile-schema-invalid', '$', 'schemaVersion=1.0 and profiles are required')
  if (
    JSON.stringify(input).length > 128 * 1024 ||
    (Array.isArray(input.profiles) && input.profiles.length > 32)
  )
    add('ocr-profile-limit-exceeded', '$', 'Pack exceeds bounded size/count')
  const seenProfiles = new Set<string>()
  for (const [profileIndex, rawProfile] of (Array.isArray(input.profiles)
    ? input.profiles
    : []
  ).entries()) {
    const path = `profiles.${profileIndex}`
    if (!object(rawProfile)) {
      add('ocr-profile-schema-invalid', path, 'Profile must be an object')
      continue
    }
    closed(rawProfile, PROFILE_KEYS, path)
    const profileKey = typeof rawProfile.profileKey === 'string' ? rawProfile.profileKey : ''
    if (
      !/^[a-z][a-z0-9_-]{1,63}$/.test(profileKey) ||
      typeof rawProfile.name !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(String(rawProfile.version ?? '')) ||
      !Array.isArray(rawProfile.fields) ||
      !object(rawProfile.review)
    )
      add('ocr-profile-schema-invalid', path, 'Invalid profile identity/schema')
    if (seenProfiles.has(profileKey))
      add('ocr-profile-duplicate-key', `${path}.profileKey`, 'Duplicate profile key')
    seenProfiles.add(profileKey)
    const seenFields = new Set<string>()
    for (const [fieldIndex, rawField] of (Array.isArray(rawProfile.fields)
      ? rawProfile.fields
      : []
    ).entries()) {
      if (!object(rawField)) {
        add('ocr-profile-schema-invalid', `${path}.fields.${fieldIndex}`, 'Field must be an object')
        continue
      }
      closed(rawField, FIELD_KEYS, `${path}.fields.${fieldIndex}`)
      const fieldKey = typeof rawField.key === 'string' ? rawField.key : ''
      if (
        !/^[a-z][a-z0-9_]{0,63}$/.test(fieldKey) ||
        typeof rawField.label !== 'string' ||
        !['string', 'number', 'date', 'boolean'].includes(String(rawField.type))
      )
        add(
          'ocr-profile-schema-invalid',
          `${path}.fields.${fieldIndex}`,
          'Invalid field definition',
        )
      if (seenFields.has(fieldKey))
        add('ocr-profile-duplicate-key', `${path}.fields.${fieldIndex}.key`, 'Duplicate field key')
      seenFields.add(fieldKey)
      closed(rawField, FIELD_KEYS, `${path}.fields.${fieldIndex}`)
    }
    for (const [entityIndex, rawEntity] of (Array.isArray(rawProfile.entities)
      ? rawProfile.entities
      : []
    ).entries()) {
      if (!object(rawEntity)) {
        add(
          'ocr-profile-schema-invalid',
          `${path}.entities.${entityIndex}`,
          'Entity must be an object',
        )
        continue
      }
      closed(rawEntity, ENTITY_KEYS, `${path}.entities.${entityIndex}`)
      if (
        !Array.isArray(rawEntity.matchFields) ||
        !['task', 'wbs_node', 'milestone', 'risk', 'project_member', 'project', 'file'].includes(
          String(rawEntity.entityType),
        )
      )
        add(
          'ocr-profile-schema-invalid',
          `${path}.entities.${entityIndex}`,
          'Invalid entity definition',
        )
    }
    const review = object(rawProfile.review) ? rawProfile.review : {}
    closed(review, REVIEW_KEYS, `${path}.review`)
    for (const [groupIndex, rawGroup] of (Array.isArray(review.groups)
      ? review.groups
      : []
    ).entries()) {
      if (!object(rawGroup)) {
        add(
          'ocr-profile-schema-invalid',
          `${path}.review.groups.${groupIndex}`,
          'Group must be an object',
        )
        continue
      }
      closed(rawGroup, GROUP_KEYS, `${path}.review.groups.${groupIndex}`)
      if (!COMPONENTS.includes(rawGroup.component as OcrReviewComponentKey))
        add(
          'ocr-profile-review-component-unknown',
          `${path}.review.groups.${groupIndex}.component`,
          'Unknown review component',
        )
      if (
        !Array.isArray(rawGroup.fieldKeys) ||
        rawGroup.fieldKeys.some((key) => !seenFields.has(String(key)))
      )
        add(
          'ocr-profile-schema-invalid',
          `${path}.review.groups.${groupIndex}.fieldKeys`,
          'Review group references unknown field',
        )
    }
  }
  const scan = (value: unknown, path = '$') => {
    if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${path}.${index}`))
    if (!object(value)) {
      if (typeof value === 'string' && EXECUTABLE.test(value))
        add(
          'ocr-profile-executable-content',
          path,
          'Executable, URL, prompt, provider or SQL content is forbidden',
        )
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE.test(key))
        add('ocr-profile-sensitive-content', `${path}.${key}`, 'Sensitive fields are forbidden')
      if (/provider|model|prompt/i.test(key))
        add(
          'ocr-profile-provider-override',
          `${path}.${key}`,
          'Provider/model/prompt authority is core-owned',
        )
      scan(item, `${path}.${key}`)
    }
  }
  scan(input)
  findings.sort((a, b) => `${a.path}:${a.code}`.localeCompare(`${b.path}:${b.code}`))
  if (findings.some((item) => item.severity === 'blocking')) return { valid: false, findings }
  const normalizedPayload = normalizeOcrProfilePack(input as unknown as OcrProfilePluginPackPayload)
  return {
    valid: true,
    findings,
    normalizedPayload,
    digest: computeOcrProfilePackDigest(normalizedPayload),
  }
}

export function projectOcrReviewUi(profile: OcrProfileProjection) {
  const fieldKeys = new Set(profile.schemaSnapshot.fields.map((field) => field.key))
  return profile.reviewSnapshot.groups
    .filter(
      (group) =>
        COMPONENTS.includes(group.component) && group.fieldKeys.every((key) => fieldKeys.has(key)),
    )
    .map((group) => ({ ...group, fieldKeys: [...group.fieldKeys] }))
}

/** Deterministic three-source merge. Namespaced plugin refs cannot shadow host profiles. */
export function mergeOcrProfileProjections(
  builtin: readonly OcrProfileProjection[],
  plugin: readonly OcrProfileProjection[],
  organization: readonly OcrProfileProjection[],
): OcrProfileProjection[] {
  const priority: Record<OcrPluginProfileSource, number> = {
    builtin: 0,
    plugin: 1,
    organization: 2,
  }
  const byRef = new Map<string, OcrProfileProjection>()
  for (const item of [...builtin, ...plugin, ...organization]) {
    const current = byRef.get(item.profileRef)
    if (!current || priority[item.source] > priority[current.source])
      byRef.set(item.profileRef, item)
  }
  return [...byRef.values()].sort((a, b) => {
    const source = priority[a.source] - priority[b.source]
    return source !== 0 ? source : a.profileRef.localeCompare(b.profileRef)
  })
}
