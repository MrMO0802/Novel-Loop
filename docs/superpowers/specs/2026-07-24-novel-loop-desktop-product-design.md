# Novel Loop Desktop Product Design

Status: Approved direction, detailed design specification

Date: 2026-07-24

Target platform: Ubuntu 24.04 first

Product form: Local-first desktop application

Planned shell: Electron + React + TypeScript + Vite

Engine: Local Novel Loop Engine

First AI provider: Local Codex CLI

## Approved Direction

The approved product direction is **Quiet Project Space**:

- The main information architecture is Project Library -> Project Space -> Chapter Workspace.
- The Chapter Workspace provides an optional Focus Mode inspired by the editor-first concept.
- The product is author-facing. Internal CLI, schema, artifact, run, queue, and mutation concepts remain behind a translation layer.
- Drafts, revision candidates, commit previews, and committed chapters remain visually and behaviorally distinct.
- Codex never mutates canonical Story State without an explicit human commit step.

This document is a product and UX specification. It does not authorize production Electron or React implementation.

# 1. Product Goal Summary

Novel Loop is a local-first long-form fiction writing desktop application. It helps an author move from an initial idea to a coherent, continuously evolving novel while keeping the manuscript at the center of the experience.

The product must make four difficult jobs feel understandable:

1. Turn an idea into a usable story foundation.
2. Plan and write the next chapter without losing continuity.
3. Diagnose and revise a chapter with evidence instead of vague AI criticism.
4. Commit chapter changes into the canonical story record only after the author understands and approves them.

The product is not:

- A visual wrapper around CLI commands.
- A developer dashboard for engine artifacts.
- A chat interface that asks the author to manage the novel through prompts.
- A cloud publishing, billing, collaboration, or account product.
- An autonomous agent that silently changes the manuscript or Story State.

## Success Criteria

An invited author should be able to:

- Create a project without learning Novel Loop Engine terminology.
- Generate and review a Story Bible.
- Understand what the system recommends doing next.
- Draft and manually edit a chapter in a distraction-controlled editor.
- See why diagnostics found a problem and where the evidence appears.
- Compare an original draft with an AI revision candidate.
- Understand exactly what canonical story information will change.
- Commit a chapter without fear that unrelated content will be altered.
- Recover after a timeout, cancellation, invalid AI response, or application restart.

# 2. Core Users And Jobs To Be Done

## Primary User

The primary user is a Chinese-language long-form fiction author who:

- Writes serial or book-length fiction chapter by chapter.
- Works alone or with limited editorial support.
- Has little or no command-line knowledge.
- Values continuity, character consistency, pacing, and unresolved story promises.
- Wants AI assistance but does not trust uncontrolled rewriting.
- May work for several hours in one session.

## Secondary User

The secondary user is an advanced author or editor who wants:

- More visibility into story continuity and state changes.
- Access to technical provenance when diagnosing a failure.
- Snapshots, audit reports, and recovery controls.
- Faster keyboard-driven navigation.

## Jobs To Be Done

### Starting A Novel

When I have a promising idea, I want to turn it into a coherent story foundation, so I can begin writing without spending days configuring a system.

### Continuing A Novel

When I return to my project, I want to see the next meaningful action, so I do not have to reconstruct where I stopped.

### Planning A Chapter

When I begin a chapter, I want a plan grounded in the current story, characters, open mysteries, and reader knowledge, so the chapter advances the novel rather than becoming an isolated scene.

### Writing And Editing

When I am drafting, I want the manuscript to occupy most of the screen, so system information supports rather than interrupts my writing.

### Diagnosing Problems

When the system reports a problem, I want the exact passages, rule, and consequence, so I can judge whether the criticism is valid.

### Reviewing A Revision

When AI proposes a revision, I want to compare it with my draft and understand what it fixed, so I remain the author of the final text.

### Committing Canon

When I approve a chapter, I want to know which facts, character states, timeline events, mysteries, and reader expectations will change, so I can safely advance the canonical story.

### Recovering Work

When a long task fails or the application closes, I want to resume from the last safe stage, so I do not lose writing or repeat expensive work.

# 3. MVP, P1, And P2 Scope

## MVP

MVP is the first invited-author build. It must preserve the complete safety boundary while exposing only the author-facing workflow.

### Project And Environment

- First-launch welcome and local-data explanation.
- Codex binary, login, smoke, and JSON capability checks.
- Non-technical Codex installation and login guidance.
- Project directory selection.
- Automatic backup preference.
- Project library with create, open, archive, and backup entry points.
- New novel wizard.

### Story Foundation

- Story Bible generation and review.
- Global outline and first-volume outline review.
- Chapter list and next chapter entry.
- Author edits to generated Markdown content before acceptance.

### Chapter Workflow

- Chapter mission and selected plan.
- Scene plan summary.
- Chapter draft generation.
- Manual chapter editing with autosave.
- Diagnostics with evidence.
- Revision candidate generation and comparison.
- Accept all, reject, or retain candidate as an alternate version.
- Commit preview translated into author language.
- Explicit controlled local commit.
- Clear committed state and next chapter action.

### Story Record

- Character summaries.
- Timeline.
- Reader knowledge, suspicions, questions, and expectations.
- Open mysteries and story promises.
- Foreshadowing.
- Canon facts.
- Read-only world rule and relationship summaries.

### Reliability

- Long-task progress and cancellation.
- Failure recovery and resume.
- Snapshot visibility.
- Basic run history.
- Project validation and audit presented in natural language.
- Crash recovery from draft autosave and incomplete task state.

## P1

- Paragraph-level candidate acceptance.
- Manual suggestion workflow for Story State corrections.
- Relationship graph visualization.
- More advanced timeline filtering.
- Custom editor typography and layout presets.
- Multiple outline variants.
- Search across manuscript and story record.
- User-facing snapshot restore flow.
- Side-by-side chapter and Story State inspection.
- Export to DOCX, EPUB, or publishing formats.
- Advanced project health and continuity views.

## P2

- Existing novel import and guided reconstruction.
- Windows production release.
- Multi-project templates.
- Plugin or provider extension architecture exposed to advanced users.
- Multi-author review workflow.
- macOS release.
- Optional local semantic search across large projects.

