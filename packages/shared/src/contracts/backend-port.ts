import { z } from 'zod';

/**
 * Electron main → backend: stop opencode and exit. Ending the utilityProcess would not end its children on Windows
 * (17 §3.5), so main asks the backend to shut down and waits for it to exit.
 */
export const backendShutdownMessageSchema = z.object({ type: z.literal('backend.shutdown') });
export type BackendShutdownMessage = z.infer<typeof backendShutdownMessageSchema>;
