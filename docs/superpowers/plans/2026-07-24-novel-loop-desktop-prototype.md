# Novel Loop Desktop Interactive Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, fixture-driven, high-fidelity browser prototype that validates Novel Loop's approved Project Library -> Project Space -> Chapter Workspace experience without connecting to Electron, Novel Loop Engine, Codex, or project files.

**Architecture:** Create an isolated Vite + React + TypeScript package under `prototype/desktop`. The prototype uses a typed in-memory adapter and realistic Chinese fixture data so every page and failure state is deterministic. Components use Radix UI primitives as the single accessibility foundation, custom Novel Loop tokens, and Phosphor icons.

**Tech Stack:** React 19, TypeScript 5, Vite 7, React Router, Radix UI primitives, Phosphor Icons, Vitest, Testing Library, Playwright, native CSS.

## Global Constraints

- Do not create Electron main, preload, or production renderer code.
- Do not import from `src/app`, `src/storage`, `src/providers`, or `src/cli`.
- Do not read or write `projects/`, `runs/`, `snapshots/`, `.env`, auth files, or Codex artifacts.
- Do not invoke Codex, shell commands, Node filesystem APIs, or Novel Loop Engine.
- Do not modify Story State, chapter queue, canonical artifacts, or existing engine behavior.
- The prototype is Chinese-first and uses internationalization-ready message keys.
- Draft, revision candidate, commit preview, and committed chapter must remain visually distinct.
- Story Record changes require a visible preview and explicit confirmation.
- No raw run IDs, artifact paths, mutation IDs, JSON paths, schemas, error codes, tokens, or JSONL in default UI.
- Use one restrained pine-green accent across the prototype.
- Use Phosphor Icons only. Do not hand-draw SVG icons.
- Use cards only for projects, versions, dialogs, and repeated entities where framing communicates hierarchy.
- Support 1440x900 and 1024x720 prototype viewports.
- Respect `prefers-reduced-motion`.
- Every page must include loading, empty, error, and keyboard-focus behavior where applicable.
- Source design specification: `docs/superpowers/specs/2026-07-24-novel-loop-desktop-product-design.md`.

---

## Planned File Structure

```text
prototype/desktop/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
├── index.html
├── README.md
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   ├── PrototypeContext.tsx
│   │   └── prototypeState.ts
│   ├── fixtures/
│   │   ├── types.ts
│   │   ├── projects.ts
│   │   ├── rainRadio.ts
│   │   ├── diagnostics.ts
│   │   ├── revisions.ts
│   │   ├── commitPreview.ts
│   │   └── tasks.ts
│   ├── shell/
│   │   ├── ApplicationShell.tsx
│   │   ├── ProjectNavigation.tsx
│   │   ├── ChapterNavigator.tsx
│   │   ├── CommandPalette.tsx
│   │   └── TaskTray.tsx
│   ├── pages/
│   │   ├── FirstLaunchPage.tsx
│   │   ├── ProjectLibraryPage.tsx
│   │   ├── NewNovelPage.tsx
│   │   ├── ProjectOverviewPage.tsx
│   │   ├── ChapterWorkspacePage.tsx
│   │   ├── RevisionComparisonPage.tsx
│   │   ├── CommitPreviewPage.tsx
│   │   ├── StoryRecordPage.tsx
│   │   ├── RunCenterPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── IconButton.tsx
│   │   ├── StatusLabel.tsx
│   │   ├── EmptyState.tsx
│   │   ├── InlineNotice.tsx
│   │   ├── Disclosure.tsx
│   │   ├── Dialog.tsx
│   │   └── Skeleton.tsx
│   ├── features/
│   │   ├── editor/ManuscriptEditor.tsx
│   │   ├── diagnostics/DiagnosticFinding.tsx
│   │   ├── revisions/ParagraphDiff.tsx
│   │   ├── commit/StoryRecordChangeGroup.tsx
│   │   ├── recovery/RecoveryDialog.tsx
│   │   └── story-record/StoryRecordViews.tsx
│   ├── i18n/
│   │   ├── messages.zh-CN.ts
│   │   └── t.ts
│   └── styles/
│       ├── tokens.css
│       ├── base.css
│       ├── shell.css
│       └── pages.css
└── tests/
    ├── setup.ts
    ├── prototype-boundary.test.ts
    ├── navigation.test.tsx
    ├── status-model.test.tsx
    ├── revision-flow.test.tsx
    ├── commit-preview.test.tsx
    ├── recovery.test.tsx
    └── visual/
        └── prototype.spec.ts
```

