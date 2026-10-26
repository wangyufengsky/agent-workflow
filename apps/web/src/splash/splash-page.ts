import type { LaunchPreferences } from '@aw/shared';
import { MARK } from '../brand/mark.ts';
import { HOME_COPY, SPLASH_COPY } from '../copy/home.ts';
import { THEMES } from '../theme/registry.ts';
import { THEME_TOKEN_NAMES } from '../theme/tokens.ts';

/**
 * The opening animation (28 §5, D113) as one self-contained page: Electron main shows it before the backend (and so
 * the app) is up, as a `data:` URL, in the theme the last start remembered. Main reads `window.splash`:
 * `done` settles once the animation ended or was skipped (at once with reduced motion or the setting off), `leave()`
 * fades the page out before the app loads, `fail()` says the backend did not start.
 */
export function splashHtml({ theme, intro }: LaunchPreferences): string {
  const { tokens, colorScheme } = THEMES[theme];
  const vars = THEME_TOKEN_NAMES.map((name) => `--${name}:${tokens[name]}`).join(';');
  const cy = MARK.height / 2;
  const nodes = MARK.nodes
    .map((cx, i) => `<circle class="node${i === 1 ? ' filled' : ''}" cx="${cx}" cy="${cy}" r="${MARK.radius}"/>`)
    .join('');
  const lines = MARK.lines.map((d) => `<path class="line" d="${d}"/>`).join('');
  return `<!doctype html>
<html lang="zh-CN" data-intro="${intro}" style="color-scheme:${colorScheme};${vars}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${SPLASH_COPY.title}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="mark">
<svg class="nodes" width="${MARK.width * 2}" height="${MARK.height * 2}" viewBox="0 0 ${MARK.width} ${MARK.height}" aria-hidden="true">${lines}${nodes}<circle class="spark" r="2.4"/></svg>
<h1 class="word"><span class="lead">${HOME_COPY.mark.lead}</span> <em class="emphasis">${HOME_COPY.mark.emphasis}</em></h1>
<p class="tagline">${HOME_COPY.tagline}</p>
<section class="failed" hidden><p><strong>${SPLASH_COPY.failed}</strong></p><p>${SPLASH_COPY.failedBody}</p><button type="button">${SPLASH_COPY.quit}</button></section>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/**
 * How long the opening plays and the fade-out before the app takes over. The script counts them with timers: a window
 * that does not paint (hidden at start, a slow GPU, a virtual display) runs no CSS animations and fires none of their
 * events, and waiting for one kept the window on this page.
 */
const INTRO_MS = 1200;
const LEAVE_MS = 200;
const HOLD_MS = 250;

/** 1.2 s (28 §5.1): nodes pop one after another as the lines draw, the wordmark rises, the tagline fades in. */
const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:grid;place-items:center;overflow:hidden;background:var(--bg);color:var(--ink);cursor:default;user-select:none;
  -webkit-app-region:drag;
  font:400 14px/1.55 "DM Sans",-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif}
body::before{content:"";position:fixed;inset:-20%;background:radial-gradient(closest-side,var(--accent-fill),transparent 70%)}
.mark{position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center}
.nodes{overflow:visible}
.line{fill:none;stroke:var(--line-3);stroke-width:2;stroke-dasharray:60;stroke-dashoffset:0}
.node{fill:var(--panel);stroke:var(--accent);stroke-width:2.2;transform-box:fill-box;transform-origin:center}
.node.filled{fill:var(--accent)}
.spark{fill:var(--accent);opacity:0;offset-path:path("M8 12H116")}
.word{margin:0;font-family:Montserrat,"DM Sans",-apple-system,"PingFang SC",sans-serif;font-size:52px;font-weight:400;
  letter-spacing:-1px;line-height:1.1;color:var(--ink-strong)}
.word .lead,.word .emphasis{display:inline-block}
.emphasis{font-family:Georgia,"Times New Roman",serif;letter-spacing:-.5px;color:var(--accent)}
.tagline{margin:0;font-size:16px;color:var(--sub)}
.failed{margin-top:12px;color:var(--danger)}
.failed p{margin:0 0 4px}
.failed button{-webkit-app-region:no-drag;margin-top:8px;height:32px;padding:0 16px;border:0;border-radius:999px;background:var(--primary-bg);color:var(--primary-ink);font:inherit}
[data-intro="true"] .node{animation:pop .32s cubic-bezier(.32,1.28,.54,1) both}
[data-intro="true"] .node:nth-of-type(2){animation-delay:.09s}
[data-intro="true"] .node:nth-of-type(3){animation-delay:.18s}
[data-intro="true"] .line{stroke-dashoffset:60;animation:draw .22s cubic-bezier(.2,.7,.2,1) .1s both}
[data-intro="true"] .line:nth-of-type(2){animation-delay:.2s}
[data-intro="true"] .lead{animation:rise .5s cubic-bezier(.2,.7,.2,1) .3s both}
[data-intro="true"] .emphasis{animation:rise .5s cubic-bezier(.2,.7,.2,1) .38s both}
[data-intro="true"] .tagline{animation:fade .35s cubic-bezier(.2,.7,.2,1) .6s both}
[data-intro="true"] .mark{animation:hold ${HOLD_MS / 1000}s linear ${(INTRO_MS - HOLD_MS) / 1000}s both}
[data-intro="true"][data-state="waiting"] .spark{animation:spark 1.1s linear infinite}
[data-state="leaving"] body{animation:out ${LEAVE_MS / 1000}s cubic-bezier(.2,.7,.2,1) both}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes hold{to{opacity:1}}
@keyframes out{to{opacity:0}}
@keyframes spark{0%{offset-distance:0%;opacity:0}15%,85%{opacity:1}100%{offset-distance:100%;opacity:0}}
@media (prefers-reduced-motion:reduce){*,body{animation:none!important}.line{stroke-dashoffset:0}}
`;

/** `window.splash` for main (see `splashHtml`); a click or any key skips to the last frame. */
const SCRIPT = `
const root = document.documentElement;
const animate = root.dataset.intro === 'true' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
let finish;
const done = new Promise((resolve) => { finish = resolve; });
const end = () => {
  if (root.dataset.state !== undefined) return;
  for (const a of document.getAnimations()) a.finish();
  root.dataset.state = 'waiting';
  finish();
};
if (animate) {
  setTimeout(end, ${INTRO_MS});
  addEventListener('pointerdown', end);
  addEventListener('keydown', end);
} else end();
document.querySelector('.failed button').addEventListener('click', () => window.close());
window.splash = {
  done,
  leave() {
    if (!animate) return Promise.resolve();
    root.dataset.state = 'leaving';
    return new Promise((resolve) => setTimeout(resolve, ${LEAVE_MS}));
  },
  fail() {
    root.dataset.state = 'failed';
    document.querySelector('.failed').hidden = false;
  },
};
`;

/** The window's colour until the page paints: the same theme's background. */
export const splashBackground = ({ theme }: LaunchPreferences): string => THEMES[theme].tokens.bg;

/** The height of the app's header (`--header-h`), where the title bar's window buttons sit (17 §3.14). */
const TITLE_BAR_HEIGHT = 56;

/**
 * The window buttons Windows and Linux draw over the header's right end once the system title bar is hidden (17
 * §3.14): on the theme's background, in its secondary text colour, so they change with the theme.
 */
export const titleBarOverlay = ({ theme }: LaunchPreferences) => ({
  color: THEMES[theme].tokens.bg,
  symbolColor: THEMES[theme].tokens.sub,
  height: TITLE_BAR_HEIGHT,
});
