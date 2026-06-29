# API Reference

**Last verified:** June 30, 2026

Base URL: `http://localhost:4000` (development)

All `/api/*` routes return JSON. Errors use `{ "error": "message" }`.

**Auth legend:**

| Symbol | Meaning |
|--------|---------|
| — | Public (no auth) |
| Auth | `requireAuth` — valid session token required |
| Role | Additional dashboard role check |

Tokens are sent via `Authorization: Bearer <token>` or the `session_token` cookie.

For setup, see [SETUP.md](./SETUP.md) or [README.md](../README.md). Endpoint details below.

---

## Health and static

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Health check (`status`, `uptime`, `timestamp`) |
| GET | `/` | — | Plain-text hello |
| GET | `/uploads/avatars/:filename` | — | Serve avatar image (placeholder if missing) |
| GET | `/uploads/*` | — | Static uploaded files |

---

## Auth — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | — | Register new account (rate limited) |
| POST | `/login` | — | Email/password login (rate limited) |
| POST | `/logout` | — | End session |
| POST | `/verify-email` | — | Verify email with token |
| POST | `/resend-verification` | — | Resend verification email (rate limited) |
| GET | `/me` | Auth | Current authenticated user |
| POST | `/change-password` | Auth | Change password |
| POST | `/forgot-password` | — | Request password reset email (rate limited) |
| POST | `/reset-password` | — | Reset password with token |
| POST | `/oauth` | — | Initiate OAuth redirect |
| GET | `/google/callback` | — | Google OAuth callback |

**Web wrapper:** [lib/api/auth.ts](../../research-pipeline-web/lib/api/auth.ts)

---

## Users — `/api/users`

All routes require auth.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/search` | Search users |
| GET | `/me` | Current user profile |
| GET | `/me/exists` | Check if profile exists |
| GET | `/me/role` | Current user role |
| PATCH | `/me` | Update current user |
| POST | `/complete-profile` | Complete onboarding profile |
| GET | `/:userId` | Get user by ID |

**Web wrapper:** [lib/api/users.ts](../../research-pipeline-web/lib/api/users.ts)

---

## User profile — `/api/user`

All routes require auth.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/profile` | Get profile |
| PATCH | `/profile` | Update profile |
| GET | `/notification-preferences` | Get notification preferences |
| PATCH | `/notification-preferences` | Update notification preferences |
| GET | `/display-preferences` | Get display preferences |
| PATCH | `/display-preferences` | Update display preferences |
| POST | `/avatar` | Upload avatar (multipart) |

**Web wrapper:** [lib/api/users.ts](../../research-pipeline-web/lib/api/users.ts)

---

## Upload — `/api/upload`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/avatar` | Auth | Upload avatar (multipart) |
| POST | `/avatar-cropped` | Auth | Upload cropped avatar (base64 JSON) |

**Web wrapper:** [lib/api/upload.ts](../../research-pipeline-web/lib/api/upload.ts)

---

## Projects — `/api/projects`

All routes require auth unless noted.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/` | Auth | Create project (multipart document upload) |
| POST | `/join` | Auth | Join project by code |
| GET | `/code/:code` | Auth | Look up project by code |
| GET | `/invitations` | Auth | List pending invitations |
| POST | `/invitations/:invitationId/respond` | Auth | Accept or decline invitation |
| GET | `/` | Auth | List user's projects |
| GET | `/advised/stats` | adviser | Adviser project statistics |
| GET | `/advised` | adviser | List advised projects |
| GET | `/:id` | Auth | Get project by ID |
| GET | `/:id/members` | Auth | List project members |
| GET | `/:id/meetings` | Auth | List project meetings |
| GET | `/:id/files` | Auth | List project files |
| GET | `/:id/invitations` | Auth | List project invitations |
| DELETE | `/:id/members/:memberId` | Auth | Remove member |
| POST | `/:id/invite` | Auth | Invite user to project |
| POST | `/:id/join-requests/:memberId/respond` | Auth | Approve/reject join request |
| POST | `/:id/find-related-studies` | Auth | RRL keyword search |
| GET | `/:id/cross-reference` | Auth | Cross-reference studies |
| PATCH | `/:id/keywords` | Auth | Update project keywords |
| POST | `/:id/schedule` | Auth | Schedule defense for project |
| PATCH | `/:id/status` | Auth | Update project status |
| PATCH | `/:id/details` | Auth | Update project details |
| PATCH | `/:id/abstract` | Auth | Update project abstract |
| POST | `/:id/leave` | Auth | Leave project |
| POST | `/:id/transfer-leadership` | Auth | Transfer group leadership |
| POST | `/:id/transfer-leadership/revert` | Auth | Revert leadership transfer |
| POST | `/:id/transfer-main-adviser` | Auth | Transfer main adviser |
| POST | `/:id/transfer-main-adviser/revert` | Auth | Revert main adviser transfer |
| DELETE | `/:id` | Auth | Delete project |
| GET | `/:id/review-request` | Auth | Get active review request |
| POST | `/:id/review-request/withdraw` | Auth | Withdraw review request |
| PATCH | `/:id/review-request/complete` | Auth | Complete review request |

**Web wrapper:** [lib/api/projects.ts](../../research-pipeline-web/lib/api/projects.ts), [paperReviews.ts](../../research-pipeline-web/lib/api/paperReviews.ts)

### Paper versions — `/api/projects/:id/paper-versions`

Nested under projects. All routes require auth.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List paper versions |
| POST | `/` | Upload new version (multipart) |
| POST | `/generate` | Generate version |
| POST | `/:versionId/request-review` | Request adviser review |
| GET | `/:versionId/download` | Download version file |
| GET | `/:versionId/diff` | Diff between versions |

**Web wrapper:** [lib/api/paperVersions.ts](../../research-pipeline-web/lib/api/paperVersions.ts)

### Paper comments — `/api/projects/:id/paper-comments`

Nested under projects. All routes require auth.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/summary` | Comment summary |
| GET | `/` | List comments |
| POST | `/` | Create comment |
| PATCH | `/:commentId` | Update comment |
| POST | `/:commentId/resolve` | Resolve comment |
| POST | `/:commentId/request-revision` | Request revision on comment |
| POST | `/:commentId/reopen` | Reopen comment |
| DELETE | `/:commentId` | Delete comment |

