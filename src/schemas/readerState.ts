import { z } from 'zod';

export const ReaderStateSchema = z.object({
  readerKnows: z.array(z.string()).default([]),
  readerSuspects: z.array(z.string()).default([]),
  readerQuestions: z.array(z.string()).default([]),
  readerExpectations: z.array(z.string()).default([]),
  readerDoesNotKnow: z.array(z.string()).default([])
});

export type ReaderState = z.infer<typeof ReaderStateSchema>;
