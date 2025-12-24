import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

export interface TransferCodeData {
  code: string;
  sourceDeviceId: string | null;
  publicKey: string;
  timestamp: number;
  state: 'pending' | 'completed' | 'failed';
}

export interface TransferState {
  // Transfer codes map: transferId -> TransferCodeData
  transferCodes: Record<string, TransferCodeData>;
  
  // Active transfer ID (only one active transfer at a time)
  activeTransferId: string | null;
  
  // Restoration flag to prevent duplicate restorations
  isRestored: boolean;
  
  // Actions
  storeTransferCode: (transferId: string, code: string, sourceDeviceId: string | null, publicKey: string) => void;
  getTransferCode: (transferId: string) => TransferCodeData | null;
  clearTransferCode: (transferId: string) => void;
  updateTransferState: (transferId: string, state: 'pending' | 'completed' | 'failed') => void;
  getAllPendingTransfers: () => Array<{ transferId: string; data: TransferCodeData }>;
  getActiveTransferId: () => string | null;
  setActiveTransferId: (transferId: string | null) => void;
  restoreFromStorage: (codes: Record<string, TransferCodeData>, activeTransferId: string | null) => void;
  markRestored: () => void;
  cleanupExpired: () => void;
  reset: () => void;
  clearAll: () => void; // Alias for reset for semantic clarity
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

const initialState = {
  transferCodes: {} as Record<string, TransferCodeData>,
  activeTransferId: null as string | null,
  isRestored: false,
};

export const useTransferStore = create<TransferState>((set, get) => ({
  ...initialState,
  
  storeTransferCode: (transferId: string, code: string, sourceDeviceId: string | null, publicKey: string) => {
    set((state) => ({
      transferCodes: {
        ...state.transferCodes,
        [transferId]: {
          code,
          sourceDeviceId,
          publicKey,
          timestamp: Date.now(),
          state: 'pending',
        },
      },
      activeTransferId: transferId,
    }));
  },
  
  getTransferCode: (transferId: string) => {
    const state = get();
    return state.transferCodes[transferId] || null;
  },
  
  clearTransferCode: (transferId: string) => {
    set((state) => {
      const { [transferId]: removed, ...rest } = state.transferCodes;
      const newActiveTransferId = state.activeTransferId === transferId ? null : state.activeTransferId;
      return {
        transferCodes: rest,
        activeTransferId: newActiveTransferId,
      };
    });
  },
  
  updateTransferState: (transferId: string, newState: 'pending' | 'completed' | 'failed') => {
    set((state) => {
      const existing = state.transferCodes[transferId];
      if (!existing) {
        return state;
      }
      
      const updated = {
        ...existing,
        state: newState,
      };
      
      // Clear active transfer if completed or failed
      const newActiveTransferId = 
        (newState === 'completed' || newState === 'failed') && state.activeTransferId === transferId
          ? null
          : state.activeTransferId;
      
      return {
        transferCodes: {
          ...state.transferCodes,
          [transferId]: updated,
        },
        activeTransferId: newActiveTransferId,
      };
    });
  },
  
  getAllPendingTransfers: () => {
    const state = get();
    const pending: Array<{ transferId: string; data: TransferCodeData }> = [];
    
    Object.entries(state.transferCodes).forEach(([transferId, data]) => {
      if (data.state === 'pending') {
        pending.push({ transferId, data });
      }
    });
    
    return pending;
  },
  
  getActiveTransferId: () => {
    return get().activeTransferId;
  },
  
  setActiveTransferId: (transferId: string | null) => {
    set({ activeTransferId: transferId });
  },
  
  restoreFromStorage: (codes: Record<string, TransferCodeData>, activeTransferId: string | null) => {
    const now = Date.now();
    const validCodes: Record<string, TransferCodeData> = {};
    
    // Only restore non-expired pending transfers
    Object.entries(codes).forEach(([transferId, data]) => {
      if (data.state === 'pending' && (now - data.timestamp) < FIFTEEN_MINUTES) {
        validCodes[transferId] = data;
      }
    });
    
    // Verify active transfer is still valid
    let validActiveTransferId = activeTransferId;
    if (activeTransferId && (!validCodes[activeTransferId] || validCodes[activeTransferId].state !== 'pending')) {
      validActiveTransferId = null;
    }
    
    set({
      transferCodes: validCodes,
      activeTransferId: validActiveTransferId,
      isRestored: true,
    });
  },
  
  markRestored: () => {
    set({ isRestored: true });
  },
  
  cleanupExpired: () => {
    const now = Date.now();
    set((state) => {
      const validCodes: Record<string, TransferCodeData> = {};
      let newActiveTransferId = state.activeTransferId;
      
      Object.entries(state.transferCodes).forEach(([transferId, data]) => {
        const age = now - data.timestamp;
        if (age < FIFTEEN_MINUTES) {
          validCodes[transferId] = data;
        } else if (transferId === state.activeTransferId) {
          newActiveTransferId = null;
        }
      });
      
      return {
        transferCodes: validCodes,
        activeTransferId: newActiveTransferId,
      };
    });
  },
  
  reset: () => {
    set(initialState);
  },
  
  clearAll: () => {
    // Alias for reset - clears all transfer codes and active transfer
    set(initialState);
  },
}));

/**
 * Hook to get transfer codes for persistence
 */
export const useTransferCodesForPersistence = () => {
  return useTransferStore(
    useShallow((state) => ({
      transferCodes: state.transferCodes,
      activeTransferId: state.activeTransferId,
    }))
  );
};


