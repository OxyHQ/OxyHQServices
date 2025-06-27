declare module 'express' {
  export function Router(): any;
  export interface Request { [key: string]: any }
  export interface Response { [key: string]: any }
}
