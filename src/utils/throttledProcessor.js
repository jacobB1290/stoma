// utils/throttledProcessor.js
export class ThrottledProcessor {
  constructor(options = {}) {
    this.maxExecutionTime = options.maxExecutionTime || 10; // ms per chunk
    this.yieldInterval = options.yieldInterval || 16; // ms between chunks (60fps)
    this.onProgress = options.onProgress || (() => {});
    this.shouldContinue = options.shouldContinue || (() => true);
    this.progressInterval = options.progressInterval || 80;
  }

  async processArray(items, processor) {
    const results = [];
    let processedCount = 0;
    let lastProgressTime = 0;

    for (let i = 0; i < items.length; i++) {
      const chunkStart = performance.now();

      // Process items until we hit time limit
      while (
        i < items.length &&
        performance.now() - chunkStart < this.maxExecutionTime
      ) {
        if (!this.shouldContinue()) {
          return results;
        }
        results.push(await processor(items[i], i));
        processedCount++;
        i++;
      }

      // Report progress (throttled to reduce render pressure)
      const now = performance.now();
      if (now - lastProgressTime >= this.progressInterval || processedCount >= items.length) {
        this.onProgress((processedCount / items.length) * 100);
        lastProgressTime = now;
      }

      // Yield to UI - this is the key part
      await new Promise((resolve) => {
        if ("requestIdleCallback" in window) {
          requestIdleCallback(resolve, { timeout: this.yieldInterval });
        } else {
          setTimeout(resolve, this.yieldInterval);
        }
      });
    }

    return results;
  }

  async processInBatches(items, batchSize, batchProcessor) {
    const results = [];
    let lastProgressTime = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      if (!this.shouldContinue()) {
        return results;
      }
      const batchResult = await batchProcessor(batch);
      results.push(...batchResult);

      // Report progress (throttled to reduce render pressure)
      const now = performance.now();
      if (now - lastProgressTime >= this.progressInterval || i + batchSize >= items.length) {
        this.onProgress(Math.min(100, ((i + batchSize) / items.length) * 100));
        lastProgressTime = now;
      }

      // Yield to UI
      await new Promise((resolve) => setTimeout(resolve, this.yieldInterval));
    }

    return results;
  }
}
