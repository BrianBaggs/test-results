import '@testing-library/jest-dom/vitest'

// Suppress expected console messages in tests
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: unknown[]) => {
  const message = args.join(' ')

  // Filter out expected test error messages
  if (
    message.includes('Error parsing XML:') ||
    message.includes('Error in PDF generation:') ||
    message.includes('PDF Generation failed:') ||
    message.includes('Could not access localStorage in PDF context:') ||
    message.includes('The width(0) and height(0) of chart should be greater than 0') ||
    message.includes('Error parsing file:') ||
    message.includes('An update to Animate inside a test was not wrapped in act(') ||
    message.includes('In HTML, <button> cannot be a descendant of <button>') ||
    // Recharts' Pie labels render through an internal zIndex-portal system (ZIndexLayer,
    // @since 3.4): a <g> portal target is registered via a useLayoutEffect, then consumed
    // once a separate subscriber component re-renders with it — an unavoidable multi-pass
    // settle that isn't guaranteed to finish inside one act() flush. Confirmed via a real
    // Linux/CI reproduction (Docker) that this is scheduling-sensitive, not a real bug: it
    // fires only when another test file runs concurrently (genuine CPU contention changes
    // how many passes complete before reconciliation), never when isolated, and disappears
    // entirely with --no-file-parallelism. Recharts hardcodes this zIndex (DefaultZIndexes.label
    // = 2000, in node_modules/recharts/es6/zIndex/DefaultZIndexes.js) with no prop to opt out
    // short of dropping Pie's label feature, so it can't be fixed from application code —
    // giving ResponsiveContainer fixed pixel dimensions under test was tried and rejected:
    // it skips rendering the .recharts-responsive-container element entirely, which broke
    // useChartRenderComplete's synchronous chart-ready detection (src/hooks/useChartRenderComplete.ts).
    message.includes('a unique "key" prop') && message.includes('a child from Pie') ||
    // React logs this as console.error('The tag <%s> is unrecognized...', type) — match
    // around the %s placeholder rather than the substituted tag name, since args.join(' ')
    // below never performs that substitution.
    message.includes('is unrecognized in this browser') ||
    // next-themes (0.4.x) intentionally renders an inline <script> inside ThemeProvider so the
    // saved theme is applied before first paint (prevents a flash of the wrong theme). React
    // warns about any <script> rendered from a component; the script is what we want in the
    // app, and it never runs under jsdom, so the warning is noise here.
    message.includes('Encountered a script tag while rendering React component')
  ) {
    return
  }

  originalConsoleError(...args)
}

console.warn = (...args: unknown[]) => {
  const message = args.join(' ')

  // Filter out expected test warning messages
  if (
    message.includes('PDF preview frame not found, falling back to regular preview') ||
    message.includes('Large dataset detected') ||
    message.includes('Very large dataset detected') ||
    message.includes('The width(0) and height(0) of chart should be greater than 0')
  ) {
    return
  }

  originalConsoleWarn(...args)
}

// Global test configuration
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {
      // Mock implementation
    },
    removeListener: () => {
      // Mock implementation
    },
    addEventListener: () => {
      // Mock implementation
    },
    removeEventListener: () => {
      // Mock implementation
    },
    dispatchEvent: () => {
      // Mock implementation
    },
  }),
})

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {
    // Mock implementation
  }

  unobserve() {
    // Mock implementation
  }

  disconnect() {
    // Mock implementation
  }
}

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  root = null
  rootMargin = ''
  thresholds: ReadonlyArray<number> = []

  observe() {
    // Mock implementation
  }

  unobserve() {
    // Mock implementation
  }

  disconnect() {
    // Mock implementation
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
} as unknown as typeof IntersectionObserver

// Mock localStorage
const localStorageMock = {
  getItem: () => null,
  setItem: () => {
    // Mock implementation
  },
  removeItem: () => {
    // Mock implementation
  },
  clear: () => {
    // Mock implementation
  },
}

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock getBoundingClientRect to provide default dimensions for chart containers
Element.prototype.getBoundingClientRect = () => ({
  width: 400,
  height: 300,
  top: 0,
  left: 0,
  bottom: 300,
  right: 400,
  x: 0,
  y: 0,
  toJSON: () => ({}),
})
