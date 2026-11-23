import { defineAgent } from "eve";

// MODEL is substituted per run by harness/run-eve.mjs (the same model as the comparison harness).
export default defineAgent({
  model: "__MODEL__",
  reasoning: "high",
});
