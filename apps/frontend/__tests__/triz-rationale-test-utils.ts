/**
 * v2-triz-recommendation-rationale-ui —— Test utilities.
 * Used by triz-rationale.test.tsx for mocking permissions.
 */
import { vi } from 'vitest'

export const mockPermissions = vi.hoisted(() => ({ value: {} as Record<string, boolean> }))
