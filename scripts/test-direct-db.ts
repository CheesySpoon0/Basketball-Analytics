#!/usr/bin/env npx tsx
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";

async function main() {
  // Use direct connection without adapter
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DIRECT_URL
      }
    }
  });

  try {
    console.log('Using DIRECT_URL:', process.env.DIRECT_URL);
    const result = await prisma.$queryRaw`SELECT current_database()`;
    console.log('Database connection successful:', result);

    const count = await prisma.player.count();
    console.log('Player count:', count);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();