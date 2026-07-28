import { dialog } from 'electron';
import path from 'node:path';

export interface ProjectDialogPort {
  chooseDefaultLibrary(): Promise<string | null>;
  chooseProjectDirectory(): Promise<string | null>;
  chooseAlternateLibrary(): Promise<string | null>;
}

export class NativeProjectDialog implements ProjectDialogPort {
  async chooseDefaultLibrary(): Promise<string | null> {
    return this.chooseLibraryDirectory();
  }

  async chooseProjectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return selectedDirectory(result.filePaths, result.canceled);
  }

  async chooseAlternateLibrary(): Promise<string | null> {
    return this.chooseLibraryDirectory();
  }

  private async chooseLibraryDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    return selectedDirectory(result.filePaths, result.canceled);
  }
}

function selectedDirectory(filePaths: string[], canceled: boolean): string | null {
  const selectedPath = filePaths[0];
  if (canceled || selectedPath === undefined) {
    return null;
  }
  return path.resolve(selectedPath);
}
