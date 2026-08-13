import { z } from "zod";
import {
  BRIDGE_BUILD_ID,
  BRIDGE_VERSION,
  BrowserJobSchema,
  JobResultMessageSchema,
  ProgressEventSchema,
  ResearchErrorCodeSchema,
  ResearchSessionIdSchema,
  SourceCounterSchema
} from "@browser-research/protocol";

export const BROKER_VERSION = BRIDGE_VERSION;
export const BROKER_BUILD_ID = BRIDGE_BUILD_ID;

export const BrokerRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    type: z.literal("broker_request"),
    id: z.string().uuid(),
    operation: z.literal("status")
  }),
  z.object({
    type: z.literal("broker_request"),
    id: z.string().uuid(),
    operation: z.literal("run_job"),
    sessionId: ResearchSessionIdSchema,
    source: SourceCounterSchema.optional(),
    job: BrowserJobSchema
  })
]);

const BrokerStatusSchema = z.object({
  connected: z.boolean(),
  expectedOrigin: z.string(),
  port: z.number().int(),
  extensionVersion: z.string().nullable(),
  connectedAt: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  pendingJobs: z.number().int().nonnegative(),
  brokerClients: z.number().int().nonnegative(),
  brokerVersion: z.string().min(1),
  brokerBuildId: z.string().min(1)
});

export const BrokerResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("broker_response"),
    id: z.string().uuid(),
    ok: z.literal(true),
    result: z.union([BrokerStatusSchema, JobResultMessageSchema])
  }),
  z.object({
    type: z.literal("broker_response"),
    id: z.string().uuid(),
    ok: z.literal(false),
    error: z.object({ code: ResearchErrorCodeSchema, message: z.string() })
  })
]);

// Streamed from the broker to the requesting broker-client while a run_job is in
// flight. `id` correlates with the broker_request id, not the bridge job id.
export const BrokerProgressSchema = z.object({
  type: z.literal("broker_progress"),
  id: z.string().uuid(),
  event: ProgressEventSchema
});

export type BrokerRequest = z.infer<typeof BrokerRequestSchema>;
export type BrokerResponse = z.infer<typeof BrokerResponseSchema>;
export type BrokerStatus = z.infer<typeof BrokerStatusSchema>;
export type BrokerProgress = z.infer<typeof BrokerProgressSchema>;
