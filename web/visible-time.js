// Deadlines that count only the time the page is visible.
//
// iOS suspends a hidden page's process, its workers included, soon after an
// app switch or the lock screen, while the clock setTimeout runs on keeps
// going as long as the phone is awake: WebKit suspends no DOM timer, and its
// monotonic time is mach_absolute_time. A plain deadline then runs out while
// nothing could run and fires as soon as the page is back, before the resumed
// work can finish, and the task fails with a message that blames the photo or
// the connection. A deadline from here stops when the page is hidden and goes
// on with the time it had left once the page is visible again. A desktop
// browser keeps working in a hidden tab; there a stuck task is stopped only
// once the page is visible again.
//
// The calls match setTimeout and clearTimeout, so a module can take them in
// their place. One visibilitychange listener per page serves every deadline.
const pages = new WeakMap();
function pending(page) {
  if (typeof page?.addEventListener !== "function") return null;
  let timers = pages.get(page);
  if (!timers) {
    pages.set(page, (timers = new Set()));
    page.addEventListener("visibilitychange", () => settle(page, timers));
  }
  return timers;
}
// Each deadline follows the page's state, also when a change came without its
// event: any deadline set while the page is visible resumes the stopped ones.
function settle(page, timers) {
  for (const timer of [...timers]) (page.hidden ? timer.pause : timer.resume)();
}
export function visibleTimers({ setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  now = () => performance.now(), page = globalThis.document } = {}) {
  const timers = pending(page);
  return {
    setTimer(callback, ms = 0) {
      let left = Math.max(0, Number(ms) || 0), handle = null, since = 0;
      const timer = {
        pause() {
          if (handle === null) return;
          clearTimer(handle); handle = null;
          left = Math.max(0, left - (now() - since));
        },
        resume() {
          if (handle !== null) return;
          since = now();
          handle = setTimer(() => { handle = null; timers?.delete(timer); callback(); }, left);
        },
        clear() {
          timers?.delete(timer);
          if (handle !== null) clearTimer(handle);
          handle = null;
        },
      };
      if (!timers) timer.resume();
      else { timers.add(timer); settle(page, timers); }
      return timer;
    },
    clearTimer(timer) { timer?.clear?.(); },
  };
}
