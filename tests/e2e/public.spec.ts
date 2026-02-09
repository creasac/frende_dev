import { test, expect } from '@playwright/test'

test('login page loads', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByTestId('login-form')).toBeVisible()
})

test('signup page loads', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toBeVisible()
})

test('playground loads', async ({ page }) => {
  await page.goto('/play/translate')
  await expect(page.getByTestId('playground-input')).toBeVisible()
  await expect(page.getByTestId('playground-action')).toBeVisible()
})

test('home AI chat shows empty state', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('temp-ai-empty')).toBeVisible()
})

test('chat route redirects to login when unauthenticated', async ({ page }) => {
  await page.goto('/chat')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByTestId('login-form')).toBeVisible()
})
