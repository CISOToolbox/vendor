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

        // Known issue: this module's input has no `data-change="loadJSON"`
        // handler, so the non-File-System-Access-API fallback is inert.
        // See the `test.fixme` below.
        expect(await page.locator('#file-input').getAttribute('data-change')).toBeNull();
    });

    // ── 5. Language preference persists locally ────────────────────────
    test('language toggle persists across a reload (localStorage ct_lang)', async ({ page }) => {
        await openApp(page);

        const before = await page.evaluate(() => localStorage.getItem('ct_lang'));
        await page.locator('[data-click="ct_toggleLang"]').click();
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

    // ── Known issue ────────────────────────────────────────────────────
    // `index.html` declares `<input type="file" id="file-input">` with no
    // `data-change="loadJSON"` handler, and no listener is attached in JS.
    // `openFile()` falls back to clicking that input when the File System
    // Access API is unavailable (Firefox, Safari, older browsers), so
    // "File > Open" silently does nothing there. Remove the `fixme` once the
    // handler is wired, and this becomes a real regression test.
    test('File > Open works without the File System Access API', async ({ page }) => {
        test.fixme(true, '#file-input has no change handler in this module');
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

    // ── Module-specific: the standalone vendor portal page ─────────────
    test('vendor portal page loads standalone with no uncaught error', async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto('/portal/');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).not.toBeEmpty();
        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });

});
