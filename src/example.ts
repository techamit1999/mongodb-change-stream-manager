import { ChangeStreamManager, TrackingConfig, ManagerOptions } from './index';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'your_database';

const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'key', 'auth'];

const TRACKING_CONFIG: TrackingConfig = {
  users: ['name', 'email', 'role'],
  orders: [], // track all fields
};

const OPTIONS: ManagerOptions = {
  maxReconnectAttempts: 10,
  reconnectDelay: 3000,
  maxObjectDepth: 5,
  healthCheckInterval: 60000,
};

async function main() {
  try {
    const manager = new ChangeStreamManager(
      MONGO_URL,
      DB_NAME,
      TRACKING_CONFIG,
      SENSITIVE_FIELDS,
      OPTIONS
    );

    await manager.initialize();
    console.log('Change stream manager initialized successfully');
  } catch (error) {
    console.error('Failed to initialize change stream manager:', error);
    process.exit(1);
  }
}

main();