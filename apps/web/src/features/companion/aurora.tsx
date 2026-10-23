import { useEffect, useRef, useState } from 'react';
import type { CharacterMood } from './character-assets.ts';
import styles from './orb.module.css';

export const AURORA_TEXTURE = '/companion/aurora/aurora.png';
const vertex = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * .5 + .5;
  gl_Position = vec4(position, 0., 1.);
}`;
const fragment = `
precision mediump float;
uniform sampler2D art;
uniform float time;
uniform float hue;
uniform float energy;
varying vec2 uv;
vec3 shiftHue(vec3 color, float angle) {
  vec3 axis = normalize(vec3(1.));
  return color * cos(angle) + cross(axis, color) * sin(angle)
    + axis * dot(axis, color) * (1. - cos(angle));
}
void main() {
  vec2 p = uv - .5;
  float r = length(p);
  float a = atan(p.y, p.x);
  // 不同半径的光带分别扭动，轮廓呼吸与内部流动保持不同节奏。
  a += time * .10 + .16 * sin(time * .57 + r * 11.);
  r *= 1. + .045 * sin(a * 3. + time * .83) + .025 * cos(a * 5. - time * .61);
  vec2 q = vec2(cos(a), sin(a)) * r;
  q += .012 * sin(vec2(q.y, q.x) * 17. + vec2(time * .71, -time * .53));
  vec4 c = texture2D(art, vec2(q.x + .5, .5 - q.y));
  float shimmer = 1. + .07 * sin(a * 2. + r * 19. - time * 1.2) * energy;
  c.rgb = max(vec3(0.), shiftHue(c.rgb, hue + .34 * sin(time * .19 + r * 4.))) * shimmer;
  gl_FragColor = c;
}`;

const MOOD: Record<CharacterMood, { speed: number; hue: number; energy: number }> = {
  idle: { speed: 1, hue: 0, energy: 0.5 },
  thinking: { speed: 1.5, hue: 0.18, energy: 0.8 },
  working: { speed: 2, hue: 0.05, energy: 1 },
  waiting: { speed: 0.65, hue: -1.15, energy: 0.5 },
  success: { speed: 1.3, hue: -0.5, energy: 1.5 },
  error: { speed: 0.8, hue: 1.5, energy: 0.5 },
  speaking: { speed: 1.6, hue: 0.25, energy: 1.4 },
  interaction: { speed: 1.5, hue: 0.4, energy: 1.2 },
  dragging: { speed: 1.2, hue: 0, energy: 0.8 },
};

/** 小图标与无 GPU 环境保留纹理；大形象以 30fps 流动，离屏或后台停止绘制。 */
export function Aurora({ animated, mood }: { animated: boolean; mood: CharacterMood }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const currentMood = useRef(mood);
  currentMood.current = mood;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const node = canvas.current;
    if (!animated || node === null) return;
    const gl = node.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
    if (gl === null) return;
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind);
      if (shader === null) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      gl.deleteShader(shader);
      return null;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (vs === null || fs === null || program === null) {
      if (vs !== null) gl.deleteShader(vs);
      if (fs !== null) gl.deleteShader(fs);
      if (program !== null) gl.deleteProgram(program);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL 的 useProgram 不是 React Hook。
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const time = gl.getUniformLocation(program, 'time');
    const hue = gl.getUniformLocation(program, 'hue');
    const energy = gl.getUniformLocation(program, 'energy');
    let frame = 0;
    let loaded = false;
    let visible = false;
    let lost = false;
    let previous = 0;
    let elapsed = 0;
    let tint = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (previous !== 0 && now - previous < 1000 / 30) return;
      const delta = previous === 0 ? 0 : Math.min((now - previous) / 1000, 0.1);
      previous = now;
      const state = MOOD[currentMood.current];
      elapsed += delta * state.speed;
      tint += (state.hue - tint) * Math.min(delta * 2, 1);
      gl.uniform1f(time, elapsed);
      gl.uniform1f(hue, tint);
      gl.uniform1f(energy, state.energy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (node.dataset.active !== 'true') setReady(true);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (loaded && visible && !document.hidden && !lost) frame = requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(() => {
      const pixels = Math.min(720, Math.max(1, Math.round(node.clientWidth * Math.min(devicePixelRatio, 2))));
      node.width = pixels;
      node.height = pixels;
      gl.viewport(0, 0, pixels, pixels);
    });
    resize.observe(node);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      resume();
    });
    intersection.observe(node);
    const onLost = () => {
      lost = true;
      setReady(false);
      resume();
    };
    node.addEventListener('webglcontextlost', onLost);
    document.addEventListener('visibilitychange', resume);
    const art = new Image();
    art.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art);
      loaded = true;
      resume();
    };
    art.src = AURORA_TEXTURE;
    return () => {
      art.onload = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      node.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('visibilitychange', resume);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [animated]);
  return (
    <>
      <img className={styles.texture} src={AURORA_TEXTURE} alt="" hidden={animated && ready} draggable={false} />
      <canvas ref={canvas} className={styles.flow} data-active={animated && ready} aria-hidden="true" tabIndex={-1} />
    </>
  );
}
