export interface SingleInstanceWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export interface SingleInstancePolicyDependencies {
  requestLock(): boolean;
  quit(): void;
  onSecondInstance(listener: () => void): void;
  getWindows(): SingleInstanceWindow[];
}

export function installSingleInstancePolicy(
  dependencies: SingleInstancePolicyDependencies
): boolean {
  if (!dependencies.requestLock()) {
    dependencies.quit();
    return false;
  }

  dependencies.onSecondInstance(() => {
    const window = dependencies.getWindows()[0];
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return true;
}
