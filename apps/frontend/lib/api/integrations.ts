import { apiFetch } from '@/lib/api-client'
import type {
  IntegrationAuthorizeResponse,
  IntegrationCheckResponse,
  IntegrationDisconnectResponse,
  IntegrationProvider,
  IntegrationProviderDto,
  IntegrationQrResponse,
} from '@aiproj/types'

export const integrationKeys = {
  all: ['integrations'] as const,
  list: () => [...integrationKeys.all, 'list'] as const,
  detail: (provider: IntegrationProvider) => [...integrationKeys.all, provider] as const,
}

export const integrationsApi = {
  list: () => apiFetch<IntegrationProviderDto[]>('/integrations'),
  get: (provider: IntegrationProvider) =>
    apiFetch<IntegrationProviderDto>(`/integrations/${provider}`),
  authorize: (provider: IntegrationProvider) =>
    apiFetch<IntegrationAuthorizeResponse>(`/integrations/${provider}/authorize`, {
      method: 'POST',
    }),
  qr: (provider: IntegrationProvider) =>
    apiFetch<IntegrationQrResponse>(`/integrations/${provider}/qr`, { method: 'POST' }),
  check: (provider: IntegrationProvider) =>
    apiFetch<IntegrationCheckResponse>(`/integrations/${provider}/check`, { method: 'POST' }),
  disconnect: (provider: IntegrationProvider) =>
    apiFetch<IntegrationDisconnectResponse>(`/integrations/${provider}/disconnect`, {
      method: 'POST',
    }),
}
