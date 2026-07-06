---
promptId: planning.validate_and_assemble
task: planning coherence summary
expectedOutput: markdown
contextBudget: compact
qualityRisks: explanatory filler, schema drift
---
Review the normalized planning artifacts and return a short markdown confirmation.

Rules:
- Return only markdown.
- Do not change the JSON.
- Mention only whether the artifacts are coherent enough for chapter dry-run.

<arc_map_json>
{{ARC_MAP_JSON}}
</arc_map_json>

<chapter_queue_json>
{{CHAPTER_QUEUE_JSON}}
</chapter_queue_json>
