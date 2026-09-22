// @ts-check
//
// End-to-end smoke journeys for the CISO Toolbox Vendor (TPRM) module.
//
// These run against a local static server (see playwright.config.js) — the app
// has no backend, so the suite must never need one. Everything asserted here
// is about the local frontend: boot, navigation, i18n/theme preferences and
// local (localStorage + file) persistence.
//
// The suite is self-contained: no journey reads a dataset shipped in the
// repository. Whenever a test needs a registry to work with, it creates one
// through the application's own UI.
//
const { test, expect } = require('@playwright/test');

const AUTOSAVE_KEY = 'tprm_autosave';
// The rail also holds help-overlay triggers; only these entries switch panel.
const NAV_ITEMS = '.ct-rail-item[data-click="selectPanel"]';

/** Collect uncaught page errors for the lifetime of a test. */
function trackErrors(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    return errors;
}

/** Fresh app, no leftover state from a previous journey. */
async function openApp(page, url = '/') {
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.ct-appbar')).toBeVisible();
}

/**
 * Give the suite a registry to work with, created the way a user would:
 * "Fournisseurs" → "Ajouter", which asks for the name through a native
 * prompt. Returns the vendor name, unique per run so an assertion cannot
 * pass on stale state.
 */
async function seedVendor(page) {
    const name = `E2E Vendor ${Date.now()}`;
    await page.locator(NAV_ITEMS, { hasText: /Fournisseurs|Vendors|Tiers/i }).first().click();
    await expect(page.locator('#content')).not.toBeEmpty();

    page.once('dialog', (d) => d.accept(name));
    await page.locator('[data-click="addVendor"]').first().click();
    await expect(page.locator('#content')).toContainText(name);
    return name;
}

