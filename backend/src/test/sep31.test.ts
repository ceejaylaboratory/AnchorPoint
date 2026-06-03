import "@jest/globals";
import request from "supertest";
import express, { Express } from "express";
import sep31Router from "../src/sep31/router";
import { expect, it } from "@jest/globals";

// ─── Test app ─────────────────────────────────────────────────────────────
// Mount the router without the SEP-10 auth middleware so tests focus on
// SEP-31 logic. Auth middleware tests live in a separate suite.

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/sep31", sep31Router);
  return app;
}

const app = buildApp();

// ─── Fixtures ──────────────────────────────────────────────────────────────

const validBody = {
  amount: "100",
  asset_code: "USDC",
  sender_id: "a1b2c3-sender",
  receiver_id: "d4e5f6-receiver",
};

const validBodyWithInfo = {
  amount: "250",
  asset_code: "USDC",
  sender_info: { first_name: "Alice", last_name: "Sender" },
  receiver_info: { first_name: "Bob", last_name: "Receiver", account_number: "123456789", routing_number: "021000021" },
};

// ─── GET /sep31/info ──────────────────────────────────────────────────────

describe("GET /sep31/info", () => {
  it("returns 200 with supported assets", async () => {
    const res = await request(app).get("/sep31/info");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("receive");
    expect(res.body.receive).toHaveProperty("USDC");
    expect(res.body.receive.USDC.enabled).toBe(true);
  });
});

// ─── POST /sep31/transactions ─────────────────────────────────────────────

describe("POST /sep31/transactions", () => {
  it("returns 201 with required payment fields on a valid request", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("stellar_account_id");
    expect(res.body).toHaveProperty("stellar_memo");
    expect(res.body).toHaveProperty("stellar_memo_type");
  });

  it("returns 201 when using sender_info and receiver_info instead of IDs", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send(validBodyWithInfo);

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it("returns 400 when amount is missing", async () => {
    const { amount, ...body } = validBody;
    const res = await request(app).post("/sep31/transactions").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/);
  });

  it("returns 400 when amount is negative", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send({ ...validBody, amount: "-50" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/);
  });

  it("returns 400 when asset_code is missing", async () => {
    const { asset_code, ...body } = validBody;
    const res = await request(app).post("/sep31/transactions").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asset_code/);
  });

  it("returns 400 for an unsupported asset_code", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send({ ...validBody, asset_code: "DOGE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not supported/);
  });

  it("returns 400 when neither sender_id nor sender_info is provided", async () => {
    const { sender_id, ...body } = validBody;
    const res = await request(app).post("/sep31/transactions").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sender/);
  });

  it("returns 400 when neither receiver_id nor receiver_info is provided", async () => {
    const { receiver_id, ...body } = validBody;
    const res = await request(app).post("/sep31/transactions").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/receiver/);
  });

  it("returns 400 when receiver_info is missing required name fields", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send({
        ...validBody,
        receiver_id: undefined,
        receiver_info: { account_number: "123" }, // missing first_name, last_name
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/receiver_info/);
  });

  it("returns 400 when amount exceeds max", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send({ ...validBody, amount: "9999999" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Maximum/);
  });

  it("returns 400 when memo is provided without memo_type", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send({ ...validBody, memo: "REF-001" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/memo_type/);
  });

  it("returns 400 when memo_type is invalid", async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send({ ...validBody, memo: "REF-001", memo_type: "invalid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/memo_type/);
  });

  it("generates unique IDs for each transaction", async () => {
    const r1 = await request(app).post("/sep31/transactions").send(validBody);
    const r2 = await request(app).post("/sep31/transactions").send(validBody);
    expect(r1.body.id).not.toBe(r2.body.id);
  });
});

// ─── GET /sep31/transactions/:id ──────────────────────────────────────────

describe("GET /sep31/transactions/:id", () => {
  let transactionId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/sep31/transactions")
      .send(validBody);
    transactionId = res.body.id;
  });

  it("returns 200 with transaction details for a known ID", async () => {
    const res = await request(app).get(`/sep31/transactions/${transactionId}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction.id).toBe(transactionId);
    expect(res.body.transaction.status).toBe("pending_sender");
    expect(res.body.transaction.amount_in).toBe("100");
    expect(res.body.transaction.asset_code).toBe("USDC");
  });

  it("returns 404 for an unknown transaction ID", async () => {
    const res = await request(app).get("/sep31/transactions/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("includes amount_out and amount_fee in the response", async () => {
    const res = await request(app).get(`/sep31/transactions/${transactionId}`);
    expect(res.body.transaction.amount_out).toBeDefined();
    expect(res.body.transaction.amount_fee).toBeDefined();
  });
});

// ─── PATCH /sep31/transactions/:id ────────────────────────────────────────

describe("PATCH /sep31/transactions/:id", () => {
  it("returns 400 when transaction is not in pending_customer_info_update", async () => {
    const create = await request(app)
      .post("/sep31/transactions")
      .send(validBody);
    const id = create.body.id;

    const res = await request(app)
      .patch(`/sep31/transactions/${id}`)
      .send({ receiver_info: { first_name: "Bob", last_name: "New" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pending_customer_info_update/);
  });

  it("returns 404 for an unknown transaction", async () => {
    const res = await request(app)
      .patch("/sep31/transactions/ghost-id")
      .send({ receiver_info: { first_name: "X", last_name: "Y" } });
    expect(res.status).toBe(404);
  });
});