**Web wrapper:** [lib/api/paperComments.ts](../../research-pipeline-web/lib/api/paperComments.ts)

---

## Defenses — `/api/defenses`

All routes require auth unless noted.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/` | adviser | Create defense |
| POST | `/propose` | adviser | Propose defense schedule |
| GET | `/recordings/mine` | Auth | List user's recordings |
| GET | `/me` | Auth | List user's defenses |
| GET | `/my-projects` | Auth | Defenses for user's projects |
| GET | `/project/:projectId` | Auth | Meetings for a project |
| GET | `/:id/meeting-session` | Auth | Jitsi meeting session details |
| GET | `/:id/meeting-grades` | Auth | Meeting grades |
| PUT | `/:id/panel-evaluations` | Auth | Submit panel evaluations |
| GET | `/:id/transcription/download` | Auth | Download transcription |
| GET | `/:id/transcription` | Auth | Get transcription |
| GET | `/:id/recordings` | Auth | List defense recordings |
| POST | `/:id/recordings/start` | Auth | Start recording |
| POST | `/:id/recordings/:recordingId/complete` | Auth | Complete recording (multipart upload) |
| POST | `/:id/recordings/:recordingId/transcribe` | Auth | Transcribe recording |
| GET | `/:id/recordings/:recordingId` | Auth | Recording detail |
| PATCH | `/:id/recordings/:recordingId` | Auth | Update recording metadata |
| DELETE | `/:id/recordings/:recordingId` | Auth | Soft-delete recording |
| PATCH | `/:id/recordings/:recordingId/restore` | Auth | Restore deleted recording |
| DELETE | `/:id/recordings/:recordingId/purge` | Auth | Permanently purge recording |
| GET | `/:id/recordings/:recordingId/transcription-edit` | Auth | Get editable transcription |
| PUT | `/:id/recordings/:recordingId/transcription-edit` | Auth | Save transcription edits |
| POST | `/:id/recordings/:recordingId/transcription-edit/merge` | Auth | Merge transcription lines |
| POST | `/:id/recordings/:recordingId/transcription-edit/assign` | Auth | Assign speaker to line |
| GET | `/:id/recordings/:recordingId/transcription-edit/download` | Auth | Download edited transcription |
| GET | `/:id` | Auth | Get defense/meeting by ID |
| PATCH | `/:id` | adviser | Update meeting |
| PATCH | `/:id/complete` | adviser | Mark meeting complete |
| PATCH | `/:id/restore` | adviser | Restore meeting |
| PATCH | `/:id/cancel` | adviser | Cancel defense |
| PATCH | `/:id/reschedule` | adviser | Reschedule defense |

**Web wrapper:** [lib/api/defenses.ts](../../research-pipeline-web/lib/api/defenses.ts), [recordings.ts](../../research-pipeline-web/lib/api/recordings.ts), [transcriptions.ts](../../research-pipeline-web/lib/api/transcriptions.ts)

---

## Schedule — `/api/schedule`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/me` | Auth | Current user's schedule |

**Web wrapper:** [lib/api/schedule.ts](../../research-pipeline-web/lib/api/schedule.ts)

---

## Notifications — `/api/notifications`

All routes require auth.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List notifications |
| PATCH | `/read-all` | Mark all as read |
| PATCH | `/:id/read` | Mark one as read |

**Web wrapper:** [lib/api/notifications.ts](../../research-pipeline-web/lib/api/notifications.ts)

---

## Coordinator — `/api/coordinator`

