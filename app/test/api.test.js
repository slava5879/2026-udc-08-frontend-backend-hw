import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

let app;
beforeEach(() => {
  app = createApp(createDb(":memory:"));
});

const asOlya = (r) => r.set("x-user-id", "1");
const asTaras = (r) => r.set("x-user-id", "2");

describe("authentication", () => {
  it("rejects a request with no user header", async () => {
    await request(app).get("/api/notes").expect(401);
  });
});

describe("GET /api/notes", () => {
  it("returns only the caller's own notes", async () => {
    const res = await asOlya(request(app).get("/api/notes")).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((n) => n.title)).toEqual([
      "Список покупок",
      "Ідеї для відпустки",
    ]);
  });

  it("gives a different user a different list", async () => {
    const res = await asTaras(request(app).get("/api/notes")).expect(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /api/notes", () => {
  it("creates a note owned by the caller", async () => {
    const res = await asOlya(request(app).post("/api/notes"))
      .send({ title: "Нова", body: "текст" })
      .expect(201);
    expect(res.body.title).toBe("Нова");

    const list = await asOlya(request(app).get("/api/notes")).expect(200);
    expect(list.body).toHaveLength(3);
  });

  it("rejects an empty title", async () => {
    await asOlya(request(app).post("/api/notes")).send({ title: "  " }).expect(400);
  });
});

describe("GET /api/notes/:id", () => {
  it("returns the caller's own note", async () => {
    const res = await asOlya(request(app).get("/api/notes/1")).expect(200);
    expect(res.body.title).toBe("Список покупок");
  });

  it("404s for a note that does not exist", async () => {
    await asOlya(request(app).get("/api/notes/999")).expect(404);
  });
});

describe("PATCH /api/notes/:id/archive", () => {
  it("archives the caller's own note and takes it out of the active list", async () => {
    const res = await asOlya(request(app).patch("/api/notes/1/archive"))
      .send({ archived: true })
      .expect(200);
    expect(res.body.archived).toBe(1);

    const active = await asOlya(request(app).get("/api/notes")).expect(200);
    expect(active.body.map((n) => n.id)).toEqual([2]);

    const archived = await asOlya(request(app).get("/api/notes?archived=1")).expect(200);
    expect(archived.body.map((n) => n.id)).toEqual([1]);
  });

  it("restores an archived note", async () => {
    await asOlya(request(app).patch("/api/notes/1/archive")).send({ archived: true }).expect(200);
    await asOlya(request(app).patch("/api/notes/1/archive")).send({ archived: false }).expect(200);

    const active = await asOlya(request(app).get("/api/notes")).expect(200);
    expect(active.body.map((n) => n.id)).toEqual([1, 2]);
  });

  it("does not leak internal columns", async () => {
    const res = await asOlya(request(app).patch("/api/notes/1/archive"))
      .send({ archived: true })
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "archived",
      "body",
      "created_at",
      "id",
      "title",
    ]);
  });

  it("rejects an archived flag that is not a boolean", async () => {
    await asOlya(request(app).patch("/api/notes/1/archive")).send({ archived: "true" }).expect(400);
    await asOlya(request(app).patch("/api/notes/1/archive")).send({ archived: 1 }).expect(400);
    await asOlya(request(app).patch("/api/notes/1/archive")).send({}).expect(400);
  });

  it("404s for a note that does not exist", async () => {
    await asOlya(request(app).patch("/api/notes/999/archive"))
      .send({ archived: true })
      .expect(404);
  });

  it("will not archive someone else's note", async () => {
    await asOlya(request(app).patch("/api/notes/3/archive"))
      .send({ archived: true })
      .expect(404);

    // And the note is genuinely untouched, not merely reported as missing.
    const taras = await asTaras(request(app).get("/api/notes")).expect(200);
    expect(taras.body.map((n) => n.id)).toEqual([3]);
  });
});

describe("GET /api/notes?archived=", () => {
  it("returns an empty archive before anything is archived", async () => {
    const res = await asOlya(request(app).get("/api/notes?archived=1")).expect(200);
    expect(res.body).toEqual([]);
  });

  it("rejects an archived filter it does not understand", async () => {
    await asOlya(request(app).get("/api/notes?archived=yes")).expect(400);
    await asOlya(request(app).get("/api/notes?archived=")).expect(400);
  });

  it("keeps the archive scoped to the caller", async () => {
    await asTaras(request(app).patch("/api/notes/3/archive")).send({ archived: true }).expect(200);

    const olya = await asOlya(request(app).get("/api/notes?archived=1")).expect(200);
    expect(olya.body).toEqual([]);
  });
});

describe("DELETE /api/notes/:id", () => {
  it("deletes the caller's own note", async () => {
    await asOlya(request(app).delete("/api/notes/1")).expect(204);
    const list = await asOlya(request(app).get("/api/notes")).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("will not delete someone else's note", async () => {
    await asOlya(request(app).delete("/api/notes/3")).expect(404);
    const taras = await asTaras(request(app).get("/api/notes")).expect(200);
    expect(taras.body).toHaveLength(1);
  });
});
