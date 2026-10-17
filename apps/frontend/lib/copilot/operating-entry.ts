import { create } from 'zustand'
export { requestsCopilotProjectCreation as requestsProjectCreation } from '@aiproj/types'

/** 临时转交只存内存，不将用户原文写入 URL、日志或浏览器持久化。 */
export const useCopilotOperatingEntry = create<{
  input: string
  route: string
  userId: string | null
  organizationId: number | null
  projectCreation: string | null
}>(() => ({ input: '', route: '/', userId: null, organizationId: null, projectCreation: null }))
