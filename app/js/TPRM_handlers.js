// Handlers this page renders in data-click / data-change / data-input: the
// event dispatcher calls no other name (see _ctDeclareHandlers in
// cisotoolbox.js). tests/test_dispatch_allowlist.py fails on a missing one.
_ctDeclareHandlers([
    "_addActionPlan", "_approveAssessment", "_autoSaveVendorField", "_backFromAssessmentV2",
    "_bulkVendorMeasuresDelete", "_bulkVendorMeasuresDone", "_copyEmailTemplate", "_copyPortalLink",
    "_declareNcVendor", "_doExportJSONAuto", "_editVendorMeasureRow", "_exportAssessmentExcel",
    "_exportAssessmentJSON", "_exportAssessmentLink", "_fetchLogo", "_generatePortalLink",
    "_importAssessmentIntoExisting", "_importAssessmentResponse", "_logout", "_maturityFieldLeft",
    "_newAssessmentFromTemplate", "_onAssessmentCommentChange", "_onAssessmentJustificationChange",
    "_onQuestionFieldChange", "_onRiskFilterChange", "_onSectionFieldChange", "_onSliderChange",
    "_onTemplateFieldChange", "_refreshMeasures", "_rejectAssessment", "_removeActionPlan",
    "_requestDerogVendor", "_setAnswerV2Text", "_setCoverage", "_submitForApproval",
    "_toggleAssessmentExcluded", "_toggleSelfValidation", "_updateActionPlanField",
    "_updateAssessmentWeightOverride", "_updateMaturityConfig", "addDocument", "addMeasureForRisk",
    "addQuestion", "addRiskForVendor", "addSection", "addVendor", "aiCollectDocs",
    "aiRunMeasureSuggestion", "aiRunRiskSuggestion", "aiSuggestSectionV2", "backToVendors",
    "closeModal", "closeTemplateEditor", "createTemplate", "deleteAssessment", "deleteDoc",
    "deleteQuestion", "deleteRisk", "deleteSection", "deleteTemplate", "deleteUnlinkedMeasures",
    "deleteVendor", "deleteVendorMeasure", "doraAddBranch", "doraAddCs", "doraAddEntity",
    "doraAddSignerByExisting", "doraAddSub", "doraDelBranch", "doraDelCs", "doraDelEntity",
    "doraDelSub", "doraNewSubFromLink", "doraOnSignerModeChange", "doraOpenArrangementModal",
    "doraOpenExportModal", "doraOpenFunctionModal", "doraOpenFunctionModalForArr",
    "doraOpenSignerModalForArr", "doraOpenSubIdentityModal", "doraOpenSubcontractorModal",
    "doraOpenVendorRoi", "doraPatchArrSigner", "doraPatchBranch", "doraPatchCs", "doraPatchEntity",
    "doraPatchEntityNum", "doraPatchSub", "doraRemoveSignerFromArr", "doraToggleHint",
    "downloadQuestionnaireTemplate", "downloadTemplateExcelExample", "duplicateTemplate",
    "editTemplate", "filterSubs", "filterVendorStatus", "filterVendors", "gleifOpenLookup", "goToRisk",
    "importTemplateFromExcel", "moveQuestion", "moveSection", "newAssessment", "openAiRiskAssistant",
    "openAssessmentFromVendor", "openVendor", "patchVendorRoi", "selectPanel", "selectVendorListTab",
    "setDeadlineDays", "setVendorTab", "suggestMeasuresForRisk", "toggleVendorRoiAddId",
    "updateDocField", "updateRiskField", "updateVendorConfiance", "updateVendorInternalContact",
    "updateVendorMeasure", "vendorOpenInformalSubModal", "vendorRemoveInformalSub"
]);
