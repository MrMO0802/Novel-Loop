import * as Dialog from '@radix-ui/react-dialog';
import { ShieldCheck, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import {
  getRecoveryCopyKey,
  type RecoveryAction,
  type RecoveryFixture,
  type RecoveryInspection
} from '../../fixtures/tasks';
import { t } from '../../i18n/t';

interface RecoveryDialogProps {
  onOpenChange: (open: boolean) => void;
  onActionComplete: (actionLabel: string, destructive: boolean) => void;
  open: boolean;
  recovery: RecoveryFixture;
  triggerLabel: string;
}

function TechnicalDetails({ recovery }: { recovery: RecoveryFixture }) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="nl-technical-details nl-recovery-dialog__technical"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>{t('recovery.technical')}</summary>
      {open && (
        <dl>
          <div>
            <dt>{t('recovery.technical.stage')}</dt>
            <dd><code>{recovery.technical}</code></dd>
          </div>
        </dl>
      )}
    </details>
  );
}

interface DestructiveConfirmationProps {
  action: RecoveryAction;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function DestructiveConfirmation({
  action,
  onConfirm,
  onOpenChange,
  open
}: DestructiveConfirmationProps) {
  const confirmation = action.confirmation;

  if (!confirmation) return null;

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="nl-modal-overlay nl-modal-overlay--nested" />
        <Dialog.Content
          className="nl-modal nl-recovery-confirmation"
          role="alertdialog"
        >
          <Dialog.Title>{t(confirmation.titleKey)}</Dialog.Title>
          <Dialog.Description>{t(confirmation.bodyKey)}</Dialog.Description>
          <div className="nl-modal__actions">
            <Dialog.Close asChild>
              <Button variant="secondary">{t('recovery.confirm.back')}</Button>
            </Dialog.Close>
            <Button onClick={onConfirm} variant="danger">
              {t(confirmation.confirmLabelKey)}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RecoveryDialog({
  onActionComplete,
  onOpenChange,
  open,
  recovery,
  triggerLabel
}: RecoveryDialogProps) {
  const [destructiveAction, setDestructiveAction] = useState<RecoveryAction | null>(null);
  const [inspection, setInspection] = useState<RecoveryInspection | null>(null);
  const triggerId = `recovery-trigger-${recovery.key}`;

  useEffect(() => {
    if (inspection) {
      document.getElementById(`${triggerId}-inspection-title`)?.focus();
    }
  }, [inspection, triggerId]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setDestructiveAction(null);
      setInspection(null);
    }
    onOpenChange(nextOpen);
  }

  function completeAction(
    action: RecoveryAction,
    destructive: boolean,
    completedLabel = t(action.labelKey)
  ) {
    onActionComplete(completedLabel, destructive);
    setDestructiveAction(null);
    handleOpenChange(false);
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Trigger asChild>
        <Button id={triggerId} variant="secondary">{triggerLabel}</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="nl-modal-overlay" />
        <Dialog.Content
          className="nl-modal nl-recovery-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(triggerId)?.focus();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(`${triggerId}-safest`)?.focus();
          }}
        >
          <div className="nl-modal__header">
            <div>
              <p>{t('recovery.eyebrow')}</p>
              <Dialog.Title>
                {t(getRecoveryCopyKey(recovery.key, 'title'))}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton icon={X} label={t('recovery.close')} />
            </Dialog.Close>
          </div>

          <Dialog.Description className="nl-recovery-dialog__happened">
            {t(getRecoveryCopyKey(recovery.key, 'happened'))}
          </Dialog.Description>

          <div
            className={`nl-recovery-dialog__protected${recovery.blocking ? ' is-blocking' : ''}`}
            role={recovery.blocking ? 'alert' : 'status'}
          >
            <ShieldCheck aria-hidden="true" size={20} weight="regular" />
            <div>
              <strong>{t('recovery.protected')}</strong>
              <p>{t(getRecoveryCopyKey(recovery.key, 'protected'))}</p>
            </div>
          </div>

          {!recovery.blocking && recovery.key === 'doctor-warning' && (
            <p className="nl-recovery-dialog__continuation" role="status">
              {t('recovery.doctor.continue')}
            </p>
          )}

          <section
            aria-labelledby={`recovery-next-${recovery.key}`}
            className="nl-recovery-dialog__next"
          >
            <h2 id={`recovery-next-${recovery.key}`}>{t('recovery.next')}</h2>
            <div className="nl-recovery-dialog__actions">
              {recovery.actions.map((action, index) => (
                <Button
                  id={index === 0 ? `${triggerId}-safest` : undefined}
                  key={action.labelKey}
                  onClick={() => {
                    if (action.destructive) {
                      setDestructiveAction(action);
                      return;
                    }
                    if (action.inspection) {
                      setInspection(action.inspection);
                      return;
                    }
                    completeAction(action, false);
                  }}
                  variant={action.variant}
                >
                  {t(action.labelKey)}
                </Button>
              ))}
            </div>
          </section>

          {inspection && (
            <section
              aria-labelledby={`${triggerId}-inspection-title`}
              className="nl-recovery-dialog__inspection"
            >
              <h2 id={`${triggerId}-inspection-title`} tabIndex={-1}>
                {inspection.title}
              </h2>
              <p>{inspection.description}</p>
              <dl>
                <div>
                  <dt>安全还原点</dt>
                  <dd>
                    <strong>{inspection.restorePoint.label}</strong>
                    <time>{inspection.restorePoint.createdAt}</time>
                    <span>{inspection.restorePoint.detail}</span>
                  </dd>
                </div>
                <div>
                  <dt>已经保留</dt>
                  <dd>
                    <ul>
                      {inspection.preserved.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <TechnicalDetails recovery={recovery} />
        </Dialog.Content>
      </Dialog.Portal>

      {destructiveAction && (
        <DestructiveConfirmation
          action={destructiveAction}
          onConfirm={() => completeAction(
            destructiveAction,
            true,
            destructiveAction.confirmation
              ? t(destructiveAction.confirmation.confirmLabelKey)
              : t(destructiveAction.labelKey)
          )}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDestructiveAction(null);
          }}
          open
        />
      )}
    </Dialog.Root>
  );
}
