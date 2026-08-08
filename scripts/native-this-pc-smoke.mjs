const port = Number(process.argv[2] ?? "9333");
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const pageTarget = targets.find((target) => target.type === "page" && target.title === "Muller");

if (!pageTarget?.webSocketDebuggerUrl) {
  throw new Error("Muller WebView target was not found");
}

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (typeof message.id !== "number") return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      "WebView evaluation failed",
    );
  }
  return response.result?.value;
}

await send("Runtime.enable");
const thisPcVisible = await evaluate("Boolean(document.querySelector('.this-pc-workspace'))");
if (!thisPcVisible) {
  const locationVisible = await evaluate(`Boolean(
    [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.trim().endsWith('This PC'))
  )`);
  if (!locationVisible) {
    await evaluate(`(() => {
      const browse = [...document.querySelectorAll('button')]
        .find((element) => element.textContent?.trim() === 'Browse');
      if (!browse) throw new Error('Browse command is unavailable');
      browse.click();
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const buttonLabels = await evaluate(`[
    ...document.querySelectorAll('button')
  ].map((element) => element.textContent?.trim()).filter(Boolean)`);
  if (!buttonLabels.some((label) => label.endsWith("This PC"))) {
    throw new Error(`This PC location is unavailable; buttons: ${JSON.stringify(buttonLabels)}`);
  }
  await evaluate(`(() => {
    const target = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.trim().endsWith('This PC'));
    if (!target) throw new Error('This PC location is unavailable');
    target.click();
    return true;
  })()`);
}
await new Promise((resolve) => setTimeout(resolve, 1_500));

const result = await evaluate(`(() => ({
  driveCount: document.querySelectorAll('.drive-item').length,
  errors: [...document.querySelectorAll('.this-pc-message.is-error')]
    .map((element) => element.textContent?.trim()),
  messages: [...document.querySelectorAll('.this-pc-message:not(.is-error)')]
    .map((element) => element.textContent?.trim()),
  heading: document.querySelector('.this-pc-heading strong')?.textContent?.trim() ?? null,
}))()`);

socket.close();
console.log(JSON.stringify(result, null, 2));

if (result.heading !== "This PC" || result.driveCount < 1 || result.errors.length > 0) {
  process.exitCode = 1;
}
