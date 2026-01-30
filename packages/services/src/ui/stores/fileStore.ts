import { create } from 'zustand';
import { shallow } from 'zustand/shallow';
import type { FileMetadata } from '@oxyhq/core';
// Shallow compare two file metadata objects by keys/values
function shallowEqualFile(a: FileMetadata, b: FileMetadata): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a) as Array<keyof FileMetadata>;
  const bKeys = Object.keys(b) as Array<keyof FileMetadata>;
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    // treat metadata/variants shallowly by reference
    if ((a as any)[k] !== (b as any)[k]) return false;
  }
  return true;
}

// Basic upload progress type for aggregate tracking
export interface FileUploadAggregateProgress {
  current: number;
  total: number;
}

interface FileState {
  files: Record<string, FileMetadata>;
  order: string[]; // maintain insertion / sort order
  uploading: boolean;
  deleting: string | null;
  uploadProgress: FileUploadAggregateProgress | null;
  // actions
  setFiles: (files: FileMetadata[], opts?: { merge?: boolean }) => void;
  addFile: (file: FileMetadata, opts?: { prepend?: boolean }) => void;
  updateFile: (id: string, patch: Partial<FileMetadata>) => void;
  removeFile: (id: string) => void;
  setUploading: (val: boolean) => void;
  setDeleting: (id: string | null) => void;
  setUploadProgress: (p: FileUploadAggregateProgress | null) => void;
  reset: () => void;
}

const initialState = {
  files: {} as Record<string, FileMetadata>,
  order: [] as string[],
  uploading: false,
  deleting: null as string | null,
  uploadProgress: null as FileUploadAggregateProgress | null,
};

export const useFileStore = create<FileState>((set, get) => ({
  ...initialState,
  setFiles: (files, opts) => set(state => {
    const merge = opts?.merge !== false; // default true
    if (!merge) {
      const map: Record<string, FileMetadata> = {};
      const order: string[] = [];
      files.forEach(f => { map[f.id] = f; order.push(f.id); });
      // detect if identical to avoid redundant updates
      const sameOrder = order.length === state.order.length && order.every((id, i) => id === state.order[i]);
      let sameFiles = sameOrder;
      if (sameOrder) {
        sameFiles = order.every(id => state.files[id] && shallowEqualFile(state.files[id], map[id] as FileMetadata));
      }
      if (sameOrder && sameFiles) return {} as any;
      return { files: map, order };
    }
    const newFiles = { ...state.files };
    const newOrder = [...state.order];
    let changed = false;
    files.forEach(f => {
      const prev = state.files[f.id];
      const merged = { ...(prev || {}), ...f } as FileMetadata;
      if (!prev || !shallowEqualFile(prev, merged)) { newFiles[f.id] = merged; changed = true; }
      if (!newOrder.includes(f.id)) { newOrder.unshift(f.id); changed = true; }
    });
    if (!changed) return {} as any;
    return { files: newFiles, order: newOrder };
  }),
  addFile: (file, opts) => set(state => {
    const prepend = opts?.prepend !== false; // default true
    if (state.files[file.id]) {
      if (shallowEqualFile(state.files[file.id], file)) return {} as any;
      return { files: { ...state.files, [file.id]: file } };
    }
    return {
      files: { ...state.files, [file.id]: file },
      order: prepend ? [file.id, ...state.order] : [...state.order, file.id],
    };
  }),
  updateFile: (id, patch) => set(state => {
    const existing = state.files[id];
    if (!existing) return {} as any;
    const updated = { ...existing, ...patch } as FileMetadata;
    if (shallowEqualFile(existing, updated)) return {} as any;
    return { files: { ...state.files, [id]: updated } };
  }),
  removeFile: (id) => set(state => {
    if (!state.files[id]) return {} as any;
    const { [id]: _removed, ...rest } = state.files;
    const newOrder = state.order.filter(fid => fid !== id);
    return { files: rest, order: newOrder };
  }),
  setUploading: (val) => set({ uploading: val }),
  setDeleting: (id) => set({ deleting: id }),
  setUploadProgress: (p) => set({ uploadProgress: p }),
  reset: () => set(initialState),
}));

// selectors
export const useFiles = () => {
  const files = useFileStore(s => s.files);
  const order = useFileStore(s => s.order);
  // Return stable array when contents unchanged
  const out = order.map((id: string) => files[id]);
  return out;
};
export const useUploading = () => useFileStore(s => s.uploading);
export const useUploadAggregateProgress = () => useFileStore(s => s.uploadProgress);
export const useDeleting = () => useFileStore(s => s.deleting);
