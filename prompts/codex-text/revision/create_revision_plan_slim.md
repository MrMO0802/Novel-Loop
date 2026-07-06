---
promptId: revision.create_revision_plan_slim
task: minimal revision plan
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: vague operations, unsupported changes
---
Return only JSON that matches the provided output schema.

Task:
Create a minimal revision plan for a chapter draft.

Rules:
- No markdown.
- No explanation.
- Keep operations concrete and local.
- Use `local_patch` when only small changes are needed.
- Output at least one operation.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<draft_version>
{{DRAFT_VERSION}}
</draft_version>

<diagnostics_summary>
{{DIAGNOSTICS_SUMMARY}}
</diagnostics_summary>

<draft_summary>
{{DRAFT_SUMMARY}}
</draft_summary>
