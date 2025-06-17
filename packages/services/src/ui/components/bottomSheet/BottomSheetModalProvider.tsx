import React, { createContext, useContext } from 'react';

interface BottomSheetModalContextValue {
  // Currently empty, but can be extended for shared state if needed
}

const BottomSheetModalContext = createContext<BottomSheetModalContextValue>({});

export interface BottomSheetModalProviderProps {
  children: React.ReactNode;
}

export const BottomSheetModalProvider: React.FC<BottomSheetModalProviderProps> = ({
  children,
}) => {
  const value: BottomSheetModalContextValue = {
    // Currently empty, but can be extended for shared state if needed
  };

  return (
    <BottomSheetModalContext.Provider value={value}>
      {children}
    </BottomSheetModalContext.Provider>
  );
};

export const useBottomSheetModal = () => {
  return useContext(BottomSheetModalContext);
};

BottomSheetModalProvider.displayName = 'BottomSheetModalProvider';