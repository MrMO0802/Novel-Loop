import { BookOpenText, Check, Circle } from '@phosphor-icons/react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { newNovelDraftFixture, storyBibleReviewFixture } from '../fixtures/projects';
import { t, type MessageKey } from '../i18n/t';
import '../styles/onboarding.css';

type WizardData = {
  audience: string;
  centralSituation: string;
  chapterCount: number;
  desiredFeeling: string;
  genre: string;
  protagonistDesire: string;
  protagonistFear: string;
  protagonistName: string;
  storyLength: number;
  styleReference: string;
  title: string;
  voice: string;
  worldPlace: string;
  worldRule: string;
};

type TextField = Exclude<keyof WizardData, 'chapterCount' | 'storyLength'>;
type NumberField = Extract<keyof WizardData, 'chapterCount' | 'storyLength'>;

const stages: { id: string; labelKey: MessageKey }[] = [
  { id: 'idea', labelKey: 'wizard.idea' },
  { id: 'reader', labelKey: 'wizard.reader' },
  { id: 'protagonist', labelKey: 'wizard.protagonist' },
  { id: 'world', labelKey: 'wizard.world' },
  { id: 'style', labelKey: 'wizard.style' },
  { id: 'plan', labelKey: 'wizard.plan' },
  { id: 'review', labelKey: 'wizard.review' },
  { id: 'story-bible', labelKey: 'wizard.storyBible' }
];

const initialWizardData: WizardData = { ...newNovelDraftFixture };

function TextAreaField({
  field,
  labelKey,
  onChange,
  value
}: {
  field: TextField;
  labelKey: MessageKey;
  onChange: (field: TextField, value: string) => void;
  value: string;
}) {
  const id = `wizard-${field}`;
  return (
    <div className="nl-field">
      <label htmlFor={id}>{t(labelKey)}</label>
      <textarea
        id={id}
        onChange={(event) => onChange(field, event.target.value)}
        rows={4}
        value={value}
      />
    </div>
  );
}

function TextInputField({
  field,
  labelKey,
  onChange,
  value
}: {
  field: TextField;
  labelKey: MessageKey;
  onChange: (field: TextField, value: string) => void;
  value: string;
}) {
  const id = `wizard-${field}`;
  return (
    <div className="nl-field">
      <label htmlFor={id}>{t(labelKey)}</label>
      <input
        id={id}
        onChange={(event) => onChange(field, event.target.value)}
        type="text"
        value={value}
      />
    </div>
  );
}

