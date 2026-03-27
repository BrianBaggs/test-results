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

test.describe('XML e2e tests', () => {

  test('should show the correct number of passed tests', async ({ page }) => {
    await expect(page.locator('div.bg-green-50.rounded-lg.p-4')).toContainText('5Passed')

    await expect(page.locator('div.bg-green-50.rounded-lg.p-4').locator('.lucide-circle-check-big')).toBeVisible()
  })

  test('should show the correct number of failed tests', async ({ page }) => {
    await expect(page.locator('div.bg-red-50.rounded-lg.p-4')).toContainText('4Failed')

    await expect(page.locator('div.bg-red-50.rounded-lg.p-4').locator('.lucide-circle-x')).toBeVisible()
  })

  test('should show the correct number of skipped tests', async ({ page }) => {
    await expect(page.locator('div.bg-yellow-50.rounded-lg.p-4')).toContainText('0Skipped')

    await expect(page.locator('div.bg-yellow-50.rounded-lg.p-4').locator('.lucide-triangle-alert')).toBeVisible()
  })

  test('should show the correct duration', async ({ page }) => {
    await expect(page.locator('p.text-lg.font-bold.text-blue-600.mt-1').first()).toContainText('4s')
  })

  test('should show the correct success rate', async ({ page }) => {
    await expect(page.locator('p.text-lg.font-bold.text-blue-600.mt-1').last()).toContainText('55.6%')
  })

  test('should show the pie chart with correct percentages', async ({ page }) => {
    await expect(page.getByRole('img').filter({ hasText: '5 (55.6%)4 (44.4%)' })).toBeVisible()
  })

  test('test results should show up correctly', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test Results', exact: true })).toBeVisible()

    await expect(page.locator('div.mt-4.text-sm.text-gray-500')).toContainText('Showing 9 of 9 tests')
  })

  test('should be able to search for a test', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Search tests' }).fill('test4')

    await expect(page.getByRole('row', { name: 'test4' })).toBeVisible()

        await expect(page.locator('div.mt-4.text-sm.text-gray-500')).toContainText('Showing 1 of 9 tests')
  })

  test('modal should open when you click a row', async ({ page }) => {
    await page.getByRole('row', { name: 'test1' }).first().click()

    await expect(page.getByRole('heading', { name: 'Test Details', exact: true })).toBeVisible()

    await expect(page.locator('div').filter({ hasText: /^Test Nametest1Passed$/ }).locator('.lucide-circle-check-big')).toBeVisible()
  })

  test('reloading the page should reset the results', async ({ page }) => {
    await page.reload()

    await expect(page.getByRole('button', { name: 'Select File' })).toBeVisible()
  })
})