test.describe('Vendor (TPRM) — local frontend journeys', () => {

    // ── 1. Boot ────────────────────────────────────────────────────────
    test('page load: the app shell boots with no uncaught error', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);

        await expect(page).toHaveTitle(/Vendor/i);
        await expect(page.locator('.ct-appbar')).toBeVisible();
        await expect(page.locator('.ct-rail')).toBeVisible();

        const rail = page.locator(NAV_ITEMS);
        expect(await rail.count()).toBeGreaterThanOrEqual(6);

        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

    // ── 2. Offline by construction ─────────────────────────────────────
    test('no request leaves the local origin (the app has no backend)', async ({ page }) => {
        const external = [];
        page.on('request', (r) => {
            const u = new URL(r.url());
            if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol !== 'data:') {
                external.push(r.url());
            }
        });

        await openApp(page);
        for (const item of await page.locator(NAV_ITEMS).all()) {
            await item.click();
            await page.waitForTimeout(120);
        }

        expect(external, `unexpected external requests: ${external.join(' | ')}`).toEqual([]);
    });

    // ── 3. Navigation ──────────────────────────────────────────────────
    test('navigation: every rail entry opens its panel without error', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);

        const items = await page.locator(NAV_ITEMS).all();
        expect(items.length).toBeGreaterThanOrEqual(6);

        for (const item of items) {
            const label = (await item.innerText()).trim();
            await item.click();
            await page.waitForTimeout(150);
            // Whatever the module's panel strategy (#panel-x.active or #content),
            // something must be rendered in the body area.
            const body = page.locator('.tab-panel.active, #content, .ct-content').first();
            await expect(body, `empty panel after clicking "${label}"`).not.toBeEmpty();
        }

        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

    // ── 4. File menu ───────────────────────────────────────────────────
    test('file menu exposes open / save and a hidden file input', async ({ page }) => {
        await openApp(page);

        await page.locator('.toolbar-menu button').first().click();
        const menu = page.locator('#io-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.toolbar-dropdown-item')).not.toHaveCount(0);

        // The file input is the local-persistence entry point; it must exist
        // and stay hidden (it is driven by the menu, not clicked directly).
        await expect(page.locator('#file-input')).toHaveCount(1);
        await expect(page.locator('#file-input')).toBeHidden();

        // The fallback path used when the File System Access API is absent:
        // the input carries its own handler.
        expect(await page.locator('#file-input').getAttribute('data-change')).toBe('loadJSON');
    });

    // ── 5. Language preference persists locally ────────────────────────
    test('language toggle persists across a reload (localStorage ct_lang)', async ({ page }) => {
        await openApp(page);

        const before = await page.evaluate(() => localStorage.getItem('ct_lang'));
        // The globe opens the list of deployed languages; picking the one that
        // is not current is what stores the preference.
        await page.locator('[data-click="ct_toggleLang"]').click();
        const menu = page.locator('#ct-lang-menu');
        await expect(menu).toBeVisible();
        await menu.locator('.ct-lang-item:not(.active)').first().click();
        await page.waitForTimeout(400);

        const after = await page.evaluate(() => localStorage.getItem('ct_lang'));
        expect(after).not.toBe(before);
        expect(['fr', 'en']).toContain(after);

        await page.reload();
        await expect(page.locator('.ct-appbar')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('ct_lang'))).toBe(after);
    });

    // ── 6. Theme preference persists locally ───────────────────────────
    test('theme toggle persists across a reload (localStorage ct_theme)', async ({ page }) => {
        await openApp(page);

        await page.locator('[data-click="ct_toggleTheme"]').click();
        await page.waitForTimeout(200);
        const theme = await page.evaluate(() => localStorage.getItem('ct_theme'));
        expect(['light', 'dark']).toContain(theme);

        await page.reload();
        await expect(page.locator('.ct-appbar')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('ct_theme'))).toBe(theme);
    });

    // ── 7. Local persistence: create, reload, data is still there ──────
    //
    // The journey builds its own state through the UI — it must never depend
    // on a dataset shipped in the repository. The registry lands in
    // localStorage and must still be there on the next visit, with no file
    // and no server.
    test('local persistence: a vendor created in the app survives a reload', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);

        expect(await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY)).toBeNull();

        const name = await seedVendor(page);

        const saved = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
        expect(saved, 'the new vendor should be autosaved in localStorage').toBeTruthy();
        expect(saved).toContain(name);

        await page.reload();
        await expect(page.locator('.ct-appbar')).toBeVisible();

        const restored = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
        expect(restored).toContain(name);
        await expect(page.locator('#content, .tab-panel.active').first()).not.toBeEmpty();

        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

    // `openFile()` falls back to the file input when the File System Access
    // API is unavailable (Firefox, Safari, older browsers): the journey holds
    // that path, which the input's own handler now serves.
    test('File > Open works without the File System Access API', async ({ page }) => {
        await openApp(page);

        // The payload is built here on purpose: the suite ships no fixture.
        const name = `E2E Vendor ${Date.now()}`;
        await page.setInputFiles('#file-input', {
            name: 'registry.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ vendors: [{ id: 'PP-001', name }] })),
        });
        await page.waitForTimeout(1500);
        expect(await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY)).toContain(name);
    });

    // ── Known issue ────────────────────────────────────────────────────
    // `_checkAutoSaveBanner()` builds the "previous session found" banner and
    // inserts it with `document.body.insertBefore(banner, layoutEl)`, but
    // `.ct-body` is a child of `.ct-app`, not of `<body>` — the call throws
    // and the surrounding `catch {}` swallows it. The autosave is written and
    // survives (test 7), yet nothing ever offers to restore it. Remove the
    // `fixme` once the insertion point is fixed.
    test('the autosaved session can be restored from the banner', async ({ page }) => {
        test.fixme(true, 'the restore banner is never inserted (see comment above)');
        await openApp(page);
        const name = await seedVendor(page);

        await page.reload();
        await expect(page.locator('#restore-banner')).toBeVisible();
        await page.locator('#restore-banner .btn-restore').click();
        await expect(page.locator('#content')).toContainText(name);
    });

    // ── Module-specific: vendor registry ───────────────────────────────
    test('vendor registry renders a vendor added from the UI', async ({ page }) => {
        await openApp(page);
        const name = await seedVendor(page);

        await page.locator(NAV_ITEMS, { hasText: /Tiers|Vendors|Fournisseurs/i }).first().click();
        await expect(page.locator('#content')).toContainText(name);
    });

    // ── Module-specific: non-conformities and derogations ──────────────
    //
    // The register works here as in the server-backed module, except that
    // there is nobody else to ask: whoever holds the file declares, requests
    // and approves. The journey walks that path on a third party and checks
    // the acceptance shows on its page and survives a reload.
    test('a third party can be derogated, approved locally, and it survives a reload', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);
        const name = await seedVendor(page);

        // The third party's page carries the two gestures of the register.
        await expect(page.locator('[data-click="_declareNcVendor"]')).toBeVisible();
        await page.locator('[data-click="_requestDerogVendor"]').first().click();
        const modal = page.locator('.ct-modal-box').first();
        await expect(modal.locator('#ct-der-subject .ct-ref-tag')).toContainText(name);
        await modal.locator('#ct-der-just').fill('Contract signed before the assessment; assessment booked.');
        await expect(modal.locator('#ct-der-owner-plain')).toBeVisible();     // no directory in a file
        await modal.locator('#ct-der-owner-plain').fill('Purchasing');
        await modal.locator('#ct-der-approver-plain').fill('Security lead');
        const until = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
        await modal.locator('#ct-der-until').fill(until);
        await modal.getByRole('button', { name: /^(Soumettre la demande|Submit request)$/ }).click();
        await expect(page.locator('.ct-modal-box')).toHaveCount(0);

        // The register lists it, pending; approving it is a local decision.
        await page.locator(NAV_ITEMS, { hasText: /Non-conformit/i }).first().click();
        const register = page.locator('#nonconformities-content');
        await expect(register).toContainText(/DER-\d{4}-\d{3}/);
        await register.getByText(/DER-\d{4}-\d{3}/).first().click();
        await page.locator('.ct-modal-box').first().getByRole('button', { name: /^(Approuver|Approve)$/ }).click();
        await page.locator('.ct-modal-box').first().getByRole('button', { name: /^(Confirmer|Confirm)$/ }).click();
        await expect(page.locator('.ct-modal-box')).toHaveCount(0);
        await expect(register).toContainText(/Approuvée|Approved/);

        // The third party's page says so, and the file keeps it.
        await page.locator(NAV_ITEMS, { hasText: /Fournisseurs|Vendors|Tiers/i }).first().click();
        await page.locator('#content').getByText(name).first().click();
        await expect(page.locator('#content')).toContainText(/Dérogation DER-|Derogation DER-/);

        await page.reload();
        await expect(page.locator('.ct-appbar')).toBeVisible();
        const saved = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
        expect(saved).toContain('"status":"approved"');
        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

    test('removing a third party settles what covered it', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);
        const name = await seedVendor(page);

        // An acceptance granted on that third party…
        await page.locator('[data-click="_requestDerogVendor"]').first().click();
        const modal = page.locator('.ct-modal-box').first();
        await modal.locator('#ct-der-just').fill('Accepted until the next assessment.');
        await modal.locator('#ct-der-owner-plain').fill('Purchasing');
        await modal.locator('#ct-der-approver-plain').fill('Security lead');
        await modal.locator('#ct-der-until').fill(new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
        await modal.getByRole('button', { name: /^(Soumettre la demande|Submit request)$/ }).click();
        await page.locator(NAV_ITEMS, { hasText: /Non-conformit/i }).first().click();
        const register = page.locator('#nonconformities-content');
        await register.getByText(/DER-\d{4}-\d{3}/).first().click();
        await page.locator('.ct-modal-box').first().getByRole('button', { name: /^(Approuver|Approve)$/ }).click();
        await page.locator('.ct-modal-box').first().getByRole('button', { name: /^(Confirmer|Confirm)$/ }).click();
        await expect(register).toContainText(/Approuvée|Approved/);

        // …falls when the third party leaves the file.
        await page.locator(NAV_ITEMS, { hasText: /Fournisseurs|Vendors|Tiers/i }).first().click();
        await page.locator('#content').getByText(name).first().click();
        page.once('dialog', (d) => d.accept());
        await page.locator('[data-click="deleteVendor"]').first().click();
        await page.locator(NAV_ITEMS, { hasText: /Non-conformit/i }).first().click();
        await expect(register).toContainText(/Révoquée|Revoked/);

        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

    test('a third party nobody registered is created from the declaration', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);
        await page.locator(NAV_ITEMS, { hasText: /Non-conformit/i }).first().click();
        await page.locator('[data-click="_ctNcDeclare"]').click();
        const modal = page.locator('.ct-modal-box').first();
        await modal.locator('#ct-nc-title').fill('Invoices from a provider in no register');
        await modal.locator('#ct-nc-items .ct-ref-tags').first().click();
        await modal.locator('#ct-nc-items .ct-ref-create').click();
        await expect(page.locator('#ct-cv-name')).toBeVisible();
        const created = `Ghost Consulting ${Date.now()}`;
        await page.locator('#ct-cv-name').fill(created);
        await page.locator('.ct-modal-box').first().getByRole('button', { name: /^(Créer le tiers|Create the third party)$/ }).click();

        // Back on the declaration, with the third party selected.
        const back = page.locator('.ct-modal-box').first();
        await expect(back.locator('#ct-nc-items .ct-ref-tag').first()).toContainText(created);
        await back.getByRole('button', { name: /^(Déclarer|Declare)$/ }).click();
        await expect(page.locator('.ct-modal-box')).toHaveCount(0);
        await expect(page.locator('#nonconformities-content')).toContainText(/NC-\d{4}-\d{3}/);

        // And it is now a third party of the file.
        await page.locator(NAV_ITEMS, { hasText: /Fournisseurs|Vendors|Tiers/i }).first().click();
        await expect(page.locator('#content')).toContainText(created);
        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

    // ── Module-specific: the standalone vendor portal page ─────────────
    test('vendor portal page loads standalone with no uncaught error', async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto('/portal/');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).not.toBeEmpty();
        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

});
