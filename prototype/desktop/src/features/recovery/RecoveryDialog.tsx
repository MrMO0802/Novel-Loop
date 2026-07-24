import * as Dialog from '@radix-ui/react-dialog';
import { ShieldCheck, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import type { RecoveryAction, RecoveryFixture } from '../../fixtures/tasks';
import { t } from '../../i18n/t';

interface RecoveryDialogProps {
  onOpenChange: (open: boolean) => void;
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
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function DestructiveConfirmation({
  action,
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
          <Dialog.Title>{confirmation.title}</Dialog.Title>
          <Dialog.Description>{confirmation.body}</Dialog.Description>
          <div className="nl-modal__actions">
            <Dialog.Close asChild>
              <Button variant="secondary">{t('recovery.confirm.back')}</Button>
            </Dialog.Close>
            <Button variant="danger">{confirmation.confirmLabel}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RecoveryDialog({
  onOpenChange,
  open,
  recovery,
  triggerLabel
}: RecoveryDialogProps) {
  const [destructiveAction, setDestructiveAction] = useState<RecoveryAction | null>(null);
  const triggerId = `recovery-trigger-${recovery.key}`;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setDestructiveAction(null);
    onOpenChange(nextOpen);
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
        >
          <div className="nl-modal__header">
            <div>
              <p>{t('recovery.eyebrow')}</p>
              <Dialog.Title>{recovery.title}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton icon={X} label={t('recovery.close')} />
            </Dialog.Close>
          </div>

          <Dialog.Description className="nl-recovery-dialog__happened">
            {recovery.happened}
          </Dialog.Description>

          <div
            className={`nl-recovery-dialog__protected${recovery.blocking ? ' is-blocking' : ''}`}
            role={recovery.blocking ? 'alert' : 'status'}
          >
            <ShieldCheck aria-hidden="true" size={20} weight="regular" />
            <div>
              <strong>{t('recovery.protected')}</strong>
              <p>{recovery.protectedCopy}</p>
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
              {recovery.actions.map((action) => (
                <Button
                  key={action.label}
                  onClick={() => {
                    if (action.destructive) setDestructiveAction(action);
                  }}
                  variant={action.variant}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </section>

          <TechnicalDetails recovery={recovery} />
        </Dialog.Content>
      </Dialog.Portal>

      {destructiveAction && (
        <DestructiveConfirmation
          action={destructiveAction}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDestructiveAction(null);
          }}
          open
        />
      )}
    </Dialog.Root>
  );
}
