/**
 * How the companion window takes the mouse (32 §4.1, D192). On macOS and Windows it lets clicks through and has
 * Electron forward pointer moves, so the page can ask for the mouse over its interactive parts (`interactive`).
 * Electron forwards only there: on Linux a click-through window never learns the pointer is back and stays
 * unclickable, so it always takes the mouse; its window is the character and a small margin unless a panel is open.
 */
export function companionMouse(platform: NodeJS.Platform, interactive: boolean) {
  if (platform === 'linux' || interactive) return { ignore: false, forward: false };
  return { ignore: true, forward: true };
}
