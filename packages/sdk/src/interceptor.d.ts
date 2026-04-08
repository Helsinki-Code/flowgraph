import type { Agent } from "@mariozechner/pi-agent-core";
import { InstrumentOptions, EventCollector } from "./event-model.js";
/**
 * instrumentAgent() — main entry point
 * Wraps a pi-agent Agent with flamegraph instrumentation
 * Returns unsubscribe function
 */
export declare function instrumentAgent(agent: Agent, options: InstrumentOptions): () => void;
/**
 * instrumentStream() — wraps a raw stream function for non-Agent use
 * Useful for instrumenting direct calls to stream() or completeSimple()
 */
export declare function instrumentStream<TApi, TOptions>(streamFn: (model: any, context: any, options?: TOptions) => any, collector: EventCollector, workspaceId: string): typeof streamFn;
//# sourceMappingURL=interceptor.d.ts.map