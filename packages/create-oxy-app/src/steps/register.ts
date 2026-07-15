import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ResolvedConfig } from '../context';

// `@oxyhq/core` is an OPTIONAL dependency, imported lazily only when the user
// opts into client registration. `import type` is erased at build; the runtime
// `await import` is guarded so a missing install degrades to manual instructions
// rather than crashing the scaffold.
import type { OxyServices } from '@oxyhq/core';

const OXY_API_URL = process.env.OXY_API_URL ?? 'https://api.oxy.so';
const CONSOLE_URL = 'https://console.oxy.so';

function manualInstructions(config: ResolvedConfig): void {
  p.log.warn(
    `${pc.yellow('Skipped automatic Oxy client registration.')}\n`
      + `Register ${config.name} manually at ${pc.cyan(CONSOLE_URL)}:\n`
      + `  1. Create an Application, then a public credential (client_id `
      + `${pc.dim('oxy_dk_…')}).\n`
      + `  2. Put it in ${pc.cyan('packages/frontend/.env')} as `
      + `${pc.bold('EXPO_PUBLIC_OXY_CLIENT_ID')}.`,
  );
}

async function writeClientId(config: ResolvedConfig, clientId: string): Promise<void> {
  const envPath = path.join(config.targetDir, 'packages', 'frontend', '.env');
  let existing = '';
  try {
    existing = await fs.readFile(envPath, 'utf8');
  } catch {
    existing = '';
  }
  const line = `EXPO_PUBLIC_OXY_CLIENT_ID=${clientId}`;
  const next = existing.includes('EXPO_PUBLIC_OXY_CLIENT_ID=')
    ? existing.replace(/EXPO_PUBLIC_OXY_CLIENT_ID=.*/g, line)
    : `${existing.trimEnd()}\n${line}\n`.replace(/^\n/, '');
  await fs.writeFile(envPath, next, 'utf8');
}

/**
 * Best-effort: sign in to Oxy, register an Application + public credential, and
 * write the resulting `clientId` into `packages/frontend/.env`. Every failure
 * path falls back to manual instructions — the scaffold never fails here.
 */
export async function registerOxyClient(config: ResolvedConfig): Promise<void> {
  if (!config.register) {
    return;
  }

  const interactive = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
  if (!interactive) {
    manualInstructions(config);
    return;
  }

  const wantsRegister = await p.confirm({
    message: `Register an Oxy client for ${config.name} now? (needs your Oxy login)`,
    initialValue: true,
  });
  if (p.isCancel(wantsRegister) || !wantsRegister) {
    manualInstructions(config);
    return;
  }

  const identifier = await p.text({ message: 'Oxy username or email' });
  if (p.isCancel(identifier)) {
    manualInstructions(config);
    return;
  }
  const password = await p.password({ message: 'Oxy password' });
  if (p.isCancel(password)) {
    manualInstructions(config);
    return;
  }

  const spinner = p.spinner();
  spinner.start('Registering Oxy client…');
  try {
    const core = await import('@oxyhq/core');
    const oxy: OxyServices = new core.OxyServices({ baseURL: OXY_API_URL });

    await oxy.signIn(identifier, password);

    const app = await oxy.createApp({
      name: config.name,
      redirectUris: [`${config.scheme}://`],
      scopes: ['openid', 'profile'],
    });
    const created = await oxy.createAppCredential(app._id, {
      name: `${config.name} (public)`,
      type: 'public',
      environment: 'production',
    });
    const clientId = created.credential.publicKey;

    await writeClientId(config, clientId);
    spinner.stop(`Registered Oxy client ${pc.green(clientId)} → packages/frontend/.env`);
  } catch (error) {
    spinner.stop(pc.yellow('Oxy client registration did not complete.'));
    p.log.warn(error instanceof Error ? error.message : String(error));
    manualInstructions(config);
  }
}
