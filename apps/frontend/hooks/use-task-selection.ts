'use client'

import { useCallback, useMemo, useState } from 'react'

export function useTaskSelection(maxSelected = 100) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())

  const toggle = useCallback(
    (taskId: number, selected: boolean) => {
      setSelectedIds((current) => {
        const next = new Set(current)
        if (selected) {
          if (next.has(taskId) || next.size < maxSelected) next.add(taskId)
        } else {
          next.delete(taskId)
        }
        return next
      })
    },
    [maxSelected],
  )

  const setPageSelected = useCallback(
    (taskIds: number[], selected: boolean) => {
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const taskId of taskIds) {
          if (selected) {
            if (next.has(taskId) || next.size < maxSelected) next.add(taskId)
          } else {
            next.delete(taskId)
          }
        }
        return next
      })
    },
    [maxSelected],
  )

  const retain = useCallback((taskIds: number[]) => setSelectedIds(new Set(taskIds)), [])
  const clear = useCallback(() => setSelectedIds(new Set()), [])

  return useMemo(
    () => ({ selectedIds, toggle, setPageSelected, retain, clear }),
    [clear, retain, selectedIds, setPageSelected, toggle],
  )
}
