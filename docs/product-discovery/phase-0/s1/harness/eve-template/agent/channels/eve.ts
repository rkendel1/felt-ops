import { eveChannel } from "eve/channels/eve";
import { none } from "eve/channels/auth";

// Phase 0 S1 harness: the server binds 127.0.0.1 only; no auth.
export default eveChannel({ auth: [none()] });
