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

    await page.getByRole('button', { name: 'Mark as Complete' }).first().click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    await expect(page.locator('.text-green-500')).toHaveCount(2)
  })

  test('should bulk in progress failure analysis items', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()

    await page.getByRole('button', { name: 'Mark as In Progress' }).first().click()

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

    await page.getByTestId('bulk-assignee-input').fill('John Doe')

    await page.getByTestId('shared-comment-input').fill('This is a bulk comment.')

    await page.getByTestId('bulk-comment-modal').getByRole('button', { name: 'Apply Comments' }).click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    await expect(page.locator('div.p-4').filter({ hasText: 'Notes: This is a bulk comment.' })).toHaveCount(2)
  })

  test('should bulk comment with status change in same mode', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()

    await page.getByTestId('bulk-comment-btn').click()

    await page.getByTestId('bulk-status-select').selectOption('completed')

    await page.getByTestId('bulk-assignee-input').fill('Team Lead')

    await page.getByTestId('shared-comment-input').fill('All resolved.')

    await page.getByTestId('bulk-comment-modal').getByRole('button', { name: 'Apply Comments' }).click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    await expect(page.locator('.text-green-500')).toHaveCount(2)

    await expect(page.locator('div.p-4').filter({ hasText: 'Notes: All resolved.' })).toHaveCount(2)

    await expect(page.locator('div.p-4').filter({ hasText: 'Assignee: Team Lead' })).toHaveCount(2)
  })

  test('should set individual assignees and notes in individual mode', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()

    await page.getByTestId('bulk-comment-btn').click()

    await page.getByTestId('mode-individual').click()

    // The bulk status/assignee should be hidden in individual mode
    await expect(page.getByTestId('bulk-status-select')).toBeHidden()
    await expect(page.getByTestId('bulk-assignee-input')).toBeHidden()

    // Fill individual assignees for both items
    const assigneeInputs = page.locator('[data-testid^="individual-assignee-"]')
    await assigneeInputs.first().fill('Alice')
    await assigneeInputs.last().fill('Bob')

    // Fill individual notes for both items
    const commentInputs = page.locator('[data-testid^="individual-comment-"]')
    await commentInputs.first().fill('Fix for first item')
    await commentInputs.last().fill('Fix for last item')

    await page.getByTestId('bulk-comment-modal').getByRole('button', { name: 'Apply Comments' }).click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    await expect(page.locator('div.p-4').filter({ hasText: 'Assignee: Alice' })).toHaveCount(1)
    await expect(page.locator('div.p-4').filter({ hasText: 'Assignee: Bob' })).toHaveCount(1)
    await expect(page.locator('div.p-4').filter({ hasText: 'Notes: Fix for first item' })).toHaveCount(1)
    await expect(page.locator('div.p-4').filter({ hasText: 'Notes: Fix for last item' })).toHaveCount(1)
  })

  test('should set individual statuses in individual mode', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Progress' }).click()

    await page.locator('div.space-y-4').getByRole('checkbox').first().check()

    await page.locator('div.space-y-4').getByRole('checkbox').last().check()

    await expect(page.getByRole('checkbox', { name: 'Select All (2 selected)' })).toBeVisible()

    await page.getByTestId('bulk-comment-btn').click()

    await page.getByTestId('mode-individual').click()

    // Set different statuses for each item
    const statusSelects = page.locator('[data-testid^="individual-status-"]')
    await statusSelects.first().selectOption('completed')
    await statusSelects.last().selectOption('in_progress')

    await page.getByTestId('bulk-comment-modal').getByRole('button', { name: 'Apply Comments' }).click()

    await expect(page.getByRole('checkbox', { name: 'Select All (0 selected)' })).toBeVisible()

    // First item should be green (completed), last should be blue (in_progress)
    await expect(page.locator('.text-green-500')).toHaveCount(1)
    await expect(page.locator('.text-blue-500')).toHaveCount(1)
  })
})
