import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  {
    name: "Electronics",
    slug: "electronics",
  },
  {
    name: "Furniture",
    slug: "furniture",
  },
  {
    name: "Clothing & Fashion",
    slug: "clothing-fashion",
  },
  {
    name: "Books & Stationery",
    slug: "books-stationery",
  },
  {
    name: "Food & Groceries",
    slug: "food-groceries",
  },
  {
    name: "Household",
    slug: "household",
  },
  {
    name: "Services",
    slug: "services",
  },
  {
    name: "Accommodation",
    slug: "accommodation",
  },
  {
    name: "Sports & Fitness",
    slug: "sports-fitness",
  },
  {
    name: "Other",
    slug: "other",
  },
] as const;

async function seedCategories(): Promise<void> {
  for (const category of categories) {
    await prisma.category.upsert({
      where: {
        slug: category.slug,
      },
      update: {
        name: category.name,
        isActive: true,
      },
      create: {
        name: category.name,
        slug: category.slug,
        isActive: true,
      },
    });
  }

  console.log(`Seeded ${categories.length} marketplace categories.`);
}

async function main(): Promise<void> {
  await prisma.$connect();

  console.log("Starting MUT Market database seed...");

  await seedCategories();

  console.log("MUT Market database seed completed successfully.");
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });