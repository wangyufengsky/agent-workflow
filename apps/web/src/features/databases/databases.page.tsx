import { type DbConnectionDTO, DbType } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DATABASES_COPY as C } from '../../copy/databases.ts';
import styles from './databases.module.css';
import {
  dbConnectionsQuery,
  dbSchemaQuery,
  useCreateDbConnection,
  useDeleteDbConnection,
  useTestDbConnection,
  useUpdateDbConnection,
} from './databases.queries.ts';

/** MySQL's default port. */
const DEFAULT_PORT = 3306;

/** Add or change a connection; the password goes to the credentials store and never comes back (06 §11). */
function ConnectionDialog({ connection, onClose }: { connection: DbConnectionDTO | undefined; onClose: () => void }) {
  const [name, setName] = useState(connection?.name ?? '');
  const [host, setHost] = useState(connection?.host ?? '127.0.0.1');
  const [port, setPort] = useState(String(connection?.port ?? DEFAULT_PORT));
  const [database, setDatabase] = useState(connection?.database ?? '');
  const [username, setUsername] = useState(connection?.username ?? '');
  const [password, setPassword] = useState('');
  const [tls, setTls] = useState(connection?.tls ?? false);
  const create = useCreateDbConnection();
  const update = useUpdateDbConnection();
  const mutation = connection === undefined ? create : update;
  const portNumber = Number(port);
  const valid =
    [name, host, database, username].every((v) => v.trim() !== '') && Number.isInteger(portNumber) && portNumber > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields = {
      name: name.trim(),
      type: DbType.Mysql,
      host: host.trim(),
      port: portNumber,
      database: database.trim(),
      username: username.trim(),
      tls,
    };
    const done = {
      onSuccess: () => {
        toast(C.saved);
        onClose();
      },
    };
    if (connection === undefined) create.mutate({ ...fields, password }, done);
    else update.mutate({ id: connection.id, ...fields, ...(password === '' ? {} : { password }) }, done);
  };
  const field = (id: string, label: string, input: React.ReactNode, hint?: string) => (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {input}
      {hint !== undefined && <span className="hint">{hint}</span>}
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={connection === undefined ? C.addTitle : C.editTitle(connection.name)}
    >
      <form className="col" onSubmit={submit}>
        {field(
          'db-name',
          C.name,
          <input id="db-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />,
          C.nameHint,
        )}
        <div className={styles.hostRow}>
          {field(
            'db-host',
            C.host,
            <input id="db-host" className="input mono" value={host} onChange={(e) => setHost(e.target.value)} />,
          )}
          {field(
            'db-port',
            C.port,
            <input
              id="db-port"
              className="input mono"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />,
          )}
        </div>
        {field(
          'db-database',
          C.database,
          <input
            id="db-database"
            className="input mono"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
          />,
        )}
        {field(
          'db-username',
          C.username,
          <input
            id="db-username"
            className="input mono"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />,
        )}
        {field(
          'db-password',
          C.password,
          <input
            id="db-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />,
          connection === undefined ? undefined : C.passwordKeep,
        )}
        <label className="check">
          <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
          <span>{C.tls}</span>
        </label>
        {mutation.isError && <ErrorState error={mutation.error} />}
        <div className="row">
          <Button type="submit" variant="primary" pending={mutation.isPending} disabled={!valid}>
            {COMMON_COPY.save}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SchemaDrawer({ connection, onClose }: { connection: DbConnectionDTO; onClose: () => void }) {
  const schema = useQuery(dbSchemaQuery(connection.id));
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()} title={C.schemaTitle(connection.name)} size="lg">
      {schema.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {schema.isError && <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />}
      {schema.data?.tables.length === 0 && <p className="hint">{C.schemaEmpty}</p>}
      <div className="col">
        {schema.data?.tables.map((table) => (
          <details key={table.name} className={styles.table}>
            <summary className="row">
              <span className="mono grow">{table.name}</span>
              {table.comment !== undefined && <span className="hint">{table.comment}</span>}
              {table.rows !== undefined && <span className="hint">{C.rows(table.rows)}</span>}
            </summary>
            <table className={styles.columns}>
              <tbody>
                {table.columns.map((column) => (
                  <tr key={column.name}>
                    <td className="mono">{column.name}</td>
                    <td className="mono hint">{column.type}</td>
                    <td className="hint">
                      {[column.key, column.nullable ? C.nullable : ''].filter(Boolean).join(' ')}
                    </td>
                    <td className="hint">{column.comment ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
    </Drawer>
  );
}

function ConnectionCard({
  connection,
  onEdit,
  onSchema,
  onDelete,
}: {
  connection: DbConnectionDTO;
  onEdit: () => void;
  onSchema: () => void;
  onDelete: () => void;
}) {
  const test = useTestDbConnection();
  return (
    <article className="card pad col" aria-label={connection.name}>
      <span className="row">
        <span className="tile">
          <Icon name="db" />
        </span>
        <span className="section-title grow ellipsis">{connection.name}</span>
        {connection.tls && <span className="chip">{C.tlsChip}</span>}
      </span>
      <span className="hint mono ellipsis">
        {connection.username}@{connection.host}:{connection.port}/{connection.database}
      </span>
      {test.data !== undefined && (
        <span className={test.data.ok ? styles.ok : 'error-text'} role="status">
          {test.data.ok ? C.testOk(test.data.serverVersion ?? '') : C.testFailed(test.data.error ?? '')}
        </span>
      )}
      {test.isError && <ErrorState error={test.error} />}
      <div className="row wrap">
        <Button size="sm" icon="refresh" pending={test.isPending} onClick={() => test.mutate(connection.id)}>
          {C.test}
        </Button>
        <Button size="sm" icon="list" onClick={onSchema}>
          {C.schema}
        </Button>
        <Button size="sm" icon="edit" onClick={onEdit}>
          {C.edit}
        </Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={onDelete}>
          {C.delete}
        </Button>
      </div>
    </article>
  );
}

type Open = { what: 'add' } | { what: 'edit' | 'schema' | 'delete'; connection: DbConnectionDTO } | { what: 'none' };

/** Database connections (M5-07, 11 §9). */
export function DatabasesPage() {
  const connections = useQuery(dbConnectionsQuery);
  const remove = useDeleteDbConnection();
  const [open, setOpen] = useState<Open>({ what: 'none' });
  const close = () => setOpen({ what: 'none' });
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setOpen({ what: 'add' })}>
          {C.add}
        </Button>
      </div>
      {connections.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {connections.isError && <ErrorState error={connections.error} onRetry={() => void connections.refetch()} />}
      {connections.data?.length === 0 && <EmptyState icon="db" title={C.empty} body={C.emptyBody} />}
      <div className="grid-2">
        {connections.data?.map((c) => (
          <ConnectionCard
            key={c.id}
            connection={c}
            onEdit={() => setOpen({ what: 'edit', connection: c })}
            onSchema={() => setOpen({ what: 'schema', connection: c })}
            onDelete={() => setOpen({ what: 'delete', connection: c })}
          />
        ))}
      </div>
      {open.what === 'add' && <ConnectionDialog connection={undefined} onClose={close} />}
      {open.what === 'edit' && <ConnectionDialog connection={open.connection} onClose={close} />}
      {open.what === 'schema' && <SchemaDrawer connection={open.connection} onClose={close} />}
      {open.what === 'delete' && (
        <Dialog
          open
          onOpenChange={(isOpen) => !isOpen && close()}
          title={C.deleteTitle(open.connection.name)}
          footer={
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() =>
                remove.mutate(open.connection.id, {
                  onSuccess: () => {
                    toast(C.deleted);
                    close();
                  },
                })
              }
            >
              {C.delete}
            </Button>
          }
        >
          <p>{C.deleteBody}</p>
          {remove.isError && <ErrorState error={remove.error} />}
        </Dialog>
      )}
    </div>
  );
}