## Task 1: Isolated Prototype Package And Safety Boundary

**Files:**

- Create: `prototype/desktop/package.json`
- Create: `prototype/desktop/tsconfig.json`
- Create: `prototype/desktop/vite.config.ts`
- Create: `prototype/desktop/index.html`
- Create: `prototype/desktop/src/main.tsx`
- Create: `prototype/desktop/src/app/App.tsx`
- Create: `prototype/desktop/src/styles/tokens.css`
- Create: `prototype/desktop/src/styles/base.css`
- Create: `prototype/desktop/tests/setup.ts`
- Create: `prototype/desktop/tests/prototype-boundary.test.ts`
- Create: `prototype/desktop/README.md`

**Interfaces:**

- Produces: isolated `@novel-loop/desktop-prototype` package.
- Produces: `App` root component.
- Enforces: no imports from production engine modules.

- [ ] **Step 1: Create the isolated package manifest**

```json
{
  "name": "@novel-loop/desktop-prototype",
  "version": "0.0.0-prototype",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "check": "tsc -b --pretty false",
    "test": "vitest run",
    "test:visual": "playwright test",
    "test:all": "pnpm check && pnpm test && pnpm build && pnpm test:visual"
  },
  "dependencies": {
    "@phosphor-icons/react": "^2.1.10",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-tooltip": "^1.2.8",
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "react-router-dom": "^7.8.2"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^24.3.0",
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^5.0.2",
    "jsdom": "^26.1.0",
    "typescript": "^5.9.2",
    "vite": "^7.1.3",
    "vitest": "^3.2.4"
  },
  "packageManager": "pnpm@10.12.1"
}
```

- [ ] **Step 2: Add TypeScript and Vite configuration**

`prototype/desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts"]
}
```

`prototype/desktop/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
  preview: { host: '127.0.0.1', port: 4179, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts']
  }
});
```

- [ ] **Step 3: Add the test setup and boundary test before application code**

`prototype/desktop/tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

```ts
import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const absolute = path.join(root, entry);
    return statSync(absolute).isDirectory() ? sourceFiles(absolute) : [absolute];
  }).filter((file) => /\.(ts|tsx)$/.test(file));
}

