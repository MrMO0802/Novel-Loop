import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { FloppyDisk } from '@phosphor-icons/react/FloppyDisk';
import { Plus } from '@phosphor-icons/react/Plus';
import { Trash } from '@phosphor-icons/react/Trash';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ChapterAuthoringResult,
  ChapterPlanReviewResult,
  ChapterSaveMissionWorkingCopyRequest
} from '../../../../shared/chapterContract';
import { t } from '../../i18n/messages.zh-CN';
import { ChapterRevisionCompare } from './ChapterRevisionCompare';

type AvailablePlan = Extract<ChapterPlanReviewResult, { available: true }>;
type Mission = AvailablePlan['mission'];
type MissionDraft = ChapterSaveMissionWorkingCopyRequest['mission'];
type Objective = MissionDraft['requiredObjectives'][number];
type CharacterDelta = MissionDraft['characterDeltas'][number];
type NewParticipant = MissionDraft['newParticipants'][number];
type ReaderInformation = MissionDraft['readerInformation'];
type IntroducedDebt = MissionDraft['debtsToIntroduce'][number];

interface ParticipantRow {
  name: string;
  participantToken: string;
  role: string;
  selected: boolean;
}

interface ChapterMissionEditorProps {
  mission: Mission;
  onAdopted: () => Promise<void>;
  onClose: () => void;
  onOutcome: (result: ChapterAuthoringResult) => void;
  projectKey: string;
  reviewToken: string;
}

