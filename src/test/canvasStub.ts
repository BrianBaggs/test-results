// jsdom has no <canvas>, and the diff viewer measures text with one. This gives
// it a minimal 2d context so the REAL component can render under test.
export function stubCanvas() {
  const ctx = { font: '', measureText: (t: string) => ({ width: t.length * 7 }) };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ctx });
}
