declare module 'color' {
  interface Color {
    (color: string | Color | undefined, model?: string): Color;
    rgb(): Color;
    rgba(): Color;
    alpha(): number;
    alpha(val: number): Color;
    fade(val: number): Color;
    lighten(val: number): Color;
    darken(val: number): Color;
    string(): string;
    hex(): string;
    toString(): string;
  }

  function color(color: string | Color | undefined, model?: string): Color;
  export default color;
}


