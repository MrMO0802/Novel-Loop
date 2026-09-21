import { z } from 'zod';

import { normalizeCanonPatchProposal } from '../providers/codex/normalizers.js';

// Validate both supported wire formats without replacing the original proposal with normalized data.
export const DesktopSubmissionPatchProposalSchema = z.custom<Record<string, unknown>>((value) => {
  try {
    normalizeCanonPatchProposal(value, { projectId: 'submission-proposal-validation' });
    return true;
  } catch {
    return false;
  }
}, { message: 'Expected a valid canonical or slim canon patch proposal.' });
