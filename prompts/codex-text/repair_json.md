---
promptId: repair_json
task: JSON schema repair
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: semantic drift, invented plot content
---
Return only corrected JSON matching the output schema.

Rules:
- Do not add new plot content.
- Do not change the semantic meaning.
- Only repair JSON structure and schema shape.
- Repair missing required fields, scalar types, and array item types before changing wording.
- Do not wrap output in ```json fences.
- No markdown.
- No explanation.

<target_prompt_id>
{{TARGET_PROMPT_ID}}
</target_prompt_id>

<error_message>
{{ERROR_MESSAGE}}
</error_message>

<previous_output>
{{PREVIOUS_OUTPUT}}
</previous_output>
