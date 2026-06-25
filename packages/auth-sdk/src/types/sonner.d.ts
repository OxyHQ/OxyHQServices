declare module 'sonner' {
  export interface ToastT {
    (message: string): string | number;
    success: (message: string) => string | number;
    error: (message: string) => string | number;
    info: (message: string) => string | number;
  }

  export const toast: ToastT;
}