describe('prototype boundary', () => {
  test('does not import production engine, Node, Electron, or Codex modules', () => {
    const forbidden = [
      /from ['"].*src\/app/,
      /from ['"].*src\/storage/,
      /from ['"].*src\/providers/,
      /node:fs/,
      /node:child_process/,
      /electron/,
      /codex exec/
    ];
    for (const file of sourceFiles(path.resolve('src'))) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) expect(content, file).not.toMatch(pattern);
    }
  });
});
```

- [ ] **Step 4: Run the boundary test as the first safety guard**

Run:

```bash
corepack pnpm --dir prototype/desktop install
corepack pnpm --dir prototype/desktop test
```

Expected: the boundary test passes against the initial source tree and remains active as later source files are added.

- [ ] **Step 5: Add the minimal app root**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

```tsx
export function App() {
  return <main aria-label="Novel Loop 原型">Novel Loop</main>;
}
```

Create minimal `tokens.css` and `base.css` files at this step so the app imports and build are valid. Task 2 replaces their initial contents with the approved visual tokens and base rules.

- [ ] **Step 6: Document the prototype boundary**

`prototype/desktop/README.md` must state:

```text
This package is a fixture-driven UX prototype.
It does not connect to Electron, Novel Loop Engine, Codex, project files, or Story State.
No output from this package is canonical novel data.
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
corepack pnpm --dir prototype/desktop check
corepack pnpm --dir prototype/desktop test
corepack pnpm --dir prototype/desktop build
```

Expected: all commands pass.

Commit:

```bash
git add prototype/desktop
git commit -m "prototype: scaffold isolated desktop UX package"
```

## Task 2: Semantic Tokens, Shared Components, And Fixture Contract

**Files:**

- Modify: `prototype/desktop/src/styles/tokens.css`
- Modify: `prototype/desktop/src/styles/base.css`
- Create: `prototype/desktop/src/fixtures/types.ts`
- Create: `prototype/desktop/src/fixtures/projects.ts`
- Create: `prototype/desktop/src/components/Button.tsx`
- Create: `prototype/desktop/src/components/IconButton.tsx`
- Create: `prototype/desktop/src/components/StatusLabel.tsx`
- Create: `prototype/desktop/src/components/InlineNotice.tsx`
- Create: `prototype/desktop/src/components/Skeleton.tsx`
- Create: `prototype/desktop/tests/status-model.test.tsx`

**Interfaces:**

- Produces: `ChapterStatus`, `ContentStatus`, `TaskStatus`, `ProjectSummary`.
- Produces: shared semantic components used by every later page.

- [ ] **Step 1: Write status model tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { StatusLabel } from '../src/components/StatusLabel';

describe('StatusLabel', () => {
  test.each([
    ['draft', '草稿'],
    ['revision_candidate', '修订候选'],
    ['commit_preview', '待确认'],
    ['committed', '已提交']
  ] as const)('renders %s as author-facing %s', (status, label) => {
    render(<StatusLabel status={status} />);
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText(/mutation|artifact|queue|runId/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Define fixture types**

```ts
export type ContentStatus =
  | 'draft'
  | 'revision_candidate'
  | 'accepted_draft'
  | 'commit_preview'
  | 'committed';

export type ChapterStatus =
  | 'planned'
  | 'drafting'
  | 'reviewing'
  | 'needs_review'
  | 'ready_to_confirm'
  | 'committed'
  | 'needs_recovery'
  | 'needs_refresh';

export type TaskStatus =
  | 'waiting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'recoverable';

export interface ProjectSummary {
  id: string;
  title: string;
  currentChapter: number;
  currentChapterTitle: string;
  status: ChapterStatus;
  wordCount: number;
  updatedLabel: string;
  openMysteryCount: number;
  pendingReviewCount: number;
}
```

- [ ] **Step 3: Define exact semantic tokens**

```css
:root {
  color-scheme: light;
  --nl-canvas: #f3f5f3;
  --nl-surface: #fcfdfc;
  --nl-surface-subtle: #e9edea;
  --nl-text: #202521;
  --nl-text-secondary: #626c65;
  --nl-border: #d5dbd6;
  --nl-accent: #3f6d56;
  --nl-accent-hover: #345b48;
  --nl-accent-soft: #dfeae3;
  --nl-warning: #8a642b;
  --nl-warning-soft: #f4ead8;
  --nl-danger: #9c443e;
  --nl-danger-soft: #f4dfdc;
  --nl-radius-control: 6px;
  --nl-radius-card: 8px;
  --nl-font-ui: "Source Han Sans SC", "Noto Sans CJK SC", system-ui, sans-serif;
  --nl-font-manuscript: "Source Han Serif SC", "Noto Serif CJK SC", serif;
  --nl-shadow-overlay: 0 16px 48px rgb(32 37 33 / 14%);
  --nl-focus: 0 0 0 3px rgb(63 109 86 / 28%);
}
```

- [ ] **Step 4: Implement shared controls with accessible names and no default card styling**

`Button` accepts `variant: 'primary' | 'secondary' | 'quiet' | 'danger'` and always renders one-line labels. `IconButton` requires `label`. `StatusLabel` maps every status to an icon, text, and semantic tone.

- [ ] **Step 5: Run tests and perform contrast checks**

Run:

```bash
corepack pnpm --dir prototype/desktop exec vitest run tests/status-model.test.tsx
corepack pnpm --dir prototype/desktop check
```

Expected: status tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
git add prototype/desktop/src prototype/desktop/tests
git commit -m "prototype: add Novel Loop tokens and author-facing status model"
```

## Task 3: Application Shell, Routes, And Keyboard Navigation

**Files:**

- Create: `prototype/desktop/src/app/routes.tsx`
- Create: `prototype/desktop/src/app/PrototypeContext.tsx`
- Create: `prototype/desktop/src/app/prototypeState.ts`
- Create: `prototype/desktop/src/shell/ApplicationShell.tsx`
- Create: `prototype/desktop/src/shell/ProjectNavigation.tsx`
- Create: `prototype/desktop/src/shell/CommandPalette.tsx`
- Create: `prototype/desktop/src/styles/shell.css`
- Modify: `prototype/desktop/src/app/App.tsx`
- Create: `prototype/desktop/tests/navigation.test.tsx`

**Interfaces:**

- Produces: prototype routes and state transitions.
- Produces: keyboard shortcuts `Ctrl+K`, `Ctrl+P`, `Ctrl+Shift+Enter`, and `Esc`.

- [ ] **Step 1: Write navigation tests**

Test these routes:

```text
/setup?state=ready
/setup?state=missing
/setup?state=login
/setup?state=warning
/library
/new
/project/rain-radio
/project/rain-radio/chapter/2
/project/rain-radio/story-record
/tasks
/settings
```

Test that `Ctrl+K` opens the command palette and `Esc` returns focus to the invoking button.

- [ ] **Step 2: Define prototype state**

```ts
export interface PrototypeState {
  activeProjectId: string | null;
  focusMode: boolean;
  assistantPanel: 'goal' | 'diagnostics' | 'candidate' | 'commit' | null;
  activeTaskId: string | null;
  autosave: 'saved' | 'saving' | 'failed';
}
```

Expose state only through `PrototypeContext`; do not use browser storage.

- [ ] **Step 3: Implement routes and shell**

The shell must:

- Keep one-line desktop navigation.
- Show current project.
- Show a semantic task button only when a task is running or recoverable.
- Hide project navigation on setup and library pages.
- Collapse project navigation into a drawer at 1024px.

- [ ] **Step 4: Implement command palette destinations**

Commands:

```text
返回作品库
打开项目概览
打开第二章
打开故事档案
打开任务中心
切换专注模式
打开设置
```

- [ ] **Step 5: Verify**

Run:

```bash
corepack pnpm --dir prototype/desktop exec vitest run tests/navigation.test.tsx
corepack pnpm --dir prototype/desktop check
```

Expected: all routes and keyboard tests pass.

- [ ] **Step 6: Commit**

```bash
git add prototype/desktop/src prototype/desktop/tests
git commit -m "prototype: add desktop shell and keyboard navigation"
```

## Task 4: First Launch, Project Library, And New Novel Wizard

**Files:**

- Create: `prototype/desktop/src/pages/FirstLaunchPage.tsx`
- Create: `prototype/desktop/src/pages/ProjectLibraryPage.tsx`
- Create: `prototype/desktop/src/pages/NewNovelPage.tsx`
- Create: `prototype/desktop/src/fixtures/projects.ts`
- Create: `prototype/desktop/src/i18n/messages.zh-CN.ts`
- Create: `prototype/desktop/src/i18n/t.ts`
- Create: `prototype/desktop/tests/onboarding.test.tsx`

**Interfaces:**

- Consumes: shared controls, routes, and `ProjectSummary`.
- Produces: all four Codex readiness states and resumable named-stage wizard.

- [ ] **Step 1: Write onboarding tests**

Cover:

- Ready state enables Continue.
- Missing state shows Open guide and Check again.
- Login state never shows token, auth path, or terminal arguments.
- Doctor warning remains non-blocking.
- New novel wizard retains fixture input while moving between named stages.

- [ ] **Step 2: Add Chinese message keys**

Use keys such as:

```ts
export const zhCN = {
  'setup.localData.title': '你的小说保存在这台电脑上',
  'setup.codex.ready': 'Codex 已准备好',
  'setup.codex.missing': '未找到 Codex',
  'library.continue': '继续创作',
  'library.newNovel': '新建小说',
  'wizard.idea': '核心创意',
  'wizard.reader': '类型与读者',
  'wizard.protagonist': '主角',
  'wizard.world': '世界观',
  'wizard.style': '风格',
  'wizard.plan': '篇幅与章节计划'
} as const;
```

- [ ] **Step 3: Implement project library as a readable list**

Do not use a grid of equal generic cards. Use:

- One Continue Writing panel.
- Project rows with title, chapter status, word count, and pending review count.
- Empty state with one New Novel action.
- Archived projects behind a disclosure.

- [ ] **Step 4: Implement named-stage wizard**

The wizard must:

- Use labels above controls.
- Show one coherent creative topic at a time.
- Allow Back and Next.
- Keep generated Story Bible review as a fixture state.
- Use no generic Step 1 labels as primary copy.

- [ ] **Step 5: Verify**

Run:

```bash
corepack pnpm --dir prototype/desktop exec vitest run tests/onboarding.test.tsx
corepack pnpm --dir prototype/desktop check
```

- [ ] **Step 6: Commit**

```bash
git add prototype/desktop/src prototype/desktop/tests
git commit -m "prototype: add first launch and novel creation flow"
```

## Task 5: Project Overview And Story Record

**Files:**

- Create: `prototype/desktop/src/pages/ProjectOverviewPage.tsx`
- Create: `prototype/desktop/src/pages/StoryRecordPage.tsx`
- Create: `prototype/desktop/src/features/story-record/StoryRecordViews.tsx`
- Create: `prototype/desktop/src/fixtures/rainRadio.ts`
- Create: `prototype/desktop/tests/story-record.test.tsx`

**Interfaces:**

- Produces: author-facing overview and Story Record tabs.
- Consumes: Rain Radio fixture with characters, timeline, reader knowledge, mysteries, foreshadowing, world rules, and canon facts.

- [ ] **Step 1: Define realistic fixture data**

The fixture must include:

- Lin Che character state.
- Four open mysteries.
- Two foreshadowing threads.
- At least six timeline events.
- Reader known, suspected, questioned, and expected items.
- Canon facts from Chapter 1.
- Chapter 2 pending commit preview.

Fixture names and copy must match the approved design specification.

- [ ] **Step 2: Write Story Record tests**

Verify:

- No raw JSON is rendered.
- Every internal concept uses the approved Chinese label.
- Selecting 时间线 changes the main view.
- Selecting 待兑现悬念 shows status and evidence in author language.

- [ ] **Step 3: Implement Project Overview**

The page contains:

- Current volume progress.
- Latest chapter summary.
- Main characters.
- Open mystery summary.
- Recent activity.
- One Recommended Next Action.

Avoid metric dashboards and generic progress bars.

- [ ] **Step 4: Implement Story Record**

Use:

- List plus detail for characters.
- Vertical chronological timeline.
- Grouped reader knowledge.
- Filterable mystery and foreshadowing lists.
- Relationship graph represented as a simple accessible relationship list in the prototype.

- [ ] **Step 5: Verify and commit**

```bash
corepack pnpm --dir prototype/desktop exec vitest run tests/story-record.test.tsx
corepack pnpm --dir prototype/desktop check
git add prototype/desktop/src prototype/desktop/tests
git commit -m "prototype: add project overview and Story Record"
```

## Task 6: Chapter Workspace And Focus Mode

**Files:**

- Create: `prototype/desktop/src/pages/ChapterWorkspacePage.tsx`
- Create: `prototype/desktop/src/shell/ChapterNavigator.tsx`
- Create: `prototype/desktop/src/features/editor/ManuscriptEditor.tsx`
- Create: `prototype/desktop/src/shell/TaskTray.tsx`
- Create: `prototype/desktop/tests/chapter-workspace.test.tsx`

**Interfaces:**

- Produces: three-column chapter workspace and editor-first Focus Mode.
- Produces: draft autosave state and version selector.

- [ ] **Step 1: Write workspace tests**

Verify:

- Default workspace contains chapter navigator, manuscript, and goal panel.
- Focus Mode hides both side panels but keeps chapter status and autosave visible.
- `Ctrl+Shift+Enter` toggles Focus Mode.
- Draft, candidate, preview, and committed labels are distinct.
- No task percentage is shown when progress is not measurable.

- [ ] **Step 2: Implement manuscript editor**

Use an accessible controlled `textarea` for the prototype:

```tsx
export function ManuscriptEditor(props: {
  value: string;
  status: 'draft' | 'accepted_draft' | 'committed';
  onChange(value: string): void;
}) {
  return (
    <textarea
      aria-label="章节正文"
      readOnly={props.status === 'committed'}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}
```

The prototype does not choose a production editor engine.

- [ ] **Step 3: Implement workspace layout**

At 1440px:

```text
220px chapter navigation | minmax(680px, 1fr) editor | 312px assistant
```

At 1024px:

- Chapter navigation becomes a drawer.
- Assistant becomes a drawer.
- Editor remains centered.

- [ ] **Step 4: Implement task tray states**

Fixture states:

- Writing scene 2 of 3.
- Collecting diagnostic evidence.
- Cancelling.
- Recoverable timeout.

- [ ] **Step 5: Verify and commit**

```bash
corepack pnpm --dir prototype/desktop exec vitest run tests/chapter-workspace.test.tsx
corepack pnpm --dir prototype/desktop check
git add prototype/desktop/src prototype/desktop/tests
git commit -m "prototype: add chapter workspace and focus mode"
```

## Task 7: Diagnostics And Revision Comparison

**Files:**

- Create: `prototype/desktop/src/pages/RevisionComparisonPage.tsx`
- Create: `prototype/desktop/src/features/diagnostics/DiagnosticFinding.tsx`
- Create: `prototype/desktop/src/features/revisions/ParagraphDiff.tsx`
- Create: `prototype/desktop/src/fixtures/diagnostics.ts`
- Create: `prototype/desktop/src/fixtures/revisions.ts`
- Create: `prototype/desktop/tests/revision-flow.test.tsx`

**Interfaces:**

- Produces: evidence-based diagnostics and whole-candidate decision flow.
- Does not mutate canonical content.

- [ ] **Step 1: Write revision flow tests**

Verify:

- Timeline finding names exact cited paragraphs.
- Opening evidence focuses the cited passage.
- Candidate is labeled 修订候选.
- Accepting candidate changes the editable version to 已接受草稿, not 已提交.
- Rejecting candidate preserves the original draft.
- Keep as alternate keeps both versions.

- [ ] **Step 2: Define diagnostics fixture**

Use the approved Chapter 2 scenario:

```text
Problem: the same delivery occurs at incompatible times.
Evidence: paragraphs 2, 11, 20, and 32.
Candidate result: conflict resolved, duplicate handoff removed, no new order or recipient.
```

- [ ] **Step 3: Implement finding presentation**

Each finding displays:

- Natural-language title.
- Severity.
- Short explanation.
- Evidence snippets.
- Why it matters.
- View in chapter action.

Internal rule names remain under Technical Details only.

- [ ] **Step 4: Implement side-by-side and unified diff modes**

The diff must:

- Preserve readable paragraph widths.
- Label removed and added text.
- Include a non-color indicator.
- Show candidate result and possible new issue summary.

- [ ] **Step 5: Verify and commit**

```bash
corepack pnpm --dir prototype/desktop exec vitest run tests/revision-flow.test.tsx
corepack pnpm --dir prototype/desktop check
git add prototype/desktop/src prototype/desktop/tests
git commit -m "prototype: add evidence review and revision comparison"
```

## Task 8: Commit Preview, Tasks, Errors, And Recovery

**Files:**

- Create: `prototype/desktop/src/pages/CommitPreviewPage.tsx`
- Create: `prototype/desktop/src/pages/RunCenterPage.tsx`
- Create: `prototype/desktop/src/features/commit/StoryRecordChangeGroup.tsx`
- Create: `prototype/desktop/src/features/recovery/RecoveryDialog.tsx`
- Create: `prototype/desktop/src/fixtures/commitPreview.ts`
- Create: `prototype/desktop/src/fixtures/tasks.ts`
- Create: `prototype/desktop/tests/commit-preview.test.tsx`
- Create: `prototype/desktop/tests/recovery.test.tsx`

**Interfaces:**

- Produces: controlled commit preview with explicit high-risk review.
- Produces: all required failure and recovery fixtures.
- Never performs a real commit.

- [ ] **Step 1: Write commit preview tests**

Verify:

- Preview states that nothing has been formally committed.
- Five new facts, four timeline events, one character change, one mystery escalation, two foreshadowing changes, and reader changes are grouped.
- High-risk mystery change requires an explicit review decision.
- Technical details are collapsed by default.
- Commit action remains disabled while a required decision is incomplete.
- Confirmation dialog says it creates canonical content and safe restore points.

- [ ] **Step 2: Write recovery tests**

Cover:

- Codex missing.
- Codex login required.
- Doctor warning with working smoke.
- Timeout.
- Usage limit.
- Invalid structured output.
- Diagnostics hard fail.
- Candidate has no improvement.
- Candidate stale.
- Commit preview stale.
- Damaged project protected mode.
- Incomplete commit journal.
- User cancellation.
- Crash recovery.

Every state must name what was protected and provide at least one next action.

- [ ] **Step 3: Implement commit preview**

Groups:

```text
新增故事事实
人物变化
时间线变化
待兑现悬念
伏笔
读者认知
高风险变化
```

Do not expose mutation IDs or JSON paths before Technical Details is expanded.

- [ ] **Step 4: Implement Run Center**

Show:

- Current task.
- Human-readable stage.
- Elapsed time.
- Cancel or resume.
- Recent completed and failed tasks.
- Generated destination.
- Technical details disclosure.

- [ ] **Step 5: Implement recovery dialog**

The first action is always the safest recommendation. Destructive actions use a separate confirmation.

- [ ] **Step 6: Verify and commit**

```bash
corepack pnpm --dir prototype/desktop exec vitest run \
  tests/commit-preview.test.tsx \
  tests/recovery.test.tsx
corepack pnpm --dir prototype/desktop check
git add prototype/desktop/src prototype/desktop/tests
git commit -m "prototype: add controlled commit and recovery experiences"
```

## Task 9: Responsive, Accessibility, Visual QA, And Prototype Guide

**Files:**

- Create: `prototype/desktop/playwright.config.ts`
- Create: `prototype/desktop/tests/visual/prototype.spec.ts`
- Modify: `prototype/desktop/src/styles/base.css`
- Modify: `prototype/desktop/src/styles/shell.css`
- Modify: `prototype/desktop/src/styles/pages.css`
- Modify: `prototype/desktop/README.md`
- Create: `docs/product/novel-loop-prototype-test-script.md`

**Interfaces:**

- Produces: visual snapshots at 1440x900 and 1024x720.
- Produces: keyboard and reduced-motion verification.
- Produces: invited-author usability script.

- [ ] **Step 1: Configure Playwright**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  webServer: {
    command: 'corepack pnpm dev',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'desktop-1024',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 720 } }
    }
  ]
});
```

- [ ] **Step 2: Add visual route tests**

Capture:

- Setup ready and missing.
- Project Library.
- New Novel wizard.
- Project Overview.
- Chapter Workspace default and Focus Mode.
- Diagnostics.
- Revision comparison.
- Commit preview.
- Story Record.
- Task timeout and crash recovery.

For each page assert:

- No horizontal overflow.
- Primary controls remain visible.
- Text does not overlap.
- No button label wraps.
- Focus ring is visible.

- [ ] **Step 3: Add reduced-motion styles**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 4: Run accessibility-oriented manual checks**

At both viewports:

1. Navigate every primary flow with keyboard only.
2. Verify focus return after every dialog and drawer.
3. Verify zoom at 200 percent.
4. Verify Chinese IME composition in the prototype textarea.
5. Verify diff meaning without color.
6. Verify all icon-only buttons have tooltips and accessible names.

- [ ] **Step 5: Write the prototype test script**

`docs/product/novel-loop-prototype-test-script.md` must include the ten usability tasks and acceptance signals from the approved design specification, plus a note-taking table:

```text
Participant
Task completion
Observed hesitation
Terminology misunderstanding
Canonical-state misunderstanding
Recovery success
Follow-up quote
```

- [ ] **Step 6: Run final verification**

```bash
corepack pnpm --dir prototype/desktop install --frozen-lockfile
corepack pnpm --dir prototype/desktop check
corepack pnpm --dir prototype/desktop test
corepack pnpm --dir prototype/desktop build
corepack pnpm --dir prototype/desktop test:visual
git diff --check
```

Expected:

- TypeScript passes.
- Unit and interaction tests pass.
- Vite build passes.
- All required screenshots are generated.
- No horizontal overflow or overlap assertions fail.
- Existing Novel Loop Engine source and tests remain untouched.

- [ ] **Step 7: Commit**

```bash
git add prototype/desktop docs/product/novel-loop-prototype-test-script.md
git commit -m "prototype: finalize desktop UX validation build"
```

## Manual Review Gates

### Gate 1: Visual Foundation

Review after Task 3:

- Project Library and shell do not resemble a developer dashboard.
- Pine accent, typography, radius, and spacing are approved.
- 1024px behavior is acceptable.

### Gate 2: Core Writing Experience

Review after Task 6:

- Chapter Workspace keeps manuscript dominant.
- Focus Mode is useful rather than decorative.
- Draft and committed states cannot be confused.

### Gate 3: Review And Commit Safety

Review after Task 8:

- Diagnostics evidence is understandable without technical details.
- Revision candidate never appears canonical.
- Commit preview communicates that Story Record is still unchanged.
- Recovery actions feel safe.

### Gate 4: Invited-Author Prototype

Review after Task 9:

- All ten usability tasks are possible.
- The prototype is stable at required viewports.
- Product copy is ready for five invited-author sessions.
- Production Electron planning remains blocked until findings are incorporated.

## Rollback Strategy

- All prototype files live under `prototype/desktop` and `docs/product`.
- Removing these paths fully removes the prototype without affecting Novel Loop Engine.
- No root package scripts or runtime dependencies are required.
- Every task has an independent commit and can be reverted without touching project data.

## Definition Of Done

- The prototype demonstrates all approved MVP workflows using fixtures.
- The prototype contains no engine, Codex, filesystem, or Electron integration.
- Draft, candidate, preview, and committed content states are distinct.
- All required error and recovery states are inspectable.
- Keyboard, reduced motion, 1024x720, and 1440x900 checks pass.
- Five invited-author sessions can be run from the documented test script.
- Findings are reviewed before any production Electron implementation plan is approved.
