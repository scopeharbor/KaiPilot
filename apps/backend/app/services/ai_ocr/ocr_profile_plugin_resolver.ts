import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import {
  PLUGIN_SEAM_OCR_PROFILE,
  makePluginOcrProfileRef,
  validateOcrProfilePluginPack,
  type OcrProfileProjection,
} from '@aiproj/types'

interface ReleaseMetadata {
  contributions?: Array<{
    contributionKey?: string
    seamKey?: string
    seamVersion?: string
    payload?: unknown
  }>
}

/**
 * Resolves enabled OCR profile contributions without materializing a second
 * profile registry. Provider selection and credentials are intentionally absent.
 */
export default class OcrProfilePluginResolver {
  async listEnabledPluginProfiles(organizationId: number): Promise<OcrProfileProjection[]> {
    const installations = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('status', 'enabled')
      .orderBy('plugin_id', 'asc')

    const projections: OcrProfileProjection[] = []
    for (const installation of installations) {
      const release = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('id', installation.releaseId)
        .where('status', 'approved')
        .first()
      if (!release) continue
      const metadata = this.parseMetadata(release.metadata)
      for (const contribution of metadata.contributions ?? []) {
        if (contribution.seamKey !== PLUGIN_SEAM_OCR_PROFILE) continue
        const validation = validateOcrProfilePluginPack(contribution.payload)
        if (!validation.valid || !validation.normalizedPayload || !validation.digest) continue
        for (const profile of validation.normalizedPayload.profiles) {
          projections.push({
            profileRef: makePluginOcrProfileRef(installation.pluginId, profile.profileKey),
            source: 'plugin',
            name: profile.name,
            version: profile.version,
            ...(profile.description ? { description: profile.description } : {}),
            pluginRef: {
              pluginId: installation.pluginId,
              pluginVersion: installation.version,
              payloadDigest: validation.digest,
            },
            schemaSnapshot: { fields: profile.fields, entities: profile.entities ?? [] },
            reviewSnapshot: { groups: profile.review.groups },
          })
        }
      }
    }
    return projections.sort((a, b) => a.profileRef.localeCompare(b.profileRef))
  }

  async resolve(organizationId: number, profileRef: string): Promise<OcrProfileProjection | null> {
    const profiles = await this.listEnabledPluginProfiles(organizationId)
    return profiles.find((profile) => profile.profileRef === profileRef) ?? null
  }

  private parseMetadata(metadata: string | null): ReleaseMetadata {
    if (!metadata) return {}
    try {
      const value = JSON.parse(metadata) as unknown
      return value && typeof value === 'object' ? (value as ReleaseMetadata) : {}
    } catch {
      return {}
    }
  }
}
