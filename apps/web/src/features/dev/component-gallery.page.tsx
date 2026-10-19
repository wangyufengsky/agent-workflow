import { STATUS_TONES, StatusTone } from '@aw/shared';
import { useState } from 'react';
import { ThemeSwitch } from '../../app/shell/theme-switch.tsx';
import { Button } from '../../components/button.tsx';
import { CommandPalette } from '../../components/command-palette.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { toast } from '../../components/toast.tsx';

// Development-only page (not in production builds): every shared component on one screen so the four themes can
// be reviewed from E2E screenshots (M1-12). Sample text is fixture data, not product copy.
const SAMPLE_MARKDOWN = `### 改动摘要
- 新增 \`GET /refunds?page=\` 分页接口
- 导出改为**流式写出**，避免大文件占满内存

| 文件 | 改动 |
| --- | --- |
| src/refunds.ts | +120 −8 |

> 假设：导出上限为 10 万行。

\`\`\`ts
export function paginate(page: number) { return page * 20; }
\`\`\``;

export function ComponentGalleryPage() {
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const noop = () => undefined;

  return (
    <div className="content">
      <div className="page">
        <div className="page-head">
          <h1 className="title grow">Components</h1>
          <ThemeSwitch />
        </div>
        <div className="stack">
          <Panel title="Button / IconButton">
            <div className="row wrap">
              <Button variant="primary" icon="plus">
                Primary
              </Button>
              <Button>Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="brand">Brand</Button>
              <Button variant="danger" icon="trash">
                Danger
              </Button>
              <Button pending>Pending</Button>
              <Button disabled>Disabled</Button>
              <Button size="sm">Small</Button>
              <Button size="lg" variant="primary">
                Large
              </Button>
              <IconButton icon="settings" label="Settings" />
              <IconButton icon="refresh" label="Refresh" />
            </div>
          </Panel>
          <Panel title="StatusBadge">
            <div className="row wrap">
              {STATUS_TONES.map((tone) => (
                <StatusBadge key={tone} tone={tone} label={tone} />
              ))}
            </div>
          </Panel>
          <Panel title="Tabs">
            <Tabs
              items={[
                { value: 'output', label: 'Output', content: <p className="hint">Tab one content</p> },
                { value: 'changes', label: 'Changes', content: <p className="hint">Tab two content</p> },
                { value: 'process', label: 'Process', content: <p className="hint">Tab three content</p> },
              ]}
            />
          </Panel>
          <Panel title="Markdown">
            <Markdown source={SAMPLE_MARKDOWN} />
          </Panel>
          <Panel title="EmptyState">
            <EmptyState
              icon="inbox"
              title="Nothing here"
              body="Empty state body text."
              action={<Button>Action</Button>}
            />
          </Panel>
          <Panel
            title="Overlays"
            footer={<span className="hint">Dialog · Drawer · Toast · Command palette</span>}
            actions={<span className="badge outline">overlay</span>}
          >
            <div className="row wrap">
              <Button onClick={() => setDialog(true)}>Open dialog</Button>
              <Button onClick={() => setDrawer(true)}>Open drawer</Button>
              <Button onClick={() => toast('Saved')}>Toast</Button>
              <Button onClick={() => toast('Failed', StatusTone.Danger)}>Error toast</Button>
              <Button onClick={() => setPalette(true)}>Open palette</Button>
            </div>
          </Panel>
        </div>
      </div>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Dialog title"
        description="Dialog description explaining the consequence."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Confirm
            </Button>
          </>
        }
      />
      <Drawer
        open={drawer}
        onOpenChange={setDrawer}
        title="Drawer title"
        size="md"
        footer={<Button>Footer action</Button>}
      >
        <Markdown source={SAMPLE_MARKDOWN} />
      </Drawer>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        items={[
          { id: 'a', group: 'Pages', label: 'Home', run: noop },
          { id: 'b', group: 'Pages', label: 'Projects', run: noop },
          { id: 'c', group: 'Actions', label: 'Switch theme', hint: '⌘K', run: noop },
        ]}
      />
    </div>
  );
}
