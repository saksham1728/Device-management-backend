// MongoDB initialization script
db = db.getSiblingDB('device_management');

// Create collections with validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'email', 'password'],
      properties: {
        name: { bsonType: 'string' },
        email: { bsonType: 'string' },
        password: { bsonType: 'string' },
        role: { enum: ['user', 'admin'] }
      }
    }
  }
});

db.createCollection('devices', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'type', 'owner_id'],
      properties: {
        name: { bsonType: 'string' },
        type: { bsonType: 'string' },
        status: { enum: ['active', 'inactive'] },
        owner_id: { bsonType: 'objectId' }
      }
    }
  }
});

db.createCollection('logs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['device_id', 'event', 'value'],
      properties: {
        device_id: { bsonType: 'objectId' },
        event: { bsonType: 'string' },
        value: { bsonType: 'number' }
      }
    }
  }
});

print('Database initialized successfully');