export function ChapterMissionEditor({
  mission,
  onAdopted,
  onClose,
  onOutcome,
  projectKey,
  reviewToken
}: ChapterMissionEditorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const compareTriggerRef = useRef<HTMLButtonElement>(null);
  const directAdoptTriggerRef = useRef<HTMLButtonElement>(null);
  const editGeneration = useRef(0);
  const restoreCompareFocus = useRef(false);
  const restoreDirectAdoptFocus = useRef(false);
  const initialDraft = useMemo(() => createInitialDraft(mission), [mission]);
  const [chapterFunction, setChapterFunction] = useState(
    initialDraft.chapterFunction
  );
  const [objectives, setObjectives] = useState<Objective[]>(
    initialDraft.requiredObjectives
  );
  const [introducedDebts, setIntroducedDebts] = useState<IntroducedDebt[]>(
    mission.introducedDebts.map((debt) => ({ ...debt }))
  );
  const [characterDeltas, setCharacterDeltas] = useState<CharacterDelta[]>(
    initialDraft.characterDeltas
  );
  const [participants, setParticipants] = useState<ParticipantRow[]>(
    mission.participantOptions.map((participant) => ({ ...participant }))
  );
  const [newParticipants, setNewParticipants] = useState<NewParticipant[]>([]);
  const [readerInformation, setReaderInformation] = useState<ReaderInformation>(
    initialDraft.readerInformation
  );
  const [forbiddenMoves, setForbiddenMoves] = useState(
    initialDraft.forbiddenMoves
  );
  const [emotionalCurve, setEmotionalCurve] = useState(
    initialDraft.targetEmotionalCurve
  );
  const [targetWordCount, setTargetWordCount] = useState<number | null>(
    initialDraft.targetWordCount
  );
  const [revisionToken, setRevisionToken] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<MissionDraft | null>(null);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<'dirty' | 'saved' | 'adopted'>('dirty');
  const [saving, setSaving] = useState(false);
  const [compareMode, setCompareMode] = useState<
    'compare' | 'confirm' | null
  >(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [invalidCharacterDeltas, setInvalidCharacterDeltas] = useState<
    number[]
  >([]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!compareMode) {
      if (restoreDirectAdoptFocus.current) {
        restoreDirectAdoptFocus.current = false;
        directAdoptTriggerRef.current?.focus();
      } else if (restoreCompareFocus.current) {
        restoreCompareFocus.current = false;
        compareTriggerRef.current?.focus();
      }
    }
  }, [compareMode]);

  const markDirty = () => {
    editGeneration.current += 1;
    setStatus('dirty');
    setRevisionToken(null);
    setSavedDraft(null);
    setSavedSummary(null);
    setCompareMode(null);
    setLocalError(null);
    setInvalidCharacterDeltas([]);
  };

  const buildDraft = (): MissionDraft | null => {
    const incompleteParticipant = newParticipants.some(({ name, role }) => (
      (name.trim() === '') !== (role.trim() === '')
    ));
    const incompleteCharacterDeltas = characterDeltas.flatMap((delta, index) => {
      const completedFields = [delta.from, delta.to, delta.evidenceRequired]
        .filter((value) => value.trim() !== '').length;
      return completedFields > 0 && completedFields < 3 ? [index] : [];
    });
    if (chapterFunction.trim() === '') {
      setLocalError(t('chapter.mission.validationPurpose'));
      return null;
    }
    if (incompleteParticipant) {
      setLocalError(t('chapter.mission.validationParticipant'));
      return null;
    }
    if (incompleteCharacterDeltas.length > 0) {
      setInvalidCharacterDeltas(incompleteCharacterDeltas);
      setLocalError(t('chapter.mission.validationCharacterChange'));
      return null;
    }
    setInvalidCharacterDeltas([]);
    return {
      chapterFunction: chapterFunction.trim(),
      requiredObjectives: objectives
        .filter(({ text }) => text.trim() !== '')
        .map((objective) => ({ ...objective, text: objective.text.trim() })),
      debtTokens: mission.debtItems.map(({ itemToken }) => itemToken),
      debtsToIntroduce: introducedDebts
        .filter(({ promise }) => promise.trim() !== '')
        .map(({ type, promise, importance }) => ({
          type,
          promise: promise.trim(),
          importance
        })),
      characterDeltas: characterDeltas.filter(({ from, to, evidenceRequired }) => (
        from.trim() !== '' && to.trim() !== '' && evidenceRequired.trim() !== ''
      )).map((delta) => ({
        ...delta,
        from: delta.from.trim(),
        to: delta.to.trim(),
        evidenceRequired: delta.evidenceRequired.trim()
      })),
      participantTokens: participants
        .filter(({ selected }) => selected)
        .map(({ participantToken }) => participantToken),
      newParticipants: newParticipants
        .filter(({ name, role }) => name.trim() !== '' && role.trim() !== '')
        .map(({ name, role }) => ({ name: name.trim(), role: role.trim() })),
      readerInformation: mapReaderInformation(readerInformation),
      forbiddenMoves: cleanTextRows(forbiddenMoves),
      targetEmotionalCurve: cleanTextRows(emotionalCurve),
      targetWordCount
    };
  };

  const save = async () => {
    if (saving) return;
    const draft = buildDraft();
    if (!draft) return;
    const saveGeneration = editGeneration.current;
    const summary = missionDraftSummary({
      draft,
      mission
    });
    setSaving(true);
    setLocalError(null);
    try {
      const result = await window.novelLoop.chapter.saveMissionWorkingCopy({
        projectKey,
        reviewToken,
        mission: draft
      });
      if (saveGeneration !== editGeneration.current) return;
      if (result.outcome === 'saved') {
        setRevisionToken(result.revisionToken);
        setSavedDraft(draft);
        setSavedSummary(summary);
        setStatus('saved');
      } else {
        onOutcome(result);
      }
    } catch {
      if (saveGeneration === editGeneration.current) {
        onOutcome({ outcome: 'invalid', messageKey: 'invalid_output' });
      }
    } finally {
      setSaving(false);
    }
  };

  const adopt = async () => {
    if (!revisionToken) return false;
    try {
      const result = await window.novelLoop.chapter.adoptRevision({
        projectKey,
        revisionToken,
        confirmInvalidation: true
      });
      if (result.outcome === 'adopted') {
        setCompareMode(null);
        setStatus('adopted');
        await onAdopted();
        return true;
      }
      onOutcome(result);
      return false;
    } catch {
      onOutcome({ outcome: 'invalid', messageKey: 'invalid_output' });
      return false;
    }
  };

  return (
    <>
      <section
        aria-labelledby="chapter-mission-editor-title"
        className="nl-chapter-editor"
        hidden={compareMode !== null}
      >
      <div className="nl-editor-heading">
        <div>
          <p className="nl-section-label">{t('chapter.mission.label')}</p>
          <h2
            id="chapter-mission-editor-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('chapter.mission.title')}
          </h2>
        </div>
        <p
          aria-live="polite"
          className={`nl-edit-status nl-edit-status--${status}`}
        >
          {statusLabel(status)}
        </p>
      </div>

      {localError && (
        <p className="nl-inline-alert nl-inline-alert--error" role="alert">
          {localError}
        </p>
      )}

      <div className="nl-mission-editor__sections">
        <div className="nl-field">
          <label htmlFor="chapter-purpose">{t('chapter.mission.purpose')}</label>
          <textarea
            id="chapter-purpose"
            onChange={(event) => {
              markDirty();
              setChapterFunction(event.currentTarget.value);
            }}
            rows={4}
            value={chapterFunction}
          />
        </div>

        <TextRows
          addLabel={t('chapter.mission.addObjective')}
          label={t('chapter.review.objectives')}
          onChange={(rows, changedIndex, action) => {
            markDirty();
            if (action === 'remove' && changedIndex !== undefined) {
              setObjectives((current) => current.filter((_, index) => (
                index !== changedIndex
              )));
            } else if (action === 'add') {
              setObjectives((current) => [...current, {
                itemToken: null,
                text: '',
                type: 'plot',
                priority: 'must'
              }]);
            } else if (changedIndex !== undefined) {
              setObjectives((current) => current.map((objective, index) => (
                index === changedIndex
                  ? { ...objective, text: rows[index] ?? '' }
                  : objective
              )));
            }
          }}
          rows={objectives.map(({ text }) => text)}
        />

        <NarrativeDebtRows
          boundDebts={mission.debtItems}
          introducedDebts={introducedDebts}
          onChange={(rows) => {
            markDirty();
            setIntroducedDebts(rows);
          }}
        />

        <CharacterDeltaRows
          deltas={characterDeltas}
          invalidRows={invalidCharacterDeltas}
          onChange={(rows) => {
            markDirty();
            setCharacterDeltas(rows);
          }}
          participants={participants}
        />

        <ReaderInformationFields
          onChange={(next) => {
            markDirty();
            setReaderInformation(next);
          }}
          readerInformation={readerInformation}
        />

        <TextRows
          addLabel={t('chapter.mission.addForbiddenMove')}
          label={t('chapter.review.forbiddenMoves')}
          onChange={(rows) => {
            markDirty();
            setForbiddenMoves(rows);
          }}
          rows={forbiddenMoves}
        />

        <TextRows
          addLabel={t('chapter.mission.addEmotion')}
          label={t('chapter.mission.emotionalCurve')}
          onChange={(rows) => {
            markDirty();
            setEmotionalCurve(rows);
          }}
          rows={emotionalCurve}
        />

        <fieldset className="nl-repeatable-field">
          <legend>{t('chapter.mission.participants')}</legend>
          <div className="nl-participant-options">
            {participants.map((participant, index) => (
              <label className="nl-participant-option" key={participant.participantToken}>
                <input
                  checked={participant.selected}
                  onChange={(event) => {
                    const selected = event.currentTarget.checked;
                    markDirty();
                    setParticipants((current) => current.map((row, rowIndex) => (
                      rowIndex === index
                        ? { ...row, selected }
                        : row
                    )));
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>{participant.name}</strong>
                  <small>{participant.role}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="nl-repeatable-list">
            {newParticipants.map((participant, index) => (
              <div className="nl-participant-row" key={`new-participant-${index}`}>
                <label>
                  <span>{`新人物 ${index + 1} 姓名`}</span>
                  <input
                    aria-label={`新人物 ${index + 1} 姓名`}
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      markDirty();
                      setNewParticipants((current) => current.map((row, rowIndex) => (
                        rowIndex === index
                          ? { ...row, name }
                          : row
                      )));
                    }}
                    value={participant.name}
                  />
                </label>
                <label>
                  <span>{`新人物 ${index + 1} 角色`}</span>
                  <input
                    aria-label={`新人物 ${index + 1} 角色`}
                    onChange={(event) => {
                      const role = event.currentTarget.value;
                      markDirty();
                      setNewParticipants((current) => current.map((row, rowIndex) => (
                        rowIndex === index
                          ? { ...row, role }
                          : row
                      )));
                    }}
                    value={participant.role}
                  />
                </label>
                <button
                  aria-label={`移除新人物 ${index + 1}`}
                  className="nl-icon-action"
                  onClick={() => {
                    markDirty();
                    setNewParticipants((current) => current.filter((_, rowIndex) => (
                      rowIndex !== index
                    )));
                  }}
                  title={`移除新人物 ${index + 1}`}
                  type="button"
                >
                  <Trash aria-hidden size={18} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="nl-secondary-action"
            onClick={() => {
              markDirty();
              setNewParticipants((current) => [
                ...current,
                { name: '', role: '' }
              ]);
            }}
            type="button"
          >
            <Plus aria-hidden size={18} />
            {t('chapter.mission.addParticipant')}
          </button>
        </fieldset>

        <div className="nl-field nl-field--compact">
          <label htmlFor="chapter-target-word-count">
            {t('chapter.mission.wordCount')}
          </label>
          <input
            id="chapter-target-word-count"
            min="1"
            onChange={(event) => {
              markDirty();
              const value = event.currentTarget.valueAsNumber;
              setTargetWordCount(Number.isFinite(value) ? value : null);
            }}
            type="number"
            value={targetWordCount ?? ''}
          />
        </div>
      </div>

      <div className="nl-editor-actions">
        <button className="nl-secondary-action" onClick={onClose} type="button">
          {t('chapter.editor.discard')}
        </button>
        <button
          className="nl-secondary-action"
          disabled={!revisionToken}
          onClick={() => setCompareMode('compare')}
          ref={compareTriggerRef}
          type="button"
        >
          {t('chapter.editor.compare')}
        </button>
        <button
          className="nl-secondary-action"
          disabled={!revisionToken}
          onClick={() => setCompareMode('confirm')}
          ref={directAdoptTriggerRef}
          type="button"
        >
          <CheckCircle aria-hidden size={18} />
          {t('chapter.revision.adopt')}
        </button>
        <button
          className="nl-primary-action"
          disabled={saving}
          onClick={() => void save()}
          type="button"
        >
          <FloppyDisk aria-hidden size={18} />
          {saving ? t('chapter.editor.saving') : t('chapter.editor.save')}
        </button>
      </div>
      </section>
      {compareMode && savedDraft && savedSummary && (
        <ChapterRevisionCompare
          artifactKind="mission"
          candidate={savedSummary}
          onAdopt={adopt}
          onBack={() => {
            if (compareMode === 'confirm') {
              restoreDirectAdoptFocus.current = true;
            } else {
              restoreCompareFocus.current = true;
            }
            setCompareMode(null);
          }}
          {...(compareMode === 'confirm'
            ? {
                onCancelConfirmation: () => {
                  restoreDirectAdoptFocus.current = true;
                  setCompareMode(null);
                }
              }
            : {})}
          source={missionReviewSummary(mission)}
          startConfirming={compareMode === 'confirm'}
        />
      )}
    </>
  );
}

function TextRows({
  addLabel,
  label,
  onChange,
  rows
}: {
  addLabel: string;
  label: string;
  onChange: (
    rows: string[],
    changedIndex: number | undefined,
    action: 'add' | 'edit' | 'remove'
  ) => void;
  rows: string[];
}) {
  return (
    <fieldset className="nl-repeatable-field">
      <legend>{label}</legend>
      <div className="nl-repeatable-list">
        {rows.map((row, index) => (
          <div className="nl-repeatable-row" key={`${label}-${index}`}>
            <textarea
              aria-label={`${label} ${index + 1}`}
              onChange={(event) => onChange(
                rows.map((value, rowIndex) => rowIndex === index
                  ? event.currentTarget.value
                  : value),
                index,
                'edit'
              )}
              rows={2}
              value={row}
            />
            <button
              aria-label={`移除${label} ${index + 1}`}
              className="nl-icon-action"
              onClick={() => onChange(
                rows.filter((_, rowIndex) => rowIndex !== index),
                index,
                'remove'
              )}
              title={`移除${label} ${index + 1}`}
              type="button"
            >
              <Trash aria-hidden size={18} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="nl-secondary-action"
        onClick={() => onChange([...rows, ''], undefined, 'add')}
        type="button"
      >
        <Plus aria-hidden size={18} />
        {addLabel}
      </button>
    </fieldset>
  );
}

function NarrativeDebtRows({
  boundDebts,
  introducedDebts,
  onChange
}: {
  boundDebts: Mission['debtItems'];
  introducedDebts: IntroducedDebt[];
  onChange: (rows: IntroducedDebt[]) => void;
}) {
  return (
    <fieldset className="nl-repeatable-field">
      <legend>{t('chapter.review.narrativePromises')}</legend>
      {boundDebts.length > 0 && (
        <>
          <p className="nl-canonical-debt-note">
            {t('chapter.mission.boundPromisesNote')}
          </p>
          <section
            aria-label={t('chapter.mission.boundPromises')}
            className="nl-canonical-debt-list"
          >
            <h3>{t('chapter.mission.boundPromises')}</h3>
            <ul>
              {boundDebts.map(({ itemToken, promise }) => (
                <li key={itemToken}>{promise}</li>
              ))}
            </ul>
          </section>
        </>
      )}
      <div className="nl-repeatable-list">
        {introducedDebts.map((debt, index) => (
          <div className="nl-repeatable-row" key={`introduced-debt-${index}`}>
            <textarea
              aria-label={`${t('chapter.mission.newPromise')} ${index + 1}`}
              onChange={(event) => onChange(introducedDebts.map((row, rowIndex) => (
                rowIndex === index
                  ? { ...row, promise: event.currentTarget.value }
                  : row
              )))}
              rows={2}
              value={debt.promise}
            />
            <button
              aria-label={`移除${t('chapter.mission.newPromise')} ${index + 1}`}
              className="nl-icon-action"
              onClick={() => onChange(introducedDebts.filter((_, rowIndex) => (
                rowIndex !== index
              )))}
              title={`移除${t('chapter.mission.newPromise')} ${index + 1}`}
              type="button"
            >
              <Trash aria-hidden size={18} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="nl-secondary-action"
        onClick={() => onChange([...introducedDebts, {
          importance: 5,
          promise: '',
          type: 'promise'
        }])}
        type="button"
      >
        <Plus aria-hidden size={18} />
        {t('chapter.mission.addPromise')}
      </button>
    </fieldset>
  );
}

function CharacterDeltaRows({
  deltas,
  invalidRows,
  onChange,
  participants
}: {
  deltas: CharacterDelta[];
  invalidRows: number[];
  onChange: (rows: CharacterDelta[]) => void;
  participants: ParticipantRow[];
}) {
  const selected = participants.filter(({ selected }) => selected);
  return (
    <fieldset className="nl-repeatable-field">
      <legend>{t('chapter.review.characterDeltas')}</legend>
      <div className="nl-repeatable-list">
        {deltas.map((delta, index) => (
          <div className="nl-character-delta" key={`character-delta-${index}`}>
            <label>
              <span>{t('chapter.mission.character')}</span>
              <select
                aria-label={`人物变化 ${index + 1} 人物`}
                onChange={(event) => {
                  const participant = participants[Number(event.currentTarget.value)];
                  if (!participant) return;
                  onChange(deltas.map((row, rowIndex) => rowIndex === index
                    ? { ...row, participantToken: participant.participantToken }
                    : row));
                }}
                value={String(participants.findIndex(({ participantToken }) => (
                  participantToken === delta.participantToken
                )))}
              >
                {participants.map((participant, participantIndex) => (
                  <option key={participant.participantToken} value={participantIndex}>
                    {`${participant.name}（${participant.role}）`}
                  </option>
                ))}
              </select>
            </label>
            {([
              ['from', t('chapter.mission.changeFrom')],
              ['to', t('chapter.mission.changeTo')],
              ['evidenceRequired', t('chapter.mission.changeEvidence')]
            ] as const).map(([field, fieldLabel]) => (
              <label key={field}>
                <span>{fieldLabel}</span>
                <input
                  aria-invalid={invalidRows.includes(index)
                    ? 'true'
                    : undefined}
                  aria-label={`人物变化 ${index + 1} ${fieldLabel}`}
                  onChange={(event) => onChange(deltas.map((row, rowIndex) => (
                    rowIndex === index
                      ? { ...row, [field]: event.currentTarget.value }
                      : row
                  )))}
                  value={delta[field]}
                />
              </label>
            ))}
            <button
              aria-label={`移除人物变化 ${index + 1}`}
              className="nl-icon-action"
              onClick={() => onChange(deltas.filter((_, rowIndex) => rowIndex !== index))}
              title={`移除人物变化 ${index + 1}`}
              type="button"
            >
              <Trash aria-hidden size={18} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="nl-secondary-action"
        disabled={selected.length === 0}
        onClick={() => {
          const participant = selected[0];
          if (!participant) return;
          onChange([...deltas, {
            participantToken: participant.participantToken,
            from: '',
            to: '',
            evidenceRequired: ''
          }]);
        }}
        type="button"
      >
        <Plus aria-hidden size={18} />
        {t('chapter.mission.addCharacterChange')}
      </button>
    </fieldset>
  );
}

function ReaderInformationFields({
  onChange,
  readerInformation
}: {
  onChange: (readerInformation: ReaderInformation) => void;
  readerInformation: ReaderInformation;
}) {
  const fields = [
    ['newKnowledge', t('chapter.mission.newKnowledge'), t('chapter.mission.addKnowledge')],
    ['newSuspicions', t('chapter.mission.newSuspicions'), t('chapter.mission.addSuspicion')],
    ['questionsToMaintain', t('chapter.mission.questionsMaintain'), t('chapter.mission.addQuestion')],
    ['questionsToAnswer', t('chapter.mission.questionsAnswer'), t('chapter.mission.addAnswer')]
  ] as const;
  return fields.map(([field, label, addLabel]) => (
    <TextRows
      addLabel={addLabel}
      key={field}
      label={label}
      onChange={(rows) => onChange({ ...readerInformation, [field]: rows })}
      rows={readerInformation[field]}
    />
  ));
}

function createInitialDraft(mission: Mission): MissionDraft {
  return {
    chapterFunction: mission.chapterFunction,
    requiredObjectives: mission.objectiveItems.map((objective) => ({
      itemToken: objective.itemToken,
      text: objective.text,
      type: objective.type,
      priority: objective.priority
    })),
    debtTokens: mission.debtItems.map(({ itemToken }) => itemToken),
    debtsToIntroduce: mission.introducedDebts.map((debt) => ({ ...debt })),
    characterDeltas: mission.characterDeltaItems.map((delta) => ({
      participantToken: delta.participantToken,
      from: delta.from,
      to: delta.to,
      evidenceRequired: delta.evidenceRequired
    })),
    participantTokens: mission.participantOptions
      .filter(({ selected }) => selected)
      .map(({ participantToken }) => participantToken),
    newParticipants: [],
    readerInformation: mapReaderInformation(mission.readerInformation),
    forbiddenMoves: [...mission.forbiddenMoves],
    targetEmotionalCurve: [...mission.targetEmotionalCurve],
    targetWordCount: mission.targetWordCount
  };
}

function mapReaderInformation(reader: ReaderInformation): ReaderInformation {
  return {
    newKnowledge: cleanTextRows(reader.newKnowledge),
    newSuspicions: cleanTextRows(reader.newSuspicions),
    questionsToMaintain: cleanTextRows(reader.questionsToMaintain),
    questionsToAnswer: cleanTextRows(reader.questionsToAnswer)
  };
}

function cleanTextRows(rows: string[]): string[] {
  return rows.map((row) => row.trim()).filter(Boolean);
}

export function missionReviewSummary(mission: Mission): string {
  return authorMissionSummary([
    ['本章目的', [mission.chapterFunction]],
    ['必须完成', mission.objectives],
    ['推进的悬念与承诺', mission.narrativePromises],
    ['人物变化', mission.characterDeltas],
    ['本章人物', mission.participantOptions
      .filter(({ selected }) => selected)
      .map(({ name, role }) => `${name}（${role}）`)],
    ['读者会知道', mission.readerInformation.newKnowledge],
    ['读者会产生的猜测', mission.readerInformation.newSuspicions],
    ['读者会继续追问', mission.readerInformation.questionsToMaintain],
    ['本章会回答的问题', mission.readerInformation.questionsToAnswer],
    ['本章不能做', mission.forbiddenMoves],
    ['情绪节奏', mission.targetEmotionalCurve],
    ['目标字数', mission.targetWordCount === null
      ? []
      : [`${mission.targetWordCount} 字`]]
  ] satisfies Array<[string, string[]]>);
}

function missionDraftSummary({
  draft,
  mission
}: {
  draft: MissionDraft;
  mission: Mission;
}): string {
  const debtByToken = new Map(mission.debtItems.map(({ itemToken, promise }) => (
    [itemToken, promise]
  )));
  const participantByToken = new Map(mission.participantOptions.map(({
    participantToken,
    name,
    role
  }) => [participantToken, `${name}（${role}）`]));
  const selectedParticipantTokens = new Set(draft.participantTokens);
  const participantLabels = [
    ...mission.participantOptions
      .filter(({ participantToken }) => selectedParticipantTokens.has(participantToken))
      .flatMap(({ participantToken }) => {
        const label = participantByToken.get(participantToken);
        return label ? [label] : [];
      }),
    ...draft.newParticipants.map(({ name, role }) => `${name}（${role}）`)
  ];
  const narrativePromises = [
    ...draft.debtTokens.flatMap((itemToken) => {
      const promise = debtByToken.get(itemToken);
      return promise ? [promise] : [];
    }),
    ...draft.debtsToIntroduce.map(({ promise }) => promise)
  ];
  const characterDeltaLabels = draft.characterDeltas.map(({
    participantToken,
    from,
    to,
    evidenceRequired
  }) => {
    const participantLabel = participantByToken.get(participantToken)
      ?? '人物信息无法确认';
    return `${participantLabel}：${from} → ${to}；${evidenceRequired}`;
  });
  const sections = [
    ['本章目的', [draft.chapterFunction]],
    ['必须完成', draft.requiredObjectives.map(({ text }) => text)],
    ['推进的悬念与承诺', narrativePromises],
    ['人物变化', characterDeltaLabels],
    ['本章人物', participantLabels],
    ['读者会知道', draft.readerInformation.newKnowledge],
    ['读者会产生的猜测', draft.readerInformation.newSuspicions],
    ['读者会继续追问', draft.readerInformation.questionsToMaintain],
    ['本章会回答的问题', draft.readerInformation.questionsToAnswer],
    ['本章不能做', draft.forbiddenMoves],
    ['情绪节奏', draft.targetEmotionalCurve],
    ['目标字数', draft.targetWordCount === null
      ? []
      : [`${draft.targetWordCount} 字`]]
  ] satisfies Array<[string, string[]]>;
  return authorMissionSummary(sections);
}

function authorMissionSummary(sections: Array<[string, string[]]>): string {
  return sections.flatMap(([title, rows]) => [
    `## ${title}`,
    '',
    rows.length > 0 ? rows.map((row) => `- ${row}`).join('\n') : '暂无',
    ''
  ]).join('\n');
}

function statusLabel(status: 'dirty' | 'saved' | 'adopted') {
  if (status === 'saved') return t('chapter.editor.saved');
  if (status === 'adopted') return t('chapter.editor.adopted');
  return t('chapter.editor.unsaved');
}
