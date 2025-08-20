# API Documentation

## Base URL
```
http://localhost:5000/api
```

## Authentication
All protected endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <access_token>
```

## Response Format
All API responses follow this structure:
```json
{
  "success": boolean,
  "message": "string (optional)",
  "data": object | array,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description",
    "details": "Additional error details",
    "timestamp": "ISO 8601 timestamp",
    "requestId": "unique request identifier"
  }
}
```

## Rate Limiting
Different endpoints have different rate limits:
- **Authentication**: 5 requests/minute per IP
- **Device Operations**: 100 requests/minute per user
- **Analytics**: 50 requests/minute per user
- **Exports**: 10 requests/hour per user

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1640995200
```

---

## Authentication Endpoints

### POST /auth/signup
Register a new user account.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "user" // optional, defaults to "user"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user"
    }
  }
}
```

### POST /auth/login
Authenticate user and receive tokens.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token",
    "user": {
      "id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user",
      "lastLoginAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

### POST /auth/refresh
Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "jwt_refresh_token"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Tokens refreshed successfully",
  "data": {
    "accessToken": "new_jwt_access_token",
    "refreshToken": "new_jwt_refresh_token",
    "user": {
      "id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user"
    }
  }
}
```

### POST /auth/logout
Logout and blacklist tokens.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**
```json
{
  "refreshToken": "jwt_refresh_token" // optional
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### POST /auth/logout-all
Logout from all devices and revoke all tokens.

**Headers:** `Authorization: Bearer <access_token>`

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out from all devices successfully",
  "data": {
    "revokedTokens": 3
  }
}
```

---

## Device Management

### GET /devices
List user's devices with optional filtering.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**
- `type` (string): Filter by device type
- `status` (string): Filter by status (active/inactive)
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 10, max: 100)

