import { expect, test } from '@playwright/test';

const story = (id: string) => `/iframe.html?id=skills-repository-packages--${id}&viewMode=story&globals=theme:dark`;

test('repository import preserves its files while selecting library entrypoints', async ({ page }, info) => {
  await page.goto(story('review-repository'));
  const dialog = page.getByRole('dialog', { name: 'Import from GitHub', exact: true });
  await expect(dialog.getByRole('button', { name: 'Import repository', exact: true })).toBeEnabled();
  await expect(dialog.getByText('The full repository travels', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('repository-import.png') });

  await dialog.getByRole('button', { name: 'View 17 files', exact: true }).click();
  const files = page.getByRole('dialog', { name: 'Included repository files', exact: true });
  await expect(files.getByRole('heading', { name: 'Runtime requirements', exact: true })).toBeVisible();
  await files.getByText('NOTICE.md', { exact: true }).first().click();
  await expect(files.getByText('Example upstream credits are preserved with this repository.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('repository-files.png') });
  await files.getByRole('button', { name: 'Close', exact: true }).click();

  await dialog.locator('summary').filter({ hasText: 'Choose skills' }).click();
  await dialog.getByRole('checkbox', { name: 'Import skills/research/SKILL.md', exact: true }).uncheck();
  await expect(dialog.getByText('Choose skills · 1 selected', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'View 17 files', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import repository', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const source = page.getByRole('region', { name: 'acme/team-skills', exact: true });
  await expect(source.getByText('Code review', { exact: true })).toBeVisible();
  await expect(source.getByText('Research', { exact: true })).toHaveCount(0);
});

test('individual skill imports are an advanced opt-in', async ({ page }, info) => {
  await page.goto(story('review-repository'));
  const dialog = page.getByRole('dialog', { name: 'Import from GitHub', exact: true });
  await dialog.getByRole('button', { name: 'More import options', exact: true }).click();
  const individual = page.getByRole('menuitemcheckbox', { name: 'Import individual skills', exact: true });
  await expect(individual).not.toBeChecked();
  await page.screenshot({ path: info.outputPath('repository-advanced.png') });
  await individual.click();
  await expect(dialog.getByRole('button', { name: 'Import 4 skills', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'More import options', exact: true }).click();
  await expect(individual).toBeChecked();
  await individual.click();
  await expect(dialog.getByRole('button', { name: 'Import repository', exact: true })).toBeEnabled();
});

test('invalid supporting files block the whole repository', async ({ page }, info) => {
  await page.goto(story('blocked-package'));
  const dialog = page.getByRole('dialog', { name: 'Import from GitHub', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Unsupported symlink or submodule');
  await expect(dialog.getByRole('button', { name: 'Import repository', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('repository-blocked.png') });
});

test('the import action stays visible on mobile when skill selection expands', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(story('mobile'));
  const dialog = page.getByRole('dialog', { name: 'Import from GitHub', exact: true });
  await dialog.locator('summary').filter({ hasText: 'Choose skills' }).click();
  const button = dialog.getByRole('button', { name: 'Import repository', exact: true });
  await expect(button).toBeEnabled();
  const bounds = await button.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(812);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: info.outputPath('repository-mobile.png') });
});
