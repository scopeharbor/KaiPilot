'use client'

import * as React from 'react'

const NextLegacyThemeContext = React.createContext(false)

/** Adapt embedded legacy controls to the workspace theme, including their body portals. */
export function NextLegacyThemeScope({ children }: { children: React.ReactNode }) {
  return (
    <NextLegacyThemeContext.Provider value={true}>
      <div data-next-track data-next-legacy-ui>
        {children}
      </div>
    </NextLegacyThemeContext.Provider>
  )
}

export function useNextLegacyThemeScope() {
  const enabled = React.useContext(NextLegacyThemeContext)
  return enabled ? { 'data-next-track': '', 'data-next-legacy-ui': '' } : {}
}
