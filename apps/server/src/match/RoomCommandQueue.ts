/**
 * In-memory per-room FIFO execution queue for economic commands.
 *
 * Ensures that within a given room, commands are processed sequentially in arrival order.
 * Separate rooms execute independently without blocking each other.
 * Queue is operational in-memory state and is discarded upon process restart.
 */
export class RoomCommandQueue {
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Enqueues a task for the specified room, returning a promise for its result.
   */
  async enqueue<T>(roomCode: string, task: () => Promise<T>): Promise<T> {
    const key = roomCode.toUpperCase();
    const previous = this.queues.get(key) ?? Promise.resolve();

    let taskResolve!: (val: T) => void;
    let taskReject!: (err: unknown) => void;
    const taskPromise = new Promise<T>((resolve, reject) => {
      taskResolve = resolve;
      taskReject = reject;
    });

    const next = previous
      .catch(() => {
        // Continue queue processing even if prior task failed
      })
      .then(async () => {
        try {
          const result = await task();
          taskResolve(result);
        } catch (err) {
          taskReject(err);
        }
      });

    this.queues.set(key, next);

    // Clean up reference when idle
    next.finally(() => {
      if (this.queues.get(key) === next) {
        this.queues.delete(key);
      }
    });

    return taskPromise;
  }
}
