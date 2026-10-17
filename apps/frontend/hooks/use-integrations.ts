'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi, integrationKeys } from '@/lib/api/integrations'
import { useAuthStore } from '@/stores/auth-store'
import type { IntegrationProvider } from '@aiproj/types'

export function useIntegrations() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: integrationKeys.list(),
    queryFn: integrationsApi.list,
    enabled: isAuthenticated,
  })
}

export function useAuthorizeIntegration() {
  return useMutation({ mutationFn: integrationsApi.authorize })
}

export function useIntegrationQr() {
  return useMutation({ mutationFn: integrationsApi.qr })
}

export function useCheckIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.check(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.all }),
  })
}

export function useDisconnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.disconnect(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.all }),
  })
}
