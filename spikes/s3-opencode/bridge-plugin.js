// S1: inject the calling session id into arguments of our own MCP tools.
import { appendFileSync } from 'node:fs';

const PREFIX = 'agent-workflow_';
const LOG = new URL('./plugin.log', import.meta.url);
export default {
  id: 'agent-workflow-bridge',
  server: async () => {
    appendFileSync(LOG, `loaded\n`);
    return {
      'tool.execute.before': async (input, output) => {
        appendFileSync(LOG, `before ${input.tool} ${input.sessionID} ${JSON.stringify(output.args)}\n`);
        // Mutate in place: the caller keeps its reference to the args object.
        if (input.tool.startsWith(PREFIX)) output.args.__aw_session = input.sessionID;
      },
    };
  },
};
