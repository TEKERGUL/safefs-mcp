import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { startWatch } from "./watch.js";

export async function runGuard(root: string, commandArgs: string[]): Promise<number> {
  if (commandArgs.length === 0) {
    console.error("Error: guard requires a command after --.");
    console.error("Example: safefs guard -- claude");
    return 1;
  }

  const watch = await startWatch(root);
  const [command, ...args] = commandArgs;

  return await new Promise<number>((resolve) => {
    let child: ChildProcess | undefined;
    let resolved = false;

    const finish = (code: number): void => {
      if (resolved) return;
      resolved = true;
      process.off("SIGINT", onSigint);
      void watch.stop().then(() => resolve(code));
    };

    const attach = (proc: ChildProcess, attemptedCommand: string): void => {
      child = proc;

      proc.once("error", (err) => {
        if (shouldRetryWithCmd(command!, attemptedCommand, err)) {
          attach(spawn(`${command}.cmd`, args, { cwd: root, stdio: "inherit" }), `${command}.cmd`);
          return;
        }

        console.error(`SafeFS guard failed to start command: ${err.message}`);
        finish(1);
      });

      proc.once("exit", (code, signal) => {
        if (signal) {
          finish(128);
          return;
        }
        finish(code ?? 1);
      });
    };

    function onSigint(): void {
      child?.kill("SIGINT");
      finish(130);
    }

    process.once("SIGINT", onSigint);
    attach(spawn(command!, args, { cwd: root, stdio: "inherit" }), command!);
  });
}

function shouldRetryWithCmd(
  originalCommand: string,
  attemptedCommand: string,
  err: Error
): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return (
    process.platform === "win32" &&
    code === "ENOENT" &&
    attemptedCommand === originalCommand &&
    path.extname(originalCommand) === "" &&
    !originalCommand.includes(path.sep) &&
    !originalCommand.includes("/")
  );
}
