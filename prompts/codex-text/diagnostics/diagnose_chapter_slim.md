---
promptId: diagnostics.diagnose_chapter_slim
task: structured chapter diagnostics
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: false positives, vague issues
---
Return only JSON that matches the provided output schema.

Task:
Give a minimal diagnostics result for the draft.

Rules:
- No markdown.
- No explanation.
- Set `passed` false if any hard continuity problem is present.
- If `passed` is true, set `averageScore` to 8.5 or higher.
- Return all required top-level fields: `chapterNumber`, `draftVersion`, `passed`, `averageScore`, `hardChecks`, `softScores`, `diagnostics`, and `revisionRequired`.
- Return exactly four `hardChecks`, one for each schema-defined `checkName`; never invent a check name.
- Every hard check must contain `checkName`, `result`, `blocking`, `evidence`, and `explanation`.
- Use `fail` with `blocking=true` only for a concrete hard contradiction supported by evidence.
- Use `insufficient_evidence` or `possible_risk` with `blocking=false` when evidence is incomplete; these are not hard failures.
- Include `diagnostics` as an array; use an empty array if there are no issues.
- Every diagnostics item must contain `type`, `severity`, `message`, `evidence`, and `recommendation`.
- If enhanced context is provided, cite concrete evidence in the matching hard check.
- Do not add properties that are absent from the output schema.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<draft_version>
{{DRAFT_VERSION}}
</draft_version>

<draft_summary>
{{DRAFT_SUMMARY}}
</draft_summary>

<diagnostics_context>
{{DIAGNOSTICS_CONTEXT}}
</diagnostics_context>