## Explicitly Out Of Scope

- DeepSeek.
- OpenAI API integration.
- Web UI or Web SaaS.
- Cloud accounts, billing, or subscription management.
- Automatic Codex installation, update, or authentication.
- Renderer access to Node.js, project files, shell commands, or raw Codex JSONL.
- Automatic Story State commit.
- Real-time collaboration.
- Publishing marketplace or social features.

# 4. Information Architecture

## Primary Structure

```text
Application
├── First Launch
│   ├── Welcome And Local Data
│   ├── Codex Readiness
│   ├── Project Storage
│   └── Backup Preference
├── Project Library
│   ├── Continue Writing
│   ├── Recent Projects
│   ├── New Novel
│   ├── Backups
│   └── Archived Projects
├── Project Space
│   ├── Overview
│   ├── Chapters
│   ├── Story Foundation
│   │   ├── Story Bible
│   │   ├── Global Outline
│   │   └── Volume Outline
│   ├── Story Record
│   │   ├── Characters
│   │   ├── Timeline
│   │   ├── Reader Knowledge
│   │   ├── Open Mysteries
│   │   ├── Foreshadowing
│   │   ├── Relationships
│   │   ├── World Rules
│   │   └── Canon Facts
│   └── Project Activity
│       ├── Current Tasks
│       ├── Recent Runs
│       ├── Snapshots
│       └── Project Health
├── Chapter Workspace
│   ├── Chapter Plan
│   ├── Draft Editor
│   ├── Diagnostics
│   ├── Revision Comparison
│   ├── Commit Preview
│   └── Committed Summary
└── Settings
    ├── Codex
    ├── Storage
    ├── Autosave
    ├── Backup
    ├── Appearance
    ├── Editor
    ├── Privacy
    └── Advanced Diagnostics
```

## Navigation Model

### Application Level

The title bar contains:

- Product name.
- Current project switcher.
- Global task indicator.
- Search or command palette.
- Settings.

### Project Level

A stable left navigation contains:

- Overview.
- Chapters.
- Story Foundation.
- Story Record.
- Activity.

The navigation uses plain author language. Internal engine concepts appear only in advanced details.

### Chapter Level

The Chapter Workspace uses:

- Chapter navigator on the left.
- Manuscript and focused workflow in the center.
- Contextual assistant panel on the right.
- A bottom task tray only while long work is active or recoverable.

## Author-Facing Terminology

| Internal concept | Default product label |
|---|---|
| Story State | Story Record / 故事档案 |
| Narrative Debt | Open Mystery / 待兑现悬念 |
| Foreshadowing | Foreshadowing / 伏笔 |
| Reader State | Reader Knowledge / 读者认知 |
| Canon Patch | Story Record Changes / 故事档案变更 |
| State Diff | Change Preview / 变更预览 |
| Diagnostics | Chapter Review / 章节检查 |
| Revision Candidate | Revision Candidate / 修订候选 |
| Commit | Formally Commit Chapter / 正式提交本章 |
| Run | Task / 任务 |
| Snapshot | Safe Restore Point / 安全还原点 |
| Audit | Project Health Check / 项目检查 |
| Queue status | Chapter status / 章节状态 |
| Hard check | Critical consistency check / 关键一致性检查 |

# 5. Three Workspace Layout Directions

## Direction A: Quiet Project Space

Structure:

- Project Library first.
- Each project becomes a self-contained workspace.
- Chapter Workspace uses a restrained three-column layout.
- Focus Mode collapses navigation and assistant panels.

Best for:

- Invited authors.
- Long-running projects.
- Mixed writing, planning, review, and continuity work.

Main trade-off:

- One additional navigation layer compared with direct editor launch.

## Direction B: Unified Writing Studio

Structure:

- Global application sidebar is always visible.
- Projects, chapters, Story Record, tasks, and settings share one shell.
- Operational information is easier to access.

Best for:

- Editors managing several projects.
- Advanced users who frequently inspect runs and state.

Main trade-off:

- Higher learning cost and stronger dashboard feel.

## Direction C: Editor-First Canvas

Structure:

- The application opens directly into the most recent manuscript.
- Project navigation, diagnostics, Story Record, and tasks use drawers.
- The text column remains visually dominant.

Best for:

- Daily drafting.
- Small laptop screens.
- Authors who rarely inspect system state.

Main trade-off:

- Important continuity and recovery information can become difficult to discover.

## Comparison

| Dimension | Direction A | Direction B | Direction C |
|---|---:|---:|---:|
| Writing immersion | High | Medium | Highest |
| New-user learning cost | Low | High | Lowest |
| Multi-chapter navigation | High | Highest | Medium |
| Story Record access | High | Highest | Medium |
| AI review workflow | Highest | High | Medium-high |
| Long-term extensibility | High | Highest | Medium |
| Risk of developer-console feel | Low | High | Lowest |

# 6. Recommended Direction

Direction A is the approved base architecture.

Direction C is incorporated as an optional Focus Mode inside the Chapter Workspace.

## Why

1. Project Library, Project Space, and Chapter Workspace match how authors think about their work.
2. Story Record remains accessible without dominating the manuscript.
3. Diagnostics, revision comparison, commit preview, and recovery each have a stable location.
4. Multi-volume and multi-chapter growth does not require a navigation redesign.
5. Advanced provenance can remain available through progressive disclosure.

Direction B should not be the default. Selected operational patterns from Direction B may later support an advanced editor or producer view.

# 7. Key User Flows

## First Launch

```text
Welcome
-> Local data explanation
-> Check Codex
-> Guide installation or login if needed
-> Select project directory
-> Choose automatic backup preference
-> Open Project Library
```

Success condition:

- The author understands that files remain local.
- Codex status is explained without exposing binary paths or auth details.
- A doctor warning does not block setup when smoke and JSON checks pass.

## Create A Novel

```text
New Novel
-> Core idea
-> Genre and target reader
-> Protagonist
-> World
-> Style
-> Length and chapter plan
-> Review collected brief
-> Generate Story Bible
-> Review and edit
-> Create project
-> Project Overview
```

Design rule:

- Each step asks for one coherent creative decision.
- Generated material is visibly a draft until accepted.
- The wizard may save and resume at any step.

## Continue Writing

```text
Project Library
-> Continue Writing
-> Project Overview
-> Recommended next action
-> Chapter Workspace
```

The next action may be:

- Continue editing.
- Review diagnostics.
- Compare a revision candidate.
- Review Story Record changes.
- Recover an interrupted task.
- Start the next chapter.

## Create The Next Chapter

```text
Create Next Chapter
-> Generate chapter mission
-> Review selected plan
-> Confirm or edit plan
-> Generate scene plan
-> Generate draft
-> Manual editing
```

The planning sequence is presented as one author-facing flow. Candidate ranking and engine artifacts remain hidden unless advanced details are opened.

## Diagnose And Revise

```text
Run Chapter Review
-> Show critical and advisory findings
-> Open cited passage
-> Accept or dismiss finding for this review
-> Generate revision candidate
-> Compare original and candidate
-> Accept, reject, or retain candidate
```

The author sees:

- What is wrong.
- Where it occurs.
- Why it matters.
- What the candidate changed.
- Whether the candidate resolved the issue.

## Commit A Chapter

```text
Candidate or edited draft
-> Final chapter review passes
-> Generate Story Record change preview
-> Review all high-risk changes
-> Confirm one controlled commit
-> Create safe restore points
-> Commit canonical chapter and Story Record
-> Show committed summary
-> Offer next chapter
```

The commit button is unavailable when:

- Preview sources are stale.
- Critical conflicts remain.
- Required human decisions are incomplete.
- The chapter is not based on the current Story Record.
- Commit safety checks are incomplete.

## Recover An Interrupted Task

```text
Application restart
-> Detect interrupted or incomplete task
-> Explain last completed safe stage
-> Offer resume, inspect, or discard task attempt
-> Continue without deleting generated artifacts
```

# 8. Page-Level Wireframes

## First Launch: Codex Available

```text
┌────────────────────────────────────────────────────────────┐
│ Novel Loop                                                 │
│                                                            │
│ Your stories stay on this computer.                        │
│                                                            │
│ Codex readiness                                            │
│ Installed                     Ready                        │
│ Signed in                     Ready                        │
│ Text generation              Ready                        │
│ Structured output            Ready                        │
│                                                            │
│ Project location             ~/Documents/Novel Loop        │
│ Automatic backup             Daily                         │
│                                                            │
│                                      [Continue]             │
└────────────────────────────────────────────────────────────┘
```

## First Launch: Codex Not Installed

```text
┌────────────────────────────────────────────────────────────┐
│ Codex is required for AI-assisted writing                  │
│                                                            │
│ Novel Loop could not find Codex on this computer.          │
│ Your project files are safe and no changes were made.      │
│                                                            │
│ 1. Open the Codex installation guide                       │
│ 2. Install and sign in                                     │
│ 3. Return here and check again                             │
│                                                            │
│ [Open guide]                     [Check again]              │
│                                                            │
│ Continue without AI                                       │
└────────────────────────────────────────────────────────────┘
```

## Project Library

```text
┌ Novel Loop                           Search     Settings ┐
│                                                         │
│ Continue writing                                        │
│ Rain Radio                                              │
│ Chapter 2 is waiting for review             [Review]    │
│ Last edited today at 14:32                              │
│                                                         │
│ My projects                                 [New novel] │
│ ─────────────────────────────────────────────────────── │
│ Rain Radio       Chapter 2 review        42,680 words   │
│ Chang'an Dream   Chapter 16 draft       186,420 words   │
│ Flight Zero      Story planning           8,230 words   │
│                                                         │
│ Recent activity                                         │
│ A revision candidate resolved the Chapter 2 timeline    │
│ conflict.                                               │
└─────────────────────────────────────────────────────────┘
```

## New Novel Wizard

```text
┌ New Novel                                      Save draft ┐
├───────────────────────────────────────────────────────────┤
│ Core idea                                                 │
│                                                           │
│ What is the story's central situation?                    │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ A food courier receives a plea for help from a radio │ │
│ │ that has no power source.                            │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                           │
│ What should the reader feel after the first three         │
│ chapters?                                                 │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ Curiosity, unease, and growing suspicion.            │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                           │
│ [Back]                                          [Next]    │
└───────────────────────────────────────────────────────────┘
```

The step indicator uses named stages such as Idea, Reader, Protagonist, World, Style, and Plan. It does not use generic Step 1 labels as the primary text.

## Project Overview

```text
┌ Rain Radio / Overview                       Create next chapter ┐
├──────────────┬──────────────────────────────┬────────────────────┤
│ Overview     │ Current focus                │ Recommended next   │
│ Chapters     │                              │ action             │
│ Foundation   │ Volume 1                     │                    │
│ Story Record │ 2 of 30 chapters             │ Review Chapter 2   │
│ Activity     │                              │ Story Record       │
│              │ Latest chapter               │ changes            │
│              │ Chapter 2: Delivery Address  │                    │
│              │ Revision passed review       │ [Review changes]   │
│              │                              │                    │
│              │ Open mysteries               │                    │
│              │ 4 active, 2 need attention   │                    │
│              │ this volume                  │                    │
└──────────────┴──────────────────────────────┴────────────────────┘
```

## Chapter Workspace: Default

```text
┌ Rain Radio / Chapter 2      Draft saved        Focus mode ┐
├────────────┬─────────────────────────────┬─────────────────┤
│ Volume 1   │ Chapter 2: Delivery Address │ Chapter goal    │
│ Chapter 1  │                             │                 │
│ Chapter 2  │ [Manuscript editor]         │ Connect the     │
│ Chapter 3  │                             │ building to the │
│            │ Lin Che stood below the     │ radio signal.   │
│ Foundation │ third building...           │                 │
│ Characters │                             │ Chapter review  │
│ Timeline   │                             │ Timeline issue  │
│ Mysteries  │                             │ resolved        │
│            │                             │                 │
│            │                             │ [Compare drafts]│
├────────────┴─────────────────────────────┴─────────────────┤
│ Checking chapter consistency: collecting evidence [Cancel]│
└────────────────────────────────────────────────────────────┘
```

