import * as Dialog from '@radix-ui/react-dialog';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrototypeContext } from '../app/PrototypeContext';

interface CommandPaletteProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  trigger: ReactElement;
}

export function CommandPalette({ onOpenChange, open, trigger }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { setActiveProjectId, toggleFocusMode } = usePrototypeContext();

  function runCommand(action: () => void) {
    onOpenChange(false);
    action();
  }

  const commands = [
    { label: '返回作品库', action: () => navigate('/library') },
    {
      label: '打开项目概览',
      action: () => {
        setActiveProjectId('rain-radio');
        navigate('/project/rain-radio');
      }
    },
    {
      label: '打开第二章',
      action: () => {
        setActiveProjectId('rain-radio');
        navigate('/project/rain-radio/chapter/2');
      }
    },
    {
      label: '打开故事档案',
      action: () => {
        setActiveProjectId('rain-radio');
        navigate('/project/rain-radio/story-record');
      }
    },
    { label: '打开任务中心', action: () => navigate('/tasks') },
    { label: '切换专注模式', action: toggleFocusMode },
    { label: '打开设置', action: () => navigate('/settings') }
  ];

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="nl-command-palette__overlay" />
        <Dialog.Content aria-describedby={undefined} className="nl-command-palette" aria-label="快速操作">
          <Dialog.Title className="nl-command-palette__title">快速操作</Dialog.Title>
          <div className="nl-command-palette__commands">
            {commands.map((command) => (
              <button
                className="nl-command-palette__command"
                key={command.label}
                onClick={() => runCommand(command.action)}
                type="button"
              >
                {command.label}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
