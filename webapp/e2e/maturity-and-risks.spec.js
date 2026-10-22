// @ts-check
//
// Typing in the vendor-maturity settings and filtering the risk list: a
// number is typed whole and saved when the field is left, the maturity panel
// stays open, and the risk filter keeps the columns the user hid.
//
const { test, expect } = require('@playwright/test');

async function openApp(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.ct-appbar')).toBeVisible();
}

test.describe('Vendor (TPRM) — maturity settings and risk filter', () => {
    test('a maturity weight is typed whole, saved when left, and the panel stays open', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => {
            window.D.vendors.push({ id: 'PP-M1', name: 'Maturity vendor' });
            window.D.assessments.push({ id: 'EVAL-M1', vendor_id: 'PP-M1', title: 'Annual', status: 'validated', score: 80,
                                        approved_at: '2026-10-20T07:24:04+00:00', responses: [] });
            window.selectPanel('vendors');
            window.openVendor(window.D.vendors.length - 1);
            window.setVendorTab('assessments');
        });
        await page.locator('details.maturity-detail > summary').click();
        const audit = page.locator('input[data-args*="weight_by_kind.audit"]');
        await audit.fill('');
        await audit.pressSequentially('2.5', { delay: 80 });
        await expect(audit).toHaveValue('2.5');
        await audit.press('Tab');
        await expect.poll(() => page.evaluate(() => window.D.maturity_config.weight_by_kind.audit)).toBe(2.5);
        await expect(page.locator('details.maturity-detail')).toHaveAttribute('open', '');
    });

    async function openMaturity(page) {
        await openApp(page);
        await page.evaluate(() => {
            window.D.vendors.push({ id: 'PP-M2', name: 'Maturity gestures' });
            window.D.assessments.push({ id: 'EVAL-M2', vendor_id: 'PP-M2', title: 'Annual', status: 'validated', score: 80,
                                        approved_at: '2026-10-20T07:24:04+00:00', responses: [], weight_override: 3 });
            window.selectPanel('vendors');
            window.openVendor(window.D.vendors.length - 1);
            window.setVendorTab('assessments');
        });
        await page.locator('details.maturity-detail > summary').click();
    }

    test('a negative weight typed then left is marked and not kept', async ({ page }) => {
        await openMaturity(page);
        const weight = page.locator('input[data-args*="EVAL-M2"][type="number"]');
        await weight.click();
        await weight.press('ControlOrMeta+a');
        await weight.pressSequentially('-2', { delay: 60 });
        await weight.press('Tab');
        await expect(weight).toHaveAttribute('aria-invalid', 'true');
        expect(await page.evaluate(() => window.D.assessments.find((a) => a.id === 'EVAL-M2').weight_override)).toBe(3);
    });

    test('a click right after typing a weight is not lost, and Tab reaches the next field', async ({ page }) => {
        await openMaturity(page);
        const q = page.locator('input[data-args*="weight_by_kind.questionnaire"]');
        await q.click();
        await q.press('ArrowUp');
        expect(await q.evaluate((el) => el === document.activeElement)).toBe(true);
        await q.press('Tab');
        expect(await page.locator('input[data-args*="weight_by_kind.audit"]').evaluate((el) => el === document.activeElement)).toBe(true);
        const weight = page.locator('input[data-args*="EVAL-M2"][type="number"]');
        await weight.fill('2');
        await page.locator('input[type="checkbox"][data-args*="EVAL-M2"]').click();
        await expect.poll(() => page.evaluate(() => window.D.assessments.find((a) => a.id === 'EVAL-M2').excluded)).toBe(true);
    });

    test('what is typed is saved at once, two fields in a row included', async ({ page }) => {
        await openMaturity(page);
        const audit = page.locator('input[data-args*="weight_by_kind.audit"]');
        await audit.fill('2.75');
        const weight = page.locator('input[data-args*="EVAL-M2"][type="number"]');
        await weight.fill('4');
        // Leaving the page right now loses nothing: the local save already holds both.
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tprm_autosave') || '{}'));
        const d = saved.data || saved;
        expect(d.maturity_config.weight_by_kind.audit).toBe(2.75);
        expect(d.assessments.find((a) => a.id === 'EVAL-M2').weight_override).toBe(4);
    });

    test('an emptied setting shows its value again once left', async ({ page }) => {
        await openMaturity(page);
        const audit = page.locator('input[data-args*="weight_by_kind.audit"]');
        await audit.fill('');
        await audit.press('Tab');
        await expect(audit).not.toHaveValue('');
    });

    test('the risk filter keeps the columns the user hid', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => {
            window.D.vendors.push({ id: 'PP-R1', name: 'Risk vendor' });
            window.D.risks.push({ id: 'R-1', vendor_id: 'PP-R1', title: 'Data leak', category: 'confidentiality', status: 'open' });
            window.selectPanel('risks');
        });
        await page.waitForSelector('#risk-list-table');
        await page.evaluate(() => window.hideCol('risk-list-table', 'cat'));
        const hidden = () => page.locator('#risk-list-table th[data-col="cat"]').evaluate((th) => getComputedStyle(th).display === 'none');
        expect(await hidden()).toBe(true);
        await page.locator('#risk-search').fill('Data');
        await expect.poll(hidden).toBe(true);
    });
});
