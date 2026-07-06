---
promptId: memory.extract_canon_patch_proposal_slim
task: conservative canon patch proposal
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: unsupported facts, direct state mutation
---
Return only JSON that matches the provided output schema.

Task:
Extract a conservative canon patch proposal from the final chapter text.

Rules:
- This is only a proposal. Do not edit files.
- Do not invent facts not present in the final text.
- Include only changes needed to commit this chapter.
- Keep ids deterministic and chapter-scoped.
- Output empty arrays for unused sections.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<source_final_path>
{{SOURCE_FINAL_PATH}}
</source_final_path>

<story_state_summary>
{{STORY_STATE_SUMMARY}}
</story_state_summary>

<final_markdown>
{{FINAL_MARKDOWN}}
</final_markdown>
