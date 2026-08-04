import { useEffect, useRef, useState } from 'react';

import type {
  ChapterDraftReviewResult,
  ChapterDraftWorkingCopyResult
} from '../../../../shared/chapterContract';

interface ChapterDraftEditorProps {
  projectKey: string;
  draft: Extract<ChapterDraftReviewResult, { available: true }>;
  workingCopy: ChapterDraftWorkingCopyResult;
  onAdopted(): void;
}

export function ChapterDraftEditor({
  projectKey,
  draft,
  workingCopy,
  onAdopted
}: ChapterDraftEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [markdown, setMarkdown] = useState(draft.markdown);
  const [recoveryPending, setRecoveryPending] = useState(
    workingCopy.recoveryAvailable && !workingCopy.stale && workingCopy.markdown !== null
  );
  const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'saving'>('saved');
  const [revisionToken, setRevisionToken] = useState<string | null>(workingCopy.revisionToken);
  const [preview, setPreview] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (saveState !== 'unsaved' || recoveryPending) return;
    const timeout = window.setTimeout(() => { void save(); }, 750);
    return () => window.clearTimeout(timeout);
  }, [markdown, recoveryPending, saveState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPreview((value) => !value);
      }
      if (event.key === 'Escape') {
        setComparing(false);
        setDiscarding(false);
        setAdopting(false);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function save(): Promise<string | null> {
    if (recoveryPending || saveState === 'saving') return null;
    setSaveState('saving');
    try {
      const pending = window.novelLoop.chapter.saveDraftWorkingCopy({ projectKey, markdown });
      setSaveState('saved');
      const result = await pending;
      setRevisionToken(result.revisionToken);
      return result.revisionToken;
    } catch {
      setSaveState('unsaved');
      return null;
    }
  }

  async function discard(): Promise<void> {
    await window.novelLoop.chapter.discardDraftWorkingCopy({ projectKey });
    setMarkdown(draft.markdown);
    setRevisionToken(null);
    setDiscarding(false);
    setSaveState('saved');
    textareaRef.current?.focus();
  }

  async function adopt(): Promise<void> {
    const token = revisionToken ?? await save();
    if (token === null) return;
    await window.novelLoop.chapter.adoptDraftRevision({
      projectKey,
      revisionToken: token,
      confirmAdoption: true
    });
    setAdopting(false);
    onAdopted();
  }

  const status = saveState === 'saved'
    ? '已自动保存'
    : saveState === 'saving'
      ? '正在保存'
      : '尚未保存';

  return (
    <section className="nl-draft-editor" aria-label="章节正文编辑器">
      {recoveryPending && (
        <div className="nl-draft-editor__recovery" role="alert">
          <p>已恢复上次未采用的编辑草稿</p>
          <div>
            <button type="button" onClick={() => {
              setMarkdown(workingCopy.markdown ?? draft.markdown);
              setRevisionToken(workingCopy.revisionToken);
              setRecoveryPending(false);
              setSaveState('saved');
              textareaRef.current?.focus();
            }}>继续编辑</button>
            <button type="button" onClick={() => {
              void discard();
              setRecoveryPending(false);
            }}>放弃恢复</button>
          </div>
        </div>
      )}
      <div className="nl-draft-editor__toolbar">
        <div role="tablist" aria-label="章节视图">
          <button aria-selected={!preview} onClick={() => setPreview(false)} role="tab" type="button">编辑</button>
          <button aria-selected={preview} onClick={() => setPreview(true)} role="tab" type="button">预览</button>
        </div>
        <p aria-live="polite" role="status">{status}</p>
      </div>
      {preview ? (
        <article className="nl-draft-editor__preview">{markdown}</article>
      ) : (
        <textarea
          aria-label="章节正文"
          disabled={recoveryPending}
          onChange={(event) => {
            setMarkdown(event.target.value);
            setSaveState('unsaved');
          }}
          ref={textareaRef}
          value={markdown}
        />
      )}
      <footer className="nl-draft-editor__footer">
        <p>{countWords(markdown)} 字</p>
        <div>
          <button type="button" onClick={() => setComparing(true)}>查看对比</button>
          <button type="button" onClick={() => setDiscarding(true)}>放弃草稿</button>
          <button type="button" onClick={() => setAdopting(true)}>采用此修订</button>
        </div>
      </footer>
      {comparing && (
        <div className="nl-draft-editor__dialog" role="dialog" aria-label="草稿对比">
          <pre>{draft.markdown}</pre><pre>{markdown}</pre>
          <button type="button" onClick={() => setComparing(false)}>关闭</button>
        </div>
      )}
      {discarding && (
        <div className="nl-draft-editor__dialog" role="dialog" aria-label="放弃草稿确认">
          <p>放弃未采用的编辑草稿？</p>
          <button type="button" onClick={() => { void discard(); }}>确认放弃</button>
          <button type="button" onClick={() => setDiscarding(false)}>取消</button>
        </div>
      )}
      {adopting && (
        <div className="nl-draft-editor__dialog" role="dialog" aria-label="采用草稿确认">
          <p>采用此作者修订？</p>
          <button type="button" onClick={() => { void adopt(); }}>确认采用</button>
          <button type="button" onClick={() => setAdopting(false)}>取消</button>
        </div>
      )}
    </section>
  );
}

function countWords(markdown: string): number {
  return Array.from(markdown.replace(/^#{1,6}\s+[^\n]+\n?/u, '').replace(/\s/gu, '')).length;
}
