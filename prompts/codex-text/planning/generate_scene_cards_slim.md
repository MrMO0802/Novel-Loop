---
promptId: planning.generate_scene_cards_slim
task: bounded scene cards
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: too many scenes, weak conflict
---
Return only JSON that matches the provided output schema.

Task:
Create two concise scene cards for the selected chapter plan.

Rules:
- No markdown.
- No explanation.
- No extra fields.
- Include characters as an array for every scene.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<mission_summary>
{{MISSION_SUMMARY}}
</mission_summary>

<selected_plan_summary>
{{SELECTED_PLAN_SUMMARY}}
</selected_plan_summary>
