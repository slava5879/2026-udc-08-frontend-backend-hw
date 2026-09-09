import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Pretend session. A real app would verify a signed cookie or a JWT here;
 * that is deliberately out of scope — this workshop is about what happens
 * AFTER you know who the caller is.
 *
 * The caller identifies itself with the `x-user-id` header. Seeded users are
 * 1 (Оля) and 2 (Тарас).
 */
function currentUser(req, res, next) {
  const id = Number(req.header("x-user-id"));
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(401).json({ error: "not authenticated" });
  }
  req.userId = id;
  next();
}

/**
 * `?archived=0|1`, absent means "active". Anything else is a client error:
 * the UI only ever sends 0 or 1, and a value we do not understand must not
 * quietly fall back to showing something.
 */
function parseArchivedQuery(value) {
  if (value === undefined) return 0;
  if (value === "0") return 0;
  if (value === "1") return 1;
  return null;
}

export function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(resolve(here, "../public")));

  app.use("/api", currentUser);

  // List the caller's own notes — active by default, archived on request.
  app.get("/api/notes", (req, res) => {
    const archived = parseArchivedQuery(req.query.archived);
    if (archived === null) {
      return res.status(400).json({ error: "archived must be 0 or 1" });
    }

    const rows = db
      .prepare(
        "SELECT id, title, body, created_at, archived FROM notes WHERE user_id = ? AND archived = ? ORDER BY id",
      )
      .all(req.userId, archived);
    res.json(rows);
  });

  // Read one note.
  app.get("/api/notes/:id", (req, res) => {
    const note = db
      .prepare("SELECT id, user_id, title, body, created_at FROM notes WHERE id = ?")
      .get(Number(req.params.id));
    if (!note) return res.status(404).json({ error: "not found" });
    res.json(note);
  });

  // Create a note for the caller.
  app.post("/api/notes", (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body : "";
    if (!title) return res.status(400).json({ error: "title is required" });

    const info = db
      .prepare("INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)")
      .run(req.userId, title, body);
    const created = db
      .prepare("SELECT id, title, body, created_at, archived FROM notes WHERE id = ?")
      .get(info.lastInsertRowid);
    res.status(201).json(created);
  });

  // Archive or restore one of the caller's own notes.
  app.patch("/api/notes/:id/archive", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid note id" });
    }
    // The browser is attacker-controlled, so the desired state is validated
    // here rather than trusted: only a real boolean is accepted.
    const archived = req.body?.archived;
    if (typeof archived !== "boolean") {
      return res.status(400).json({ error: "archived must be a boolean" });
    }

    // The owner is part of the UPDATE itself. The question this answers is
    // "may this user touch this note", not "does this note exist" — so
    // another user's note is never loaded, let alone changed.
    const info = db
      .prepare("UPDATE notes SET archived = ? WHERE id = ? AND user_id = ?")
      .run(archived ? 1 : 0, id, req.userId);
    if (info.changes === 0) return res.status(404).json({ error: "not found" });

    const note = db
      .prepare(
        "SELECT id, title, body, created_at, archived FROM notes WHERE id = ? AND user_id = ?",
      )
      .get(id, req.userId);
    res.json(note);
  });

  // Delete one of the caller's own notes.
  app.delete("/api/notes/:id", (req, res) => {
    const info = db
      .prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
      .run(Number(req.params.id), req.userId);
    if (info.changes === 0) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  });

  return app;
}
