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
