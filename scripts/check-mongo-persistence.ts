import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import { createPersistence } from "../src/infrastructure/persistence/createPersistence.js";

const config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.Mongo) {
  throw new Error("db:check 仅允许在 PERSISTENCE_DRIVER=mongo 时运行");
}
assertPersistenceReady(config);

const persistence = await createPersistence(config);
try {
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    driver: config.persistenceDriver,
    database: config.cloudDatabaseName,
    indexesEnsured: true,
  })}\n`);
} finally {
  await persistence.close();
}
