import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { TestData, ReportConfig } from '../types'

/* ── Shared mock state ──────────────────────────────────────────────
 * We store the mock canvas / pdf-instance in a plain object on globalThis
 * so both the vi.mock factory (hoisted) and the tests can share state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any

if (!g.__pdfMocks) {
  g.__pdfMocks = {
    // html2canvas is called once per rendered page; this is that page's canvas.
    canvas: {
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,mock'),
    },
    html2canvas: vi.fn(),
    pdf: {
      addPage: vi.fn(),
      addImage: vi.fn(),
      save: vi.fn(),
    },
    JsPDF: vi.fn(),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __mocks: Record<string, any> = g.__pdfMocks

// Wire up cross-refs
__mocks.html2canvas.mockResolvedValue(__mocks.canvas)

// IMPORTANT: jsPDF is instantiated with `new jsPDF()` in pdfGenerator.ts.
// Use a normal function here so the mock remains constructable.
__mocks.JsPDF.mockImplementation(function () {
  return __mocks.pdf
})

vi.mock('html2canvas', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (globalThis as any).__pdfMocks.html2canvas,
}))

vi.mock('jspdf', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jsPDF: (globalThis as any).__pdfMocks.JsPDF,
}))

describe('pdfGenerator', () => {
  let mockTestData: TestData
  let mockConfig: ReportConfig
  let reportEl: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Re-wire after clearAllMocks
    __mocks.html2canvas.mockResolvedValue(__mocks.canvas)

    // IMPORTANT: must be a normal function because pdfGenerator uses
    // `new jsPDF(...)`.
    __mocks.JsPDF.mockImplementation(function () {
      return __mocks.pdf
    })

    __mocks.canvas.toDataURL.mockReturnValue(
      'data:image/jpeg;base64,mock',
    )

    mockTestData = {
      summary: {
        total: 100,
        passed: 75,
        failed: 20,
        skipped: 5,
        flaky: 0,
        time: 120.5,
      },
      suites: [{
        name: 'Suite 1',
        tests: 50,
        failures: 10,
        errors: 0,
        skipped: 2,
        time: 60.0,
        timestamp: '2024-01-01T12:00:00Z',
        testcases: Array.from({ length: 50 }, (_, i) => ({
          name: `Test ${i + 1}`,
          status: i < 37 ? 'passed' : i < 47 ? 'failed' : 'skipped',
          suite: 'Suite 1',
          time: Math.random() * 5,
        })),
      }],
    }

    mockConfig = {
      title: 'Test Results Report',
      author: 'Test Author',
      projectName: 'Test Project',
      includeExecutiveSummary: true,
      includeTestMetrics: true,
      includeFailedTests: true,
      includeFlakyTests: false,
      includeAllTests: true,
      includeResolutionProgress: true,
    }

    // Real DOM element for #report-preview
    reportEl = document.createElement('div')
    reportEl.id = 'report-preview'
    reportEl.innerHTML = '<div>Report content</div>'
    document.body.appendChild(reportEl)

    // Chart-render-complete indicator
    const indicator = document.createElement('div')
    indicator.className = 'chart-render-complete'
    document.body.appendChild(indicator)

    // Mock requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        cb(0)
        return 0
      })
  })

  afterEach(() => {
    document.getElementById('report-preview')?.remove()
    document.querySelector('.chart-render-complete')?.remove()
    vi.restoreAllMocks()
  })

  it('should export generatePDF function', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    expect(typeof generatePDF).toBe('function')
  })

  it('should generate PDF successfully', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await expect(
      generatePDF(mockTestData, mockConfig),
    ).resolves.not.toThrow()
  })

  it('should call progress callback', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    const cb = vi.fn()

    await generatePDF(mockTestData, mockConfig, cb)

    expect(cb).toHaveBeenCalledWith(100)
  })

  it('should throw when report element not found', async () => {
    reportEl.remove()

    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await expect(
      generatePDF(mockTestData, mockConfig),
    ).rejects.toThrow('No report content found')
  })

  it('should restore a pre-existing inline theme variable after generation, rather than clearing it', async () => {
    document.documentElement.style.setProperty('--primary', '#123456')

    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await generatePDF(mockTestData, mockConfig)

    expect(
      document.documentElement.style.getPropertyValue('--primary'),
    ).toBe('#123456')

    document.documentElement.style.removeProperty('--primary')
  })

  it('should pin dark-theme hex fallbacks (not the light map) while the page is in dark mode, so the live page does not flash to light mode during capture', async () => {
    document.documentElement.classList.add('dark')
    let backgroundDuringCapture: string | null = null
    __mocks.html2canvas.mockImplementationOnce(async () => {
      backgroundDuringCapture = document.documentElement.style.getPropertyValue('--background')
      return __mocks.canvas
    })

    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await generatePDF(mockTestData, mockConfig)

    expect(backgroundDuringCapture).toBe('#18181b')
    // Restored afterwards, same as the light-mode case above
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')

    document.documentElement.classList.remove('dark')
  })

  it('should call html2canvas with correct options', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await generatePDF(mockTestData, mockConfig)

    expect(__mocks.html2canvas).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scale: 2,
        width: 794,
        windowWidth: 794,
        x: 0,
        y: 0,
        backgroundColor: '#ffffff',
      }),
    )
  })

  it('should create jsPDF with A4 portrait settings', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await generatePDF(mockTestData, mockConfig)

    expect(__mocks.JsPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
        compress: true,
      }),
    )
  })

  it('should save PDF using the project name as the filename', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await generatePDF(mockTestData, { ...mockConfig, projectName: 'Release-November-2 Critical' })

    expect(__mocks.pdf.save).toHaveBeenCalledWith('Release-November-2 Critical.pdf')
  })

  it('should fall back to a date-stamped filename when the project name is empty', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await generatePDF(mockTestData, { ...mockConfig, projectName: '' })

    expect(__mocks.pdf.save).toHaveBeenCalledWith(
      expect.stringMatching(/^test-results-report-\d{4}-\d{2}-\d{2}\.pdf$/),
    )
  })

  describe('buildReportFilename', () => {
    it('keeps spaces, dashes and digits from the project name', async () => {
      const { buildReportFilename } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      expect(buildReportFilename('Release-November-2 Critical')).toBe('Release-November-2 Critical.pdf')
    })

    it('replaces characters that are invalid in file names with dashes', async () => {
      const { buildReportFilename } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      expect(buildReportFilename('Web/API: v2 *beta* "rc" <a|b>?')).toBe('Web-API- v2 -beta- -rc- -a-b--.pdf')
    })

    it('collapses runs of whitespace and trims the ends', async () => {
      const { buildReportFilename } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      expect(buildReportFilename('  Release   Candidate\t1  ')).toBe('Release Candidate 1.pdf')
    })

    it('strips leading and trailing dots and spaces', async () => {
      const { buildReportFilename } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      expect(buildReportFilename('..Project.. ')).toBe('Project.pdf')
    })

    it('truncates long project names to 200 characters before the extension', async () => {
      const { buildReportFilename } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      const result = buildReportFilename('a'.repeat(300))

      expect(result).toBe(`${'a'.repeat(200)}.pdf`)
    })

    it('uses the date-stamped name when the project name is blank or only invalid characters', async () => {
      const { buildReportFilename } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      expect(buildReportFilename('   ')).toMatch(/^test-results-report-\d{4}-\d{2}-\d{2}\.pdf$/)
      expect(buildReportFilename('...')).toMatch(/^test-results-report-\d{4}-\d{2}-\d{2}\.pdf$/)
    })
  })

  it('should add images to PDF for each page', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await generatePDF(mockTestData, mockConfig)

    expect(__mocks.pdf.addImage).toHaveBeenCalled()

    expect(__mocks.pdf.addImage).toHaveBeenCalledWith(
      expect.stringContaining('data:image'),
      'JPEG',
      0,
      0,
      210,
      expect.any(Number),
    )
  })

  it('should handle multi-page content', async () => {
    // jsdom doesn't run layout, so simulate a clone three A4 pages tall by
    // stubbing scrollHeight (page breaks are computed from this before any
    // canvas is created).
    const A4_HEIGHT_PX = 1123

    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollHeight',
    )

    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get: () => A4_HEIGHT_PX * 3,
    })

    try {
      const { generatePDF } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      await generatePDF(mockTestData, mockConfig)

      expect(__mocks.html2canvas).toHaveBeenCalledTimes(3)
      expect(__mocks.pdf.addPage).toHaveBeenCalledTimes(2)
      expect(__mocks.pdf.addImage).toHaveBeenCalledTimes(3)
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          Element.prototype,
          'scrollHeight',
          originalDescriptor,
        )
      }
    }
  })

  it('should render each page from its own crop of the clone, not one giant canvas', async () => {
    // Regression test: PDF generation must never request one canvas for the
    // whole report — that silently produces a blank canvas once the report
    // is large enough to exceed the browser's max canvas dimensions.
    const A4_HEIGHT_PX = 1123

    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollHeight',
    )

    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get: () => A4_HEIGHT_PX * 3,
    })

    try {
      const { generatePDF } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      await generatePDF(mockTestData, mockConfig)

      const calls = __mocks.html2canvas.mock.calls as Array<
        [unknown, { y: number; height: number }]
      >

      expect(calls).toHaveLength(3)

      // Each call captures one page-sized slice, not the full report height.
      calls.forEach(([, opts]) => {
        expect(opts.height).toBeLessThanOrEqual(A4_HEIGHT_PX)
      })

      // Slices advance down the document rather than all capturing from the top.
      expect(calls[0][1].y).toBe(0)
      expect(calls[1][1].y).toBeGreaterThan(calls[0][1].y)
      expect(calls[2][1].y).toBeGreaterThan(calls[1][1].y)
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          Element.prototype,
          'scrollHeight',
          originalDescriptor,
        )
      }
    }
  })

  // Both tests below simulate real layout by stubbing getBoundingClientRect /
  // scrollHeight per-element via data-sim* attributes — jsdom never runs
  // layout, so these are the only way to exercise the pagination math against
  // known element positions. Attributes survive cloneNode, so they carry
  // over from #report-preview onto the internal clone pdfGenerator measures.
  const withSimulatedLayout = async (run: () => Promise<void>) => {
    const originalGBCR = Element.prototype.getBoundingClientRect
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollHeight',
    )

    Element.prototype.getBoundingClientRect = function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute('data-simtop')) {
        const top = Number(this.getAttribute('data-simtop'))
        const bottom = Number(this.getAttribute('data-simbottom'))

        return {
          top,
          bottom,
          height: bottom - top,
          left: 0,
          right: 794,
          width: 794,
          x: 0,
          y: top,
          toJSON() {},
        } as DOMRect
      }

      return originalGBCR.call(this)
    }

    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-simscrollheight')
          ? Number(this.getAttribute('data-simscrollheight'))
          : originalScrollHeight!.get!.call(this)
      },
    })

    try {
      await run()
    } finally {
      Element.prototype.getBoundingClientRect = originalGBCR

      if (originalScrollHeight) {
        Object.defineProperty(
          Element.prototype,
          'scrollHeight',
          originalScrollHeight,
        )
      }
    }
  }

  it('should push a short avoid-break block to the next page instead of splitting it', async () => {
    reportEl.setAttribute('data-simscrollheight', '1400')

    reportEl.innerHTML = `
      <div class="avoid-break" data-simtop="900" data-simbottom="1150">
        <div data-simtop="900" data-simbottom="950">Total Tests</div>
        <div data-simtop="950" data-simbottom="1150">3594</div>
      </div>
    `

    await withSimulatedLayout(async () => {
      const { generatePDF } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      await generatePDF(mockTestData, mockConfig)

      const calls = __mocks.html2canvas.mock.calls as Array<
        [unknown, { y: number; height: number }]
      >

      // Without the fix, page 1 would end at the ideal 1123px line, right
      // through the middle of the 900-1150 block. It should end at 900
      // instead, carrying the whole block onto page 2.
      expect(calls[0][1]).toMatchObject({
        y: 0,
        height: 900,
      })

      expect(calls[1][1]).toMatchObject({
        y: 900,
        height: 500,
      })
    })
  })

  it('should force a page-break-before section onto a fresh page', async () => {
    reportEl.setAttribute('data-simscrollheight', '1500')

    reportEl.innerHTML = `
      <div class="page-break-before" data-simtop="600" data-simbottom="1500">
        All Test Cases
      </div>
    `

    await withSimulatedLayout(async () => {
      const { generatePDF } = await import(
        '../components/ReportGenerator/pdfGenerator'
      )

      await generatePDF(mockTestData, mockConfig)

      const calls = __mocks.html2canvas.mock.calls as Array<
        [unknown, { y: number; height: number }]
      >

      // The forced break should end page 1 at 600, well short of the ideal
      // 1123px line, so the marked section starts clean on page 2.
      expect(calls[0][1]).toMatchObject({
        y: 0,
        height: 600,
      })

      expect(calls[1][1]).toMatchObject({
        y: 600,
        height: 900,
      })
    })
  })

  it('should clean up offscreen clone after generation', async () => {
    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    const childrenBefore = document.body.children.length

    await generatePDF(mockTestData, mockConfig)

    expect(document.body.children).toHaveLength(childrenBefore)
  })

  it('should handle timeout error', async () => {
    __mocks.html2canvas.mockRejectedValueOnce(new Error('timeout'))

    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await expect(
      generatePDF(mockTestData, mockConfig),
    ).rejects.toThrow(/timed out/)
  })

  it('should handle memory error', async () => {
    __mocks.html2canvas.mockRejectedValueOnce(
      new Error('Maximum call stack'),
    )

    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await expect(
      generatePDF(mockTestData, mockConfig),
    ).rejects.toThrow(/Not enough memory/)
  })

  it('should handle unknown error', async () => {
    __mocks.html2canvas.mockRejectedValueOnce('String error')

    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await expect(
      generatePDF(mockTestData, mockConfig),
    ).rejects.toThrow(/unknown error/)
  })

  it('should handle generic Error', async () => {
    __mocks.html2canvas.mockRejectedValueOnce(
      new Error('Something else'),
    )

    const { generatePDF } = await import(
      '../components/ReportGenerator/pdfGenerator'
    )

    await expect(
      generatePDF(mockTestData, mockConfig),
    ).rejects.toThrow(/Failed to generate PDF: Something else/)
  })

  it('should validate config structure', () => {
    expect(mockConfig).toHaveProperty('title')
    expect(mockConfig).toHaveProperty('author')
    expect(mockConfig).toHaveProperty('includeExecutiveSummary')
    expect(mockConfig).toHaveProperty('includeTestMetrics')
    expect(mockConfig).toHaveProperty('includeFailedTests')
    expect(mockConfig).toHaveProperty('includeAllTests')
    expect(mockConfig).toHaveProperty('includeResolutionProgress')
  })

  it('should validate test data structure', () => {
    expect(mockTestData.summary).toHaveProperty('total')
    expect(mockTestData.summary).toHaveProperty('passed')
    expect(mockTestData.summary).toHaveProperty('failed')
    expect(mockTestData.summary).toHaveProperty('skipped')
    expect(mockTestData.summary).toHaveProperty('time')
    expect(Array.isArray(mockTestData.suites)).toBe(true)
  })
})
