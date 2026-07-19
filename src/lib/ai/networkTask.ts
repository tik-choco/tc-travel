// AI Network Task: an orchestrator->worker fan-out over the mist P2P AI
// Network, ported from tc-translate's simultaneousTranslate.ts blueprint.
// The orchestrator (an expensive model, e.g. claude-fable-5) only produces a
// small JSON subtask plan; the actual work runs in parallel on cheaper
// worker models (e.g. claude-sonnet-5), keeping expensive-model token spend
// to a minimum. Structurally typed against CompanionClient.requestChat
// rather than importing it, so this module has no dependency on the mist
// wiring and stays trivially testable with a fake client.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface ChatClient {
  requestChat(
    messages: ChatMessage[],
    options?: { model?: string; onDelta?: (delta: string, full: string) => void },
  ): Promise<string>;
}

export const MAX_NETWORK_TASK_WORKERS = 4;

export type NetworkSubtask = { title: string; instruction: string };
export type NetworkTaskPlan = { subtasks: NetworkSubtask[] };

const ORCHESTRATOR_SYSTEM_PROMPT =
  `You are the orchestrator of an AI network task pipeline. Split the user's request into at most ${MAX_NETWORK_TASK_WORKERS} independent subtasks for parallel workers. Prefer a single subtask for simple requests. Return only JSON: {"subtasks":[{"title":string,"instruction":string}]}`;

const WORKER_SYSTEM_PROMPT =
  "You are a worker executing one subtask of a larger AI network task. Respond with the deliverable text only - no preamble, no meta-commentary.";

const FALLBACK_SUBTASK: NetworkSubtask = {
  title: "Direct response",
  instruction: "Fulfill the user's request directly and completely.",
};

class AbortError extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortError";
  }
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function extractJsonContent(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

function parsePlan(content: string): NetworkTaskPlan {
  const parsed = JSON.parse(extractJsonContent(content)) as Partial<{ subtasks: unknown }>;
  const rawSubtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
  const subtasks = rawSubtasks
    .map((item): NetworkSubtask | null => {
      const maybe = item as Partial<NetworkSubtask>;
      if (typeof maybe.title !== "string" || typeof maybe.instruction !== "string") return null;
      const title = maybe.title.trim();
      const instruction = maybe.instruction.trim();
      if (!title || !instruction) return null;
      return { title, instruction };
    })
    .filter((item): item is NetworkSubtask => item !== null)
    .slice(0, MAX_NETWORK_TASK_WORKERS);

  if (!subtasks.length) throw new Error("No usable subtasks in orchestrator plan.");
  return { subtasks };
}

function buildUserContent(input: string, contextText: string): string {
  const context = contextText.trim();
  return context ? `${context}\n\n${input}` : input;
}

/** Orchestrator step: asks the (expensive) orchestrator model to split the
 *  request into at most MAX_NETWORK_TASK_WORKERS independent subtasks for
 *  parallel workers. Throws if the response is missing or unusable JSON -
 *  callers should fall back to a single direct worker call on failure. */
export async function planNetworkTaskFanOut(params: {
  client: ChatClient;
  model: string;
  input: string;
  contextText: string;
  signal?: AbortSignal;
}): Promise<NetworkTaskPlan> {
  const content = await withAbort(
    params.client.requestChat(
      [
        { role: "system", content: ORCHESTRATOR_SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(params.input, params.contextText) },
      ],
      { model: params.model },
    ),
    params.signal,
  );
  return parsePlan(content);
}

/** Worker step: runs one subtask of a larger request on the (cheap) worker
 *  model. The caller dispatches one of these per planned subtask, in
 *  parallel. */
export async function runNetworkTaskWorker(params: {
  client: ChatClient;
  model: string;
  subtask: NetworkSubtask;
  input: string;
  contextText: string;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const userContent = JSON.stringify({
    request: params.input,
    subtaskTitle: params.subtask.title,
    instruction: params.subtask.instruction,
    context: params.contextText,
  });

  const content = await withAbort(
    params.client.requestChat(
      [
        { role: "system", content: WORKER_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      {
        model: params.model,
        ...(params.onDelta ? { onDelta: (_delta: string, full: string) => params.onDelta?.(full) } : {}),
      },
    ),
    params.signal,
  );

  return content.trim();
}

/** Runs the full orchestrator -> worker fan-out for one request: plans
 *  subtasks with the orchestrator model, then dispatches all subtasks in
 *  parallel to worker models, merging their outputs in plan order as they
 *  stream in. Falls back to a single direct worker call (plan: null) if
 *  planning fails. A single worker failure is recorded as a placeholder in
 *  its slot rather than failing the whole task; the task only rejects if
 *  every worker fails. */
export async function runNetworkTask(params: {
  client: ChatClient;
  orchestratorModel: string;
  workerModel: string;
  input: string;
  contextText: string;
  onDelta?: (mergedText: string) => void;
  onPlan?: (plan: NetworkTaskPlan) => void;
  signal?: AbortSignal;
}): Promise<{ plan: NetworkTaskPlan | null; text: string }> {
  let plan: NetworkTaskPlan | null = null;
  try {
    plan = await planNetworkTaskFanOut({
      client: params.client,
      model: params.orchestratorModel,
      input: params.input,
      contextText: params.contextText,
      signal: params.signal,
    });
    params.onPlan?.(plan);
  } catch {
    plan = null;
  }

  const subtasks = plan?.subtasks.length ? plan.subtasks : [FALLBACK_SUBTASK];
  const parts: string[] = new Array(subtasks.length).fill("");
  const failed: boolean[] = new Array(subtasks.length).fill(false);

  const mergedText = (): string => parts.filter((part) => part.trim() !== "").join("\n\n");

  await Promise.all(
    subtasks.map(async (subtask, index) => {
      try {
        parts[index] = await runNetworkTaskWorker({
          client: params.client,
          model: params.workerModel,
          subtask,
          input: params.input,
          contextText: params.contextText,
          signal: params.signal,
          ...(params.onDelta
            ? {
                onDelta: (text: string) => {
                  parts[index] = text;
                  params.onDelta?.(mergedText());
                },
              }
            : {}),
        });
      } catch {
        failed[index] = true;
        parts[index] = `[${subtask.title}: failed]`;
      }
      params.onDelta?.(mergedText());
    }),
  );

  if (failed.every(Boolean)) {
    throw new Error("All network task workers failed.");
  }

  return { plan, text: mergedText() };
}
