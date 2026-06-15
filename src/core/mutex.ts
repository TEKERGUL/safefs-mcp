export class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(this.release.bind(this));
      } else {
        this.queue.push(() => resolve(this.release.bind(this)));
      }
    });
  }

  private release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

export class PathMutexes {
  private mutexes = new Map<string, Mutex>();

  async acquire(path: string): Promise<() => void> {
    if (!this.mutexes.has(path)) {
      this.mutexes.set(path, new Mutex());
    }
    const mutex = this.mutexes.get(path)!;
    const release = await mutex.acquire();
    
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
