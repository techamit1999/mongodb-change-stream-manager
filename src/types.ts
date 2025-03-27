import { Document } from 'mongoose';

export interface TrackingConfig {
  [collectionName: string]: string[];
}

export interface AuditLogDocument extends Document {
  timestamp: Date;
  operationType: 'insert' | 'update' | 'delete';
  collectionName: string;
  documentKey: Record<string, any>;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  updateDescription?: Record<string, any>;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManagerOptions {
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  maxObjectDepth?: number;
  healthCheckInterval?: number;
}

export interface MongoConnectionOptions {
  serverSelectionTimeoutMS?: number;
  heartbeatFrequencyMS?: number;
  maxPoolSize?: number;
  minPoolSize?: number;
  maxIdleTimeMS?: number;
}