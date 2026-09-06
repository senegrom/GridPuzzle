// One owner for task generations, deadlines, progress and cancellation UI.
export function createTaskController({ $, scanner, status, onStop }) {
  let id = 0,
    busy = false,
    timer = null,
    deadline = null,
    started = 0;
  const clearDeadline = () => {
    clearTimeout(deadline);
    deadline = null;
  };
  const finish = () => {
    busy = false;
    clearInterval(timer);
    timer = null;
    clearDeadline();
    $("stop").hidden = true;
    $("solve").disabled = false;
    $("progress").hidden = true;
    $("status").setAttribute("aria-busy", "false");
  };
  const stop = (message = null) => {
    id++;
    scanner.cancel();
    onStop(busy);
    finish();
    if (message)
      status(
        message,
        "Search unfinished. No claim about uniqueness or impossibility has been made.",
        "warning",
      );
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
    setDeadline(callback, ms) {
      clearDeadline();
      deadline = setTimeout(callback, ms);
    },
    begin() {
      stop();
      busy = true;
      started = performance.now();
      $("stop").hidden = false;
      $("solve").disabled = true;
      $("status").setAttribute("aria-busy", "true");
      timer = setInterval(() => {
        $("status-detail").textContent =
          `${((performance.now() - started) / 1000).toFixed(1)} seconds elapsed · Stop cancels this task.`;
      }, 500);
      return id;
    },
  };
}
