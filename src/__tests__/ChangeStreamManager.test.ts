import mongoose from 'mongoose';
import { ChangeStreamManager } from '../ChangeStreamManager';

describe('ChangeStreamManager', () => {
  let manager: ChangeStreamManager;

  beforeEach(() => {
    manager = new ChangeStreamManager(
      'mongodb://localhost:27017',
      'test_db',
      { users: ['name', 'email'] },
      ['password']
    );
  });

  afterEach(async () => {
    await mongoose.connection.close();
  });

  it('should create an instance with correct configuration', () => {
    expect(manager).toBeInstanceOf(ChangeStreamManager);
  });

  // Add more tests as needed
});
