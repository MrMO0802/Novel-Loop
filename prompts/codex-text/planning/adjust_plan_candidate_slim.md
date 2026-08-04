---
promptId: planning.adjust_plan_candidate_slim
task: bounded chapter plan adjustment
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: changing canon, inventing facts, widening scope
---
Return only JSON that matches the provided output schema.

Adjust only the supplied chapter plan candidate as requested by the author.

Rules:
- Return exactly title, markdown, changeSummary, and preservedConstraints.
- Apply only the bounded author instruction.
- Keep the result within the current chapter mission and supplied Story State.
- Preserve every constraint not explicitly changed by the author.
- Story State is read-only context. Do not propose or perform Story State changes.
- Do not invent unrequested characters, facts, debts, reveals, relationships, or world rules.
- Do not rewrite the whole project or change another chapter.
- Do not select this direction, adopt this result, or overwrite an active artifact.
- Do not run shell commands or write to the workspace.
- Return no extra fields, paths, hashes, provider controls, raw output, or commands.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<author_instruction>
{{AUTHOR_INSTRUCTION}}
</author_instruction>

<current_plan_candidate>
{{CURRENT_PLAN}}
</current_plan_candidate>

<chapter_mission_context>
{{MISSION_CONTEXT}}
</chapter_mission_context>

<story_state_summary>
{{STORY_STATE_SUMMARY}}
</story_state_summary>
