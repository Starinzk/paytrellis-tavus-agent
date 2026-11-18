import { loadDotEnv } from "./lib/env.mjs";
loadDotEnv();

const { createApp } = await import("./lib/app.mjs");
const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`Paytrellis demo running on port ${port}`);
});
