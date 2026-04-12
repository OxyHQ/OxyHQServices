import { createContext, useCallback, useContext, useState } from "react"

type LayoutContextValue = {
    hideLogo: boolean
    setHideLogo: (hide: boolean) => void
}

const LayoutContext = createContext<LayoutContextValue>({
    hideLogo: false,
    setHideLogo: () => {},
})

export function LayoutProvider({ children }: { children: React.ReactNode }) {
    const [hideLogo, setHideLogoState] = useState(false)
    const setHideLogo = useCallback((hide: boolean) => setHideLogoState(hide), [])

    return (
        <LayoutContext.Provider value={{ hideLogo, setHideLogo }}>
            {children}
        </LayoutContext.Provider>
    )
}

export function useLayoutContext() {
    return useContext(LayoutContext)
}
