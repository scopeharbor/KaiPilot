'use client'

import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'

/** 组织记忆维基（/next/wiki，v3-llm-wiki-memory-foundation）。权限与开关由后端判定。 */
export default function OrganizationWikiPage() {
  return <WikiWorkspace scopeKind="organization" />
}
