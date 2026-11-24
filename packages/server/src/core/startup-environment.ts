import { isStartupEnvironmentToolOnly, Platform } from '@aw/shared';
import { host } from './platform.ts';

/** Apply a resolved snapshot, suppressing inherited substitutes for secrets that are still locked. */
export function applyStartupEnvironment(
  target: NodeJS.ProcessEnv,
  overlay: Readonly<Record<string, string>>,
  deferred: readonly string[],
  os: Platform = host.os,
): void {
  const identity = os === Platform.Win32 ? (name: string) => name.toUpperCase() : (name: string) => name;
  const approved = Object.entries(overlay);
  const affected = new Set([...deferred, ...approved.map(([name]) => name)].map(identity));
  // Delete every old spelling before setting the approved spelling. Windows process.env aliases keys.
  for (const name of Object.keys(target)) if (affected.has(identity(name))) Reflect.deleteProperty(target, name);
  for (const [name, value] of approved) Reflect.set(target, name, value);
}

export function scopedStartupEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // POSIX permits environment keys such as "__proto__"; they are plain keys here, not object members.
  return Object.assign(Object.create(null) as NodeJS.ProcessEnv, inherited);
}

/** A loader option may affect user commands but must not change how the app starts or loads modules. */
export function controlProcessOverlay(overlay: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(overlay).filter(([name]) => !isStartupEnvironmentToolOnly(name)));
}
