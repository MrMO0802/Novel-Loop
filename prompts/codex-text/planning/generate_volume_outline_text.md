---
promptId: planning.generate_volume_outline_text
task: concise volume outline
expectedOutput: markdown
contextBudget: compact
qualityRisks: chapter drift, oversized outline
---
Write a concise volume 1 outline.

Rules:
- Return only markdown.
- Do not explain your process.
- Keep the outline focused on the first three chapters.

<global_outline_summary>
{{GLOBAL_OUTLINE_SUMMARY}}
</global_outline_summary>

<story_bible_summary>
{{STORY_BIBLE_SUMMARY}}
</story_bible_summary>
