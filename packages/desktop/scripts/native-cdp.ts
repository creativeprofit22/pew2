/** Test-only WebView keyboard input. Never imported by the shipped frontend. */
export interface NativePage {
  enterOnButton(label: string): Promise<void>;
  close(): void;
}

export async function nativePage(port: number): Promise<NativePage> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Test WebView debugger is unavailable.");
  const pages = await response.json() as { type: string; url: string; webSocketDebuggerUrl: string }[];
  const page = pages.find(page => page.type === "page" && new URL(page.url).origin === "http://tauri.localhost");
  if (!page) throw new Error("The packaged launcher page was not found.");
  const endpoint = new URL(page.webSocketDebuggerUrl);
  if (endpoint.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname) || Number(endpoint.port) !== port || !endpoint.pathname.startsWith("/devtools/page/")) throw new Error("Unexpected test debugger endpoint.");
  const socket = new WebSocket(endpoint);
  let id = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  socket.addEventListener("message", event => {
    if (typeof event.data !== "string" || event.data.length > 64 * 1024) { socket.close(); return; }
    let message: { id?: number; result?: unknown; error?: unknown };
    try { message = JSON.parse(event.data) as typeof message; }
    catch { socket.close(); return; }
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error("Test browser command failed."));
    else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Test debugger closed.")); }
    pending.clear();
  });
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => { socket.close(); reject(new Error("Test debugger handshake timed out.")); }, 5000);
    socket.addEventListener("open", () => { clearTimeout(deadline); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(deadline); reject(new Error("Test debugger connection failed.")); }, { once: true });
  });
  function command(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (pending.size >= 2) return Promise.reject(new Error("Test debugger queue is full."));
    const current = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(current); reject(new Error("Test debugger command timed out.")); }, 5000);
      pending.set(current, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: current, method, params }));
    });
  }
  return {
    async enterOnButton(label) {
      if (!["Start phone access", "Stop phone access", "Keep running", "Stop work and close"].includes(label)) throw new Error("Unknown test keyboard action.");
      const focused = await command("Runtime.evaluate", {
        expression: `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.disabled) return false; button.focus(); return document.activeElement === button; })()`,
        returnByValue: true,
      }) as { result: { value?: unknown } };
      if (focused.result.value !== true) throw new Error("Expected keyboard button was not focused.");
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    },
    close() { socket.close(); },
  };
}
