---
promptId: planning.adjust_chapter_mission_slim
task: bounded chapter mission adjustment
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: changing canon, inventing characters, widening scope
---
Return only JSON that matches the provided output schema.

Adjust the current chapter mission only as requested by the author.

Rules:
- Return a complete mission value with every required top-level and nested field.
- chapterNumber must equal {{CHAPTER_NUMBER}}.
- Preserve id and every unchanged objective id, type, and priority exactly.
- Preserve unchanged debts and debt types, all four reader-information arrays,
  emotional curve, target word count, participant IDs, and introduction metadata.
- Use null for targetWordCount only when the current mission has no target.
- Apply only the bounded author instruction.
- Preserve every constraint not explicitly changed by that instruction.
- Story State is read-only context. Do not propose or perform Story State changes.
- Do not invent unrequested characters, facts, debts, reveals, relationships, or world rules.
- Do not rewrite the whole project or change another chapter.
- Do not select a plan, adopt this result, or overwrite an active artifact.
- Do not run shell commands or write to the workspace.
- Use only committed or explicitly introduced character and debt IDs supplied below.
- Return no Markdown, explanation, extra fields, paths, hashes, provider controls, or commands.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<author_instruction>
{{AUTHOR_INSTRUCTION}}
</author_instruction>

<current_mission>
{{CURRENT_MISSION}}
</current_mission>

<selected_plan_context>
{{SELECTED_PLAN_CONTEXT}}
</selected_plan_context>

<story_state_summary>
{{STORY_STATE_SUMMARY}}
</story_state_summary>
