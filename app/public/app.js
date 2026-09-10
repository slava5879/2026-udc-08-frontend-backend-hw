// Minimal UI. No framework and no build step on purpose: the point of this
// homework is the seam between UI, API, database and authorization, not the
// view layer. Keep it that way — do not introduce a bundler.

const userSelect = document.querySelector("#user");
const list = document.querySelector("#notes");
const empty = document.querySelector("#empty");
const error = document.querySelector("#error");
const form = document.querySelector("#new-note");
const filterButtons = [...document.querySelectorAll("#filters button")];

// Which shelf we are looking at. This is only the question the UI asks; what
// the caller may actually see stays the server's decision.
let showArchived = false;

function headers() {
  return { "content-type": "application/json", "x-user-id": userSelect.value };
}

function fail(message) {
  error.textContent = message;
}

function noteElement(n) {
  const li = document.createElement("li");
  const archived = Boolean(n.archived);

  const grow = document.createElement("div");
  grow.className = "grow";
  const title = document.createElement("strong");
  title.textContent = n.title;
  if (archived) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "В архіві";
    title.append(" ", badge);
  }
  const body = document.createElement("span");
  body.textContent = n.body;
  const when = document.createElement("small");
  when.textContent = n.created_at;
  grow.append(title, body, document.createElement("br"), when);

  const actions = document.createElement("div");
  actions.className = "actions";

  // Real buttons with visible text; the aria-label keeps the note's title in
  // the accessible name so the control still makes sense out of context.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = archived ? "Повернути з архіву" : "Архівувати";
  toggle.setAttribute("aria-label", `${toggle.textContent} нотатку «${n.title}»`);
  toggle.addEventListener("click", () => setArchived(n.id, !archived));

  const del = document.createElement("button");
  del.type = "button";
  del.textContent = "Видалити";
  del.setAttribute("aria-label", `Видалити нотатку «${n.title}»`);
  del.addEventListener("click", () => remove(n.id));

  actions.append(toggle, del);
  li.append(grow, actions);
  return li;
}

// Switching filter or user starts a new load without cancelling the old one,
// so two requests can be in flight at once and answer out of order. Every
// invocation takes the next id; only the newest one may touch the DOM.
let latestLoad = 0;

async function load() {
  const requestId = ++latestLoad;
  // The shelf this request asked for — `showArchived` may have moved on by the
  // time the answer arrives.
  const archived = showArchived;
  const current = () => requestId === latestLoad;

  try {
    const res = await fetch(`/api/notes?archived=${archived ? "1" : "0"}`, {
      headers: headers(),
    });
    if (!current()) return;
    if (!res.ok) {
      list.replaceChildren();
      empty.textContent = "";
      return fail("Не вдалося завантажити нотатки.");
    }

    const notes = await res.json();
    if (!current()) return;
    list.replaceChildren(...notes.map(noteElement));
    empty.textContent = notes.length
      ? ""
      : archived
        ? "В архіві порожньо — архівовані нотатки зʼявляться тут."
        : "Нотаток поки немає.";
  } catch {
    // The request never produced a response at all (offline, DNS, abort).
    if (current()) fail("Не вдалося завантажити нотатки.");
  }
}

async function setArchived(id, archived) {
  error.textContent = "";
  const message = archived
    ? "Не вдалося архівувати нотатку."
    : "Не вдалося повернути нотатку з архіву.";
  try {
    const res = await fetch(`/api/notes/${id}/archive`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ archived }),
    });
    if (!res.ok) return fail(message);
  } catch {
    return fail(message);
  }
  load();
}

async function remove(id) {
  error.textContent = "";
  try {
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE", headers: headers() });
    if (!res.ok) return fail("Не вдалося видалити нотатку.");
  } catch {
    return fail("Не вдалося видалити нотатку.");
  }
  load();
}

function setFilter(archived) {
  showArchived = archived;
  for (const b of filterButtons) {
    b.setAttribute("aria-pressed", String(b.dataset.archived === (archived ? "1" : "0")));
  }
  error.textContent = "";
  load();
}

for (const button of filterButtons) {
  button.addEventListener("click", () => setFilter(button.dataset.archived === "1"));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.querySelector("#title");
  const body = document.querySelector("#body");
  error.textContent = "";
  try {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: title.value, body: body.value }),
    });
    if (!res.ok) return fail("Не вдалося створити нотатку.");
  } catch {
    return fail("Не вдалося створити нотатку.");
  }
  title.value = "";
  body.value = "";
  // A new note is never archived — show the list it actually landed in.
  setFilter(false);
});

userSelect.addEventListener("change", load);
load();
