/**
 * Vendor Portal — types of the questionnaire exchanged with the Vendor app.
 * Pure type file (no emit). Same shapes as TPRM_types.d.ts (separate tsc
 * program — minimal duplication accepted). Reference schema:
 * backend-clients/demo-docker/vendor/src/assessment_validation.py.
 */

type VpCoverage = "covered" | "partial" | "not_covered" | "not_applicable" | null;

interface VpFileAnswer { name: string; size: number; data: string; }

type VpAnswer = string | string[] | VpFileAnswer | null;

interface VpActionPlan {
    id: string;
    title: string;
    description: string;
    target_date: string;
    owner: string;
    status?: string;
}

interface VpResponse {
    question_id: string;
    coverage: VpCoverage;
    answer: VpAnswer;
    comment: string;
    action_plans: VpActionPlan[];
    justification: string;
}

interface VpTemplateQuestion {
    id: string;
    text?: string;
    expected?: string;
    type?: string;
    weight?: number;
    criticality?: string;
    options?: string[];
    [k: string]: any;
}

interface VpTemplateSection {
    id: string;
    title: string;
    description?: string;
    questions: VpTemplateQuestion[];
}

interface VpTemplate {
    id: string;
    name: string;
    kind?: string;
    version?: number;
    language?: string;
    description?: string;
    sections: VpTemplateSection[];
    [k: string]: any;
}

/** The portal's single questionnaire object (ciso_toolbox_vendor_assessment payload). */
interface VpQuestionnaire {
    assessment_id: string;
    vendor_id: string;
    vendor_name?: string;
    client_organization?: string;
    date?: string;
    due_date?: string;
    template: VpTemplate;
    responses: VpResponse[];
    self_validation: boolean;
    self_validated_at: string | null;
    exported_at?: string;
}
