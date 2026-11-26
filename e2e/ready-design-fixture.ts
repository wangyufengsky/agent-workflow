import { DesignSectionKind, DesignStatus, getDesignOp, McpToolName, OPENCODE_AGENT_NAME } from '@aw/shared';
import { type APIRequestContext, expect } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import type { E2EProject } from './helpers.ts';

export async function readyModuleDesign(
  request: APIRequestContext,
  project: E2EProject,
  chapter: { path: string; title: string; summary: string },
) {
  const created = await request.post(`${API_BASE}/designs`, {
    headers: AUTH,
    data: { projectId: project.id, aiReviewEnabled: false },
  });
  await expect(created).toBeOK();
  const { id, title } = getDesignOp.output.parse(await created.json());
  const url = `${API_BASE}/designs/${id}`;
  const outline = await request.put(`${url}/outline`, {
    headers: AUTH,
    data: {
      sections: [{ kind: DesignSectionKind.Module, title: chapter.title, scopePaths: [chapter.path], selected: true }],
    },
  });
  await expect(outline).toBeOK();
  const [section] = getDesignOp.output.parse(await outline.json()).sections;
  if (section === undefined) throw new Error('Missing design section');
  await expect(
    await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
      headers: AUTH,
      data: {
        match: { title, agent: OPENCODE_AGENT_NAME.designer },
        steps: [
          {
            type: 'callTool',
            name: McpToolName.SubmitDesignSection,
            args: {
              sectionId: section.id,
              summary: chapter.summary,
              blocks: [{ type: 'markdown', markdown: chapter.summary }],
              files: [{ relPath: chapter.path, responsibility: chapter.summary, symbols: [] }],
              diagrams: [],
            },
          },
        ],
      },
    }),
  ).toBeOK();
  await expect(await request.post(`${url}/generate`, { headers: AUTH, data: {} })).toBeOK();
  const read = async () => {
    const response = await request.get(url, { headers: AUTH });
    await expect(response).toBeOK();
    return getDesignOp.output.parse(await response.json());
  };
  await expect.poll(async () => (await read()).status).toBe(DesignStatus.Ready);
  return { id, read };
}
