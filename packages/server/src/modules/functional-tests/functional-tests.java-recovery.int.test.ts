import {
  AttemptStatus,
  createTaskOp,
  FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT,
  FUNCTIONAL_TEST_NODE,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  type FunctionalTestLaunch,
  functionalTestReadOp,
  functionalTestRerunOp,
  functionalTestRunSchema,
  MCP_SESSION_ARG,
  McpToolName,
  ServerEventType,
  startTaskOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createFakeOpencode, script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';

const javaLaunch = {
  directory: 'orders',
  source: 'orders/pom.xml',
  script: FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT,
  mainClass: '订单服务.服务入口',
  javaVersion: 8,
  includeProvided: true,
  readyPath: '/ready',
} satisfies FunctionalTestLaunch;

const pom = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>fixture</groupId><artifactId>recovery</artifactId><version>1.0.0</version>
  <properties>
    <maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.17.0</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>
  </plugins></build>
</project>`;
const source = `package 订单服务;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.apache.commons.lang3.StringUtils;

public class 服务入口 {
  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create(
      new InetSocketAddress(System.getenv("HOST"), Integer.parseInt(System.getenv("PORT"))), 0);
    server.createContext("/ready", exchange -> {
      exchange.sendResponseHeaders(204, -1);
      exchange.close();
    });
    server.createContext("/orders", exchange -> {
      byte[] body = (StringUtils.upperCase("provided") + " " + System.getProperty("java.version"))
        .getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
  }
}`;

// 真实 Maven/JDK 8 验收需要显式提供 JDK 以及预装 Maven 依赖缓存，离线执行。
const jdk = process.env.AW_JAVA_RECOVERY_JDK;
it.skipIf(jdk === undefined)(
  'Java 主类、JDK 及 provided 依赖配置持久保存，重启及关联复测沿用原配置',
  async () => {
    const fake = createFakeOpencode();
    const env = { ...process.env, JAVA8_HOME: jdk };
    let t = await createTestApp({ fake, env });
    let mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
    try {
      const { project, repo } = await addProject(t, {
        files: {
          'orders/pom.xml': pom,
          'orders/.mvn/maven.config': '-o\n',
          'orders/src/main/java/订单服务/服务入口.java': source,
        },
      });
      const { body: original } = await t.call(createTaskOp, {
        projectId: project.id,
        workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
        requirement: '检查订单接口',
        functionalTest: { target: '/orders', writes: [], caseAttachmentIds: [] },
        start: false,
      });
      const stage = (key: string, taskId?: string) => {
        fake.enqueue(script().hang(), {
          title:
            key === FUNCTIONAL_TEST_NODE.Author
              ? '编写案例'
              : key === FUNCTIONAL_TEST_NODE.Environment
                ? '准备环境'
                : '执行测试',
        });
        return waitForEvent(
          t.app.events,
          ServerEventType.AttemptUpdated,
          ({ attempt, nodeId, taskId: id }) =>
            id !== null &&
            (taskId === undefined || id === taskId) &&
            attempt.status === AttemptStatus.Running &&
            t.app.services.tasks.detail(id).nodes.some((node) => node.id === nodeId && node.key === key),
        );
      };
      const must = async (attemptId: string, name: McpToolName, input: Record<string, unknown> = {}) => {
        const session = t.app.services.attempts.get(attemptId).opencodeSessionId;
        const result = await callTool(mcp, name, { ...input, [MCP_SESSION_ARG]: session });
        expect(result.isError, JSON.stringify(result.body)).toBe(false);
        return result.body;
      };
      const prepare = async (attemptId: string, launch?: FunctionalTestLaunch) =>
        functionalTestRunSchema.parse(
          await must(attemptId, McpToolName.TestEnvironmentPrepare, launch ? { launch } : {}),
        );

      const author = stage(FUNCTIONAL_TEST_NODE.Author, original.id);
      await t.call(startTaskOp, { id: original.id });
      const { attempt } = await author;
      const test = await must(attempt.id, McpToolName.TestCaseSave, {
        title: '读取订单',
        requirement: '读取成功返回 200',
        steps: [
          {
            kind: 'http',
            title: '读取',
            method: 'GET',
            path: '/orders',
            assertions: [{ field: 'status', equals: 200, basis: '测试夹具' }],
          },
        ],
      });
      const environment = stage(FUNCTIONAL_TEST_NODE.Environment, original.id);
      await must(attempt.id, McpToolName.SubmitResult, { summary: '已保存用例' });
      const originalRun = await prepare((await environment).attempt.id, javaLaunch);
      expect(originalRun.environment).toMatchObject({ launch: javaLaunch, ready: true });
      expect(await (await fetch(originalRun.environment.target)).text()).toMatch(/^PROVIDED 1\.8\./);

      const { dataDir } = t;
      await mcp.close();
      await t.close();
      fake.enqueue(script().hang(), { title: '准备环境' });
      t = await createTestApp({ dataDir, fake, env });
      mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
      expect((await t.call(functionalTestReadOp, { taskId: original.id })).body.runs[0]?.environment.launch).toEqual(
        javaLaunch,
      );
      const active = t.app.services.tasks
        .detail(original.id)
        .activeAttempts.find(({ status }) => status === AttemptStatus.Running);
      const recovered = active ?? (await stage(FUNCTIONAL_TEST_NODE.Environment, original.id)).attempt;
      const resumed = await prepare(recovered.id);
      expect(resumed.environment).toMatchObject({ launch: javaLaunch, ready: true });
      expect(resumed.id).toBe(originalRun.id);

      const execute = stage(FUNCTIONAL_TEST_NODE.Execute, original.id);
      await must(recovered.id, McpToolName.SubmitResult, { summary: '已恢复环境' });
      const execution = await must((await execute).attempt.id, McpToolName.TestCaseRun, {
        runId: resumed.id,
        caseId: test.id,
        version: 1,
        executionId: 'java-original',
      });
      expect(execution).toMatchObject({ status: 'passed' });

      const next = stage(FUNCTIONAL_TEST_NODE.Environment);
      const rerun = await t.call(functionalTestRerunOp, {
        taskId: original.id,
        executionIds: ['java-original'],
        ref: await repo.git('rev-parse', 'HEAD'),
      });
      expect(rerun.status).toBe(200);
      const started = await next;
      expect(started.taskId).toBe(rerun.body.taskId);
      const retested = await prepare(started.attempt.id);
      expect(retested.environment).toMatchObject({ launch: javaLaunch, ready: true });
      expect(retested.id).not.toBe(resumed.id);
      expect(await (await fetch(retested.environment.target)).text()).toMatch(/^PROVIDED 1\.8\./);
    } finally {
      await mcp.close();
      await t.close();
    }
  },
  60_000,
);
