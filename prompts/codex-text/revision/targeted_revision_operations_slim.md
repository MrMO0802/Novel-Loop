---
promptId: revision.targeted_revision_operations_slim
task: plan adjudicated paragraph-level revision operations
expectedOutput: JSON matching output schema
contextBudget: adjudicated targets only
qualityRisks: unauthorized edits, new facts, whole-chapter rewrite
---
You are producing a local, preview-only revision operation list for chapter {{CHAPTER_NUMBER}}.

Return only JSON that matches the provided output schema. Do not return a rewritten chapter. Do not edit files or run commands.

Objective:
{{OBJECTIVE}}

Allowed targets:
{{ALLOWED_TARGETS}}

Facts to preserve:
{{FACTS_TO_PRESERVE}}

Forbidden changes:
{{FORBIDDEN_CHANGES}}

Rules that the operations should address:
{{EXPECTED_RESOLVED_RULES}}

Constraints:
- Every targetIds entry must exactly match an allowed targetId.
- Every allowed target marked requiredForClosure=true must appear in exactly one operation.
- replace_paragraph must reference exactly one approved target.
- Prefer one delete_duplicate_paragraph operation per approved target. A delete may reference multiple targets only when all belong to the same approved duplicate sequence; never group unrelated targets.
- Use merge_target_paragraphs, with at least two approved targets, when multiple paragraphs must become one replacement paragraph.
- Every operation may reference approved targets only.
- Do not modify or quote non-target paragraphs.
- newFactsIntroduced must always be an empty array.
- Keep replacementText limited to the target paragraph or merged targets.
- Preserve chapter title, characters, order, recipient, plot reveals, and character goals.
- Align the delivery time with the mission and selected plan.
