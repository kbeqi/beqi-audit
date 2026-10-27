import { defineConfig } from "drizzle-kit";

// Migrations are generated here and applied with wrangler:
//   npm run db:generate
//   npm run db:migrate:local   (Miniflare D1 used by `next dev` and `wrangler dev`)
//   npm run db:migrate:remote  (production D1)
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
