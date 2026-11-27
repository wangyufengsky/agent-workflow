import type { DesignDTO } from '@aw/shared';
import { ErrorState } from '../../components/error-state.tsx';
import { PermissionPicker } from '../permissions/permission-picker.tsx';
import { useUpdateDesign } from './designs.queries.ts';

export function DesignPermissionPicker({ design }: { design: DesignDTO }) {
  const update = useUpdateDesign();
  return (
    <>
      <PermissionPicker
        scope="design"
        value={design.permissionMode}
        disabled={design.projectId === null || update.isPending}
        onChange={(permissionMode) => update.mutate({ id: design.id, permissionMode })}
      />
      {update.isError && <ErrorState error={update.error} />}
    </>
  );
}
