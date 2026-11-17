// Relays Tavus tool calls from the video call to our server and sends the
// result back into the conversation.
//
// Tavus (app-message delivery) sends:
//   { message_type: "conversation", event_type: "conversation.tool_call",
//     conversation_id, properties: { name, arguments: "<JSON string>", tool_call_id } }
// We reply with:
//   { message_type: "conversation", event_type: "conversation.tool_result",
//     conversation_id, properties: { tool_call_id, output, status: "success" | "error" } }
//
// Pure and dependency-injected so it can be tested in Node without a browser.

export const KNOWN_TOOLS = new Set(["update_field", "complete_request", "send_to_review"]);

export function isToolCall(message) {
  return message?.message_type === "conversation" && message?.event_type === "conversation.tool_call";
}

function parseArguments(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw;
  return JSON.parse(raw);
}

// What the agent hears back. Short and plain, because the LLM reads it to decide what to say.
export function toOutput(result) {
  if (result.ok === false) return `Not done: ${result.reason ?? result.error}`;
  return result.message ?? "Done.";
}

/**
 * @param message   the app-message payload from the call
 * @param runTool   async (name, args) => { status: number, body: object }  (our server)
 * @param send      (payload) => void                                       (back into the call)
 * @param log       optional (entry) => void                                (UI activity log)
 */
export async function handleToolCall(message, { runTool, send, log = () => {} }) {
  if (!isToolCall(message)) return null;
  const { name, tool_call_id } = message.properties ?? {};

  let status = "success";
  let output;
  let args = {};
  try {
    if (!KNOWN_TOOLS.has(name)) throw new Error(`Unknown tool ${name}`);
    args = parseArguments(message.properties.arguments);
    const res = await runTool(name, args);
    if (res.status >= 400) {
      status = "error";
      output = `Not done: ${res.body?.error ?? `server returned ${res.status}`}`;
    } else {
      output = toOutput(res.body);
    }
  } catch (err) {
    status = "error";
    output = `Not done: ${err.message}`;
  }

  const result = {
    message_type: "conversation",
    event_type: "conversation.tool_result",
    conversation_id: message.conversation_id,
    properties: { tool_call_id, output, status },
  };
  send(result);
  log({ name, args, status, output });
  return result;
}
