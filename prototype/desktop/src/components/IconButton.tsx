import type { Icon } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes } from 'react';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'aria-labelledby' | 'children' | 'title'
> {
  icon: Icon;
  label: string;
}

type IconButtonRuntimeProps = IconButtonProps & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'aria-labelledby' | 'title'
>;

export function IconButton(buttonProps: IconButtonProps) {
  const {
    'aria-label': _ariaLabel,
    'aria-labelledby': _ariaLabelledby,
    className,
    icon: Icon,
    label,
    title: _title,
    type = 'button',
    ...safeProps
  } = buttonProps as IconButtonRuntimeProps;
  const classes = ['nl-icon-button', className].filter(Boolean).join(' ');

  return (
    <button className={classes} type={type} {...safeProps} aria-label={label} title={label}>
      <Icon aria-hidden="true" size={18} weight="regular" />
    </button>
  );
}
