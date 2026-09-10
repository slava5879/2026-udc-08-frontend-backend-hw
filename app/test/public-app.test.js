// @vitest-environment jsdom
//
// The UI has no build step and no framework, so there is nothing to import:
// `public/app.js` wires itself to the document on evaluation. These tests give
// it the real markup from `public/index.html`, stub `fetch`, and then import it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Under the jsdom environment `import.meta.url` is an http URL, so resolve the
// markup from the vitest root (`app/`) instead.
const html = readFileSync(join(process.cwd(), "public", "index.html"), "utf8");
const bodyMarkup = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"));

// A promise we hand to the UI now and settle later, so two loads can be left
// in flight at once and answered in whatever order the test wants.
function deferred() {
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

const jsonResponse = (body) => ({ ok: true, json: async () => body });

// Let every pending microtask and the `await res.json()` hop run.
const flush = () => new Promise((r) => setTimeout(r, 0));

const el = (selector) => document.querySelector(selector);

// Evaluates `public/app.js` against a fresh document; the module's first
// `load()` is the first call the stubbed fetch sees.
async function bootUi(fetchStub) {
  document.body.innerHTML = bodyMarkup;
  vi.stubGlobal("fetch", fetchStub);
  vi.resetModules();
  await import("../public/app.js");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("loading the list", () => {
  it("keeps the newest response when an older one finishes last", async () => {
    const active = deferred();
    const archive = deferred();
    const fetchStub = vi.fn().mockReturnValueOnce(active.promise).mockReturnValueOnce(archive.promise);

    await bootUi(fetchStub);
    // The first load (active shelf) is in flight; switch to the archive.
    el('#filters button[data-archived="1"]').click();

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(fetchStub.mock.calls[0][0]).toBe("/api/notes?archived=0");
    expect(fetchStub.mock.calls[1][0]).toBe("/api/notes?archived=1");

    // The archive answers first and is empty; the active shelf answers after,
    // with a note that must not reach the screen.
    archive.resolve(jsonResponse([]));
    await flush();
    active.resolve(
      jsonResponse([
        { id: 1, title: "Список покупок", body: "Молоко", created_at: "2026-01-01", archived: 0 },
      ]),
    );
    await flush();

    expect(el("#notes").children).toHaveLength(0);
    expect(el("#empty").textContent).toBe(
      "В архіві порожньо — архівовані нотатки зʼявляться тут.",
    );
    expect(el("#error").textContent).toBe("");
  });

  it("reports a request that never produced a response", async () => {
    await bootUi(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await flush();

    expect(el("#error").textContent).toBe("Не вдалося завантажити нотатки.");
  });
});

describe("writing", () => {
  it("reports a failed create even when the request never reaches the server", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await bootUi(fetchStub);
    await flush();

    el("#title").value = "Нова";
    el("#new-note").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(el("#error").textContent).toBe("Не вдалося створити нотатку.");
    // The form keeps what the user typed, since nothing was saved.
    expect(el("#title").value).toBe("Нова");
  });

  it("reports a failed archive even when the request never reaches the server", async () => {
    const note = { id: 1, title: "Список покупок", body: "Молоко", created_at: "2026-01-01", archived: 0 };
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([note]))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await bootUi(fetchStub);
    await flush();

    el("#notes li .actions button").click();
    await flush();

    expect(el("#error").textContent).toBe("Не вдалося архівувати нотатку.");
  });

  it("reports a failed delete even when the request never reaches the server", async () => {
    const note = { id: 1, title: "Список покупок", body: "Молоко", created_at: "2026-01-01", archived: 0 };
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([note]))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await bootUi(fetchStub);
    await flush();

    el("#notes li .actions button:last-child").click();
    await flush();

    expect(el("#error").textContent).toBe("Не вдалося видалити нотатку.");
  });
});
