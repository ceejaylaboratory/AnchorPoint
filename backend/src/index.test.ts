import request from "supertest";

jest.mock("./lib/prisma", () => ({
  transaction: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
}));

jest.mock("./lib/redis", () => ({
  redis: {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    pttl: jest.fn().mockResolvedValue(1000),
    // rate-limit-redis calls SCRIPT LOAD and expects a SHA1 hash back
    call: jest
      .fn()
      .mockResolvedValue("0000000000000000000000000000000000000000"),
    on: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require("./index").default;

describe("Backend API", () => {
  it("should return UP on health check", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual("UP");
  });

  it("should return 200 on root access", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain("AnchorPoint Backend API is running.");
  });
});
