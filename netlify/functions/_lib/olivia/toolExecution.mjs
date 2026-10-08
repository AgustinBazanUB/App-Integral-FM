import { OLIVIA_CAPABILITIES } from "../../../../src/shared/oliviaCapabilities.mjs";
export const isReadTool = (name) => OLIVIA_CAPABILITIES[name]?.kind === "read" || /^(get_|list_|search_)/.test(name);
// Consecutive independent reads only. Preparation and navigation are barriers.
export async function executeToolBatch(calls, execute, { concurrency = 3 } = {}) {
  const results = [];
  for (let index = 0; index < calls.length;) {
    const chunk = [];
    if (isReadTool(calls[index].name)) {
      while (index < calls.length && chunk.length < concurrency && isReadTool(calls[index].name)) chunk.push(calls[index++]);
    } else chunk.push(calls[index++]);
    results.push(...await Promise.all(chunk.map(async (call) => {
      try { return { call, value: await execute(call) }; } catch (error) { return { call, error }; }
    })));
  }
  return results;
}
