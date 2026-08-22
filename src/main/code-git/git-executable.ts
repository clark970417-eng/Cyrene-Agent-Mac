import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ResolvedGitExecutable {
  command: string;
  source: "system";
  version: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResolveGitExecutableDeps {
  systemCommand: string;
  probe?: (command: string) => Promise<string | null>;
}

export async function probeGitExecutable(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], {
      windowsHide: true,
      timeout: 3_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveGitExecutable(
  deps: ResolveGitExecutableDeps,
): Promise<ResolvedGitExecutable | null> {
  const probe = deps.probe ?? probeGitExecutable;
  const systemVersion = await probe(deps.systemCommand);
  if (systemVersion) {
    return {
      command: deps.systemCommand,
      source: "system",
      version: parseGitVersion(systemVersion),
    };
  }

  return null;
}

function parseGitVersion(output: string): string {
  const match = output.match(/git version\s+(.+)/i);
  return match?.[1]?.trim() || output.trim();
}
