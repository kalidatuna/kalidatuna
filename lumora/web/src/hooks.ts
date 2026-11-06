// Lets pages ask the shell to re-scan for new 3D views / reveal animations
// after they update part of the DOM, without importing main.ts (no cycles).
let refreshFn: () => void = () => {};

export function setRefresh(fn: () => void) {
  refreshFn = fn;
}

export function refresh() {
  refreshFn();
}
