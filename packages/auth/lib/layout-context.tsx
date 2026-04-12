import { createContext, useCallback, useContext, useState } from "react"

type LayoutOverride = {
    /** React node to render in place of the logo */
    logoSlot: React.ReactNode | null
}

type LayoutContextValue = LayoutOverride & {
    setLogoSlot: (node: React.ReactNode | null) => void
}

const LayoutContext = createContext<LayoutContextValue>({
    logoSlot: null,
    setLogoSlot: () => {},
})

export function LayoutProvider({ children }: { children: React.ReactNode }) {
    const [logoSlot, setLogoSlotState] = useState<React.ReactNode | null>(null)
    const setLogoSlot = useCallback((node: React.ReactNode | null) => setLogoSlotState(node), [])

    return (
        <LayoutContext.Provider value={{ logoSlot, setLogoSlot }}>
            {children}
        </LayoutContext.Provider>
    )
}

export function useLayoutContext() {
    return useContext(LayoutContext)
}
