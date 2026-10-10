import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom implements neither ResizeObserver nor Element.scrollIntoView; Radix
// primitives (ScrollArea, Select, Tooltip) call them on mount. Stub them so
// component tests can render Radix-backed shadcn components.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Node 22+ ships an experimental global `localStorage` that shadows jsdom's and
// is undefined unless node gets --localstorage-file. Persist-middleware tests
// need a working Storage, so install an in-memory one when the real one is
// unusable. (Behaves like the browser's: string keys/values, same API.)
if (typeof globalThis.localStorage?.getItem !== "function") {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
  vi.stubGlobal("localStorage", storage);
}