## Chapter Workspace: Focus Mode

```text
┌ Chapter 2: Delivery Address    Draft saved    Exit focus ┐
│                                                          │
│                                                          │
│              Lin Che stood below the third               │
│              building, holding a warm paper bag.         │
│                                                          │
│              [Centered manuscript editor]                │
│                                                          │
│                                                          │
│ 2,846 words                          Chapter review ready │
└──────────────────────────────────────────────────────────┘
```

## Revision Comparison

```text
┌ Revision candidate                     Candidate passed review ┐
├─────────────────────────────┬──────────────────────────────────┤
│ Your draft                  │ Revision candidate               │
│                             │                                  │
│ He arrived at 11:40.        │ He arrived shortly before noon. │
│                             │                                  │
│ [Removed duplicate handoff] │ The repeated handoff is removed.│
├─────────────────────────────┴──────────────────────────────────┤
│ Why this changed                                             │
│ The original draft described the same delivery at two        │
│ incompatible times. The candidate keeps the daytime plan.    │
│                                                              │
│ [Reject]  [Keep as alternate]             [Accept candidate] │
└──────────────────────────────────────────────────────────────┘
```

## Commit Preview

```text
┌ Review Story Record changes                              ┐
│                                                         │
│ This chapter has not been formally committed.           │
│                                                         │
│ New story facts                                      5  │
│ Timeline events                                      4  │
│ Character changes                                    1  │
│ Open mysteries advanced                              1  │
│ New foreshadowing                                    2  │
│ Reader knowledge changes                             4  │
│                                                         │
│ High-risk changes                                       │
│ Radio plea mystery: Open -> Escalated                    │
│ The text supports escalation but does not resolve it.    │
│                                          [View evidence] │
│                                                         │
│ Technical details                                  Show │
│                                                         │
│ [Back to chapter]              [Formally commit chapter]│
└─────────────────────────────────────────────────────────┘
```

## Story Record

```text
┌ Story Record                                         Search ┐
├──────────────┬──────────────────────────────────────────────┤
│ Characters   │ Lin Che                                      │
│ Timeline     │ Current goal                                 │
│ Reader       │ Investigate the radio signal without         │
│ Mysteries    │ attracting attention.                        │
│ Foreshadowing│                                              │
│ Relationships│ What the reader knows                        │
│ World rules  │ The radio speaks without a power source.     │
│ Canon facts  │                                              │
│              │ Open mysteries                               │
│              │ Who is asking for help from the seventeenth  │
│              │ floor?                                       │
└──────────────┴──────────────────────────────────────────────┘
```

## Run Center

```text
┌ Tasks                                                    ┐
│                                                         │
│ Current task                                            │
│ Chapter 3 draft                                         │
│ Writing scene 2 of 3                                    │
│ Started 3 minutes ago                     [Cancel]       │
│                                                         │
│ Recent tasks                                            │
│ Chapter 2 review        Completed        4 min 18 sec    │
│ Chapter 2 revision      Completed        6 min 42 sec    │
│ Story Bible            Completed        3 min 35 sec    │
│                                                         │
│ Technical details                                   Show│
└─────────────────────────────────────────────────────────┘
```

# 9. High-Fidelity Visual Direction

## Visual Character

The interface should feel like:

- A serious writing tool.
- A quiet editorial workspace.
- A trustworthy local application.
- A system that becomes more detailed only when the author asks.

It should not feel like:

- An AI startup landing page.
- A terminal emulator.
- A project management dashboard.
- A social writing app.
- A decorative digital notebook.

## Base Palette

Initial light theme:

- Canvas: cool near-white.
- Primary surface: neutral white.
- Secondary surface: cool light gray.
- Primary text: charcoal.
- Secondary text: medium cool gray.
- Accent: restrained pine green.
- Destructive: muted red used only for destructive or blocking states.

The accent is used for:

- Primary action.
- Current chapter.
- Focus and selection.
- Confirmed positive state.

It is not used as decoration on every row.

## Material And Shape

- Page sections are primarily unframed.
- Repeated entities such as projects, characters, and versions may use restrained cards.
- Cards use a maximum 8px radius.
- Inputs and menus use 6px radius.
- Icon buttons use 6px radius or circular shape only when the icon convention is universally understood.
- Shadows appear only on menus, dialogs, floating task details, and elevated comparison controls.
- Structural hierarchy relies on spacing, typography, and separators.

## Motion

Motion communicates:

- A panel opening or closing.
- A task moving to the next stage.
- A draft switching to a revision candidate.
- A commit becoming canonical.
- A recoverable error entering the task tray.

Motion does not decorate static content. All transitions support reduced-motion mode.

# 10. Design System

## Recommended Component Foundation

Use Radix UI primitives as the single accessibility foundation, with custom Novel Loop semantic tokens and components.

Rules:

- Do not ship default Radix Themes styling.
- Do not combine Radix with Material, Fluent, Carbon, or another complete design system.
- The manuscript editor may use its own editor engine, but its surrounding controls follow the same Novel Loop tokens.
- Component selection remains subject to dependency and Electron compatibility review during implementation planning.

## Typography

### UI Typeface

Recommended:

- Source Han Sans SC for Chinese UI.
- Geist as the Latin companion where appropriate.
- JetBrains Mono only inside optional technical details.

UI typography scale:

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| Window title | 18px | 600 | 26px |
| Page title | 24px | 600 | 34px |
| Section title | 16px | 600 | 24px |
| Body | 14px | 400 | 22px |
| Secondary | 13px | 400 | 20px |
| Metadata | 12px | 400 | 18px |
| Button | 14px | 500 | 20px |

### Manuscript Typeface

Default:

- Source Han Serif SC.
- 18px text.
- 32px line height.
- 680-760px readable text column.
- Paragraph spacing adjustable independently from line spacing.

Editor preferences may offer:

- Serif.
- Sans serif.
- System font.
- User-selected local font in P1.

The manuscript typeface never changes the UI typeface.

## Spacing

Base spacing unit: 4px.

Primary scale:

```text
4, 8, 12, 16, 20, 24, 32, 40, 48, 64
```

Rules:

