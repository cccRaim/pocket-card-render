window.__pageErrors = [];

function recordPageError(value) {
  window.__pageErrors.push(value);
  document.documentElement.dataset.pageErrors = JSON.stringify(window.__pageErrors);
}

window.addEventListener("error", (event) => {
  recordPageError({ type: "error", message: event.message, stack: event.error?.stack || null });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  recordPageError({
    type: "unhandledrejection",
    message: reason?.message || String(reason),
    stack: reason?.stack || null,
  });
});
