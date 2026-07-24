import type { Icon } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: Icon;
  label: string;
}

export function IconButton({ className, icon: Icon, label, type = 'button', ...props }: IconButtonProps) {
  const classes = ['nl-icon-button', className].filter(Boolean).join(' ');

  return (
    <button aria-label={label} className={classes} title={label} type={type} {...props}>
      <Icon aria-hidden="true" size={18} weight="regular" />
    </button>
  );
}
