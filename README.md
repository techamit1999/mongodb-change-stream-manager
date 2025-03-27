# MongoDB Change Stream Manager

A robust MongoDB change stream manager with audit logging capabilities.

## Installation

npm install mongodb-change-stream-manager

## Usage

javascript
import ChangeStreamManager from 'mongodb-change-stream-manager';
const SENSITIVE_FIELDS = ['password', 'token', 'secret'];
const TRACKING_CONFIG = {
users: ['name', 'email'],
orders: [] // track all fields
};

const manager = new ChangeStreamManager(
'mongodb://localhost:27017',
'your_database',
TRACKING_CONFIG,
SENSITIVE_FIELDS
);

await manager.initialize();


## Features

- Automatic change stream management
- Audit logging with sensitive data protection
- Configurable field tracking
- Automatic reconnection handling
- Health checks
- Pre and post image capture support

## Configuration

...

## API Reference

...

## License

MIT