// Lifecycle watchdogs used when launched by the desktop shell.
// POSIX: ppid-reparenting poll (same trick as backend/main.py).
// Anywhere (incl. Windows): stdin EOF — the shell keeps our stdin pipe open,
// so a crashed/killed shell closes it and we exit instead of orphaning.
// Gated by HOMETUBE_WATCH_STDIN=1 so terminal runs and CLI uses never exit
// on a closed stdin.
export function startWatchdogs(log: (s: string) => void): void {
  if (process.env.HOMETUBE_WATCH_PARENT === "1" && process.platform !== "win32") {
    const launchPpid = process.ppid;
    if (launchPpid === 1) {
      log("[server] already orphaned at start, exiting");
      process.exit(0);
    }
    setInterval(() => {
      if (process.ppid !== launchPpid) {
        log("[server] parent gone, exiting");
        process.exit(0);
      }
    }, 2000).unref?.();
  }

  if (process.env.HOMETUBE_WATCH_STDIN === "1") {
    const kill = () => {
      log("[server] parent pipe closed, exiting");
      process.exit(0);
    };
    process.stdin.on("end", kill);
    process.stdin.on("close", kill);
    // Drain (and thereby detect closure of) the pipe.
    process.stdin.resume();
  }
}
