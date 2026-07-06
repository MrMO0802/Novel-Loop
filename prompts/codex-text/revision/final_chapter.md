---
promptId: revision.final_chapter
task: final chapter assembly
expectedOutput: markdown
contextBudget: compact
qualityRisks: missing ending hook, explanatory filler
---
Return final markdown only.

Task:
Produce the final chapter text from the current draft and revision plan.

Rules:
- Do not edit files.
- Do not include commentary.
- Preserve the chapter title if present.
- Keep continuity conservative.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<draft_markdown>
{{DRAFT_MARKDOWN}}
</draft_markdown>

<revision_plan_summary>
{{REVISION_PLAN_SUMMARY}}
</revision_plan_summary>
