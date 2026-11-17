import { createApp } from "./lib/app.mjs";

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`Paytrellis demo running at http://localhost:${port}`);
});
