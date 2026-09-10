// Task E, шлях 3 — авторизація як окремий набір.
//
// api.test.js перевіряє поведінку: що ендпоінт робить для свого власника.
// Цей файл ставить одне-єдине питання кожному маршруту: що станеться, якщо
// прийти НЕ ТИМ користувачем. Питання ставиться в обидва боки, бо діра, яка
// відкрита лише в один бік, — усе одно діра.
//
// Сідові дані: Оля (1) володіє нотатками 1 і 2, Тарас (2) — нотаткою 3.

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

// [власник, чужий, id чужої нотатки] — кожен випадок проганяється в обидва боки.
const crossUser = [
  { name: "Оля тягнеться до нотатки Тараса", as: asOlya, id: 3 },
  { name: "Тарас тягнеться до нотатки Олі", as: asTaras, id: 1 },
];

describe("читання чужої нотатки", () => {
  for (const { name, as, id } of crossUser) {
    it(`${name}: GET /api/notes/${id} → 404`, async () => {
      const res = await as(request(app).get(`/api/notes/${id}`));
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty("title");
      expect(res.body).not.toHaveProperty("body");
    });
  }

  it("чужа нотатка не відрізняється від неіснуючої", async () => {
    // Інакше сам код відповіді стає засобом перелічити чужі id.
    const other = await asOlya(request(app).get("/api/notes/3"));
    const missing = await asOlya(request(app).get("/api/notes/999"));
    expect(other.status).toBe(missing.status);
    expect(other.body).toEqual(missing.body);
  });
});

describe("архівування чужої нотатки", () => {
  for (const { name, as, id } of crossUser) {
    it(`${name}: PATCH /api/notes/${id}/archive → 404`, async () => {
      await as(request(app).patch(`/api/notes/${id}/archive`))
        .send({ archived: true })
        .expect(404);
    });
  }

  it("чужа нотатка справді лишається неархівованою, а не просто «не знайдена»", async () => {
    await asOlya(request(app).patch("/api/notes/3/archive"))
      .send({ archived: true })
      .expect(404);

    // Питаємо у власника: нотатка досі в активних, а архів порожній.
    const active = await asTaras(request(app).get("/api/notes")).expect(200);
    expect(active.body.map((n) => n.id)).toEqual([3]);
    const archived = await asTaras(request(app).get("/api/notes?archived=1")).expect(200);
    expect(archived.body).toEqual([]);
  });
});

describe("видалення чужої нотатки", () => {
  for (const { name, as, id } of crossUser) {
    it(`${name}: DELETE /api/notes/${id} → 404`, async () => {
      await as(request(app).delete(`/api/notes/${id}`)).expect(404);
    });
  }

  it("чужа нотатка справді лишається на місці", async () => {
    await asOlya(request(app).delete("/api/notes/3")).expect(404);
    const taras = await asTaras(request(app).get("/api/notes")).expect(200);
    expect(taras.body.map((n) => n.id)).toEqual([3]);
  });
});

describe("межі списків", () => {
  it("список ніколи не містить чужих нотаток", async () => {
    const olya = await asOlya(request(app).get("/api/notes")).expect(200);
    expect(olya.body.map((n) => n.id)).toEqual([1, 2]);

    const taras = await asTaras(request(app).get("/api/notes")).expect(200);
    expect(taras.body.map((n) => n.id)).toEqual([3]);
  });

  it("архів так само скоупиться на того, хто питає", async () => {
    await asTaras(request(app).patch("/api/notes/3/archive")).send({ archived: true }).expect(200);

    const olya = await asOlya(request(app).get("/api/notes?archived=1")).expect(200);
    expect(olya.body).toEqual([]);
    const taras = await asTaras(request(app).get("/api/notes?archived=1")).expect(200);
    expect(taras.body.map((n) => n.id)).toEqual([3]);
  });
});

describe("створення нотатки від чужого імені", () => {
  it("user_id у тілі запиту ігнорується — власник береться із сесії", async () => {
    const res = await asOlya(request(app).post("/api/notes"))
      .send({ title: "Підкинута", body: "текст", user_id: 2 })
      .expect(201);

    // Нотатка має опинитись в Олі, а не в Тараса.
    const olya = await asOlya(request(app).get("/api/notes")).expect(200);
    expect(olya.body.map((n) => n.id)).toContain(res.body.id);
    const taras = await asTaras(request(app).get("/api/notes")).expect(200);
    expect(taras.body.map((n) => n.id)).toEqual([3]);
  });
});

describe("без автентифікації", () => {
  const routes = [
    ["GET", "/api/notes"],
    ["GET", "/api/notes?archived=1"],
    ["GET", "/api/notes/1"],
    ["POST", "/api/notes"],
    ["PATCH", "/api/notes/1/archive"],
    ["DELETE", "/api/notes/1"],
  ];

  for (const [method, path] of routes) {
    it(`${method} ${path} → 401`, async () => {
      const verb = method.toLowerCase();
      await request(app)[verb](path).expect(401);
    });
  }

  it("непридатний x-user-id не пропускається", async () => {
    for (const bad of ["", "abc", "0", "-1", "1.5", "1 OR 1=1", "null"]) {
      await request(app).get("/api/notes").set("x-user-id", bad).expect(401);
    }
  });
});