- Compact controls: 8px internal gap.
- Form fields: 8px between label, control, helper, and error.
- Related control groups: 16px.
- Panel sections: 24px.
- Main page sections: 32-48px.
- Editor top and bottom breathing room: at least 48px.
- Interactive targets: minimum 32px, preferred 36-40px.

## Layout Dimensions

Desktop target:

- Minimum supported window: 1024 x 720.
- Recommended window: 1440 x 900.
- Project navigation: 216-240px.
- Chapter navigation: 200-224px.
- Assistant panel: 288-336px.
- Manuscript content: 680-760px.
- Task tray collapsed height: 40px.
- Task tray expanded maximum height: 40 percent of content area.

At narrow widths:

- Below 1180px, assistant panel becomes a drawer.
- Below 1024px, chapter navigation becomes an overlay drawer.
- Focus Mode remains available at every supported size.

## Component Hierarchy

### Level 1: Application Shell

- Title bar.
- Project switcher.
- Global task status.
- Command palette.
- Settings.

### Level 2: Workspace Structure

- Project navigation.
- Chapter navigator.
- Main content region.
- Contextual assistant.
- Task tray.

### Level 3: Workflow Surfaces

- Editor.
- Story Record browser.
- Diagnostics evidence viewer.
- Revision comparison.
- Commit preview.
- Recovery center.

### Level 4: Controls

- Buttons.
- Segmented controls.
- Tabs.
- Menus.
- Toggles.
- Checkboxes.
- Selects.
- Inputs.
- Disclosure sections.
- Inline status messages.

## Status System

Status uses text, icon, and color. Color is never the only signal.

### Chapter Status

| Internal state | Author label | Treatment |
|---|---|---|
| planned | Planned / 已规划 | Neutral outline icon |
| drafting | Drafting / 写作中 | Accent pencil icon |
| diagnostics | Reviewing / 检查中 | Accent document-search icon |
| needs_human_review | Needs review / 待审阅 | Amber review icon |
| preview_ready | Ready to confirm / 待确认 | Pine-green preview icon |
| committed | Committed / 已提交 | Pine-green check icon |
| failed | Needs recovery / 需要恢复 | Muted red warning icon |
| stale | Needs refresh / 需要重新生成 | Amber refresh icon |

### Content Status

```text
Draft
Revision candidate
Accepted draft
Commit preview
Committed chapter
```

Each state appears in:

- The editor header.
- Version selector.
- Chapter navigator.
- Activity history.

Committed content uses a lock icon and cannot be edited in place. Editing it creates a new draft or follows an explicit controlled historical workflow outside MVP.

### Task Status

```text
Waiting
Running
Cancelling
Completed
Failed
Cancelled
Recoverable
```

## Icon Guidance

Recommended family: Phosphor Icons.

Rules:

- One icon family across the product.
- Default weight: regular.
- Active navigation may use medium weight.
- Icon-only buttons require tooltips and accessible names.
- Use familiar icons for save, search, settings, close, undo, redo, expand, collapse, and history.
- Destructive actions always include text in confirmation dialogs.
- No decorative icon on every row.

## Light And Dark Strategy

MVP ships one high-quality light theme.

The token architecture must support:

- `system`
- `light`
- `dark`

Dark mode is designed during implementation but may remain experimental until visual review is complete.

Theme rules:

- Theme applies to the entire window.
- The editor may offer a separate paper tint only within the same theme family.
- Diagnostics and status colors preserve meaning and contrast.
- Syntax-like diff colors use restrained background tints, not saturated fills.

# 11. Component Inventory

## Application Components

- ApplicationTitleBar
- ProjectSwitcher
- GlobalTaskIndicator
- CommandPalette
- UpdateOrEnvironmentNotice
- AppErrorBoundary

## First-Launch Components

- WelcomePanel
- LocalDataExplanation
- CodexReadinessChecklist
- CodexInstallGuidance
- CodexLoginGuidance
- StorageDirectoryPicker
- BackupPreferenceForm

## Project Library Components

- ContinueWritingPanel
- ProjectList
- ProjectRow
- NewProjectButton
- ArchivedProjectList
- BackupStatusSummary
- EmptyProjectLibrary

## New Novel Components

- WizardShell
- NamedStageNavigation
- CoreIdeaForm
- GenreReaderForm
- ProtagonistForm
- WorldForm
- StyleForm
- LengthPlanForm
- BriefReview
- StoryBibleGenerationProgress
- StoryBibleReviewEditor

## Project Space Components

- ProjectNavigation
- ProjectOverviewHeader
- RecommendedNextAction
- VolumeProgress
- RecentChapterSummary
- CharacterSummaryList
- OpenMysterySummary
- RecentActivity
- ProjectHealthSummary

## Chapter Workspace Components

- ChapterNavigator
- ChapterHeader
- ContentStatusLabel
- AutosaveStatus
- VersionSelector
- ManuscriptEditor
- FocusModeToggle
- ChapterGoalPanel
- ChapterPlanPanel
- ReviewSummaryPanel
- RevisionCandidateNotice
- CommitPreviewNotice
- LongTaskTray

## Diagnostics Components

- DiagnosticSummary
- CriticalFindingList
- AdvisoryFindingList
- DiagnosticFinding
- EvidenceSnippet
- EvidenceLocationLink
- DiagnosticRuleExplanation
- FindingDispositionControl
- GenerateRevisionAction

## Revision Components

- RevisionComparisonHeader
- OriginalDraftPane
- CandidateDraftPane
- ParagraphDiff
- ChangeReasonPanel
- ResolvedIssueList
- NewIssueWarning
- AcceptCandidateAction
- RejectCandidateAction
- KeepAlternateAction

## Commit Components

- CommitReadinessSummary
- StoryRecordChangeGroup
- StoryFactChange
- CharacterChange
- TimelineChange
- MysteryChange
- ForeshadowingChange
- ReaderKnowledgeChange
- HighRiskChangeReview
- EvidenceDisclosure
- TechnicalDetailsDisclosure
- ControlledCommitConfirmation
- CommitCompletionSummary

## Story Record Components

