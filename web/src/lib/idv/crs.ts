import { getCrsAdapter } from "@/lib/crs/adapter";
import { CrsDriverError } from "@/lib/crs/errors";
import type { CrsAdapter } from "@/lib/crs/types";
import type { IdvAdapter } from "@/lib/idv/types";

export function createCrsIdvAdapter(crs: CrsAdapter = getCrsAdapter()): IdvAdapter {
  return {
    async close(memberRef) {
      await crs.closeMember(memberRef);
    },
    async pause(memberRef) {
      await crs.pauseMember(memberRef);
    },
    async resume(memberRef) {
      await crs.resumeMember(memberRef);
    },
    async start(request) {
      if (!request.crsIdentity) {
        throw new CrsDriverError(crs.driver, "createMember", 400);
      }
      return crs.createMember(request.crsIdentity);
    },
    async submit(request) {
      return crs.submitIdvStep(request.memberRef, request.submission, request.continuation);
    },
  };
}
