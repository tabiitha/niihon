/**
 * Entries the server keeps in its data directory (`NIHON_DATA_DIR`). The names are fixed, not
 * configuration: a module that stores a file there declares its name here.
 */
export const dataDirEntries = {
  /** SQLite database, with its `-wal` and `-shm` companions while the server runs. */
  database: 'nihon.db',
  /** Directory of the snapshots taken before migrations. */
  snapshots: 'snapshots',
  /** Lock proving that one server owns the directory. */
  instanceLock: 'nihon-instance.lock',
  /** Secret of the installation that keys the fingerprints of idempotent commands. */
  commandKey: 'nihon-command.key',
} as const;
