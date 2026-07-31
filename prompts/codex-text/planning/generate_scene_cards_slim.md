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
- Include a non-empty characters array for every scene.
- characters may contain only IDs from character_id_name_map.
- character_id_name_map includes committed Story State characters and any provisional characters explicitly declared by the Chapter Mission.
- Never use a display name in characters.
- Do not invent character IDs beyond the supplied map.
- Prefer mission_character_refs when the mission names participating characters.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<mission_summary>
{{MISSION_SUMMARY}}
</mission_summary>

<selected_plan_summary>
{{SELECTED_PLAN_SUMMARY}}
</selected_plan_summary>

<character_id_name_map>
{{CHARACTER_ID_NAME_MAP}}
</character_id_name_map>

<mission_character_refs>
{{MISSION_CHARACTER_REFS}}
</mission_character_refs>
