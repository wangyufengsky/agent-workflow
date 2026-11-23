import {
  AssistantConfirmationStatus,
  confirmAssistantCallOp,
  createProjectOp,
  createTaskOp,
  functionalTestReadOp,
  functionalTestReportReadOp,
  getTaskOp,
  listConfirmationsOp,
  listTasksOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  ServerEventType,
  TaskStatus,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestRepo } from '../packages/server/test/helpers/git.ts';
import { during, startAssistantEvaluation } from './assistant-evaluation.ts';
import { TASK_TIMEOUT_MS } from './live-app.ts';

function service(main: string, operation: string) {
  return `import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
public class ${main} {
  public static void main(String[] args) throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", Integer.parseInt(System.getenv("PORT"))), 0);
    server.createContext("/ready", request -> { request.sendResponseHeaders(204, -1); request.close(); });
    ${operation}
    server.start();
  }
}`;
}

const UPSTREAM = service(
  'RateSource',
  `
    server.createContext("/price", request -> {
      byte[] bytes = "{\\"rate\\":23}".getBytes(StandardCharsets.UTF_8);
      request.getResponseHeaders().set("Content-Type", "application/json");
      request.sendResponseHeaders(200, bytes.length);
      request.getResponseBody().write(bytes);
      request.close();
    });`,
);

const GATEWAY = service(
  'RateGateway',
  `
    String source = System.getenv("UPSTREAM_URL");
    if (source == null || !source.startsWith("http://127.0.0.1:")) throw new IllegalStateException("no local source");
    var client = HttpClient.newHttpClient();
    server.createContext("/quote", request -> {
      try {
        var response = client.send(HttpRequest.newBuilder(URI.create(source + "/price")).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        request.getResponseHeaders().set("Content-Type", "application/json");
        request.sendResponseHeaders(response.statusCode(), response.body().length);
        request.getResponseBody().write(response.body());
      } catch (Exception e) {
        request.sendResponseHeaders(503, -1);
      } finally {
        request.close();
      }
    });`,
);

const GROUP = 'Rates Compound';
const GATEWAY_NAME = 'Rates Gateway';
const UPSTREAM_NAME = 'Rates Source';
const GROUP_PATH = '.run/Rates.run.xml';

