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

test.describe('Floating Bulk Actions Bar', () => {

  test('should show floating bar when items are selected', async ({ page }) => {
    await page.getByRole('button', { name: 'Progress' }).click()

    // Floating bar should not be visible initially
    await expect(page.getByTestId('floating-bulk-actions-bar')).toBeHidden()

    // Select first item
    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    // Floating bar should now be visible
    await expect(page.getByTestId('floating-bulk-actions-bar')).toBeVisible()
    await expect(page.getByTestId('floating-selected-count')).toHaveText('1 selected')
  })

  test('should clear selection via floating bar clear button', async ({ page }) => {
    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()
    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByTestId('floating-selected-count')).toHaveText('2 selected')

    // Click clear selection on the floating bar
    await page.getByTestId('floating-clear-selection').click()

    // Floating bar should disappear
    await expect(page.getByTestId('floating-bulk-actions-bar')).toBeHidden()

    // Top bar should show 0 selected
    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()
  })

  test('should mark items as complete via floating bar', async ({ page }) => {
    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()
    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByTestId('floating-selected-count')).toHaveText('2 selected')

    await page.getByTestId('floating-mark-complete').click()

    // Selection should be cleared and floating bar hidden
    await expect(page.getByTestId('floating-bulk-actions-bar')).toBeHidden()

    // Items should be marked as complete (green icons)
    await expect(page.locator('.text-green-500')).toHaveCount(2)
  })

  test('should mark items as in progress via floating bar', async ({ page }) => {
    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()
    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await page.getByTestId('floating-mark-in-progress').click()

    await expect(page.getByTestId('floating-bulk-actions-bar')).toBeHidden()
    await expect(page.locator('.text-blue-500')).toHaveCount(2)
  })

  test('should mark items as pending via floating bar', async ({ page }) => {
    await page.getByRole('button', { name: 'Progress' }).click()

    // First mark items as complete
    await page.locator('div.space-y-4').getByRole('checkbox').first().check()
    await page.locator('div.space-y-4').getByRole('checkbox').last().check()
    await page.getByTestId('floating-mark-complete').click()

    // Now re-select and mark as pending
    await page.locator('div.space-y-4').getByRole('checkbox').first().check()
    await page.locator('div.space-y-4').getByRole('checkbox').last().check()
    await page.getByTestId('floating-mark-pending').click()

    await expect(page.getByTestId('floating-bulk-actions-bar')).toBeHidden()
    await expect(page.locator('.text-red-500')).toHaveCount(2)
  })

  test('should open bulk comment modal via floating bar', async ({ page }) => {
    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()
    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await page.getByTestId('floating-bulk-comment-btn').click()

    // The bulk comment modal should appear
    await expect(page.getByTestId('bulk-comment-modal')).toBeVisible()

    await page.getByTestId('shared-comment-input').fill('Comment from floating bar')

    await page.getByTestId('bulk-comment-modal').getByRole('button', { name: 'Apply Comments' }).click()

    await expect(page.locator('div.p-4').filter({ hasText: 'Notes: Comment from floating bar' })).toHaveCount(2)
  })

  test('should toggle select all via floating bar', async ({ page }) => {
    await page.getByRole('button', { name: 'Progress' }).click()

    // Select one item to make the floating bar appear
    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await expect(page.getByTestId('floating-bulk-actions-bar')).toBeVisible()

    // Click select all on floating bar to select all items
    await page.getByTestId('floating-select-all').check()

    // All items should now be selected - the top bar reflects it
    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()
    await expect(page.getByTestId('floating-selected-count')).toHaveText('2 selected')
  })
})
