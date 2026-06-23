import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { startWatch } from "./watch.js";

export async function runGuard(root: string, commandArgs: string[]): Promise<number> {
  if (commandArgs.length === 0) {
    console.error("Error: guard requires a command after --.");
    console.error("Example: safefs guard -- claude");
    return 1;
  }

  const command = commandArgs[0];
  if (!command) {
    console.error("Error: guard requires a command after --.");
    console.error("Example: safefs guard -- claude");
    return 1;
  }

  const watch = await startWatch(root);
  const args = commandArgs.slice(1);

  return await new Promise<number>((resolve) => {
    let child: ChildProcess | undefined;
    let resolved = false;

    const finish = (code: number): void => {
      if (resolved) return;
      resolved = true;
      process.off("SIGINT", onSigint);
      void watch.stop().then(() => resolve(code));
    };

    const handleStartError = (err: Error, attemptedCommand: string): void => {
      if (shouldRetryWithCmd(command, attemptedCommand, err)) {
        start(`${command}.cmd`);
        return;
      }

      console.error(`SafeFS guard failed to start command: ${err.message}`);
      finish(1);
    };

    const attach = (proc: ChildProcess, attemptedCommand: string): void => {
      child = proc;

      proc.once("error", (err) => handleStartError(err, attemptedCommand));

      proc.once("exit", (code, signal) => {
        if (signal) {
          finish(128);
          return;
        }
        finish(code ?? 1);
      });
    };

    const start = (attemptedCommand: string): void => {
      try {
        attach(spawnGuardProcess(attemptedCommand, args, root), attemptedCommand);
      } catch (err) {
        handleStartError(err as Error, attemptedCommand);
      }
    };

    function onSigint(): void {
      child?.kill("SIGINT");
      finish(130);
    }

    process.once("SIGINT", onSigint);
    start(command);
  });
}

function spawnGuardProcess(command: string, args: string[], root: string): ChildProcess {
  return spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: shouldUseWindowsShell(command),
  });
}

function shouldUseWindowsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function shouldRetryWithCmd(
  originalCommand: string,
  attemptedCommand: string,
  err: Error
): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return (
    process.platform === "win32" &&
    (code === "ENOENT" || code === "EINVAL") &&
    attemptedCommand === originalCommand &&
    path.extname(originalCommand) === "" &&
    !originalCommand.includes(path.sep) &&
    !originalCommand.includes("/")
  );
}
