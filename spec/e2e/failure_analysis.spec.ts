import { test, expect } from './baseFixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5173/')

  const [fileUpload] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Select File' }).click()
  ])

  await fileUpload.setFiles('./spec/testfiles/sample.xml')

  await expect(page.getByRole('heading', { name: 'Test Execution Summary' })).toBeVisible()
})

test.describe('Progress Page', () => {

  test('should open stack trace modal', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.getByRole('button', { name: 'View Stack Trace' }).first().click()

    await expect(page.getByRole('heading', { name: 'Test Details' })).toBeVisible()

    await expect(page.locator('pre.p-4.text-sm')).toContainText('First failure in Suite A')
  })

  test('should search for a specific test', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.getByRole('textbox', { name: 'Search tests' }).fill('test3')

    await expect(page.getByRole('heading', { name: 'test3' })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'test1' })).toBeHidden()

    await expect(page.getByRole('heading', { name: 'test2' }).first()).toBeHidden()

    await expect(page.getByRole('heading', { name: 'test2' }).last()).toBeHidden()

    await page.getByRole('button', { name: 'Clear Filters' }).click()

    await expect(page.getByRole('heading', { name: 'test1' })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'test2' }).first()).toBeVisible()

    await expect(page.getByRole('heading', { name: 'test2' }).last()).toBeVisible()

    await expect(page.getByRole('heading', { name: 'test3' })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'test2' }).last()).toBeVisible()
  })
})
