// Creates (or updates) the Paytrellis agent in your Tavus account:
// guardrails, objective, tools, and the PAL itself, with the tools attached.
// Safe to re-run: IDs are remembered in .agent.json (git-ignored).
//   - guardrails and the objective are created once and reused
//   - tools are updated in place, so definition changes take effect
//   - the PAL is recreated each run (the previous one is deleted) so prompt changes take effect
import { tavus, requireEnv, readJson, writeJson, TavusError } from "../lib/tavus.mjs";
import { SYSTEM_PROMPT, PERCEPTION, TOOLS, GUARDRAILS, OBJECTIVES, AGENT_NAME } from "./definitions.mjs";

const STATE_FILE = process.env.AGENT_STATE_FILE ?? new URL("../.agent.json", import.meta.url);
const state = await readJson(STATE_FILE, { guardrails: {}, tools: {} });
const save = () => writeJson(STATE_FILE, state);

// 1. Guardrails
for (const g of GUARDRAILS) {
  if (state.guardrails[g.guardrail_name]) {
    console.log(`✓ guardrail ${g.guardrail_name} (existing)`);
    continue;
  }
  const created = await tavus("POST", "/guardrails", g);
  state.guardrails[g.guardrail_name] = created.uuid;
  await save();
  console.log(`+ guardrail ${g.guardrail_name}`);
}

// 2. Objective
if (state.objectives_id) {
  console.log(`✓ objectives ${state.objectives_id} (existing)`);
} else {
  const created = await tavus("POST", "/objectives", { data: OBJECTIVES });
  state.objectives_id = created.objectives_id;
  await save();
  console.log(`+ objectives ${state.objectives_id}`);
}

// 3. Tools (names are unique per Tavus account)
async function findToolIdByName(name) {
  const list = await tavus("GET", "/tools");
  return (list.data ?? list).find?.((t) => t.name === name)?.tool_id;
}

for (const tool of TOOLS) {
  let id = state.tools[tool.name];
  if (!id) {
    try {
      id = (await tavus("POST", "/tools", tool)).tool_id;
      console.log(`+ tool ${tool.name}`);
    } catch (err) {
      if (!(err instanceof TavusError && err.status === 409)) throw err;
      id = await findToolIdByName(tool.name);
      if (!id) throw new Error(`Tool ${tool.name} already exists in your account but couldn't be found to reuse.`);
      console.log(`~ tool ${tool.name} (reused existing)`);
    }
  } else {
    console.log(`~ tool ${tool.name} (updated)`);
  }
  await tavus("PATCH", `/tools/${id}`, tool);
  state.tools[tool.name] = id;
  await save();
}

// 4. PAL: replace the previous one so prompt changes take effect
if (state.pal_id) {
  try {
    await tavus("DELETE", `/pals/${state.pal_id}`);
    console.log(`- removed previous PAL ${state.pal_id}`);
  } catch (err) {
    console.warn(`  (couldn't delete previous PAL ${state.pal_id}: ${err.message})`);
  }
}

const pal = await tavus("POST", "/pals", {
  pal_name: `Paytrellis payments assistant (${AGENT_NAME})`,
  pipeline_mode: "full",
  default_face_id: requireEnv("TAVUS_FACE_ID"),
  system_prompt: SYSTEM_PROMPT,
  greeting: `Hi, this is ${AGENT_NAME} from Paytrellis about a payment request that's on hold. Have you got a minute?`,
  guardrail_ids: Object.values(state.guardrails),
  objectives_id: state.objectives_id,
  layers: { perception: PERCEPTION },
});
state.pal_id = pal.pal_id;
await save();
console.log(`+ PAL ${pal.pal_id}`);

// 5. Attach the tools
await tavus("POST", `/pals/${pal.pal_id}/tools`, { tool_ids: Object.values(state.tools) });
console.log(`+ attached ${TOOLS.length} tools`);

console.log("\nAgent ready. Start the app with `npm start`.\n");
