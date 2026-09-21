import { createTrackingCore } from './live-tracking-core.js';
const core = createTrackingCore();
self.onmessage = ({ data }) => {
  try {
    const start = performance.now(), result = core.run(data);
    self.postMessage({ id: data.id, result, milliseconds: performance.now() - start });
  } catch (error) {
    self.postMessage({ id: data.id, error: error?.message || 'Tracking failed.' });
  }
};
