'use client'

import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'

/** 个人记忆维基（/next/me/wiki）：默认仅本人可见，可逐页授权给项目经理只读。 */
export default function PersonalWikiPage() {
  return <WikiWorkspace scopeKind="user" />
}