**Response (200):**
```json
{
  "success": true,
  "devices": [
    {
      "id": "device_id",
      "name": "Smart Thermostat",
      "type": "thermostat",
      "status": "active",
      "last_active_at": "2024-01-01T00:00:00Z",
      "owner_id": "user_id",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### POST /devices
Register a new device.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**
```json
{
  "name": "Smart Thermostat",
  "type": "thermostat",
  "status": "active" // optional, defaults to "active"
}
```

**Response (201):**
```json
{
  "success": true,
  "device": {
    "id": "device_id",
    "name": "Smart Thermostat",
    "type": "thermostat",
    "status": "active",
    "owner_id": "user_id",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### PATCH /devices/:id
Update device information.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**
```json
{
  "name": "Updated Device Name", // optional
  "type": "sensor", // optional
  "status": "inactive" // optional
}
```

**Response (200):**
```json
{
  "success": true,
  "device": {
    "id": "device_id",
    "name": "Updated Device Name",
    "type": "sensor",
    "status": "inactive",
    "owner_id": "user_id",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### DELETE /devices/:id
Delete a device.

**Headers:** `Authorization: Bearer <access_token>`

**Response (200):**
```json
{
  "success": true,
  "message": "Device deleted successfully"
}
```

### POST /devices/:id/heartbeat
Send device heartbeat to update last active time.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**
```json
{
  "status": "active" // required
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Device heartbeat recorded",
  "data": {
    "deviceId": "device_id",
    "status": "active",
    "last_active_at": "2024-01-01T00:00:00Z"
  }
}
```

---

## Logging & Analytics

### POST /devices/:id/logs
Create a new device log entry.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**
```json
{
  "event": "temperature_reading",
  "value": 23.5
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "log": {
      "id": "log_id",
      "device_id": "device_id",
      "event": "temperature_reading",
      "value": 23.5,
      "timestamp": "2024-01-01T00:00:00Z"
    }
  }
}
```

### GET /devices/:id/logs
Get device logs with pagination.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**
- `limit` (number): Number of logs to return (default: 10, max: 100)
- `page` (number): Page number (default: 1)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "log_id",
        "device_id": "device_id",
        "event": "temperature_reading",
        "value": 23.5,
        "timestamp": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalLogs": 50,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### GET /devices/:id/usage
Get device usage statistics.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**
- `range` (string): Time range (e.g., "24h", "7d", "30d")

**Response (200):**
```json
{
  "success": true,
  "data": {
    "device_id": "device_id",
    "device_name": "Smart Thermostat",
    "range": "24h",
    "summary": {
      "total_units": 1250.5,
      "average_per_log": 25.01,
      "log_count": 50
    },
    "trend": [
      {
        "hour": 0,
        "usage": 120.5,
        "average": 24.1
      }
    ]
  }
}
```

### GET /analytics/dashboard
Get comprehensive analytics dashboard.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**
- `range` (string): Time range (default: "24h")

**Response (200):**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalDevices": 5,
      "activeDevices": 4,
      "totalLogs": 1250,
      "recentLogs": 150,
      "totalUsage": 5000.5,
      "range": "24h"
    },
    "deviceBreakdown": [
      {
        "deviceId": "device_id",
        "deviceName": "Smart Thermostat",
        "deviceType": "thermostat",
        "logCount": 50,
        "totalUsage": 1250.5,
        "lastActivity": "2024-01-01T00:00:00Z"
      }
    ],
    "usageTrend": [
      {
        "timestamp": "2024-01-01T00:00:00Z",
        "usage": 120.5,
        "logCount": 5
      }
    ],
    "eventDistribution": [
      {
        "event": "temperature_reading",
        "count": 100,
        "totalValue": 2500.5
      }
    ]
  }
}
```

---

## Data Export

### POST /export/jobs
Create a new export job.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**
```json
{
  "type": "logs", // "logs", "usage_report", "device_report"
  "format": "csv", // "csv", "json"
  "dateRange": {
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-01-31T23:59:59Z"
  },
  "filters": {
    "deviceIds": ["device_id1", "device_id2"], // optional
    "eventTypes": ["temperature_reading"], // optional
    "includeInactive": false // optional
  }
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Export job created successfully",
  "data": {
    "jobId": "job_id",
    "status": "pending",
    "type": "logs",
    "format": "csv",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### GET /export/jobs
List user's export jobs.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 10, max: 50)
- `status` (string): Filter by status
- `type` (string): Filter by export type

**Response (200):**
```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "jobId": "job_id",
        "status": "completed",
        "type": "logs",
        "progress": {
          "percentage": 100,
          "currentStep": "completed",
          "processedRecords": 1000,
          "totalRecords": 1000
        },
        "result": {
          "fileName": "device-logs-2024-01-01.csv",
          "fileSize": 1024000,
          "recordCount": 1000,
          "downloadCount": 2
        },
        "createdAt": "2024-01-01T00:00:00Z",
        "completedAt": "2024-01-01T00:05:00Z",
        "duration": 300
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 3,
      "totalJobs": 25,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### GET /export/jobs/:id
Get export job status and details.

**Headers:** `Authorization: Bearer <access_token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_id",
    "status": "processing",
    "type": "logs",
    "progress": {
      "percentage": 75,
      "currentStep": "processing_data",
      "processedRecords": 750,
      "totalRecords": 1000
    },
    "result": null,
    "error": null,
    "createdAt": "2024-01-01T00:00:00Z",
    "completedAt": null,
    "duration": null
  }
}
```

### GET /export/jobs/:id/download
Download completed export file.

**Headers:** `Authorization: Bearer <access_token>`

**Response (200):**
- Content-Type: `text/csv` or `application/json`
- Content-Disposition: `attachment; filename="export-file.csv"`
- File content as response body

---

## Real-time Communication

### Server-Sent Events (SSE)

#### GET /sse/events
Establish SSE connection for real-time updates.

**Query Parameters:**
- `token` (string): JWT access token for authentication

**Response:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 1
event: connected
data: {"message":"Connected to SSE stream","userId":"user_id","timestamp":"2024-01-01T00:00:00Z"}

id: 2
event: device-update
data: {"deviceId":"device_id","status":"active","type":"device_status_update","timestamp":"2024-01-01T00:00:00Z"}

id: 3
event: device-heartbeat
data: {"deviceId":"device_id","timestamp":"2024-01-01T00:00:00Z","type":"device_heartbeat"}

id: 4
event: notification
data: {"type":"export_completed","message":"Your export is ready","timestamp":"2024-01-01T00:00:00Z"}
```

### WebSocket

#### Connection
```javascript
const socket = io('http://localhost:5000', {
  auth: {
    token: 'your_jwt_access_token'
  }
});
```

#### Events

**Client to Server:**
```javascript
// Join organization room
socket.emit('join-organization', { organizationId: 'org123' });

// Leave organization room
socket.emit('leave-organization', { organizationId: 'org123' });

// Subscribe to device updates
socket.emit('device-status-request', { deviceId: 'device123' });
```

**Server to Client:**
```javascript
// Connection confirmation
socket.on('connected', (data) => {
  // { message, userId, socketId, timestamp }
});

// Device status update
socket.on('device-update', (data) => {
  // { deviceId, status, type, timestamp }
});

// Device heartbeat
socket.on('device-heartbeat', (data) => {
  // { deviceId, timestamp, type }
});

// Notifications
socket.on('notification', (data) => {
  // { type, message, timestamp, ...additionalData }
});

// Room confirmations
socket.on('joined-organization', (data) => {
  // { organizationId }
});

socket.on('subscribed-device', (data) => {
  // { deviceId }
});
```

---

## Monitoring & Health

### GET /health
Get system health status.

**Response (200/503):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-01T00:00:00Z",
    "uptime": 3600,
    "dependencies": {
      "mongodb": "connected",
      "redis": "connected",
      "queue": "active"
    }
  }
}
```

### GET /metrics
Get system performance metrics.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**
- `startDate` (string): Start date for metrics
- `endDate` (string): End date for metrics
- `endpoint` (string): Filter by specific endpoint

**Response (200):**
```json
{
  "success": true,
  "data": {
    "requests": {
      "total": 10000,
      "last24h": 2400
    },
    "responseTime": {
      "avg": 120,
      "p50": 100,
      "p95": 250,
      "p99": 500
    },
    "statusCodes": {
      "200": 8500,
      "400": 800,
      "401": 500,
      "500": 200
    },
    "cache": {
      "hitRate": 0.85,
      "missRate": 0.15
    },
    "slowEndpoints": [
      {
        "endpoint": "GET /api/analytics/dashboard",
        "avgResponseTime": 250,
        "requestCount": 150
      }
    ]
  }
}
```

---

## Error Codes

### Authentication Errors
- `AUTH_ERROR`: General authentication failure
- `TOKEN_EXPIRED`: Access token has expired
- `TOKEN_REVOKED`: Token has been revoked/blacklisted
- `INVALID_TOKEN`: Token format is invalid
- `INVALID_CREDENTIALS`: Wrong email/password
- `ACCOUNT_LOCKED`: Account temporarily locked
- `MISSING_REFRESH_TOKEN`: Refresh token not provided
- `INVALID_REFRESH_TOKEN`: Refresh token is invalid/expired

### Validation Errors
- `VALIDATION_ERROR`: Request data validation failed
- `INVALID_DATE_RANGE`: Date range is invalid
- `INVALID_ID`: Object ID format is invalid
- `EMAIL_ALREADY_EXISTS`: Email is already registered
- `DUPLICATE_ENTRY`: Duplicate data detected

### Resource Errors
- `NOT_FOUND`: Requested resource not found
- `DEVICE_NOT_FOUND`: Device not found or access denied
- `USER_NOT_FOUND`: User not found
- `JOB_NOT_FOUND`: Export job not found
- `EXPORT_NOT_FOUND`: Export file not found

### Rate Limiting Errors
- `RATE_LIMIT_EXCEEDED`: General rate limit exceeded
- `AUTH_RATE_LIMIT_EXCEEDED`: Authentication rate limit exceeded
- `DEVICE_RATE_LIMIT_EXCEEDED`: Device operations rate limit exceeded
- `ANALYTICS_RATE_LIMIT_EXCEEDED`: Analytics rate limit exceeded
- `EXPORT_RATE_LIMIT_EXCEEDED`: Export rate limit exceeded

### System Errors
- `INTERNAL_SERVER_ERROR`: Unexpected server error
- `DATABASE_ERROR`: Database operation failed
- `CACHE_ERROR`: Cache operation failed
- `QUEUE_ERROR`: Job queue operation failed
- `EXPORT_ERROR`: Export processing failed

---

## Postman Collection

A comprehensive Postman collection is available with example requests for all endpoints. Import the collection and set up the following environment variables:

- `baseUrl`: http://localhost:5000/api
- `accessToken`: Your JWT access token
- `refreshToken`: Your JWT refresh token
- `deviceId`: A valid device ID
- `userId`: Your user ID

The collection includes:
- Pre-request scripts for token management
- Test scripts for response validation
- Environment variable automation
- Example requests with sample data