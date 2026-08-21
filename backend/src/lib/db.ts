import postgres from 'postgres';
import { config } from '~/config';

// Single shared Postgres client (postgres.js is a connection pool internally).
export const sql = postgres(config.databaseUrl, {
  ssl: 'require',
  connect_timeout: 10,
  idle_timeout: 20,
});

// Accepted by any model/helper method that wants to participate in a
// caller's transaction. Callers pass the top-level `sql` for standalone
// use or a `tx` handle from inside `sql.begin(...)`.
export type Db = postgres.Sql<{}> | postgres.TransactionSql<{}>;
