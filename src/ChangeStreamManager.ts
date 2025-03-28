import mongoose, { Connection, Model, Schema } from 'mongoose';
import { createHash } from 'crypto';
import { ObjectId, ChangeStream, Admin } from 'mongodb';
import {
  TrackingConfig,
  AuditLogDocument,
  ManagerOptions,
  MongoConnectionOptions,
} from './types';

/**
 * Manages MongoDB change streams with audit logging capabilities
 * @class ChangeStreamManager
 */
export class ChangeStreamManager {
  private static readonly DEFAULT_OPTIONS: Required<ManagerOptions> = {
    maxReconnectAttempts: 5,
    reconnectDelay: 5000,
    maxObjectDepth: 10,
    healthCheckInterval: 30000,
  };

  private readonly options: Required<ManagerOptions>;
  private reconnectAttempts: number = 0;
  private changeStream: ChangeStream | null = null;
  private auditLogModel: Model<AuditLogDocument> | null = null;

  /**
   * Creates an instance of ChangeStreamManager
   * @param mongoUrl - MongoDB connection string
   * @param dbName - Target database name
   * @param trackingConfig - Configuration for field tracking
   * @param sensitiveFields - List of fields to be hashed
   * @param options - Manager configuration options
   */
  constructor(
    private readonly mongoUrl: string,
    private readonly dbName: string,
    private readonly trackingConfig: TrackingConfig = {},
    private readonly sensitiveFields: string[] = [],
    options: ManagerOptions = {}
  ) {
    this.options = { ...ChangeStreamManager.DEFAULT_OPTIONS, ...options };
    this.processChange = this.processChange.bind(this);
    this.handleChangeStreamError = this.handleChangeStreamError.bind(this);
  }

  /**
   * Initializes the manager and starts monitoring
   * @throws {Error} If initialization fails
   */
  public async initialize(): Promise<void> {
    await this.connectDB();
    this.initializeAuditLogModel();
    await this.startChangeStream();
    this.setupEventListeners();
  }

  /**
   * Establishes MongoDB connection with retry mechanism
   * @private
   */
  private async connectDB(): Promise<void> {
    try {
      const options: MongoConnectionOptions = {
        serverSelectionTimeoutMS: 5000,
        heartbeatFrequencyMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 1,
        maxIdleTimeMS: 30000,
      };

      await mongoose.connect(this.mongoUrl, { dbName: this.dbName, ...options });
      console.log('MongoDB connected successfully');
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      if (++this.reconnectAttempts >= this.options.maxReconnectAttempts) {
        throw new Error(`Max reconnection attempts (${this.options.maxReconnectAttempts}) reached`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.reconnectDelay));
      return this.connectDB();
    }
  }

  /**
   * Initializes the audit log model schema
   * @private
   */
  private initializeAuditLogModel(): void {
    const auditLogSchema = new Schema<AuditLogDocument>(
      {
        timestamp: { type: Date, required: true, index: true },
        operationType: { 
          type: String, 
          required: true, 
          enum: ['insert', 'update', 'delete'] 
        },
        collectionName: { type: String, required: true, index: true },
        documentKey: { type: Schema.Types.Mixed, required: true },
        oldValue: {
          type: Schema.Types.Mixed,
          set: (value: any) => this.sanitizeAndHashSensitiveData(value),
        },
        newValue: {
          type: Schema.Types.Mixed,
          set: (value: any) => this.sanitizeAndHashSensitiveData(value),
        },
        updateDescription: Schema.Types.Mixed,
        checksum: String,
      },
      {
        collection: 'audit_logs',
        timestamps: true,
        strict: true,
        validateBeforeSave: true,
      }
    );

    auditLogSchema.index({ collectionName: 1, timestamp: -1 });
    this.auditLogModel = mongoose.models.AuditLog || 
      mongoose.model<AuditLogDocument>('AuditLog', auditLogSchema);
  }

    /**
     * Determines if a field in a collection should be tracked
     * @private
     * @param collectionName - Name of the collection
     * @param fieldName - Name of the field
     * @returns boolean indicating if field should be tracked
    */
    private shouldTrack(collectionName: string, fieldName: string): boolean {
        if (Object.keys(this.trackingConfig).length === 0) return true;
        if (!(collectionName in this.trackingConfig)) return false;
        const fields = this.trackingConfig[collectionName];
        return fields.length === 0 || fields.includes(fieldName);
      }
    
      /**
       * Sanitizes and hashes sensitive data in objects
       * @private
       * @param obj - Object to sanitize
       * @returns Sanitized object with hashed sensitive fields
       */
      private sanitizeAndHashSensitiveData(obj: any): any {
        if (!obj || typeof obj !== 'object' || ObjectId.isValid(obj)) return obj;
    
        const sanitized = { ...obj };
        for (const [key, value] of Object.entries(sanitized)) {
          if (this.sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
            sanitized[key] = createHash('sha256').update(String(value)).digest('hex');
          } else if (typeof value === 'object') {
            sanitized[key] = this.sanitizeAndHashSensitiveData(value);
          }
        }
        return sanitized;
      }
    