it(
  '@live 项目助手以指定的 IDEA Compound 创建任务并证明跨服务 HTTP 响应',
  async () => {
    const evaluation = await startAssistantEvaluation('project-compound');
    try {
      const { t } = evaluation;
      const repo = await createTestRepo({
        files: {
          'gateway/RateGateway.java': GATEWAY,
          'gateway/README.md': [
            'Module type: HTTP service',
            'Ready path: /ready',
            'The Gateway proxies GET /quote to Rates Source GET /price.',
            'Acceptance: GET /quote returns HTTP 200 and JSON {"rate":23}.',
          ].join('\n'),
          'source/RateSource.java': UPSTREAM,
          'source/README.md':
            'Module type: HTTP service\nReady path: /ready\nGET /price returns HTTP 200 and JSON {"rate":23}.',
          [GROUP_PATH]: `<component name="ProjectRunConfigurationManager">
        <configuration name="${GATEWAY_NAME}" type="Application">
          <option name="MAIN_CLASS_NAME" value="RateGateway"/>
          <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$/gateway"/>
          <envs><env name="UPSTREAM_URL" value="https://idea-original-value.invalid"/></envs>
        </configuration>
        <configuration name="${UPSTREAM_NAME}" type="Application">
          <option name="MAIN_CLASS_NAME" value="RateSource"/>
          <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$/source"/>
        </configuration>
        <configuration name="${GROUP}" type="CompoundRunConfigurationType">
          <toRun name="${GATEWAY_NAME}" type="Application"/>
          <toRun name="${UPSTREAM_NAME}" type="Application"/>
        </configuration>
      </component>`,
          '.aw/compound-services.json': JSON.stringify({
            compounds: [
              {
                name: GROUP,
                target: GATEWAY_NAME,
                services: [{ name: GATEWAY_NAME, dependsOn: [UPSTREAM_NAME], inject: { UPSTREAM_URL: UPSTREAM_NAME } }],
              },
            ],
          }),
        },
      });
      const { status, body: project } = await t.call(createProjectOp, { repoPath: repo.path, name: '运费双服务验收' });
      expect(status).toBe(201);
      const id = await evaluation.conversation('双服务真实 HTTP 验收', project.id);
      const turn = await evaluation.turn(
        id,
        'ask-with-compound-name',
        '帮我测「Rates Compound」这个 IDEA 组合。用 Rates Gateway 做目标，实际请求一次 GET /quote，核对 HTTP 是 200 且 JSON 的 rate 字段为数字 23。只读验收，先让我确认。',
        { context: { page: 'project', params: { projectId: project.id } } },
      );
      const names = turn.tools.map(({ tool }) => tool);
      const discovery = names.indexOf(`${MCP_ASSISTANT_TOOL_PREFIX}projects_modules`);
      expect(discovery).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(`${MCP_ASSISTANT_TOOL_PREFIX}tasks_create`)).toBeGreaterThan(discovery);
      expect(turn.results).toContainEqual(
        expect.objectContaining({
          tool: `${MCP_ASSISTANT_TOOL_PREFIX}projects_modules`,
          output: expect.stringContaining(GROUP),
        }),
      );
      expect(JSON.stringify(turn.results)).not.toContain('idea-original-value.invalid');
      const { body: confirmations } = await t.call(listConfirmationsOp, { id });
      expect(confirmations.items).toHaveLength(1);
      const confirmation = confirmations.items[0];
      expect(confirmation).toMatchObject({
        operationId: createTaskOp.id,
        status: AssistantConfirmationStatus.Pending,
        input: {
          projectId: project.id,
          functionalTest: {
            compoundSelection: {
              compoundId: `idea-compound:project:${GROUP_PATH}:${GROUP}`,
              fingerprint: expect.any(String),
              targetServiceId: `idea:project:${GROUP_PATH}:${GATEWAY_NAME}`,
            },
          },
        },
      });
      if (!confirmation) throw new Error('Expected one task confirmation');
      expect((await t.call(listTasksOp, {})).body.items).toEqual([]);
      const taskId = await during(
        t,
        (event) =>
          event.type === ServerEventType.TaskUpdated &&
          event.data.project.id === project.id &&
          [TaskStatus.Review, TaskStatus.Failed, TaskStatus.Cancelled].some((item) => item === event.data.status),
        async () => {
          const { body } = await t.call(confirmAssistantCallOp, { id: confirmation.id });
          evaluation.facts.confirmation = body;
          if (body.result?.ok !== true) throw new Error('Compound task confirmation failed');
          const task = createTaskOp.output.parse(body.result.output);
          evaluation.tasks.add(task.id);
          return task.id;
        },
        TASK_TIMEOUT_MS,
      );

      const { body: task } = await t.call(getTaskOp, { id: taskId });
      const { body: snapshot } = await t.call(functionalTestReadOp, { taskId });
      const { body: report } = await t.call(functionalTestReportReadOp, { taskId });
      Object.assign(evaluation.facts, { task, snapshot, report });
      expect(task.status).toBe(TaskStatus.Review);
      const environment = snapshot.runs.at(-1)?.environment;
      expect(environment).toMatchObject({
        ready: true,
        targetServiceId: `idea:project:${GROUP_PATH}:${GATEWAY_NAME}`,
        services: expect.arrayContaining([
          expect.objectContaining({
            name: GATEWAY_NAME,
            readyStatus: 204,
            diagnostics: expect.objectContaining({ injectedEnvironment: ['UPSTREAM_URL'] }),
          }),
          expect.objectContaining({ name: UPSTREAM_NAME, readyStatus: 204 }),
        ]),
      });
      expect(new Set(environment?.services?.map(({ target }) => target)).size).toBe(2);
      const action = snapshot.events.find(
        ({ kind, detail }) => kind === 'action' && detail.method === 'GET' && detail.path === '/quote',
      );
      expect(action).toBeDefined();
      const evidence = snapshot.events.filter(
        ({ executionId, step }) => executionId === action?.executionId && step === action?.step,
      );
      expect(evidence).toContainEqual(
        expect.objectContaining({ kind: 'result', detail: expect.objectContaining({ status: 200 }) }),
      );
      expect(evidence).toContainEqual(
        expect.objectContaining({
          kind: 'assertion',
          detail: expect.objectContaining({ field: 'body.rate', actual: 23, passed: true }),
        }),
      );
      expect(report.counts.passed).toBeGreaterThan(0);
      expect(report.counts).toMatchObject({ failed: 0, blocked: 0, not_run: 0 });
      expect(report.markdown).toContain('/quote');
    } finally {
      await evaluation.close();
    }
  },
  TASK_TIMEOUT_MS,
);