All routes require auth + coordinator role.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard` | Coordinator dashboard stats |
| GET | `/institution` | Institution details |
| GET | `/institution/advisers` | List institution advisers |
| GET | `/institution/panelists` | List panelists |
| POST | `/institution/advisers` | Add adviser to institution |
| DELETE | `/institution/advisers/:adviserId` | Remove adviser from institution |
| GET | `/courses` | List courses |
| GET | `/courses/:courseId/groups` | Groups in a course |
| POST | `/courses` | Create course |
| PUT | `/courses/:courseId` | Update course |
| DELETE | `/courses/:courseId` | Delete course |
| DELETE | `/courses/:courseId/advisers/:adviserId` | Remove adviser from course |
| GET | `/defenses` | List all defenses |
| GET | `/defenses/pending` | List pending defenses |
| POST | `/defenses/book` | Book defense schedule |
| POST | `/defenses/:defenseId/verify` | Approve defense |
| POST | `/defenses/:defenseId/reject` | Reject defense |
| PATCH | `/defenses/:defenseId/venue` | Set defense venue |
| DELETE | `/defenses/:defenseId` | Delete defense |
| PATCH | `/defenses/:defenseId/cancel` | Cancel defense |
| PATCH | `/defenses/:defenseId/complete` | Complete defense |
| PATCH | `/defenses/:defenseId/revert` | Revert defense status |
| POST | `/courses/:courseId/defenses` | Create defenses for course |
| GET | `/projects` | Institution projects |
| GET | `/projects/by-adviser` | Projects grouped by adviser |
| GET | `/rubrics` | List rubrics |
| GET | `/rubrics/:rubricId` | Get rubric |
| POST | `/rubrics` | Create rubric |
| PUT | `/rubrics/:rubricId` | Update rubric |
| DELETE | `/rubrics/:rubricId` | Delete rubric |
| GET | `/sections` | List institution sections |
| POST | `/sections` | Create section |
| PUT | `/sections/:sectionId` | Update section |
| DELETE | `/sections/:sectionId` | Delete section |
| GET | `/events` | List institution events |
| POST | `/events` | Create event |
| PATCH | `/events/:eventId` | Update event |
| PATCH | `/events/:eventId/complete` | Mark event complete |
| PATCH | `/events/:eventId/cancel` | Cancel event |
| PATCH | `/events/:eventId/revert` | Revert event status |

**Web wrapper:** [lib/api/coordinator.ts](../../research-pipeline-web/lib/api/coordinator.ts), [events.ts](../../research-pipeline-web/lib/api/events.ts)

---

## Adviser — `/api/adviser`

All routes require auth + adviser role.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rubrics` | List rubrics |
| GET | `/pending-reviews` | List pending paper reviews |
| GET | `/rubrics/:rubricId` | Get rubric |
| POST | `/rubrics` | Create rubric |
| PUT | `/rubrics/:rubricId` | Update rubric |
| DELETE | `/rubrics/:rubricId` | Delete rubric |

**Web wrapper:** [lib/api/adviser.ts](../../research-pipeline-web/lib/api/adviser.ts)

---

## Admin — `/api/admin`

All routes require auth + admin role.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | List users (search/filter) |
| GET | `/users/:userId` | Get user detail |
| PATCH | `/users/:userId` | Update user role, institution, status |
| GET | `/audit-log` | System and project audit log |
| GET | `/institutions` | List institutions |
| POST | `/institutions` | Create institution |
| PATCH | `/institutions/:institutionId` | Update institution |
| GET | `/institutions/:institutionId/programs` | List programs |
| POST | `/institutions/:institutionId/programs` | Create program |
| PATCH | `/institutions/:institutionId/programs/:programId` | Update program |

**Web wrapper:** [lib/api/admin.ts](../../research-pipeline-web/lib/api/admin.ts)

---

## Institutions — `/api/institutions`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/search` | — | Search institutions (registration) |
| GET | `/me/courses` | Auth | Current user's institution courses |
| GET | `/me/programs` | Auth | Current user's institution programs |
| GET | `/me/sections` | Auth | Current user's institution sections |

**Web wrapper:** [lib/api/institutions.ts](../../research-pipeline-web/lib/api/institutions.ts)

---

## Public — `/api/public`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/stats` | — | Public platform statistics |
| GET | `/config` | — | Public configuration |

---

## Mic — `/api/mic`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/audio` | Auth | Upload mic audio chunk (multipart) |

---

## File operations — `/api/file-operations`

Also mounted at `/api` with the same routes. All require auth.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Write file to volume |
| GET | `/file/:filename` | Read file contents |
| GET | `/files` | List files in volume |

---

## Maintenance

When adding routes:

1. Create or update `*.routes.js` in `src/modules/<domain>/`
2. Register the router in [src/app.js](../src/app.js) if new
3. Add a wrapper in the frontend repo (`research-pipeline-web/lib/api/`) if the web app needs it
4. Update this document in the same pull request
