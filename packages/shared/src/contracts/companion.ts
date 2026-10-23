import { z } from 'zod';
import { settingsSchema } from '../constants/settings.ts';

export const COMPANION_PATH = '/companion';
export const COMPANION_WINDOW = { width: 400, height: 440, bubbleHeight: 220, margin: 12, visible: 64 } as const;
export const companionConfigSchema = z.object({ enabled: z.boolean(), size: settingsSchema.shape['companion.size'] });
export const companionInteractiveSchema = z.boolean();
export const companionConversationSchema = z.string().min(1).nullable();
export const companionPathSchema = z.string().startsWith('/');
export const companionPointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const companionPositionSchema = companionPointSchema.extend({ version: z.literal(2).optional() });
export const companionPanelSchema = z.enum(['none', 'chat', 'bubble']);
export type CompanionPanel = z.infer<typeof companionPanelSchema>;
export type CompanionRect = { x: number; y: number; width: number; height: number };
export type CompanionLayout = {
  actor: CompanionRect;
  panel: CompanionRect | null;
  side: 'above' | 'below' | 'left' | 'right';
};
export const companionNoticeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  path: z.string().startsWith('/'),
  mood: z.enum(['waiting', 'success', 'error']),
  system: z.boolean(),
});
export type CompanionNotice = z.infer<typeof companionNoticeSchema>;
export const companionLabelsSchema = z.object({ open: z.string(), hide: z.string(), quit: z.string() });
export type CompanionLabels = z.infer<typeof companionLabelsSchema>;
export interface CompanionBridge {
  /** 导出等辅助窗口没有桌宠宿主能力。 */
  surface: 'main' | 'companion' | null;
  configure(config: z.infer<typeof companionConfigSchema>, labels: CompanionLabels): Promise<void>;
  setInteractive(interactive: boolean): void;
  setPanel(panel: CompanionPanel): Promise<void>;
  onLayout(listener: (layout: CompanionLayout) => void): () => void;
  startDrag(point: z.infer<typeof companionPointSchema>): void;
  moveDrag(point: z.infer<typeof companionPointSchema>): void;
  endDrag(): void;
  openMain(path?: string): Promise<void>;
  onNavigate(listener: (path: string) => void): () => void;
  selectConversation(id: string | null): void;
  getConversation(): Promise<string | null>;
  onConversation(listener: (id: string | null) => void): () => void;
  notify(notice: CompanionNotice): void;
}
