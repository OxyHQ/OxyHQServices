import React, { createContext, useContext, useState, ReactNode, useRef } from 'react';
import { ScrollView } from 'react-native';

interface ScrollContextType {
  isScrolled: boolean;
  setIsScrolled: (isScrolled: boolean) => void;
  scrollRef: React.RefObject<ScrollView>;
  scrollToTop: () => void;
}

const ScrollContext = createContext<ScrollContextType | undefined>(undefined);

export function ScrollProvider({ children }: { children: ReactNode }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  return (
    <ScrollContext.Provider value={{ isScrolled, setIsScrolled, scrollRef, scrollToTop }}>
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

