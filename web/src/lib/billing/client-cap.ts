import "server-only";

import type { OperatorRepositoryResult } from "./repository-operator.ts";

export type ClientCapMeter = { cap: number | null; count: number };
export type RaiseClientCapInput = { actorId: string; cap: number; orgId: string };

export class ClientCapError extends Error {
  readonly code = "CLIENT_CAP_REACHED";
  readonly status = 409;

  constructor() {
    super("This organization has reached its active client cap.");
    this.name = "ClientCapError";
  }
}

export type ClientCapRepository = {
  read(orgId: string): Promise<OperatorRepositoryResult<{ activeCount: number; clientCap: number | null } | null>>;
  raise(input: RaiseClientCapInput): Promise<OperatorRepositoryResult<{
    applied: boolean; clientCap: number; from: number | null; orgId: string;
  }>>;
};

function unwrap<T>(result: OperatorRepositoryResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export function createClientCapService(repository: ClientCapRepository) {
  async function readClientCap(orgId: string): Promise<ClientCapMeter> {
    const row = unwrap(await repository.read(orgId));
    if (!row) throw new Error("CLIENT_CAP_METER_UNAVAILABLE");
    return { cap: row.clientCap, count: row.activeCount };
  }

  return {
    readClientCap,
    async assertClientCap(orgId: string): Promise<ClientCapMeter> {
      const meter = await readClientCap(orgId);
      if (meter.cap !== null && meter.count >= meter.cap) throw new ClientCapError();
      return meter;
    },
    async raiseClientCap(input: RaiseClientCapInput) {
      if (!Number.isInteger(input.cap) || input.cap <= 0 || input.cap > 2_147_483_647) {
        throw new Error("CLIENT_CAP_INVALID");
      }
      return unwrap(await repository.raise(input));
    },
  };
}

async function productionService() {
  const repository = await import("./repository-operator.ts");
  return createClientCapService({
    read: repository.readClientCapForOrg,
    raise: repository.raiseClientCapForOrg,
  });
}

export async function readClientCap(orgId: string): Promise<ClientCapMeter> {
  return (await productionService()).readClientCap(orgId);
}

export async function assertClientCap(orgId: string): Promise<ClientCapMeter> {
  return (await productionService()).assertClientCap(orgId);
}

export async function raiseClientCap(input: RaiseClientCapInput) {
  return (await productionService()).raiseClientCap(input);
}
