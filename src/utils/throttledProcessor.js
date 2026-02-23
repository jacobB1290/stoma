// utils/throttledProcessor.js
export class ThrottledProcessor {
  constructor(options = {}) {
    this.maxExecutionTime = options.maxExecutionTime || 10; // ms per chunk
    this.yieldInterval = options.yieldInterval || 16; // ms between chunks (60fps)
    this.onProgress = options.onProgress || (() => {});
  }

  async processArray(items, processor) {
    const results = [];
    const startTime = Date.now();
    let processedCount = 0;

    for (let i = 0; i < items.length; i++) {
      const chunkStart = performance.now();

      // Process items until we hit time limit
      while (
        i < items.length &&
        performance.now() - chunkStart < this.maxExecutionTime
      ) {
        results.push(await processor(items[i], i));
        processedCount++;
        i++;
      }

      // Report progress
      this.onProgress((processedCount / items.length) * 100);

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

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResult = await batchProcessor(batch);
      results.push(...batchResult);

      // Report progress
      this.onProgress(Math.min(100, ((i + batchSize) / items.length) * 100));

      // Yield to UI
      await new Promise((resolve) => setTimeout(resolve, this.yieldInterval));
    }

    return results;
  }
}
