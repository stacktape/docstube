export class Counter {
  count = 0;

  private step = 1;

  /** Increments the counter and returns the new value. */
  increment(): number {
    this.count += this.step;
    return this.count;
  }

  private reset(): void {
    this.count = 0;
  }
}
