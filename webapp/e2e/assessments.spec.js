// @ts-check
//
// Assessment rules of the browser-only Vendor app, as in the server-backed
// module: an approved assessment is read-only, and the default questionnaire
// and audit templates exist in French and in English.
//
const { test, expect } = require('@playwright/test');

const NAV_ITEMS = '.ct-rail-item[data-click="selectPanel"]';

async function openApp(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.ct-appbar')).toBeVisible();
}

test.describe('Vendor (TPRM) — assessments', () => {
    test('an approved assessment opens read-only and opening it writes nothing', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await openApp(page);
        const before = await page.evaluate(() => {
            const D = window.D;
            D.vendors.push({ id: 'PP-E2E', name: 'Approved vendor' });
            // A stored score a recomputation would change: a write on opening shows.
            D.assessments.push({
                id: 'EVAL-E2E', vendor_id: 'PP-E2E', title: 'Annual', status: 'validated', score: 37,
                completion_rate: 40, self_validation: true, approved_at: '2026-10-20T07:24:04+00:00',
                template_snapshot: { sections: [{ id: 's1', title: 'Access', questions: [
                    { id: 'q1', text: 'Is MFA enforced?', criticality: 'high', weight: 3 }] }] },
                responses: [{ question_id: 'q1', coverage: 'covered', comment: '', justification: '', action_plans: [] }],
            });
            // Captured BEFORE opening: anything opening writes is a difference.
            return { record: JSON.stringify(D.assessments.find((a) => a.id === 'EVAL-E2E')),
                     saved: localStorage.getItem('tprm_autosave') };
        });
        await page.evaluate(() => window.openAssessmentV2('EVAL-E2E'));
        await page.waitForTimeout(1500);   // past the autosave debounce
        const opened = await page.evaluate(() => ({ record: JSON.stringify(window.D.assessments.find((a) => a.id === 'EVAL-E2E')),
                                                    saved: localStorage.getItem('tprm_autosave') }));
        expect(opened.record).toBe(before.record);   // opening rewrote nothing…
        expect(opened.saved).toBe(before.saved);     // …and saved nothing
        await expect(page.locator('#evalv2-locked')).toBeVisible();
        const enabled = await page.locator('#evalv2-body input, #evalv2-body select, #evalv2-body textarea, #evalv2-body button')
            .evaluateAll((els) => els.filter((el) => !el.disabled).length);
        expect(enabled).toBe(0);
        // A handler called anyway (e.g. from the console) changes nothing either.
        await page.evaluate(() => window._setCoverage('EVAL-E2E', 'q1', 'not_covered'));
        await page.waitForTimeout(1500);   // past the autosave debounce
        const after = await page.evaluate(() => ({ record: JSON.stringify(window.D.assessments.find((a) => a.id === 'EVAL-E2E')),
                                                   saved: localStorage.getItem('tprm_autosave') }));
        expect(after.record).toBe(before.record);
        expect(after.saved).toBe(before.saved);
        expect(errors).toEqual([]);
    });

    test('an assessment in progress stays editable', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => {
            window.D.vendors.push({ id: 'PP-E2F', name: 'Open vendor' });
            window.D.assessments.push({
                id: 'EVAL-E2F', vendor_id: 'PP-E2F', title: 'Annual', status: 'in_progress',
                template_snapshot: { sections: [{ id: 's1', title: 'Access', questions: [
                    { id: 'q1', text: 'Is MFA enforced?', criticality: 'high', weight: 3 }] }] },
                responses: [{ question_id: 'q1', coverage: null, comment: '', justification: '', action_plans: [] }],
            });
            window.openAssessmentV2('EVAL-E2F');
        });
        await expect(page.locator('#evalv2-locked')).toHaveCount(0);
        const enabled = await page.locator('#evalv2-body input, #evalv2-body select, #evalv2-body textarea')
            .evaluateAll((els) => els.filter((el) => !el.disabled).length);
        expect(enabled).toBeGreaterThan(0);
    });

    test('an existing French project gains the English templates, once', async ({ page }) => {
        await openApp(page);
        const out = await page.evaluate(() => {
            const D = window.D;
            // A project saved before the bilingual templates: the French ones only, under their historical ids.
            const q = window._buildDefaultQuestionnaireTemplate('fr');
            const audit = window._buildAnssi42AuditTemplate('fr');
            q.id = 'TPL-001'; audit.id = 'TPL-002';
            D.questionnaire_templates = [q, audit];
            window._ensureDefaultTemplate();
            const first = D.questionnaire_templates.map((tp) => tp.id).sort();
            window._ensureDefaultTemplate();
            return { first, second: D.questionnaire_templates.map((tp) => tp.id).sort(),
                     english: D.questionnaire_templates.filter((tp) => tp.language === 'en').map((tp) => tp.id).sort() };
        });
        expect(out.first).toEqual(['TPL-001', 'TPL-001-EN', 'TPL-002', 'TPL-002-EN']);
        expect(out.english).toEqual(['TPL-001-EN', 'TPL-002-EN']);
        expect(out.second).toEqual(out.first);   // not added twice
    });

    test('an AI suggestion arriving after the approval writes nothing', async ({ page }) => {
        await openApp(page);
        const coverage = await page.evaluate(async () => {
            const D = window.D;
            D.vendors.push({ id: 'PP-E2G', name: 'AI vendor' });
            D.assessments.push({
                id: 'EVAL-E2G', vendor_id: 'PP-E2G', title: 'Annual', status: 'pending_approval', self_validation: true,
                template_snapshot: { sections: [{ id: 's1', title: 'Access', questions: [
                    { id: 'q1', text: 'Is MFA enforced?', criticality: 'high', weight: 3 }] }] },
                responses: [{ question_id: 'q1', coverage: 'covered', comment: '', justification: '', action_plans: [] }],
            });
            let answer;
            window._aiCallAPI = () => new Promise((resolve) => { answer = resolve; });   // the provider answers later
            window.aiSuggestSectionV2('EVAL-E2G', 's1');
            const a = D.assessments.find((x) => x.id === 'EVAL-E2G');
            a.status = 'validated';                                                      // approved meanwhile
            answer(JSON.stringify([{ question_id: 'q1', coverage: 'not_covered', justification: 'none' }]));
            await new Promise((r) => setTimeout(r, 200));
            return a.responses[0].coverage;
        });
        expect(coverage).toBe('covered');
    });

    test('the default questionnaire and audit exist in French and in English', async ({ page }) => {
        await openApp(page);
        await page.locator(NAV_ITEMS, { hasText: /Modèles|Templates/i }).first().click();
        const byLang = await page.evaluate(() => {
            const out = { fr: 0, en: 0 };
            (window.D.questionnaire_templates || []).forEach((tp) => { if (tp.language in out) out[tp.language]++; });
            return out;
        });
        expect(byLang.fr).toBeGreaterThanOrEqual(2);
        expect(byLang.en).toBeGreaterThanOrEqual(2);
    });
});
