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

test.describe('Progress Bulk Actions', () => {

  test('should bulk complete failure analysis items', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()

    await page.getByRole('button', { name: 'Mark as Complete' }).click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    await expect(page.locator('.text-green-500')).toHaveCount(2)
  })

  test('should bulk in progress failure analysis items', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()

    await page.getByRole('button', { name: 'Mark as In Progress' }).click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    await expect(page.locator('.text-blue-500')).toHaveCount(2)
  })

  test('should bulk comment on failure analysis items', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()

    await page.getByTestId('bulk-comment-btn').click()

    await expect(page.getByTestId('mode-same')).toBeEnabled()

    await page.getByTestId('bulk-comment-modal').getByRole('textbox').first().fill('John Doe')

    await page.getByTestId('bulk-comment-modal').getByRole('textbox').last().fill('This is a bulk comment.')

    await page.getByTestId('bulk-comment-modal').getByRole('button', { name: 'Apply Comments' }).click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    await expect(page.locator('div.p-4').filter({ hasText: 'Notes: This is a bulk comment.' })).toHaveCount(2)
  })
})
