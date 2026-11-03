import { readFile, stat } from 'node:fs/promises'
import { test, expect } from './baseFixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5190/')
})

test.describe('Shard E2E Tests', () => {

  test('should combine two realistically-balanced sharded JUnit XML reports into one file', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Shard' }).click()

    await expect(page.getByRole('heading', { name: 'Combine sharded test runs' })).toBeVisible()

    const [fileUpload] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose XML Files' }).click()
    ])

    await fileUpload.setFiles([
      './spec/testfiles/test-results-shard-1.xml',
      './spec/testfiles/test-results-shard-2.xml'
    ])

    await expect(page.getByText('test-results-shard-1.xml')).toBeVisible()
    await expect(page.getByText('test-results-shard-2.xml')).toBeVisible()

    await page.getByRole('button', { name: 'Combine Shards' }).click()

    await expect(page.getByTestId('shard-result')).toContainText('Combined 25 tests (4 failed) from 2 files across 15 suites.')

    await expect(page.getByTestId('shard-result')).not.toContainText('appears in more than one file')

    const [fileDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download Combined XML' }).click()
    ])

    await expect(fileDownload.suggestedFilename()).toBe('test-results-combined.xml')

    const filePath = await fileDownload.path()
    await expect(stat(filePath!)).resolves.toMatchObject({ size: 38197 })

    await page.getByRole('button', { name: 'View in Dashboard' }).click()

    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await expect(page.getByTestId('stat-passed')).toContainText('20Passed')

    await expect(page.getByTestId('stat-failed')).toContainText('4Failed')

    await expect(page.getByTestId('stat-skipped')).toContainText('1Skipped')
  })

  test('should keep skipped markers, attachment output and run time intact when combining real-shaped shards', async ({ page }) => {
    await page.getByRole('button', { name: 'Shard' }).click()

    const [fileUpload] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose XML Files' }).click()
    ])

    await fileUpload.setFiles([
      './spec/testfiles/test-results-shard-real-1.xml',
      './spec/testfiles/test-results-shard-real-2.xml'
    ])

    await expect(page.getByText('test-results-shard-real-2.xml')).toBeVisible()

    await page.getByRole('button', { name: 'Combine Shards' }).click()

    await expect(page.getByTestId('shard-result')).toContainText('Combined 32 tests (4 failed) from 2 files across 9 suites.')

    const [fileDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download Combined XML' }).click()
    ])

    const combined = await readFile((await fileDownload.path())!, 'utf8')

    // Root totals: counts are summed, and run time is the two shards' own root times
    // added together (222.0397 + 160.54115), not just the sum of the suites' times (332.679).
    expect(combined).toMatch(/<testsuites [^>]*tests="32"[^>]*failures="2"[^>]*errors="2"[^>]*skipped="5"[^>]*time="382\.581"/)

    // Skipped markers, <system-out> attachments and failure/error bodies are carried over as
    // child elements — the 5 skipped tests, the 6 attachment outputs and the 4 failures from the
    // source shards — never flattened into attributes on <testcase>.
    expect(combined.match(/<skipped\b/g)).toHaveLength(5)
    expect(combined.match(/<system-out>/g)).toHaveLength(6)
    expect(combined.match(/<(failure|error)\b/g)).toHaveLength(4)
    expect(combined).not.toMatch(/<testcase[^>]*\s(skipped|system-out|properties)=/)

    // Stack traces and attachment output stay wrapped in CDATA exactly as in the source shards,
    // so they load back with their original indentation and trailing newlines.
    const cdataIn = async (path: string) => ((await readFile(path, 'utf8')).match(/<!\[CDATA\[/g) ?? []).length
    const sourceCdata = (await cdataIn('./spec/testfiles/test-results-shard-real-1.xml')) + (await cdataIn('./spec/testfiles/test-results-shard-real-2.xml'))
    expect(sourceCdata).toBeGreaterThan(0)
    expect(combined.match(/<!\[CDATA\[/g)).toHaveLength(sourceCdata)

    await page.getByRole('button', { name: 'View in Dashboard' }).click()

    await expect(page.getByTestId('stat-failed')).toContainText('4Failed')

    await expect(page.getByTestId('stat-skipped')).toContainText('5Skipped')

    await expect(page.getByTestId('stat-flaky')).toContainText('2')
  })

  test('should remove an uploaded shard before combining', async ({ page }) => {
    await page.getByRole('button', { name: 'Shard' }).click()

    const [fileUpload] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose XML Files' }).click()
    ])

    await fileUpload.setFiles([
      './spec/testfiles/test-results-shard-1.xml',
      './spec/testfiles/test-results-shard-2.xml'
    ])

    await expect(page.getByText('test-results-shard-2.xml')).toBeVisible()

    await page.getByRole('button', { name: 'Remove test-results-shard-2.xml' }).click()

    await expect(page.getByText('test-results-shard-2.xml')).not.toBeVisible()

    await expect(page.getByText('Add at least one more shard report to combine.')).toBeVisible()

    await expect(page.getByRole('button', { name: 'Combine Shards' })).toBeDisabled()
  })

  test('should combine three shards, de-duplicating a suite that genuinely reappears across files', async ({ page }) => {
    await page.getByRole('button', { name: 'Shard' }).click()

    const [fileUpload] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose XML Files' }).click()
    ])

    await fileUpload.setFiles([
      './spec/testfiles/test-results-shard-1.xml',
      './spec/testfiles/test-results-shard-2.xml',
      './spec/testfiles/test-results-shard-3.xml'
    ])

    await expect(page.getByText('test-results-shard-3.xml')).toBeVisible()

    await page.getByRole('button', { name: 'Combine Shards' }).click()

    await expect(page.getByText(/Suite ".*false_positive\.spec\.ts" was identical.*counted once, not 2 times/)).toBeVisible()

    await expect(page.getByTestId('shard-result')).toContainText('Combined 31 tests (4 failed) from 3 files across 19 suites.')

    // The de-duplication keeps the Dashboard's raw per-suite count and the Progress
    // tab's per-test-identity count in agreement, instead of silently disagreeing.
    await page.getByRole('button', { name: 'View in Dashboard' }).click()

    await expect(page.getByTestId('stat-failed')).toContainText('4Failed')

    await page.getByRole('button', { name: 'Progress' }).click()

    await expect(page.getByText('Total Tracked Tests').locator('..').getByText('4')).toBeVisible()
  })

  test('should treat the same shard report uploaded twice as one copy, not a double-count', async ({ page }) => {
    await page.getByRole('button', { name: 'Shard' }).click()

    const [firstUpload] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose XML Files' }).click()
    ])

    await firstUpload.setFiles('./spec/testfiles/test-results-shard-1.xml')

    const [secondUpload] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose XML Files' }).click()
    ])

    await secondUpload.setFiles('./spec/testfiles/test-results-shard-1.xml')

    await expect(page.getByLabel('Uploaded shard reports').getByText('test-results-shard-1.xml')).toHaveCount(2)

    await page.getByRole('button', { name: 'Combine Shards' }).click()

    await expect(page.getByText(/are byte-for-byte identical/)).toBeVisible()

    // Deduplicated down to exactly what shard-1 alone contains — not doubled.
    await expect(page.getByTestId('shard-result')).toContainText('Combined 13 tests (3 failed) from 2 files across 7 suites.')

    await page.getByRole('button', { name: 'View in Dashboard' }).click()

    await expect(page.getByTestId('stat-failed')).toContainText('3Failed')

    await page.getByRole('button', { name: 'Progress' }).click()

    await expect(page.getByText('Total Tracked Tests').locator('..').getByText('3')).toBeVisible()
  })
})
