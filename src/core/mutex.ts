export class Mutex {
  private queue: Array<{ grant: () => void; cancel: () => void }> = [];
  private locked = false;

  async acquire(timeoutMs?: number): Promise<() => void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const grant = () => {
        if (timer) clearTimeout(timer);
        this.locked = true;
        resolve(this.release.bind(this));
      };

      if (!this.locked) {
        grant();
        return;
      }

      const entry = {
        grant,
        cancel: () => {
          reject(new Error(`Mutex acquire timeout after ${timeoutMs}ms`));
        },
      };
      this.queue.push(entry);

      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            entry.cancel();
          }
        }, timeoutMs);
      }
    });
  }

  private release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        this.locked = false;
        return;
      }
      next.grant();
    } else {
      this.locked = false;
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

const DEFAULT_PATH_MUTEX_TIMEOUT_MS = 30_000;

export class PathMutexes {
  private mutexes = new Map<string, Mutex>();

  async acquire(path: string, timeoutMs?: number): Promise<() => void> {
    let mutex = this.mutexes.get(path);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(path, mutex);
    }
    const release = await mutex.acquire(timeoutMs ?? DEFAULT_PATH_MUTEX_TIMEOUT_MS);

    return () => {
      release();
      if (!mutex.isLocked) {
        this.mutexes.delete(path);
      }
    };
  }
}

export const fileMutexes = new PathMutexes();
export const timelineMutex = new Mutex();
export const auditMutex = new Mutex();
