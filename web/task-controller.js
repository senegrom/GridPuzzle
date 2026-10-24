// One owner for task generations, deadlines, progress and cancellation UI.
// Deadlines run on `deadlines`, which app.js gives visible-time.js's: they
// stop while the page is hidden, so that an app switch cannot run them out.
// A deadline set with `wallClock` runs on setTimeout's clock instead.
// While a task runs, its elapsed time replaces the status's second line
// every half second, unless the task keeps that line (keep).
// The second line of the status a stop with a message leaves.
export const UNFINISHED = "Search unfinished. No claim about uniqueness or impossibility has been made.";
export function createTaskController({ $, scanner, status, onStop,
  deadlines = { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle) } }) {
  let id = 0,
    busy = false,
    timer = null,
    deadline = null,
    started = 0,
    // The second line the running task keeps, and the line the elapsed time
    // last wrote after it.
    kept = null,
    ticked = null;
  const clearDeadline = () => {
    deadline?.();
    deadline = null;
  };
  const finish = () => {
    busy = false;
    clearInterval(timer);
    timer = null;
    kept = ticked = null;
    clearDeadline();
    $("stop").hidden = true;
    $("solve").disabled = false;
    $("check-play").disabled = $("hint-play").disabled = false;
    $("progress").hidden = true;
    $("status").setAttribute("aria-busy", "false");
  };
  const stop = (message = null) => {
    id++;
    scanner.cancel();
    onStop(busy);
    finish();
    if (message) status(message, UNFINISHED, "warning");
  };
  return {
    get id() {
      return id;
    },
    get busy() {
      return busy;
    },
    stop,
    finish,
    clearDeadline,
    setDeadline(callback, ms, { wallClock = false } = {}) {
      clearDeadline();
      if (wallClock) {
        const handle = setTimeout(callback, ms);
        deadline = () => clearTimeout(handle);
      } else {
        const handle = deadlines.setTimer(callback, ms);
        deadline = () => deadlines.clearTimer(handle);
      }
    },
    // The running task keeps `detail`, the second line of the status it has
    // just set: the elapsed time then follows that line instead of replacing
    // it, until the task ends or another status replaces the line. (The next
    // task starts with nothing kept: begin stops, and finish forgets.)
    keep(detail) {
      kept = detail;
      ticked = null;
    },
    begin() {
      stop();
      busy = true;
      started = performance.now();
      $("stop").hidden = false;
      // Check and Hint start private solves too; a second tap must not cancel
      // a nearly finished one and throw the warm interpreter away.
      $("solve").disabled = true;
      $("check-play").disabled = $("hint-play").disabled = true;
      $("status").setAttribute("aria-busy", "true");
      timer = setInterval(() => {
        const line = $("status-detail"),
          elapsed = `${((performance.now() - started) / 1000).toFixed(1)} seconds elapsed · Stop cancels this task.`;
        if (kept !== null && line.textContent !== kept && line.textContent !== ticked) kept = null;
        line.textContent = ticked = kept === null ? elapsed : `${kept} ${elapsed}`;
      }, 500);
      return id;
    },
  };
}