- StoryRecordNavigation
- CharacterList
- CharacterDetail
- RelationshipGraph
- TimelineView
- ReaderKnowledgeView
- OpenMysteryList
- ForeshadowingList
- WorldRuleList
- CanonFactList
- StoryRecordSearch

## Reliability Components

- CurrentTaskPanel
- TaskStageList
- TaskFailureSummary
- RetryTaskAction
- ResumeTaskAction
- CancelTaskAction
- RunHistory
- SnapshotList
- RestorePointDetail
- ProjectHealthReport
- CrashRecoveryDialog
- IncompleteCommitWarning

# 12. Key Interaction States

## Editor Save States

```text
Saved
Saving
Unsaved changes
Save failed
Recovered copy available
```

Rules:

- Autosave is quiet when successful.
- Save failure remains visible until resolved.
- Closing the window with unsaved data triggers a blocking confirmation.
- A recovered copy never silently replaces a newer draft.

## Draft And Version States

Draft:

- Editable.
- Autosaved.
- Not canonical.

Revision candidate:

- Read-only until accepted or copied into a new editable draft.
- Clearly labeled with generation time and source draft.
- Never silently replaces the current draft.

Accepted draft:

- Editable.
- Carries provenance from the candidate.
- Still not canonical.

Commit preview:

- Read-only.
- Bound to source draft, Story Record, and chapter status.
- Automatically invalidated when any source changes.

Committed chapter:

- Read-only canonical version.
- Editing creates a new draft branch or future controlled recommit workflow.

## Long Task States

Running:

- Show human-readable stage.
- Show elapsed time.
- Show cancellation availability.
- Keep the rest of the application usable when safe.

Cancelling:

- Disable repeated cancel requests.
- Explain that the current local process is being stopped.

Failed:

- Preserve all safe artifacts.
- Show the last completed stage.
- Offer the safest next action first.

Completed:

- Move task to history.
- Surface the generated content at its natural destination.

## Commit Button States

Disabled with explanation:

- Chapter review has critical failures.
- Revision decision is incomplete.
- Preview is stale.
- High-risk changes are not reviewed.
- Current Story Record changed.
- Chapter is already committed.

Enabled:

- Preview complete.
- Source hashes current.
- Required decisions complete.
- No blocking conflict.
- Chapter is based on the current canonical state.

After activation:

- Open a final confirmation dialog.
- State that the operation creates canonical content and restore points.
- Require a direct confirmation action.
- Do not use a generic Yes button.

# 13. Error And Recovery Experience

Every error contains:

1. What happened.
2. What was protected.
3. What the author can do next.
4. Optional technical details.

## Error Catalogue

### Codex Not Installed

Message:

> Novel Loop could not find Codex on this computer. Your project was not changed.

Actions:

- Open installation guide.
- Check again.
- Continue without AI.

### Codex Not Logged In

Message:

> Codex is installed but is not signed in. Sign in once in the Codex application or terminal, then return here.

Actions:

- Open login instructions.
- Check again.

The product never displays auth files or tokens.

### Codex Doctor Warning, Smoke Available

Message:

> Codex reported a configuration warning, but text generation and structured output are working. You can continue.

Actions:

- Continue.
- View guidance.
- Run check again.

Treatment: warning, not blocker.

### Codex Timeout

Message:

> The writing task took longer than expected and was stopped. Your draft and completed stages were preserved.

Actions:

- Resume from the last safe stage.
- Try again.
- Review task details.

### Usage Limit

Message:

> Codex could not continue because the current usage allowance is unavailable. No Story Record changes were made.

Actions:

- Try again later.
- Continue editing manually.
- View preserved work.

### Invalid Structured Output

Message:

> Codex returned a response Novel Loop could not safely use. The response was kept for diagnosis, but it was not applied.

Actions:

- Retry.
- Continue manually.
- Open technical details.

### Diagnostics Hard Failure

Message:

> This chapter has a critical consistency problem and cannot be prepared for formal commit yet.

Actions:

- View evidence.
- Create a targeted revision candidate.
- Return to editing.

### Revision Candidate Has No Improvement

Message:

> The revision candidate did not resolve the selected problem. Your original draft remains unchanged.

Actions:

- Keep candidate as alternate.
- Reject candidate.
- Revise manually.

### Candidate Is Stale

Message:

> The chapter or its review basis changed after this candidate was created. Generate a new candidate before accepting it.

Actions:

- Generate again.
- Compare sources.

### Commit Preview Is Stale

Message:

> The Story Record changed after this preview was created. Nothing was committed.

Actions:

- Refresh preview.
- Inspect recent Story Record changes.

### Project File Damage

Message:

> Novel Loop found project files that do not match the expected structure. The project is open in protected mode.

Actions:

- Run project check.
- Restore from a safe restore point.
- Open project folder.
- Export diagnostic package.

Protected mode prevents writes to canonical files.

### Incomplete Commit Journal

Message:

> A previous chapter commit did not finish cleanly. Novel Loop will not start another commit until the project is checked.

Actions:

- Inspect recovery summary.
- Restore pre-commit state.
- Complete safe recovery.

### User Cancellation

Message:

> The task was cancelled. Completed work was preserved and the Story Record was not changed.

Actions:

- Resume.
- Start again.
- Dismiss.

### Crash Recovery

On restart:

- Detect draft autosave newer than the last clean close.
- Detect running or incomplete task.
- Detect incomplete commit journal.
- Present a recovery summary before normal editing.
- Never automatically resume Codex or commit work.

# 14. Electron UI API Boundary Draft

## Required Boundary

```text
Renderer
-> typed preload API
-> Electron main and local application service
-> Novel Loop Engine
```

## Renderer Rules

Renderer must not:

- Import Node.js filesystem or process APIs.
- Read or write the projects directory.
- Execute shell commands.
- Invoke Codex directly.
- Receive auth paths, tokens, raw environment variables, or raw Codex JSONL.
- Construct engine artifact paths.
- Mutate Story State.

Recommended Electron security posture:

- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer sandbox enabled where compatible.
- A narrow explicit preload surface.
- Request and response schema validation in main.
- No generic `invoke(channel, payload)` API exposed to renderer.

## Domain-Oriented Preload Surface

