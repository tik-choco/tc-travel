import { describe, expect, it } from "vitest";
import {
  MAX_NETWORK_TASK_WORKERS,
  planNetworkTaskFanOut,
  runNetworkTask,
  runNetworkTaskWorker,
  type ChatClient,
  type ChatMessage,
} from "../ai/networkTask";

type RequestOptions = { model?: string; onDelta?: (delta: string, full: string) => void };
type Call = { messages: ChatMessage[]; options?: RequestOptions };
type Responder = (messages: ChatMessage[], options?: RequestOptions) => string | Promise<string>;

// Fake mist ChatClient: each call is answered by the next configured
// responder in order, matching the way runNetworkTask issues one
// orchestrator call followed by one call per subtask, all synchronously up
// to their first await — so call order is deterministic.
class ScriptedClient implements ChatClient {
  calls: Call[] = [];
  private responders: Responder[];

  constructor(responders: Responder[]) {
    this.responders = responders;
  }

  async requestChat(messages: ChatMessage[], options?: RequestOptions): Promise<string> {
    const call: Call = { messages, options };
    this.calls.push(call);
    const responder = this.responders[this.calls.length - 1];
    if (!responder) throw new Error(`test bug: no responder configured for call ${this.calls.length - 1}`);
    return responder(messages, options);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function planJson(subtasks: Array<{ title: string; instruction: string }>): string {
  return JSON.stringify({ subtasks });
}

describe("planNetworkTaskFanOut", () => {
  it("parses a clean JSON plan", async () => {
    const client = new ScriptedClient([() => planJson([{ title: "A", instruction: "do a" }])]);
    const plan = await planNetworkTaskFanOut({ client, model: "orchestrator-model", input: "hi", contextText: "" });
    expect(plan).toEqual({ subtasks: [{ title: "A", instruction: "do a" }] });
    expect(client.calls[0]?.options?.model).toBe("orchestrator-model");
  });

  it("parses a markdown-code-fenced JSON plan", async () => {
    const raw = "```json\n" + planJson([{ title: "A", instruction: "do a" }]) + "\n```";
    const client = new ScriptedClient([() => raw]);
    const plan = await planNetworkTaskFanOut({ client, model: "m", input: "hi", contextText: "" });
    expect(plan).toEqual({ subtasks: [{ title: "A", instruction: "do a" }] });
  });

  it("throws on unusable output", async () => {
    const client = new ScriptedClient([() => "not json at all"]);
    await expect(planNetworkTaskFanOut({ client, model: "m", input: "hi", contextText: "" })).rejects.toThrow();
  });

  it("throws when the plan has no valid subtasks", async () => {
    const client = new ScriptedClient([() => planJson([])]);
    await expect(planNetworkTaskFanOut({ client, model: "m", input: "hi", contextText: "" })).rejects.toThrow();
  });

  it("drops malformed entries but keeps valid ones", async () => {
    const raw = JSON.stringify({
      subtasks: [{ title: "A", instruction: "do a" }, { title: 42, instruction: "bad" }, { title: "B" }],
    });
    const client = new ScriptedClient([() => raw]);
    const plan = await planNetworkTaskFanOut({ client, model: "m", input: "hi", contextText: "" });
    expect(plan.subtasks).toEqual([{ title: "A", instruction: "do a" }]);
  });

  it("caps subtasks at MAX_NETWORK_TASK_WORKERS", async () => {
    const subtasks = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, instruction: `do ${i}` }));
    const client = new ScriptedClient([() => planJson(subtasks)]);
    const plan = await planNetworkTaskFanOut({ client, model: "m", input: "hi", contextText: "" });
    expect(plan.subtasks).toHaveLength(MAX_NETWORK_TASK_WORKERS);
    expect(plan.subtasks).toEqual(subtasks.slice(0, MAX_NETWORK_TASK_WORKERS));
  });
});

describe("runNetworkTaskWorker", () => {
  it("uses the worker model and returns the trimmed deliverable", async () => {
    const client = new ScriptedClient([() => "  the answer  "]);
    const result = await runNetworkTaskWorker({
      client,
      model: "worker-model",
      subtask: { title: "A", instruction: "do a" },
      input: "original request",
      contextText: "ctx",
    });
    expect(result).toBe("the answer");
    expect(client.calls[0]?.options?.model).toBe("worker-model");
  });
});

