declare namespace sinon {
  export interface SinonFakeTimers {
    restore(): void;
    tick(ms: number): void;
  }
  export function useFakeTimers(): SinonFakeTimers;
  export function restore(): void;
  export function stub(): any;
}

declare module 'sinon' {
  export = sinon;
}
