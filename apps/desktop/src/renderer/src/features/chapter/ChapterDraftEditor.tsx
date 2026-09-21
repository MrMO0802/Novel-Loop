import { FloppyDisk } from '@phosphor-icons/react/FloppyDisk';
import { ShieldCheck } from '@phosphor-icons/react/ShieldCheck';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react';

import type {
  ChapterDraftReviewResult,
  ChapterDraftWorkingCopyResult
} from '../../../../shared/chapterContract';
import { t } from '../../i18n/messages.zh-CN';

interface ChapterDraftEditorProps {
  projectKey: string;
  draft: Extract<ChapterDraftReviewResult, { available: true }>;
  workingCopy: ChapterDraftWorkingCopyResult;
  onAdopted(): void | Promise<void>;
  onCheckSubmission?: () => void;
}

type DialogKind = 'adopt' | 'compare' | 'discard' | null;
type ActionState = 'idle' | 'adopting' | 'discarding';
type FocusIntent = 'dialog_opener' | 'textarea' | 'preview' | null;
type SaveOrigin = 'auto' | 'manual';

export function ChapterDraftEditor({
  projectKey,
  draft,
  workingCopy,
  onAdopted,
  onCheckSubmission
}: ChapterDraftEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const recoveryActionRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const saveTail = useRef<Promise<string | null>>(Promise.resolve(null));
  const editVersion = useRef(0);
  const latestQueuedSaveVersion = useRef(-1);
  const revisionTokenRef = useRef<string | null>(
    workingCopy.recoveryAvailable ? null : workingCopy.revisionToken
  );
  const [markdown, setMarkdown] = useState(draft.markdown);
  const [adoptedMarkdown, setAdoptedMarkdown] = useState(draft.markdown);
  const [hasAdopted, setHasAdopted] = useState(draft.versionKind === 'author_adopted');
  const [saveOrigin, setSaveOrigin] = useState<SaveOrigin>('auto');
  const [recoveryPending, setRecoveryPending] = useState(
    workingCopy.recoveryAvailable
  );
  const [discardingRecovery, setDiscardingRecovery] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'saving'>(
    'saved'
  );
  const [preview, setPreview] = useState(
    draft.versionKind === 'author_adopted' && !workingCopy.recoveryAvailable
  );
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [adoptionRecoveryRequired, setAdoptionRecoveryRequired] = useState(false);
  const [focusIntent, setFocusIntent] = useState<FocusIntent>(null);
  const hasPendingRevision = markdown !== adoptedMarkdown || revisionTokenRef.current !== null;

  useEffect(() => {
    if (
      saveState !== 'unsaved'
      || recoveryPending
      || adoptionRecoveryRequired
      || dialog !== null
      || actionState !== 'idle'
    ) return;
    const timeout = window.setTimeout(() => { void save(); }, 750);
    return () => window.clearTimeout(timeout);
  }, [
    actionState,
    adoptionRecoveryRequired,
    dialog,
    markdown,
    recoveryPending
  ]);

  useEffect(() => {
    if (adoptionRecoveryRequired) recoveryActionRef.current?.focus();
  }, [adoptionRecoveryRequired]);

  useLayoutEffect(() => {
    if (focusIntent === 'preview') {
      if (!preview || dialog !== null || actionState !== 'idle') return;
      previewRef.current?.focus();
      setFocusIntent(null);
      return;
    }
    if (focusIntent === 'textarea') {
      if (
        recoveryPending
        || discardingRecovery
        || adoptionRecoveryRequired
        || actionState !== 'idle'
        || dialog !== null
        || preview
      ) return;
      textareaRef.current?.focus();
      setFocusIntent(null);
      return;
    }
    if (focusIntent === 'dialog_opener') {
      if (dialog !== null || actionState !== 'idle') return;
      openerRef.current?.focus();
      setFocusIntent(null);
    }
  }, [
    actionState,
    adoptionRecoveryRequired,
    dialog,
    discardingRecovery,
    focusIntent,
    preview,
    recoveryPending
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey
        && event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        if (
          !recoveryPending
          && !adoptionRecoveryRequired
          && actionState === 'idle'
          && dialog === null
        ) void save('manual');
      }
      if (
        event.ctrlKey
        && event.shiftKey
        && event.key.toLowerCase() === 'p'
      ) {
        event.preventDefault();
        if (
          !recoveryPending
          && !adoptionRecoveryRequired
          && actionState === 'idle'
          && dialog === null
        ) setPreview((value) => !value);
      }
      if (event.key === 'Escape' && dialog !== null && actionState === 'idle') {
        event.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function updateRevisionToken(token: string | null): void {
    revisionTokenRef.current = token;
  }

  function save(origin: SaveOrigin = 'auto'): Promise<string | null> {
    if (
      recoveryPending
      || adoptionRecoveryRequired
      || actionState !== 'idle'
      || dialog !== null
    ) return Promise.resolve(null);
    if (saveState === 'saved') {
      if (origin === 'manual') {
        setSaveOrigin('manual');
        setActionError(null);
      }
      return Promise.resolve(revisionTokenRef.current);
    }
    return enqueueSave(markdown, editVersion.current, origin);
  }

  function enqueueSave(snapshot: string, version: number, origin: SaveOrigin = 'auto'): Promise<string | null> {
    if (version <= latestQueuedSaveVersion.current) return saveTail.current;
    latestQueuedSaveVersion.current = version;
    const queued = saveTail.current.catch(() => null).then(async () => {
      if (version === editVersion.current) setSaveState('saving');
      try {
        const result = await window.novelLoop.chapter.saveDraftWorkingCopy({
          projectKey,
          markdown: snapshot
        });
        if (version === editVersion.current) {
          updateRevisionToken(result.revisionToken);
          setSaveOrigin(origin);
          setSaveState('saved');
          setActionError(null);
        }
        return result.revisionToken;
      } catch {
        if (latestQueuedSaveVersion.current === version) {
          latestQueuedSaveVersion.current = version - 1;
        }
        if (version === editVersion.current) {
          setSaveState('unsaved');
          setActionError('编辑草稿暂时无法保存，请稍后重试。');
        }
        return null;
      }
    });
    saveTail.current = queued;
    return queued;
  }

  async function discardRecovery(): Promise<void> {
    if (discardingRecovery) return;
    setDiscardingRecovery(true);
    setActionError(null);
    try {
      await window.novelLoop.chapter.discardDraftWorkingCopy({ projectKey });
      setMarkdown(adoptedMarkdown);
      updateRevisionToken(null);
      setRecoveryPending(false);
      setSaveState('saved');
      setFocusIntent('textarea');
    } catch {
      setActionError('上次编辑草稿暂时无法丢弃，请重试。');
    } finally {
      setDiscardingRecovery(false);
    }
  }

  function continueRecovery(): void {
    if (workingCopy.stale || workingCopy.markdown === null) return;
    setMarkdown(workingCopy.markdown);
    updateRevisionToken(workingCopy.revisionToken);
    setRecoveryPending(false);
    setSaveState('saved');
    setActionError(null);
    setFocusIntent('textarea');
  }

  async function discard(): Promise<void> {
    if (actionState !== 'idle' || adoptionRecoveryRequired) return;
    setActionState('discarding');
    setActionError(null);
    editVersion.current += 1;
    try {
      await saveTail.current.catch(() => null);
      await window.novelLoop.chapter.discardDraftWorkingCopy({ projectKey });
      setMarkdown(adoptedMarkdown);
      updateRevisionToken(null);
      setSaveState('saved');
      setDialog(null);
      setFocusIntent('dialog_opener');
    } catch {
      setActionError('编辑草稿暂时无法丢弃，请重试。');
    } finally {
      setActionState('idle');
    }
  }

  async function adopt(): Promise<void> {
    if (actionState !== 'idle' || adoptionRecoveryRequired || !hasPendingRevision) return;
    setActionState('adopting');
    setActionError(null);
    let adoptionCompleted = false;
    try {
      if (saveState === 'unsaved') await saveTail.current.catch(() => null);
      const token = saveState === 'saved'
        ? revisionTokenRef.current
        : await saveCurrentForAdoption();
      if (token === null) {
        setActionError('请先保存当前编辑，再采用此修订。');
        return;
      }
      const result = await window.novelLoop.chapter.adoptDraftRevision({
        projectKey,
        revisionToken: token,
        confirmAdoption: true
      });
      if (result.outcome === 'recovery_required') {
        setAdoptionRecoveryRequired(true);
        setDialog(null);
        return;
      }
      adoptionCompleted = true;
      updateRevisionToken(null);
      setAdoptedMarkdown(markdown);
      setHasAdopted(true);
      setSaveState('saved');
      setDialog(null);
      setPreview(true);
      setFocusIntent('preview');
      await onAdopted();
    } catch {
      if (adoptionCompleted) setAdoptionRecoveryRequired(true);
      setActionError(adoptionCompleted
        ? '修订已采用，但界面暂时无法刷新。重新进入本章即可查看。'
        : '此修订暂时无法采用，请重新检查当前草稿。');
    } finally {
      setActionState('idle');
    }
  }

  async function reloadAfterAdoptionRecovery(): Promise<void> {
    setActionError(null);
    try {
      await onAdopted();
    } catch {
      setActionError('本章暂时无法重新载入，请返回项目概览后再进入。');
    }
  }

  async function saveCurrentForAdoption(): Promise<string | null> {
    return enqueueSave(markdown, editVersion.current).catch(() => null);
  }

  function openDialog(next: Exclude<DialogKind, null>, opener: HTMLButtonElement): void {
    if (adoptionRecoveryRequired || (next === 'adopt' && !hasPendingRevision)) return;
    openerRef.current = opener;
    setActionError(null);
    setDialog(next);
  }

  function closeDialog(): void {
    if (actionState !== 'idle') return;
    setDialog(null);
    setFocusIntent('dialog_opener');
  }

  const status = saveState === 'saved'
    ? saveOrigin === 'manual'
      ? '已保存'
      : hasPendingRevision ? '已自动保存' : hasAdopted ? '修订已采用' : '当前草稿已保存'
    : saveState === 'saving'
      ? '正在保存'
      : '尚未保存';
  const controlsDisabled = recoveryPending
    || adoptionRecoveryRequired
    || actionState !== 'idle';
  const editingDisabled = controlsDisabled || dialog !== null;
  const submissionDisabled = editingDisabled
    || discardingRecovery
    || saveState !== 'saved'
    || hasPendingRevision;

  return (
    <section className="nl-draft-editor" aria-label="章节正文编辑器">
      {recoveryPending && (
        <div className="nl-draft-editor__recovery" role="alert">
          <p>
            {workingCopy.stale
              ? '上次编辑草稿基于旧版本，无法恢复。'
              : '已恢复上次未采用的编辑草稿'}
          </p>
          <div>
            {!workingCopy.stale && (
              <button
                disabled={discardingRecovery}
                type="button"
                onClick={continueRecovery}
              >
                继续编辑
              </button>
            )}
            <button
              disabled={discardingRecovery}
              type="button"
              onClick={() => { void discardRecovery(); }}
            >
              放弃恢复
            </button>
          </div>
        </div>
      )}
      {adoptionRecoveryRequired && (
        <div className="nl-draft-editor__recovery" role="alert">
          <p>采用过程需要恢复后才能继续编辑。</p>
          <button
            ref={recoveryActionRef}
            type="button"
            onClick={() => { void reloadAfterAdoptionRecovery(); }}
          >
            重新载入本章
          </button>
        </div>
      )}
      {actionError !== null && <p className="nl-inline-alert nl-inline-alert--error" role="alert">{actionError}</p>}
      {hasAdopted && !hasPendingRevision && !recoveryPending && !adoptionRecoveryRequired && (
        <p className="nl-draft-editor__adopted" role="note">修订已采用，尚未正式提交。</p>
      )}
      <div className="nl-draft-editor__toolbar">
        <div role="tablist" aria-label="章节视图">
          <button
            aria-selected={!preview}
            disabled={controlsDisabled}
            onClick={() => setPreview(false)}
            role="tab"
            type="button"
          >
            编辑
          </button>
          <button
            aria-selected={preview}
            disabled={controlsDisabled}
            onClick={() => setPreview(true)}
            role="tab"
            type="button"
          >
            预览
          </button>
        </div>
        <div className="nl-draft-editor__save-actions">
          <p aria-live="polite" role="status">{status}</p>
          <button
            className="nl-secondary-action"
            disabled={editingDisabled || saveState === 'saving'}
            type="button"
            onClick={() => { void save('manual'); }}
          >
            <FloppyDisk aria-hidden size={18} />
            保存草稿
          </button>
          {onCheckSubmission && (
            <button
              className="nl-primary-action"
              disabled={submissionDisabled}
              type="button"
              onClick={() => {
                if (!submissionDisabled) onCheckSubmission();
              }}
            >
              <ShieldCheck aria-hidden size={18} />
              {t('submission.title')}
            </button>
          )}
        </div>
      </div>
      {onCheckSubmission && hasPendingRevision && !adoptionRecoveryRequired && (
        <p className="nl-inline-alert" role="note">{t('submission.pendingEdits')}</p>
      )}
      <textarea
        aria-label="章节正文"
        disabled={editingDisabled}
        hidden={preview}
        onChange={(event) => {
          editVersion.current += 1;
          setMarkdown(event.target.value);
          setSaveState('unsaved');
          setActionError(null);
        }}
        ref={textareaRef}
        value={markdown}
      />
      {preview && <SafeDraftBlocks markdown={markdown} previewRef={previewRef} />}
      <footer className="nl-draft-editor__footer">
        <p>{countWords(markdown)} 字</p>
        <div>
          <button
            disabled={controlsDisabled}
            type="button"
            onClick={(event) => openDialog('compare', event.currentTarget)}
          >
            查看对比
          </button>
          <button
            disabled={controlsDisabled}
            type="button"
            onClick={(event) => openDialog('discard', event.currentTarget)}
          >
            放弃草稿
          </button>
          <button
            disabled={controlsDisabled || !hasPendingRevision}
            type="button"
            onClick={(event) => openDialog('adopt', event.currentTarget)}
          >
            采用此修订
          </button>
        </div>
      </footer>
      {dialog === 'compare' && (
        <DraftDialog closeDisabled={false} label="草稿对比" onClose={closeDialog}>
          <SafeDraftBlocks markdown={draft.markdown} />
          <SafeDraftBlocks markdown={markdown} />
        </DraftDialog>
      )}
      {dialog === 'discard' && (
        <DraftDialog
          closeDisabled={actionState !== 'idle'}
          label="放弃草稿确认"
          onClose={closeDialog}
        >
          <p>放弃未采用的编辑草稿？</p>
          <button
            data-autofocus
            disabled={actionState !== 'idle'}
            type="button"
            onClick={() => { void discard(); }}
          >
            确认放弃
          </button>
        </DraftDialog>
      )}
      {dialog === 'adopt' && (
        <DraftDialog
          closeDisabled={actionState !== 'idle'}
          label="采用草稿确认"
          onClose={closeDialog}
        >
          <p>采用此作者修订？</p>
          <button
            data-autofocus
            disabled={actionState !== 'idle'}
            type="button"
            onClick={() => { void adopt(); }}
          >
            确认采用
          </button>
        </DraftDialog>
      )}
    </section>
  );
}

function DraftDialog({
  children,
  closeDisabled,
  label,
  onClose
}: {
  children: ReactNode;
  closeDisabled: boolean;
  label: string;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]');
    const first = preferred ?? focusableElements(dialog)[0];
    first?.focus();
  }, []);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab' || dialogRef.current === null) return;
    const focusable = focusableElements(dialogRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="nl-draft-editor__dialog-backdrop">
      <div
        aria-label={label}
        aria-modal="true"
        className="nl-draft-editor__dialog"
        onKeyDown={keepFocusInside}
        ref={dialogRef}
        role="dialog"
      >
        {children}
        <button disabled={closeDisabled} type="button" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

function SafeDraftBlocks({ markdown, previewRef }: {
  markdown: string;
  previewRef?: RefObject<HTMLElement | null>;
}) {
  const blocks = markdown
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block, index) => !(index === 0 && /^#\s+Chapter\s+\d+\s+Draft$/u.test(block)));
  return (
    <article ref={previewRef} tabIndex={-1} className="nl-draft-editor__preview" data-testid="draft-manuscript-preview">
      {blocks.map((block, index) => {
        const heading = /^#{1,6}\s+(.+)$/u.exec(block);
        return heading === null
          ? <p key={`${index}-${block.slice(0, 24)}`}>{block}</p>
          : <h2 key={`${index}-${block.slice(0, 24)}`}>{heading[1]}</h2>;
      })}
    </article>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )];
}

function countWords(markdown: string): number {
  return Array.from(
    markdown.replace(/^#{1,6}\s+[^\n]+\n?/u, '').replace(/\s/gu, '')
  ).length;
}
