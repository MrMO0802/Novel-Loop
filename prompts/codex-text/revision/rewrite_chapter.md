---
promptId: revision.rewrite_chapter
task: revise chapter draft
expectedOutput: markdown
contextBudget: compact
qualityRisks: unsupported rewrite, lost continuity
---
Return final markdown only.

Task:
Rewrite the chapter draft using the revision plan.

Rules:
- Do not edit files.
- Do not mention schema or process.
- Keep the same chapter intent.
- Do not reveal answers that the plan forbids.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<draft_markdown>
{{DRAFT_MARKDOWN}}
</draft_markdown>

<revision_plan_summary>
{{REVISION_PLAN_SUMMARY}}
</revision_plan_summary>
