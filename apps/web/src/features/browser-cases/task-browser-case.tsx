import { rerunBrowserCaseOp, type TaskDetailDTO } from '@aw/shared';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { BROWSER_CASE_COPY as C } from '../../copy/browser-cases.ts';
import { BrowserCaseEditor } from './browser-case-editor.tsx';
import { BrowserCaseRun } from './browser-case-run.tsx';

export function TaskBrowserCase({ task }: { task: TaskDetailDTO }) {
  const [saving, setSaving] = useState(false);
  if (task.browserCase !== undefined) {
    return (
      <BrowserCaseRun
        test={task.browserCase}
        label={C.rerun}
        launch={() => callOperation(rerunBrowserCaseOp, { id: task.id, approved: true })}
      />
    );
  }
  const scope = task.browserTest;
  if (scope === undefined) return null;
  return (
    <>
      <Button size="sm" onClick={() => setSaving(true)}>
        {C.saveFromTask}
      </Button>
      {saving && (
        <BrowserCaseEditor
          projectId={task.project.id}
          initial={{ name: task.title, scope }}
          onClose={() => setSaving(false)}
        />
      )}
    </>
  );
}
