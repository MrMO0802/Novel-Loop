---
promptId: planning.rank_plan_candidates_slim
task: rank candidate plans
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: inconsistent scoring, hidden preferences
---
Return only JSON that matches the provided output schema.

Task:
Select the strongest candidate plan.

Rules:
- No markdown.
- No explanation.
- `selectedCandidateId` must match one candidate id.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<candidate_ids>
{{CANDIDATE_IDS}}
</candidate_ids>

<plan_candidates>
{{PLAN_CANDIDATES}}
</plan_candidates>
