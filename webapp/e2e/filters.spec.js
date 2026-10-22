// @ts-check
//
// Typing in a list filter keeps the focus: every keystroke lands in the
// field, the caret stays at its end and the list narrows.
//
const { test, expect } = require('@playwright/test');

async function openApp(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.ct-appbar')).toBeVisible();
    await page.evaluate(() => {
        window.D.vendors.push({ id: 'PP-F1', name: 'Alpha Cloud', status: 'active' }, { id: 'PP-F2', name: 'Beta Payroll', status: 'active' });
        window.D.risks.push({ id: 'R-F1', vendor_id: 'PP-F1', title: 'Data leak', category: 'confidentiality', status: 'open' });
    });
}

const FILTERS = [
    { name: 'vendors', open: (w) => w.selectPanel('vendors'), input: '[data-input="filterVendors"]', item: '.vendor-card' },
    { name: 'risks', open: (w) => w.selectPanel('risks'), input: '[data-input="_onRiskFilterChange"]', item: '#risk-list-table tbody tr' },
    { name: 'subcontractors', open: (w) => { w.selectPanel('vendors'); w.selectVendorListTab('subcontractors'); }, input: '[data-input="filterSubs"]', item: null },
];

test.describe('Vendor (TPRM) — list filters', () => {
    for (const f of FILTERS) {
        test(`the ${f.name} filter keeps the focus while typing`, async ({ page }) => {
            await openApp(page);
            await page.evaluate(`(${f.open.toString()})(window)`);
            await page.locator(f.input).click();
            await page.keyboard.type('zzqx', { delay: 60 });   // matches nothing
            await expect(page.locator(f.input)).toHaveValue('zzqx');
            expect(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), f.input)).toBe(true);
            expect(await page.evaluate((sel) => document.querySelector(sel).selectionStart, f.input)).toBe(4);
            if (f.item) expect(await page.locator(f.item).count()).toBe(0);
        });
    }
});
