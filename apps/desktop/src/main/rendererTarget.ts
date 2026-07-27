import { pathToFileURL } from 'node:url';

export type RendererTarget =
  | {
      kind: 'url';
      location: string;
      trustedRendererUrl: string;
    }
  | {
      kind: 'file';
      location: string;
      trustedRendererUrl: string;
    };

export interface RendererTargetInput {
  environmentUrl: string | undefined;
  isDevelopment: boolean;
  packagedRendererPath: string;
}

export function selectRendererTarget(input: RendererTargetInput): RendererTarget {
  const developmentOrigin = input.isDevelopment
    ? parseDevelopmentRendererOrigin(input.environmentUrl)
    : null;
  if (developmentOrigin !== null) {
    return {
      kind: 'url',
      location: developmentOrigin,
      trustedRendererUrl: developmentOrigin
    };
  }

  return {
    kind: 'file',
    location: input.packagedRendererPath,
    trustedRendererUrl: pathToFileURL(input.packagedRendererPath).toString()
  };
}

function parseDevelopmentRendererOrigin(
  environmentUrl: string | undefined
): string | null {
  if (environmentUrl === undefined) {
    return null;
  }

  try {
    const parsed = new URL(environmentUrl);
    const isExactOrigin = environmentUrl === parsed.origin
      || environmentUrl === `${parsed.origin}/`;
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && parsed.username.length === 0
      && parsed.password.length === 0
      && parsed.pathname === '/'
      && parsed.search.length === 0
      && parsed.hash.length === 0
      && isExactOrigin
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}