function ReviewSummary({ data }: { data: WizardData }) {
  const summary = [
    [t('wizard.review.idea'), data.centralSituation],
    [t('wizard.review.reader'), `${data.genre} · ${data.audience}`],
    [t('wizard.review.protagonist'), `${data.protagonistName} · ${data.protagonistDesire}`],
    [t('wizard.review.world'), `${data.worldPlace} · ${data.worldRule}`],
    [t('wizard.review.style'), `${data.voice} · ${data.styleReference}`],
    [
      t('wizard.review.plan'),
      t('wizard.review.planValue', {
        chapters: data.chapterCount,
        words: new Intl.NumberFormat('zh-CN').format(data.storyLength)
      })
    ]
  ];

  return (
    <div className="nl-wizard-review">
      <p>{t('wizard.review.intro')}</p>
      <h3>{data.title || t('wizard.review.untitled')}</h3>
      <dl>
        {summary.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function NewNovelPage() {
  const navigate = useNavigate();
  const [activeStage, setActiveStage] = useState(0);
  const [data, setData] = useState<WizardData>(initialWizardData);
  const [storyBible, setStoryBible] = useState(storyBibleReviewFixture);
  const currentStage = stages[activeStage];
  const isReview = currentStage.id === 'review';
  const isStoryBible = currentStage.id === 'story-bible';

  function updateText(field: TextField, value: string) {
    setData((current) => ({ ...current, [field]: value }));
  }

  function updateNumber(field: NumberField, event: ChangeEvent<HTMLInputElement>) {
    setData((current) => ({ ...current, [field]: Number(event.target.value) }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isStoryBible) {
      navigate('/project/rain-radio');
      return;
    }
    setActiveStage((current) => Math.min(current + 1, stages.length - 1));
  }

  let stageContent;
  switch (currentStage.id) {
    case 'idea':
      stageContent = (
        <>
          <TextInputField
            field="title"
            labelKey="wizard.idea.titleLabel"
            onChange={updateText}
            value={data.title}
          />
          <TextAreaField
            field="centralSituation"
            labelKey="wizard.idea.situationLabel"
            onChange={updateText}
            value={data.centralSituation}
          />
          <TextAreaField
            field="desiredFeeling"
            labelKey="wizard.idea.feelingLabel"
            onChange={updateText}
            value={data.desiredFeeling}
          />
        </>
      );
      break;
    case 'reader':
      stageContent = (
        <>
          <div className="nl-field">
            <label htmlFor="wizard-genre">{t('wizard.reader.genreLabel')}</label>
            <select
              id="wizard-genre"
              onChange={(event) => updateText('genre', event.target.value)}
              value={data.genre}
            >
              <option>{t('wizard.reader.genre.suspense')}</option>
              <option>{t('wizard.reader.genre.fantasy')}</option>
              <option>{t('wizard.reader.genre.history')}</option>
            </select>
          </div>
          <TextAreaField
            field="audience"
            labelKey="wizard.reader.audienceLabel"
            onChange={updateText}
            value={data.audience}
          />
        </>
      );
      break;
    case 'protagonist':
      stageContent = (
        <>
          <TextInputField
            field="protagonistName"
            labelKey="wizard.protagonist.nameLabel"
            onChange={updateText}
            value={data.protagonistName}
          />
          <TextAreaField
            field="protagonistDesire"
            labelKey="wizard.protagonist.desireLabel"
            onChange={updateText}
            value={data.protagonistDesire}
          />
          <TextAreaField
            field="protagonistFear"
            labelKey="wizard.protagonist.fearLabel"
            onChange={updateText}
            value={data.protagonistFear}
          />
        </>
      );
      break;
    case 'world':
      stageContent = (
        <>
          <TextAreaField
            field="worldPlace"
            labelKey="wizard.world.placeLabel"
            onChange={updateText}
            value={data.worldPlace}
          />
          <TextAreaField
            field="worldRule"
            labelKey="wizard.world.ruleLabel"
            onChange={updateText}
            value={data.worldRule}
          />
        </>
      );
      break;
    case 'style':
      stageContent = (
        <>
          <div className="nl-field">
            <label htmlFor="wizard-voice">{t('wizard.style.voiceLabel')}</label>
            <select
              id="wizard-voice"
              onChange={(event) => updateText('voice', event.target.value)}
              value={data.voice}
            >
              <option>{t('wizard.style.voice.restrained')}</option>
              <option>{t('wizard.style.voice.intimate')}</option>
            </select>
          </div>
          <TextAreaField
            field="styleReference"
            labelKey="wizard.style.referenceLabel"
            onChange={updateText}
            value={data.styleReference}
          />
        </>
      );
      break;
    case 'plan':
      stageContent = (
        <div className="nl-number-fields">
          <div className="nl-field">
            <label htmlFor="wizard-storyLength">{t('wizard.plan.lengthLabel')}</label>
            <input
              id="wizard-storyLength"
              min={10000}
              onChange={(event) => updateNumber('storyLength', event)}
              step={10000}
              type="number"
              value={data.storyLength}
            />
          </div>
          <div className="nl-field">
            <label htmlFor="wizard-chapterCount">{t('wizard.plan.chaptersLabel')}</label>
            <input
              id="wizard-chapterCount"
              min={1}
              onChange={(event) => updateNumber('chapterCount', event)}
              type="number"
              value={data.chapterCount}
            />
          </div>
          <TextAreaField
            field="desiredFeeling"
            labelKey="wizard.plan.paceLabel"
            onChange={updateText}
            value={data.desiredFeeling}
          />
        </div>
      );
      break;
    case 'review':
      stageContent = <ReviewSummary data={data} />;
      break;
    case 'story-bible':
      stageContent = (
        <div className="nl-story-bible-review">
          <p className="nl-story-bible-review__status">
            <BookOpenText aria-hidden="true" size={18} weight="regular" />
            {t('wizard.storyBible.status')}
          </p>
          <div className="nl-field">
            <label htmlFor="wizard-storyBible">{t('wizard.storyBible.label')}</label>
            <textarea
              className="nl-story-bible-review__editor"
              id="wizard-storyBible"
              onChange={(event) => setStoryBible(event.target.value)}
              rows={18}
              value={storyBible}
            />
          </div>
        </div>
      );
      break;
    default:
      stageContent = null;
  }

  return (
    <div className="nl-page nl-page--wizard">
      <header className="nl-page__header">
        <h1>{t('wizard.title')}</h1>
      </header>

      <div className="nl-wizard-layout">
        <nav className="nl-stage-navigation" aria-label={t('wizard.navigation')}>
          <ol>
            {stages.map((stage, index) => {
              const isCurrent = activeStage === index;
              const isComplete = activeStage > index;
              return (
                <li key={stage.id}>
                  <button
                    aria-current={isCurrent ? 'step' : undefined}
                    className={isCurrent ? 'is-current' : ''}
                    onClick={() => setActiveStage(index)}
                    type="button"
                  >
                    {isComplete
                      ? <Check aria-hidden="true" size={16} weight="bold" />
                      : <Circle aria-hidden="true" size={12} weight={isCurrent ? 'fill' : 'regular'} />}
                    <span>{t(stage.labelKey)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <form className="nl-wizard-form" onSubmit={handleSubmit}>
          <header className="nl-wizard-form__header">
            <h2>{isStoryBible ? t('wizard.storyBible.heading') : t(currentStage.labelKey)}</h2>
          </header>

          <div className="nl-wizard-form__fields">
            {stageContent}
          </div>

          <footer className="nl-wizard-form__actions">
            <Button
              disabled={activeStage === 0}
              onClick={() => setActiveStage((current) => Math.max(0, current - 1))}
              variant="secondary"
            >
              {t('wizard.action.back')}
            </Button>
            <Button type="submit">
              {isStoryBible
                ? t('wizard.action.create')
                : isReview
                  ? t('wizard.action.generate')
                  : t('wizard.action.next')}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
