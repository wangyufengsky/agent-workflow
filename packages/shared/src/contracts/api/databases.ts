import { z } from 'zod';
import { dbTlsModeSchema, dbTypeSchema } from '../../enums/system.ts';

/** `db_connections` row (10) without its password: only the credentials module reads that (06 §11). */
export const dbConnectionSchema = z.object({
  id: z.string(),
  /** Unique: the AI's database tools name a connection by it (12 §6.9). */
  name: z.string(),
  type: dbTypeSchema,
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  tlsMode: dbTlsModeSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DbConnectionDTO = z.infer<typeof dbConnectionSchema>;

const fields = {
  name: z.string().trim().min(1),
  type: dbTypeSchema,
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1),
  username: z.string().trim().min(1),
  /** May be empty (a local server without a password). */
  password: z.string(),
  tlsMode: dbTlsModeSchema,
};

export const createDbConnectionRequestSchema = z.object(fields);
export type CreateDbConnectionRequest = z.infer<typeof createDbConnectionRequestSchema>;

/** `PATCH /db-connections/:id`: the password changes only when given. */
export const updateDbConnectionRequestSchema = z
  .object({ id: z.string(), ...fields })
  .partial()
  .required({ id: true });
export type UpdateDbConnectionRequest = z.infer<typeof updateDbConnectionRequestSchema>;

export const dbTestResultSchema = z.object({
  ok: z.boolean(),
  serverVersion: z.string().nullable(),
  /** The driver's message when the connection failed. */
  error: z.string().nullable(),
});
export type DbTestResultDTO = z.infer<typeof dbTestResultSchema>;

export const dbColumnSchema = z.object({
  name: z.string(),
  /** Full column type, e.g. `varchar(64)`. */
  type: z.string(),
  nullable: z.boolean(),
  /** `PRI`, `UNI`, `MUL`. */
  key: z.string().optional(),
  default: z.string().optional(),
  comment: z.string().optional(),
});
export type DbColumn = z.infer<typeof dbColumnSchema>;

export const dbTableSchema = z.object({
  name: z.string(),
  comment: z.string().optional(),
  /** The server's estimate. */
  rows: z.number().optional(),
});
export type DbTable = z.infer<typeof dbTableSchema>;

export const dbIndexSchema = z.object({ name: z.string(), columns: z.array(z.string()), unique: z.boolean() });
export type DbIndex = z.infer<typeof dbIndexSchema>;

/** `GET /db-connections/:id/schema`: tables with their columns, for browsing. */
export const dbSchemaSchema = z.object({ tables: z.array(dbTableSchema.extend({ columns: z.array(dbColumnSchema) })) });
export type DbSchemaDTO = z.infer<typeof dbSchemaSchema>;

/** `PUT /projects/:id/db-connections` (11 §3): replaces the project's connections. */
export const setProjectDbConnectionsRequestSchema = z.object({ id: z.string(), connectionIds: z.array(z.string()) });
