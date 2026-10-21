import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Integration tests run git as on a machine where the user configured nothing (a fresh CI runner, a new laptop): the
// developer's global and system settings (identity, signing, autocrlf …) must not decide the outcome. Without an
// identity git would guess one from the host name on some machines only, so guessing is turned off too.
const config = join(mkdtempSync(join(tmpdir(), 'aw-gitconfig-')), 'config');
writeFileSync(config, '[user]\n\tuseConfigOnly = true\n');
process.env.GIT_CONFIG_GLOBAL = config;
process.env.GIT_CONFIG_NOSYSTEM = '1';
