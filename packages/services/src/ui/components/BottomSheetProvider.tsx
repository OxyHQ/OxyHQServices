import React, { type ReactNode } from 'react';

/**
 * BottomSheetProvider - Simple provider for bottom sheet context
 * 
 * This is a compatibility component that maintains the same API structure
 * as @gorhom/bottom-sheet's BottomSheetModalProvider. Since we use a single
 * BottomSheetRouter instance, this is mainly a pass-through wrapper.
 * 
 * In the future, this could be extended to manage multiple bottom sheets
 * or provide additional context if needed.
 */
export interface BottomSheetProviderProps {
    children: ReactNode;
}

const BottomSheetProvider: React.FC<BottomSheetProviderProps> = ({ children }) => {
    // Currently just a pass-through, but maintains API compatibility
    // and allows for future enhancements (multiple sheets, context, etc.)
    return <>{children}</>;
};

BottomSheetProvider.displayName = 'BottomSheetProvider';

export default BottomSheetProvider;

