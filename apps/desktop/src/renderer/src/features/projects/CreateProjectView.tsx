import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { Check } from '@phosphor-icons/react/Check';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from 'react';

import type {
  CreateProjectRequest,
  ProjectOpenResult,
  ProjectSummary
} from '../../../../shared/projectContract';
import { t, type MessageKey } from '../../i18n/messages.zh-CN';

interface CreateProjectViewProps {
  onCancel: () => void;
  onCreated: (project: ProjectSummary) => void;
}

type FieldErrors = Record<'title' | 'coreIdea', MessageKey | null>;

const EMPTY_ERRORS: FieldErrors = {
  title: null,
  coreIdea: null
};

export function CreateProjectView({
  onCancel,
  onCreated
}: CreateProjectViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<FieldErrors>(EMPTY_ERRORS);
  const [actionError, setActionError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    headingRef.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const title = readField(formData, 'title');
    const coreIdea = readField(formData, 'coreIdea');
    const nextErrors: FieldErrors = {
      title: title.length === 0
        ? 'create.error.titleRequired'
        : title.length > 120
          ? 'create.error.titleTooLong'
          : null,
      coreIdea: coreIdea.length === 0
        ? 'create.error.coreIdeaRequired'
        : coreIdea.length > 2_000
          ? 'create.error.coreIdeaTooLong'
          : null
    };

    setErrors(nextErrors);
    setActionError(null);
    if (nextErrors.title || nextErrors.coreIdea) {
      if (nextErrors.title) {
        titleRef.current?.focus();
      }
      return;
    }

    const request: CreateProjectRequest = {
      title,
      coreIdea,
      useDifferentLocation: formData.get('useDifferentLocation') === 'on',
      ...optionalField(formData, 'genre'),
      ...optionalField(formData, 'protagonist'),
      ...optionalField(formData, 'worldPremise')
    };

    setPending(true);
    try {
      let result = await window.novelLoop.projects.create(request);
      if (!mounted.current) {
        return;
      }
      const shouldChooseDefaultLibrary = !request.useDifferentLocation
        && (
          result.outcome === 'location_required'
          || result.outcome === 'location_unavailable'
        );
      if (shouldChooseDefaultLibrary) {
        const selection =
          await window.novelLoop.projects.chooseDefaultLibrary();
        if (!mounted.current) {
          return;
        }
        if (selection.selection === 'cancelled') {
          return;
        }
        if (selection.selection === 'location_unavailable') {
          setActionError('project.error.locationUnavailable');
          return;
        }
        result = await window.novelLoop.projects.create(request);
        if (!mounted.current) {
          return;
        }
      }
      handleCreateResult(result, onCreated, setActionError);
    } catch {
      if (mounted.current) {
        setActionError('project.error.failed');
      }
    } finally {
      if (mounted.current) {
        setPending(false);
      }
    }
  };

  const hasFieldErrors = errors.title !== null || errors.coreIdea !== null;

  return (
    <main className="nl-project-shell">
      <header className="nl-project-header">
        <div className="nl-brand">
          <BookOpenText aria-hidden size={24} weight="fill" />
          <span>{t('app.brand')}</span>
        </div>
        <button
          className="nl-tertiary-action"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          <ArrowLeft aria-hidden size={17} />
          {t('create.back')}
        </button>
      </header>

      <div className="nl-project-content nl-create-layout">
        <section className="nl-create-intro" aria-labelledby="create-title">
          <p className="nl-section-label">{t('create.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="create-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('create.title')}
          </h1>
          <p>{t('create.intro')}</p>
        </section>

        <form className="nl-create-form" noValidate onSubmit={submit}>
          {hasFieldErrors && (
            <div className="nl-inline-alert nl-inline-alert--error" role="alert">
              <WarningCircle aria-hidden size={20} weight="fill" />
              <div>
                {errors.title && (
                  <p id="create-title-error">{t(errors.title)}</p>
                )}
                {errors.coreIdea && (
                  <p id="create-core-idea-error">{t(errors.coreIdea)}</p>
                )}
              </div>
            </div>
          )}

          {actionError && (
            <p className="nl-inline-alert nl-inline-alert--error" role="alert">
              <WarningCircle aria-hidden size={20} weight="fill" />
              {t(actionError)}
            </p>
          )}

          <div className="nl-field">
            <label htmlFor="project-title">{t('create.field.title')}</label>
            <input
              aria-describedby={
                errors.title ? 'create-title-error create-title-help'
                  : 'create-title-help'
              }
              aria-invalid={errors.title ? 'true' : undefined}
              autoComplete="off"
              id="project-title"
              maxLength={120}
              name="title"
              ref={titleRef}
              required
              type="text"
            />
            <p className="nl-field__help" id="create-title-help">
              {t('create.field.titleHelp')}
            </p>
          </div>

          <div className="nl-field">
            <label htmlFor="project-core-idea">
              {t('create.field.coreIdea')}
            </label>
            <textarea
              aria-describedby={
                errors.coreIdea
                  ? 'create-core-idea-error create-core-idea-help'
                  : 'create-core-idea-help'
              }
              aria-invalid={errors.coreIdea ? 'true' : undefined}
              id="project-core-idea"
              maxLength={2_000}
              name="coreIdea"
              required
              rows={5}
            />
            <p className="nl-field__help" id="create-core-idea-help">
              {t('create.field.coreIdeaHelp')}
            </p>
          </div>

          <div className="nl-create-form__optional">
            <div className="nl-field">
              <label htmlFor="project-genre">
                {t('create.field.genre')}
              </label>
              <input
                autoComplete="off"
                id="project-genre"
                maxLength={160}
                name="genre"
                type="text"
              />
            </div>
            <div className="nl-field">
              <label htmlFor="project-protagonist">
                {t('create.field.protagonist')}
              </label>
              <input
                autoComplete="off"
                id="project-protagonist"
                maxLength={160}
                name="protagonist"
                type="text"
              />
            </div>
          </div>

          <div className="nl-field">
            <label htmlFor="project-world-premise">
              {t('create.field.worldPremise')}
            </label>
            <textarea
              id="project-world-premise"
              maxLength={1_000}
              name="worldPremise"
              rows={3}
            />
          </div>

          <div className="nl-checkbox-field">
            <input
              aria-describedby="alternate-location-help"
              id="alternate-location"
              name="useDifferentLocation"
              type="checkbox"
            />
            <div className="nl-checkbox-field__text">
              <label htmlFor="alternate-location">
                {t('create.field.alternateLocation')}
              </label>
              <small id="alternate-location-help">
                {t('create.field.alternateLocationHelp')}
              </small>
            </div>
          </div>

          <div className="nl-form-actions">
            <button
              className="nl-secondary-action"
              disabled={pending}
              onClick={onCancel}
              type="button"
            >
              {t('common.cancel')}
            </button>
            <button
              className="nl-primary-action"
              disabled={pending}
              type="submit"
            >
              <Check aria-hidden size={18} weight="bold" />
              {pending ? t('create.pending') : t('create.submit')}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalField(
  formData: FormData,
  name: 'genre' | 'protagonist' | 'worldPremise'
): Partial<Pick<CreateProjectRequest, typeof name>> {
  const value = readField(formData, name);
  return value ? { [name]: value } : {};
}

function handleCreateResult(
  result: ProjectOpenResult,
  onCreated: (project: ProjectSummary) => void,
  setError: (key: MessageKey) => void
) {
  switch (result.outcome) {
    case 'created':
    case 'opened':
      onCreated(result.project);
      return;
    case 'cancelled':
      return;
    case 'invalid_project':
      setError('project.error.invalidData');
      return;
    case 'location_required':
      setError('project.error.locationRequired');
      return;
    case 'location_unavailable':
      setError('project.error.locationUnavailable');
      return;
    case 'project_exists':
      setError('project.error.exists');
      return;
    case 'failed':
      setError('project.error.failed');
  }
}
