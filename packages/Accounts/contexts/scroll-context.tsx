import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ScrollContextType {
  isScrolled: boolean;
  setIsScrolled: (isScrolled: boolean) => void;
}

const ScrollContext = createContext<ScrollContextType | undefined>(undefined);

export function ScrollProvider({ children }: { children: ReactNode }) {
  const [isScrolled, setIsScrolled] = useState(false);

  return (
    <ScrollContext.Provider value={{ isScrolled, setIsScrolled }}>
      {children}
    </ScrollContext.Provider>
  );
}

export function useScrollContext() {
  const context = useContext(ScrollContext);
  if (context === undefined) {
    throw new Error('useScrollContext must be used within a ScrollProvider');
  }
  return context;
}

