// Ambient declarations for Metro static image imports.
//
// `import logo from './logo.png'` resolves to a numeric asset reference
// produced by Metro's asset registry — the same `number` shape React Native
// types as `ImageRequireSource`. Declaring the value as `number` (not `any`)
// keeps the import precisely typed and assignable to `<Image source={...}>`.

declare module '*.jpg' {
  const value: number;
  export default value;
}

declare module '*.png' {
  const value: number;
  export default value;
}

declare module '*.jpeg' {
  const value: number;
  export default value;
}

declare module '*.gif' {
  const value: number;
  export default value;
}

declare module '*.webp' {
  const value: number;
  export default value;
}