describe("runNetworkTask", () => {
  it("falls back to a single direct worker call (plan: null) when planning fails", async () => {
    const client = new ScriptedClient([() => "not json", () => "fallback answer"]);
    const result = await runNetworkTask({
      client,
      orchestratorModel: "orchestrator-model",
      workerModel: "worker-model",
      input: "raw user input",
      contextText: "",
    });

    expect(result.plan).toBeNull();
    expect(result.text).toBe("fallback answer");
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.options?.model).toBe("orchestrator-model");
    expect(client.calls[1]?.options?.model).toBe("worker-model");
    const workerUserMessage = client.calls[1]?.messages.find((m) => m.role === "user");
    expect(workerUserMessage?.content).toContain("raw user input");
  });

  it("merges multi-subtask worker output in plan order, even when workers resolve out of order", async () => {
    const deferredA = defer<string>();
    const deferredB = defer<string>();
    const client = new ScriptedClient([
      () => planJson([{ title: "A", instruction: "do a" }, { title: "B", instruction: "do b" }]),
      () => deferredA.promise,
      () => deferredB.promise,
    ]);

    const taskPromise = runNetworkTask({
      client,
      orchestratorModel: "orchestrator-model",
      workerModel: "worker-model",
      input: "hi",
      contextText: "",
    });

    deferredB.resolve("B result");
    deferredA.resolve("A result");

    const result = await taskPromise;
    expect(result.text).toBe("A result\n\nB result");
    expect(result.plan?.subtasks.map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("reports the plan via onPlan", async () => {
    const client = new ScriptedClient([
      () => planJson([{ title: "A", instruction: "do a" }]),
      () => "A result",
    ]);
    let reported: unknown = null;
    await runNetworkTask({
      client,
      orchestratorModel: "orchestrator-model",
      workerModel: "worker-model",
      input: "hi",
      contextText: "",
      onPlan: (plan) => {
        reported = plan;
      },
    });
    expect(reported).toEqual({ subtasks: [{ title: "A", instruction: "do a" }] });
  });

  it("streams merged progress via onDelta as each worker emits deltas", async () => {
    const client = new ScriptedClient([
      () => planJson([{ title: "A", instruction: "do a" }, { title: "B", instruction: "do b" }]),
      (_messages, options) => {
        options?.onDelta?.("He", "He");
        return "Hello";
      },
      (_messages, options) => {
        options?.onDelta?.("Wo", "Wo");
        return "World";
      },
    ]);

    const merges: string[] = [];
    const result = await runNetworkTask({
      client,
      orchestratorModel: "orchestrator-model",
      workerModel: "worker-model",
      input: "hi",
      contextText: "",
      onDelta: (mergedText) => merges.push(mergedText),
    });

    expect(result.text).toBe("Hello\n\nWorld");
    expect(merges.length).toBeGreaterThan(0);
    expect(merges[merges.length - 1]).toBe("Hello\n\nWorld");
    expect(merges).toContain("He");
  });

  it("passes single-subtask streaming straight through", async () => {
    const client = new ScriptedClient([
      () => planJson([{ title: "A", instruction: "do a" }]),
      (_messages, options) => {
        options?.onDelta?.("Hel", "Hel");
        options?.onDelta?.("lo", "Hello");
        return "Hello";
      },
    ]);

    const merges: string[] = [];
    const result = await runNetworkTask({
      client,
      orchestratorModel: "orchestrator-model",
      workerModel: "worker-model",
      input: "hi",
      contextText: "",
      onDelta: (mergedText) => merges.push(mergedText),
    });

    expect(result.text).toBe("Hello");
    expect(merges).toEqual(["Hel", "Hello", "Hello"]);
  });

  it("keeps a placeholder for a single failed worker without failing the task", async () => {
    const client = new ScriptedClient([
      () => planJson([{ title: "A", instruction: "do a" }, { title: "B", instruction: "do b" }]),
      () => {
        throw new Error("worker A exploded");
      },
      () => "B result",
    ]);

    const result = await runNetworkTask({
      client,
      orchestratorModel: "orchestrator-model",
      workerModel: "worker-model",
      input: "hi",
      contextText: "",
    });

    expect(result.text).toBe("[A: failed]\n\nB result");
  });

  it("throws when every worker fails", async () => {
    const client = new ScriptedClient([
      () => planJson([{ title: "A", instruction: "do a" }, { title: "B", instruction: "do b" }]),
      () => {
        throw new Error("worker A exploded");
      },
      () => {
        throw new Error("worker B exploded");
      },
    ]);

    await expect(
      runNetworkTask({
        client,
        orchestratorModel: "orchestrator-model",
        workerModel: "worker-model",
        input: "hi",
        contextText: "",
      }),
    ).rejects.toThrow();
  });
});
