# API Documentation (Current Endpoints)

Base URL (local): `http://localhost:3000`

## Auth

All `/api/users/*` routes require authentication.

You can authenticate using either:
- `Authorization: Bearer <token>`
- `Cookie: session_token=<token>`

For local dev (`NODE_ENV !== production`), you can use:
- `x-user-id: <uuid>`

---

## 1) Health / Root

### `GET /`

Returns a plain text response.

**Response (200)**
```text
Hello World!
```

---

## 2) Users API

### `GET /api/users/me`

Get current authenticated user's profile.

**Request body:** none

**Response (200)**
```json
{
	"id": "ce1a7457-2a32-498d-ae68-a8a61560495e",
	"email": "test@example.com",
	"full_name": "Updated Test User",
	"avatar_url": null,
	"status": 1,
	"role": "student"
}
```

**Possible errors**
- `401` `{ "error": "Unauthorized" }`
- `404` `{ "error": "Profile not found" }`

---

### `GET /api/users/me/exists`

Check if current user profile exists.

**Request body:** none

**Response (200)**
```json
{
	"exists": true,
	"role": "student"
}
```

---

### `GET /api/users/me/role`

Get current user role.

**Request body:** none

**Response (200)**
```json
{
	"role": "student"
}
```

**Possible errors**
- `404` `{ "error": "Role not found" }`

---

### `PATCH /api/users/me`

Update current user profile.

**Request body (JSON)**
```json
{
	"full_name": "Updated Test User",
	"avatar_url": null
}
```

Both fields are optional, but at least one must be provided.

**Response (200)**
```json
{
	"id": "ce1a7457-2a32-498d-ae68-a8a61560495e",
	"email": "test@example.com",
	"full_name": "Updated Test User",
	"avatar_url": null,
	"status": 1,
	"role": "student"
}
```

**Possible errors**
- `400` `{ "error": "No supported fields to update" }`
- `400` `{ "error": "full_name must be between 2 and 80 characters" }`
- `404` `{ "error": "Profile not found" }`

---

### `POST /api/users/complete-profile`

Create or complete first-time profile setup.

**Request body (JSON)**
```json
{
	"displayName": "Test User",
	"role": "student",
	"email": "test@example.com",
	"avatarUrl": null,
	"googlePhotoUrl": null
}
```

`role` supports: `student`, `teacher`, `adviser` (`teacher` is mapped to `adviser`).

**Response (200)**
```json
{
	"success": true,
	"redirectPath": "/student"
}
```

**Possible errors**
- `400` `{ "error": "displayName must be between 2 and 80 characters", "success": false }`
- `400` `{ "error": "role must be one of: student, teacher, adviser", "success": false }`

---

### `GET /api/users/:userId`

Get a profile by user id.

**Important:** only allows fetching your own profile (`:userId` must equal authenticated user id).

**Request body:** none

**Response (200)**
```json
{
	"id": "ce1a7457-2a32-498d-ae68-a8a61560495e",
	"email": "test@example.com",
	"full_name": "Updated Test User",
	"avatar_url": null,
	"status": 1,
	"role": "student"
}
```

**Possible errors**
- `403` `{ "error": "Forbidden" }`
- `404` `{ "error": "Profile not found" }`

---

## 3) Global Error Shapes

- `404` fallback: `{ "error": "Not found" }`
- `500` fallback: `{ "error": "Internal server error" }`

