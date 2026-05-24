#!/usr/bin/env npx tsx
import { prisma } from "../lib/prisma.js";

async function main() {
  try {
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