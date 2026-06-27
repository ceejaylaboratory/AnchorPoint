jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => ({
    $extends: jest.fn().mockReturnValue({}),
  })),
}));

describe("Prisma Clients", () => {
  it("instantiates PrismaClient for both prisma and db.service modules", () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require("@prisma/client");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const prisma = require("./prisma").default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const db = require("./db.service").default;

    expect(PrismaClient).toHaveBeenCalledTimes(2);
    expect(prisma).toBeDefined();
    expect(typeof prisma.$extends).toBe("function");
    // db.service.ts uses raw PrismaClient
    expect(db).toBeDefined();
    expect(typeof db.$extends).toBe("function");
  });
});
