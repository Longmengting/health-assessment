import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$connect();
  console.info("No baseline data is required for Health Path.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
