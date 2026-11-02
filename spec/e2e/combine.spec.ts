import { stat } from 'node:fs/promises'
import { test, expect } from './baseFixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5190/')
})

test.describe('Combine split E2E Tests', () => {

  test('should combine split XML files', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Split' }).click()

    await expect(page.getByRole('heading', { name: 'Split a report for your team' })).toBeVisible()

    const [fileUpload] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByText('Export A', { exact: true }).click()
    ])

    await fileUpload.setFiles('./spec/testfiles/test-results-export-a.json')

    await expect(page.getByText('test-results-export-a.json')).toBeVisible()

    const [fileUploadB] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByText('Export B', { exact: true }).click()
    ])

    await fileUploadB.setFiles('./spec/testfiles/test-results-export-b.json')

    await expect(page.getByText('test-results-export-b.json')).toBeVisible()

    await page.getByRole('button', { name: 'Combine' }).click()

    await expect(page.getByTestId('combine-result')).toContainText('Combined 9 tests (4 failed) with all resolution progress merged.')

    await page.getByRole('button', { name: 'Continue to Report' }).click()

    await expect(page.getByRole('heading', { name: 'Report Generator' })).toBeVisible()

    await page.getByRole('textbox', { name: 'Author' }).fill('Tester')

    await page.getByRole('textbox', { name: 'Project Name' }).fill('Test Project')

    await page.getByRole('checkbox', { name: 'Include Failure Resolution Progress' }).check()

    await page.getByRole('button', { name: 'Preview Report' }).click()

    await expect(page.getByRole('heading', { name: 'Automated Test Results Report' })).toBeVisible()

    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click()
    ])

    expect(pdfDownload.suggestedFilename()).toBe('Test Project.pdf')

    const filePath = await pdfDownload.path()
    expect((await stat(filePath!)).size).toBeGreaterThan(300000)
  })
})