      /**
       * Processes a change event from MongoDB
       * @private
       * @param change - Change event from MongoDB
       */
      private async processChange(change: any): Promise<void> {
        const { ns, operationType, fullDocument, fullDocumentBeforeChange, documentKey, updateDescription } = change;
        const collectionName = ns.coll;
    
        if (collectionName === 'audit_logs') return;
    
        const auditLog: Partial<AuditLogDocument> = {
          timestamp: new Date(),
          operationType: operationType as 'insert' | 'update' | 'delete',
          collectionName,
          documentKey,
          updateDescription: updateDescription || null,
        };
    
        switch (operationType) {
          case 'insert':
            auditLog.newValue = this.filterTrackedFields(fullDocument, collectionName);
            break;
          case 'update':
            auditLog.oldValue = this.filterTrackedFields(fullDocumentBeforeChange, collectionName);
            auditLog.newValue = this.filterTrackedFields(fullDocument, collectionName);
            break;
          case 'delete':
            auditLog.oldValue = this.filterTrackedFields(fullDocumentBeforeChange, collectionName);
            break;
          default:
            return;
        }
    
        auditLog.checksum = this.createChecksum(auditLog);
    
        try {
          await this.auditLogModel?.create(auditLog);
          console.log(`Change detected in ${auditLog.collectionName}:`, {
            operation: auditLog.operationType,
            documentId: auditLog?.documentKey?.['_id'],
            timestamp: auditLog.timestamp,
          });
        } catch (error) {
          console.error('Error saving audit log:', error);
        }
      }
    
      /**
       * Filters object fields based on tracking configuration
       * @private
       * @param obj - Object to filter
       * @param collectionName - Collection name for tracking config
       */
      private filterTrackedFields(obj: Record<string, any> | null, collectionName: string): Record<string, any> {
        if (!obj) return {};
        return Object.fromEntries(
          Object.entries(obj).filter(([key]) => this.shouldTrack(collectionName, key))
        );
      }
    
      /**
       * Creates a checksum for data integrity
       * @private
       * @param data - Data to create checksum for
       */
      private createChecksum(data: any): string {
        return createHash('sha256')
          .update(JSON.stringify(this.limitObjectDepth(data)))
          .digest('hex');
      }

        /**
   * Enables pre and post image capture for change streams
   * @private
   */
  private async enablePreAndPostImages(): Promise<void> {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const enablePromises = collections.map((collection) =>
      mongoose.connection.db
        .command({
          collMod: collection.name,
          changeStreamPreAndPostImages: { enabled: true },
        })
        .catch((err) => console.warn(`Skipping ${collection.name}: ${err.message}`))
    );

    await Promise.allSettled(enablePromises);
    console.log('Pre and post images configuration completed.');
  }

  /**
   * Initializes and manages the change stream
   * @private
   */
  private async startChangeStream(): Promise<void> {
    try {
      const adminDb: Admin = mongoose.connection.db.admin();
      const serverStatus = await adminDb.serverStatus();

      if (!serverStatus.repl) {
        console.error('MongoDB not running as replica set. Attempting to initiate...');
        try {
          await adminDb.command({ replSetInitiate: {} });
          console.log('Replica set initiated. Waiting for initialization...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (initError: any) {
          if (initError.codeName === 'AlreadyInitialized') {
            console.warn('Replica set is already initialized. Proceeding...');
          } else {
            throw initError;
          }
        }
      }

      await this.enablePreAndPostImages();

      if (this.changeStream) {
        await this.changeStream.close();
      }

      this.changeStream = mongoose.connection.db.watch([], {
        fullDocument: 'updateLookup',
        fullDocumentBeforeChange: 'whenAvailable',
      });

      console.log('Change stream started. Watching for database changes...');

      this.changeStream.on('change', this.processChange);
      this.changeStream.on('error', this.handleChangeStreamError);

      this.startHealthCheck();
    } catch (error) {
      console.error('Error starting change stream:', error);
      setTimeout(
        () => this.startChangeStream(),
        this.options.reconnectDelay
      );
    }
  }

  /**
   * Starts periodic health checks for MongoDB connection
   * @private
   */
  private startHealthCheck(): void {
    setInterval(async () => {
      if (mongoose.connection.readyState !== 1) {
        console.warn('MongoDB connection lost. Attempting to reconnect...');
        await this.startChangeStream();
      }
    }, this.options.healthCheckInterval);
  }

  /**
   * Handles errors from the change stream
   * @private
   * @param error - Error from change stream
   */
  private handleChangeStreamError(error: Error): void {
    console.error('Change stream error:', error);
    if (this.changeStream) {
      this.changeStream.close().catch(console.error);
    }
    setTimeout(
      () => this.startChangeStream(),
      this.options.reconnectDelay
    );
  }

  /**
   * Performs graceful shutdown of services
   * @private
   * @param signal - Signal that triggered shutdown
   */
  private async gracefulShutdown(signal: string): Promise<void> {
    console.log(`\n${signal} signal received. Starting graceful shutdown...`);
    try {
      if (this.changeStream) {
        await this.changeStream.close();
      }
      await mongoose.connection.close();
      console.log('MongoDB connection closed.');
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Sets up process event listeners for graceful shutdown
   * @private
   */
  private setupEventListeners(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach((signal) => {
      process.on(signal, () => this.gracefulShutdown(signal));
    });

    process.on('uncaughtException', (error: Error) => {
      console.error('Uncaught Exception:', error);
      this.gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.gracefulShutdown('UNHANDLED_REJECTION');
    });
  }

  /**
   * Limits object depth to prevent circular references
   * @private
   * @param obj - Object to limit depth
   * @param currentDepth - Current depth in object
   */
  private limitObjectDepth(obj: any, currentDepth: number = 0): any {
    if (
      !obj || 
      typeof obj !== 'object' || 
      currentDepth >= this.options.maxObjectDepth
    ) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.limitObjectDepth(item, currentDepth + 1));
    }

    return Object.keys(obj).reduce((acc: Record<string, any>, key: string) => {
      acc[key] = this.limitObjectDepth(obj[key], currentDepth + 1);
      return acc;
    }, {});
  }
}
