import { test, expect } from './baseFixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5190/')

  const [fileUpload] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Select File' }).click()
  ])

  await fileUpload.setFiles('./spec/testfiles/sample.xml')

  await expect(page.getByRole('heading', { name: 'Test Execution Summary' })).toBeVisible()
})

test.describe('Report Page', () => {

  test('should render report preview', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('navigation').getByRole('button', { name: 'Report' }).click()

    await page.getByRole('textbox', { name: 'Author' }).fill('Test User')

    await page.getByRole('textbox', { name: 'Project Name' }).fill('Test Project')

    await expect(page.getByRole('textbox', { name: 'Report Title' })).toHaveValue('Automated Test Results Report')

    await expect(page.getByRole('checkbox', { name: 'Include Executive Summary' })).toBeChecked()

    await expect(page.getByRole('checkbox', { name: 'Include Test Metrics and' })).toBeChecked()

    await expect(page.getByRole('checkbox', { name: 'Include Failed Tests Details' })).toBeChecked()

    await expect(page.getByRole('checkbox', { name: 'Include All Test Cases' })).not.toBeChecked()

    await page.getByRole('checkbox', { name: 'Include Failure Resolution' }).check()

    await page.getByRole('button', { name: 'Preview Report' }).click()

    await expect(page.getByTestId('preview-container')).toBeVisible()

    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click()
    ])

    expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  })

  test('should name the downloaded PDF after the project name', async ({ page }) => {
    await page.getByRole('navigation').getByRole('button', { name: 'Report' }).click()

    await page.getByRole('textbox', { name: 'Project Name' }).fill('Release-November-2 Critical')

    await page.getByRole('button', { name: 'Preview Report' }).click()

    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click()
    ])

    expect(download.suggestedFilename()).toBe('Release-November-2 Critical.pdf')
  })

  test('should use a date-stamped PDF name when the project name is empty', async ({ page }) => {
    await page.getByRole('navigation').getByRole('button', { name: 'Report' }).click()

    await page.getByRole('button', { name: 'Preview Report' }).click()

    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click()
    ])

    expect(download.suggestedFilename()).toMatch(/^test-results-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  })
})
