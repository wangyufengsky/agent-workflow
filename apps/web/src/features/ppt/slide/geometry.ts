/** Every page is laid out on this canvas and scaled (23 §5.3): thumbnails, preview, show and print look the same. */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
/** CSS pixels per inch: the canvas is 13.333 × 7.5 in, PowerPoint's 16:9 (23 §6.2). */
export const SLIDE_PX_PER_INCH = 96;

/** Splits `**…**` marks (the only mark, 23 §5.1) into plain and emphasised runs. */
export function emphasisRuns(text: string): Array<{ text: string; strong: boolean }> {
  return text
    .split('**')
    .map((part, i) => ({ text: part, strong: i % 2 === 1 }))
    .filter((run) => run.text !== '');
}
