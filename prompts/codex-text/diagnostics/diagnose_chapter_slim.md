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
- Include issues as an array; use an empty array if there are no issues.
- If enhanced context is provided, cite concrete evidence in `hardChecks` when a hard check fails.
- If evidence is missing, prefer an issue that says insufficient evidence instead of inventing a contradiction.

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
