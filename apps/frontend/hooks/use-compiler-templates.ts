/**
 * v3-template-compiler-plugin-integration —— TanStack Query hooks for compiler templates（tasks 4.1）。
 *
 * 分层 query keys，组织隔离由后端负责；前端仅按当前会话查询。
 */

import { useQuery } from '@tanstack/react-query'
import { listCompilerTemplates, getCompilerTemplateDetail } from '@/lib/api/compiler-templates'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

export const compilerTemplateKeys = {
  all: (organizationId: number) => ['compiler', 'templates', organizationId] as const,
  lists: (organizationId: number) => [...compilerTemplateKeys.all(organizationId), 'list'] as const,
  list: (organizationId: number) => [...compilerTemplateKeys.lists(organizationId)] as const,
  details: (organizationId: number) =>
    [...compilerTemplateKeys.all(organizationId), 'detail'] as const,
  detail: (organizationId: number, templateId: string) =>
    [...compilerTemplateKeys.details(organizationId), templateId] as const,
}

/** 模板候选列表 */
export function useCompilerTemplates() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  return useQuery({
    queryKey: compilerTemplateKeys.list(organizationId ?? 0),
    queryFn: () => listCompilerTemplates(),
    enabled: organizationId !== null,
  })
}

/** 模板详情 */
export function useCompilerTemplateDetail(templateId: string | null) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  return useQuery({
    queryKey: compilerTemplateKeys.detail(organizationId ?? 0, templateId ?? ''),
    queryFn: () => getCompilerTemplateDetail(templateId!),
    enabled: organizationId !== null && !!templateId && /^ptpl_[a-z0-9_]+$/.test(templateId),
  })
}
