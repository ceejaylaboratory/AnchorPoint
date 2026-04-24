import { PrismaClient } from "@prisma/client";
import { withTracingExtension } from "../tracing/prisma.extension";

const prisma = withTracingExtension(new PrismaClient());

export default prisma;
