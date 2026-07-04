# 目标项目文件树示例

```text
novel-loop-engine/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  .env.example
  .gitignore

  examples/
    brief.md

  prompts/
    strategy/
      build_story_bible.md
      build_genre_contract.md
      build_reader_promise.md
    planning/
      plan_global_outline.md
      plan_chapter_mission.md
      generate_plan_candidates.md
      rank_plan_candidates.md
      generate_scene_cards.md
    production/
      write_scene.md
      assemble_chapter.md
    diagnostics/
      diagnose_chapter.md
    revision/
      create_revision_plan.md
      revise_draft.md
    memory/
      extract_canon_patch.md
      repair_json_output.md

  src/
    cli/
      index.ts
      commands/
        init.ts
        validate.ts
        buildBible.ts
        planGlobal.ts
        chapter.ts
        inspect.ts
        rollback.ts
        commitChapter.ts

    app/
      initProject.ts
      validateProject.ts
      buildBible.ts
      planGlobal.ts
      runChapterLoop.ts
      inspectProject.ts
      rollbackProject.ts
      commitChapter.ts

    engine/
      strategy/
        StrategyService.ts
      planning/
        PlanningService.ts
      production/
        ProductionService.ts
      diagnostics/
        DiagnosticsService.ts
        QualityGate.ts
      revision/
        RevisionService.ts
      memory/
        MemoryService.ts
        applyCanonPatch.ts

    schemas/
      index.ts
      config.ts
      storyState.ts
      chapterMission.ts
      sceneCard.ts
      diagnostics.ts
      revisionPlan.ts
      canonPatch.ts
      runManifest.ts

    llm/
      LLMClient.ts
      MockLLMClient.ts
      ProviderFactory.ts
      JsonResponseParser.ts

    prompts/
      PromptService.ts
      TemplateRenderer.ts

    storage/
      ProjectPaths.ts
      FileStore.ts
      AtomicWriter.ts
      SnapshotStore.ts

    logging/
      RunLogger.ts
      errors.ts

    utils/
      ids.ts
      dates.ts
      result.ts
      text.ts

  tests/
    fixtures/
      brief.md
      llm/
      states/
    unit/
    integration/
```