This is conceptual pseudocode, not an implementation contract.

```text
novelLoop.projects
  list()
  create(input)
  open(projectId)
  archive(projectId)
  backup(projectId)
  validate(projectId)

novelLoop.foundation
  read(projectId)
  generate(projectId, input)
  saveAuthorEdits(projectId, section, content)

novelLoop.chapters
  list(projectId)
  read(projectId, chapterNumber, version)
  saveDraft(projectId, chapterNumber, content, revision)
  createNext(projectId, options)
  generateDraft(projectId, chapterNumber, options)

novelLoop.review
  diagnose(projectId, chapterNumber)
  listFindings(projectId, chapterNumber)
  generateCandidate(projectId, chapterNumber, findingIds)
  compareCandidate(projectId, chapterNumber, candidateId)
  acceptCandidate(projectId, chapterNumber, candidateId)
  rejectCandidate(projectId, chapterNumber, candidateId)

novelLoop.commit
  createPreview(projectId, chapterNumber)
  reviewChange(projectId, chapterNumber, previewId, changeId, decision)
  approve(projectId, chapterNumber, previewId)
  commit(projectId, chapterNumber, approvalId)

novelLoop.storyRecord
  summary(projectId)
  characters(projectId)
  timeline(projectId, filters)
  readerKnowledge(projectId)
  mysteries(projectId)
  foreshadowing(projectId)
  canonFacts(projectId, query)

novelLoop.tasks
  list(projectId)
  detail(projectId, taskId)
  cancel(projectId, taskId)
  retry(projectId, taskId)
  resume(projectId, taskId)
  subscribe(listener)

novelLoop.codex
  readiness()
  checkAgain()

novelLoop.settings
  read()
  updateSafePreferences(patch)
```

## Main-Process Responsibilities

- Validate every renderer request.
- Resolve project IDs to trusted paths.
- Call application services, never shell through user-provided strings.
- Enforce Codex read-only execution boundary.
- Convert engine events into redacted author-facing task events.
- Map internal errors into stable user-facing error categories.
- Revalidate source freshness before preview, approval, and commit.
- Keep commit, snapshot, and Story State writes inside engine services.

## Event Model

Renderer receives redacted events such as:

```text
TASK_STARTED
TASK_STAGE_CHANGED
TASK_PROGRESS_UPDATED
TASK_RECOVERABLE_FAILURE
TASK_COMPLETED
DRAFT_AUTOSAVE_STATUS
CHAPTER_STATUS_CHANGED
COMMIT_PREVIEW_INVALIDATED
PROJECT_HEALTH_CHANGED
```

Events contain:

- Project ID.
- Chapter number where relevant.
- Author-facing stage.
- Safe progress information.
- Recoverability.
- Related product destination.

Events do not contain:

- Raw prompt.
- Auth data.
- Shell command.
- Raw JSONL.
- Filesystem paths.
- Unredacted provider output.

# 15. Accessibility And Keyboard Operation

## Accessibility Target

- WCAG 2.2 AA for all renderer surfaces.
- Full keyboard operation.
- Screen-reader labels for all controls and status changes.
- Reduced-motion support.
- High-contrast compatibility.
- No information conveyed by color alone.

## Keyboard Model

Global:

| Action | Shortcut |
|---|---|
| Command palette | Ctrl+K |
| Project library | Ctrl+Shift+P |
| Quick open chapter | Ctrl+P |
| Search current project | Ctrl+Shift+F |
| Settings | Ctrl+, |
| Toggle focus mode | Ctrl+Shift+Enter |
| Open task tray | Ctrl+Shift+T |
| Close dialog or drawer | Esc |

Editor:

| Action | Shortcut |
|---|---|
| Save now | Ctrl+S |
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |
| Find in chapter | Ctrl+F |
| Open chapter review | Ctrl+Alt+R |
| Open version selector | Ctrl+Alt+V |

Commit actions do not receive a single-key shortcut. The final commit requires a visible confirmation dialog.

## Focus Management

- Opening a dialog moves focus to its title or first meaningful control.
- Closing returns focus to the invoking control.
- Drawers trap focus only while modal.
- Non-modal assistant panels remain in normal tab order.
- Task completion announcements use polite live regions.
- Blocking errors use assertive announcements.
- Version switching announces the selected content state.

## Editor Accessibility

- The editor exposes document structure to assistive technology.
- Placeholder text is never used as a field label.
- Diagnostic evidence links move focus to the cited paragraph and provide a return action.
- Diff views offer side-by-side and unified reading modes.
- Insertions and removals include text labels, not only red and green backgrounds.

# 16. Ubuntu 24.04 Desktop Adaptation

## Window And Shell

- Test under GNOME with Wayland as the primary environment.
- Support X11 fallback.
- Use native window controls unless custom chrome has a demonstrated usability advantage.
- Respect system text scaling from 100 to 200 percent.
- Persist window size, position, and maximized state safely.
- Do not restore an off-screen window after monitor changes.

## File Selection

- Use native directory and file dialogs from the main process.
- Explain project location in author language.
- Handle removable or unavailable storage gracefully.
- Detect read-only directories before project creation.
- Never ask the renderer to hold unrestricted filesystem handles.

## Fonts And Input

- Verify Source Han font availability or package required fonts with licensing review.
- Test Chinese input methods including IBus Pinyin.
- Ensure IME composition is not interrupted by autosave, diagnostics markers, or React rerenders.
- Test punctuation, selection, undo, and candidate windows in the manuscript editor.

## Desktop Integration

- `.desktop` launcher.
- Application icon at Linux-required sizes.
- Correct application category.
- Single-instance behavior.
- Open project from recent documents only after explicit file association design.
- System notifications only for long-task completion when the app is not focused.

## Packaging

Packaging direction requires later engineering validation:

- AppImage for invited testing simplicity.
- Debian package for managed Ubuntu installations.
- Do not assume Snap confinement is compatible with local Codex discovery and project directory access.

## Performance

- Large manuscript rendering must remain responsive.
- Long engine work runs outside the renderer thread.
- Diff computation for large chapters must not block typing.
- Story Record lists should virtualize only when data size justifies it.
- Editor startup should restore the last draft before loading secondary analytics.

