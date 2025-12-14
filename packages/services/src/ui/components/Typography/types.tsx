// MD3TypescaleKey enum for variant types
export enum MD3TypescaleKey {
  displayLarge = 'displayLarge',
  displayMedium = 'displayMedium',
  displaySmall = 'displaySmall',
  headlineLarge = 'headlineLarge',
  headlineMedium = 'headlineMedium',
  headlineSmall = 'headlineSmall',
  titleLarge = 'titleLarge',
  titleMedium = 'titleMedium',
  titleSmall = 'titleSmall',
  labelLarge = 'labelLarge',
  labelMedium = 'labelMedium',
  labelSmall = 'labelSmall',
  bodyLarge = 'bodyLarge',
  bodyMedium = 'bodyMedium',
  bodySmall = 'bodySmall',
}

export type VariantProp<T> =
  | (T extends string ? (string extends T ? never : T) : never)
  | keyof typeof MD3TypescaleKey;
