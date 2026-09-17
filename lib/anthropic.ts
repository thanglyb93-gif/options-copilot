import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/**
 * Lazily constructed singleton so importing this module never throws when
 * ANTHROPIC_API_KEY is unset -- the app shell must still render before
 * Anthropic is wired up.
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const DEFAULT_MODEL: Anthropic.Model = "claude-sonnet-5";

export interface StructuredGenerationRequest {
  /** Tool name Claude is forced to call; also used as the response key. */
  toolName: string;
  toolDescription: string;
  inputSchema: Anthropic.Tool.InputSchema;
  systemPrompt?: string;
  userPrompt: string;
  model?: Anthropic.Model;
  maxTokens?: number;
}

/**
 * Forces Claude to respond via a single tool call matching `inputSchema`,
 * and returns that call's (unvalidated) input -- avoids parsing JSON out
 * of prose, which is fragile. Callers are responsible for validating the
 * shape of the returned value against their own types.
 */
export async function generateStructuredOutput(
  request: StructuredGenerationRequest
): Promise<unknown> {
  const client = getAnthropicClient();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: request.model ?? DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? 1536,
      system: request.systemPrompt,
      tools: [
        {
          name: request.toolName,
          description: request.toolDescription,
          input_schema: request.inputSchema,
        },
      ],
      tool_choice: { type: "tool", name: request.toolName },
      messages: [{ role: "user", content: request.userPrompt }],
    });
  } catch (error) {
    // The Anthropic SDK's own error message is often the raw HTTP status
    // + response body (e.g. `400 {"type":"error","error":{"message":
    // "Your credit balance is too low..."}}`) -- fine to log, never fine
    // to let reach a UI verbatim. Every caller in this codebase (briefing
    // generation, headline classification, Today's Summary) goes through
    // this one function, so cleaning the message here is what guarantees
    // none of them can leak it, even one that forgets to handle it itself.
    console.error(`Anthropic request failed (tool: ${request.toolName}):`, error);
    throw new Error("Anthropic request failed.");
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUse) {
    throw new Error("Claude did not return a tool_use block.");
  }

  return toolUse.input;
}
