import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const telemetryPath = (workspaceDir: string): string => join(workspaceDir, '.docstube', 'telemetry.json');
