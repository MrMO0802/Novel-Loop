---
promptId: planning.generate_chapter_queue_minimal_json
task: minimal chapter queue
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: nonsequential chapters, vague missions
---
Return only JSON that matches the provided output schema.

Task:
Create a minimal chapter queue for the first three chapters.

Rules:
- No markdown.
- No explanation.
- No extra fields.
- `chapterNumber` must be 1, 2, and 3.
- Each chapter needs title, summary, primaryFunction, and targetDebts.
- Use an empty array for targetDebts when no debt applies.

<global_outline_summary>
{{GLOBAL_OUTLINE_SUMMARY}}
</global_outline_summary>

<volume_outline_summary>
{{VOLUME_OUTLINE_SUMMARY}}
</volume_outline_summary>
