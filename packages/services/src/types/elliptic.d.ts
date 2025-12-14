declare module 'elliptic' {
  export interface KeyPair {
    getPrivate(enc?: 'hex' | 'array' | 'bn'): string | number[] | any;
    getPublic(enc?: 'hex'): string;
    getPublic(enc?: 'array'): number[];
    getPublic(compressed: boolean, enc?: 'hex'): string;
    getPublic(compressed: boolean, enc?: 'array'): number[];
    sign(msg: string | number[]): Signature;
    verify(msg: string | number[], signature: Signature | string | { r: string | number[]; s: string | number[] }): boolean;
  }

  export interface Signature {
    r: any;
    s: any;
    recoveryParam: number | null;
    toDER(enc?: 'hex'): string;
    toCompact(enc?: 'hex', param?: number): string;
  }

  export interface Curve {
    n: any;
    red: any;
    g: Point;
    decodePoint(bytes: string | number[], enc?: string): Point;
  }

  export interface Point {
    x: any;
    y: any;
    inf: boolean;
    getX(): any;
    getY(): any;
    encode(enc?: string, compressed?: boolean): string | number[];
    add(p: Point): Point;
    mul(k: any): Point;
    eq(p: Point): boolean;
  }

  export class EC {
    constructor(curve: string | Curve);
    keyFromPrivate(priv: string | number[], enc?: string): KeyPair;
    keyFromPublic(pub: string | number[] | Point, enc?: string): KeyPair;
    genKeyPair(opts?: { entropy?: string | number[]; pers?: string | number[] }): KeyPair;
    keyPair(opts?: { priv?: string | number[]; pub?: string | number[] | Point; privEnc?: string; pubEnc?: string }): KeyPair;
    curve: Curve;
    n: any;
    nh: any;
    g: Point;
  }

  export type ECKeyPair = KeyPair;

  // ec can be called as a function or used as a constructor
  export interface ECConstructor {
    new (curve: string | Curve): EC;
    (curve: string | Curve): EC;
  }
  
  export const ec: ECConstructor;
}