# 17. Windows Migration Considerations

## Paths And Storage

- Never persist POSIX separators in UI-facing assumptions.
- Treat project IDs and storage roots independently.
- Handle drive letters, UNC paths, and unavailable network drives.
- Avoid case-sensitive filename assumptions.
- Test long paths and non-ASCII usernames.

## Codex Discovery

- Detect executable variants without exposing command paths.
- Account for PowerShell and Windows terminal installation differences.
- Keep provider invocation inside main/application service.
- Preserve the same no-workspace-write boundary.

## Window And Input

- Support Windows scale factors such as 125, 150, and 175 percent.
- Verify native title bar behavior and snap layouts.
- Test Microsoft Pinyin IME.
- Use Windows keyboard conventions where they differ.
- Test high-contrast mode.

## Packaging And Signing

- Plan for code signing before broad distribution.
- Use a conventional installer with explicit project-data preservation behavior.
- Updates must never remove project directories.
- Uninstall must leave author projects intact unless the user explicitly chooses removal.

## Cross-Platform Design Rule

The product uses shared information architecture and semantic design tokens, while allowing platform-specific:

- Window controls.
- File dialogs.
- Menu conventions.
- Keyboard hints.
- Notification behavior.

# 18. Design Risks And Product Decisions

## Risks

### Too Much Engine Surface

Risk:

- Exposing every engine feature would produce a control console.

Mitigation:

- Organize around author jobs.
- Keep provenance under technical details.
- Require a product justification before adding an engine-derived control.

### Unclear Canonical Status

Risk:

- Authors may confuse an accepted candidate with a committed chapter.

Mitigation:

- Persistent content status label.
- Distinct commit preview.
- Read-only committed state.
- Explicit controlled commit confirmation.

### AI Task Latency

Risk:

- Real Codex tasks may take several minutes.

Mitigation:

- Stage-based progress.
- Background-safe operation.
- Cancellation and recovery.
- Meaningful elapsed time.
- No fake percentage when the engine cannot estimate progress.

### Error Language Becomes Technical

Risk:

- Internal error codes leak into the primary experience.

Mitigation:

- Stable user-facing error taxonomy.
- Technical details remain opt-in.
- Every error includes next actions and protected-state confirmation.

### Story Record Becomes A Data Dashboard

Risk:

- Lists and graphs may distract from writing.

Mitigation:

- Start with summaries and author questions.
- Use timeline, character detail, and focused filters.
- Avoid aggregate metrics with no writing decision attached.

### Editor Complexity

Risk:

- Paragraph-level revision, comments, diagnostics, and versions can overwhelm the manuscript.

Mitigation:

- MVP uses whole-candidate acceptance.
- Diagnostics annotations are hidden until review mode.
- Focus Mode removes secondary tools.

### Desktop Packaging And Codex Discovery

Risk:

- Linux installation variations make Codex detection unreliable.

Mitigation:

- Layered readiness check.
- Non-blocking doctor warning.
- Clear installation guidance.
- No automatic auth or update management.

### Large Project Performance

Risk:

- Long projects may make Story Record, timeline, search, and diff views slow.

Mitigation:

- Load chapter text before secondary information.
- Use indexed summaries from the engine.
- Paginate or virtualize only large collections.
- Keep expensive work outside renderer.

## Product Decisions Adopted By This Specification

- Primary architecture: Direction A.
- Chapter Focus Mode: included.
- Default startup: return to the last chapter when safe, otherwise Project Library.
- Default UI language: Chinese, with internationalization-ready message keys.
- Story State label: 故事档案.
- Narrative Debt label: 待兑现悬念.
- Commit label: 正式提交本章.
- AI output never replaces the current draft automatically.
- Story Record cannot be directly edited in MVP.
- Paragraph-level candidate acceptance is P1.
- Project cover is optional and never automatically generated.

## Decisions Requiring Validation In Prototype Testing

1. Whether the right assistant panel should auto-collapse after typing begins.
2. Whether authors understand 故事档案 without onboarding explanation.
3. Whether 待兑现悬念 is clearly distinct from 伏笔.
4. Whether the Project Overview provides enough value to justify an extra navigation step.
5. Whether whole-candidate acceptance is sufficient for the invited-author MVP.
6. Whether task progress should remain visible when the author changes pages.
7. Whether the initial light theme supports multi-hour writing without excessive brightness.
8. Whether technical details should be available per artifact or only through Activity.

# Prototype Validation Plan

## Prototype Scope

The first interactive prototype should include:

- First launch with three Codex readiness outcomes.
- Project Library with empty and populated states.
- New Novel wizard using realistic Chinese content.
- Project Overview.
- Chapter Workspace default and Focus Mode.
- Diagnostics evidence navigation.
- Revision comparison.
- Commit preview with high-risk decision.
- Running, timeout, usage-limit, stale-preview, and crash-recovery states.

The prototype uses static or controlled fixture data. It does not call the engine or Codex.

## Usability Tasks

Ask each invited author to:

1. Create a new novel from a short idea.
2. Find the next chapter action.
3. Continue editing an existing draft.
4. Identify why a timeline finding is considered critical.
5. Compare and reject or accept a revision candidate.
6. Explain whether the chapter is already canonical.
7. Review what will change in the Story Record.
8. Recover from a simulated Codex timeout.
9. Find an open mystery and its planned relevance.
10. Locate a previous safe restore point.

## Prototype Acceptance Signals

- At least 80 percent of participants identify draft versus committed state without prompting.
- All participants understand that commit preview has not modified Story Record.
- At least 80 percent complete revision comparison without opening technical details.
- All participants can recover from a simulated failed task.
- No participant expects Codex to edit canonical state automatically.
- Median time to resume the current chapter is under 20 seconds.
- Authors can explain the purpose of 故事档案 and 待兑现悬念 in their own words.

# Design Approval Gate

Production planning may begin only after human approval of:

- Primary information architecture.
- Chapter Workspace layout.
- Draft, candidate, preview, and committed status model.
- Commit preview interaction.
- Error and recovery language.
- Typed preload boundary.
- Prototype validation scope.

No production Electron or React implementation is authorized by this document alone.
