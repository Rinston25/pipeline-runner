# Pipeline Runner

Define task pipelines with dependencies, run them in parallel where possible, and watch progress live in the browser.

A pipeline is a directed graph of tasks. A task starts only once every task it depends on has succeeded; tasks that do not depend on each other run at the same time. Tasks are simulated: each one has a configurable duration and a "force failure" switch, so the scheduling and failure behaviour is easy to demonstrate.

## Run it

Requirements: Docker with Compose v2.

```sh
docker compose up --build
```

| What | Where |
| --- | --- |
| Web UI | http://localhost:3000 |
| API | http://localhost:3001 (`GET /health`) |

If port 3000 is already in use on your machine, pick another one for the UI:

```sh
WEB_PORT=3100 docker compose up --build
```

Stop with `Ctrl+C`; `docker compose down` removes the containers and `docker compose down -v` also deletes the stored data.

### Try it

1. Open the UI and click **New pipeline**, then **Load example** (a diamond: `checkout` -> `lint` and `unit-tests` in parallel -> `build` -> `deploy`).
2. Tick **Force failure** on `unit-tests` if you want to see the failure path.
3. Create the pipeline, click **Run pipeline**, and watch the run page: task statuses change as they happen, with no refresh.
4. Go back to the list to see each pipeline's latest status at a glance; the **Run** button there starts a run directly.

### Tests

The scheduling and validation logic is pure JavaScript with no database, so the tests need only Node 20+:

```sh
cd backend
npm install
npm test
```

They cover dependency ordering and cycle detection, parallel execution and the concurrency limit, and failure handling (skipping, unrelated branches, the final run status).

## Architecture

```
                     HTTP / JSON                      SQL
   Browser  <------------------------->  API  <------------------>  PostgreSQL
 (Nuxt SPA)    + SSE live event stream  (Fastify)                        ^
      ^                                    |  ^                          |
      |                                    |  | subscribe                | SQL
      |                       LPUSH run id |  | "events" channel         |
      |                                    v  |                          |
      |                                  Redis  <------------------>  Worker
      +--------------------------------  queue +   BRPOP run id,    (Node process)
                                        pub/sub    publish events
```

| Service | Role |
| --- | --- |
| `web` | Nuxt (Vue) single-page app. Talks to the API directly from the browser. |
| `api` | Fastify. Stores pipeline definitions, creates runs, serves run state, and streams events to browsers over SSE. |
| `worker` | Separate Node process. Pops run ids from Redis, executes the tasks, writes every state change to Postgres, publishes events. |
| `postgres` | Source of truth for pipelines, runs and per-task state. |
| `redis` | A FIFO list (`pipeline:run-queue`) of run ids waiting for a worker, and a pub/sub channel (`pipeline:events`) for change notifications. |
| `migrate` | One-shot job that applies SQL migrations before the API and worker start. |

The API and worker share one codebase (`backend/`) and one image but run as separate processes.

**Life of a run**

1. `POST /api/pipelines/:id/runs` inserts a `runs` row (`queued`) plus one `run_tasks` row per task (`pending`) in a single transaction, then pushes the run id onto the Redis queue.
2. A worker pops the id and atomically claims the run (`UPDATE ... WHERE status = 'queued'`), so a duplicate queue entry or a second worker cannot run it twice.
3. The scheduler (`backend/src/engine/scheduler.js`) starts every task whose dependencies have all succeeded, up to the concurrency limit, and starts more as tasks finish.
4. After each state change the worker writes to Postgres first and then publishes an event to Redis.
5. The API forwards events to browsers over SSE; the page reloads the affected pipeline/run from the API.

**Data model** (`backend/migrations/001_init.sql`): `pipelines`, `tasks`, `task_dependencies` (edges), `runs`, `run_tasks`. A run copies each task's name, duration and failure flag into `run_tasks`, so a run keeps describing exactly what was executed. Pipelines are immutable once created.

**Statuses**

- Run: `queued` -> `running` -> `success` | `failed`
- Task: `pending` -> `running` -> `success` | `failed`, or `pending` -> `skipped`

### API

| Method and path | Purpose |
| --- | --- |
| `POST /api/pipelines` | Create a pipeline: `{ name, tasks: [{ name, durationMs?, shouldFail?, dependsOn?: [taskName] }] }`. Returns 400 with a `details` list for cycles, unknown task references, duplicate names or self-dependencies; 409 for a duplicate pipeline name. |
| `GET /api/pipelines` | All pipelines with task count and latest run. |
| `GET /api/pipelines/:id` | One pipeline with its tasks and dependencies. |
| `POST /api/pipelines/:id/runs` | Queue a run (202). |
| `GET /api/pipelines/:id/runs` | Recent runs of a pipeline. |
| `GET /api/runs/:id` | A run with every task's status, start/finish time, duration and error (tasks listed in dependency order). |
| `GET /api/events` | Server-Sent Events stream of `run.updated` and `task.updated` events. |

### Configuration

Environment variables (defaults are set in `docker-compose.yml` and `backend/src/config.js`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `TASK_CONCURRENCY` | 3 | Max tasks of one run executing at once |
| `RUN_CONCURRENCY` | 2 | Max runs one worker executes at once |
| `HEARTBEAT_INTERVAL_MS` | 2000 | How often a worker refreshes the heartbeat of its runs |
| `STALE_RUN_AFTER_MS` | 15000 | A running run with an older heartbeat counts as abandoned |
| `RECOVERY_INTERVAL_MS` | 5000 | How often workers look for abandoned or un-enqueued runs |
| `WEB_PORT` | 3000 | Host port of the UI |

The Postgres password defaults to a local-development value (`POSTGRES_PASSWORD` overrides it); the database and Redis are not published to the host.

## Tradeoffs

### What happens after a task fails

- The failed task is recorded as `failed` with its error message, start/finish time and duration.
- Every task that directly or indirectly depends on it is marked `skipped`, with the reason ("Skipped because upstream task X failed"). Skipped tasks never start.
- Tasks on unrelated branches keep running and are allowed to finish, so a failure wastes as little work as possible. Tasks already running when a failure happens are not interrupted.
- The run ends as `failed`. A run is `success` only if every task succeeded; a skipped task alone is enough to make it `failed`. The run page shows a red banner listing the failed tasks and how many were skipped.
- There are no automatic retries: a failure is reported, not hidden. The alternative (stopping everything on the first failure) is simpler but throws away independent work; the chosen policy is closer to what CI systems do.
- If something other than a task breaks while running (for example the database becomes unreachable), the worker tries to close the run out as `failed` (running tasks `failed`, unstarted tasks `skipped`) rather than leaving it in progress.

### The concurrency limit

- The limit is per run: at most `TASK_CONCURRENCY` (default 3) tasks of one run execute at once. Each worker also executes at most `RUN_CONCURRENCY` (default 2) runs at once, so one worker runs at most 6 tasks at a time with the defaults.
- Capacity grows by adding workers (`docker compose up --scale worker=3`); runs are claimed atomically, so workers do not collide.
- It is a local limit, not a global one: there is no cluster-wide cap, no per-pipeline limit and no fairness between pipelines. The queue is plain FIFO. A global cap would need a shared counter or semaphore in Redis.
- Because tasks are simulated timers, the limit exists to demonstrate scheduling behaviour rather than to protect real resources.

### How the UI gets live updates

- The API exposes Server-Sent Events. The worker publishes small "this run/task changed" events to a Redis pub/sub channel; each API process subscribes once and forwards them to every connected browser.
- SSE fits because traffic is one-way (server to browser), it is plain HTTP, and the browser reconnects by itself. WebSockets would add a bidirectional channel nothing here needs.
- Events are only hints. The page reacts by refetching the pipeline or run from the API (debounced by 100 ms), so the database stays the single source of truth and an out-of-order or duplicate event cannot show wrong state. The cost is an extra HTTP request per burst of events instead of applying patches directly.
- Redis pub/sub does not store messages, so events sent while a browser is disconnected are lost. When the connection is restored the page reloads its data ("resync"). A short "Live / Reconnecting" indicator shows the connection state.
- Every browser receives every event and filters client-side. That is fine locally but would need per-run subscriptions or authentication at scale.
- The browser talks to the API directly (CORS is open for local use) rather than through the Nuxt server, which avoids proxies buffering the event stream.

### What happens if the worker crashes mid-run

- While a worker executes a run it refreshes the run's heartbeat every 2 seconds. Every worker periodically (every 5 seconds) looks for running runs whose heartbeat is older than 15 seconds.
- Such a run is marked `failed` with the reason "The worker stopped before this run finished"; its running tasks become `failed` and its not-yet-started tasks become `skipped`. This was verified by killing the worker container mid-run: the UI shows `running` until the heartbeat goes stale (up to about 20 seconds), then `failed`.
- The run is deliberately not retried automatically: a task may have had side effects before the crash, and the system cannot know whether re-running it is safe. The user can start a new run.
- Consequences: detection is not instant, and if every worker is down nothing can detect it, so the run keeps showing `running` until a worker returns. A worker that is stopped normally (SIGTERM) stops taking new runs and gets 30 seconds to finish its active ones.
- Queued work survives too. Redis uses append-only persistence, and the database is the source of truth: workers re-push any run that is still `queued` in Postgres but missing from the Redis queue (for example after the API died between saving a run and enqueuing it, or after Redis lost its data). Runs queued while the worker is down are picked up when it returns; this was verified as well.

### Other decisions

- Pipelines cannot be edited after creation (runs reference tasks by id, and immutability avoids ambiguous history).
- Task names are unique within a pipeline and used as the keys in the API.
- There is no authentication or user model; "their pipelines" means all pipelines on this instance.
- Migrations are plain SQL files run by a small script with an advisory lock, instead of adding a migration framework.

## What I would improve with more time

- Retries with backoff per task, task timeouts, cancelling a run, and "re-run failed tasks only".
- Resume interrupted runs safely, which needs idempotent tasks or per-task checkpoints.
- A Redis Streams queue with consumer groups and acknowledgements instead of a list plus a database sweep.
- A global concurrency limit and fair scheduling between pipelines; per-task resource limits.
- SSE event ids with `Last-Event-ID` replay so reconnecting clients receive missed events instead of refetching everything; per-run subscriptions.
- Authentication and per-user pipelines; locking down CORS.
- Pipeline versioning and editing; pagination for pipelines and runs.
- A graph view of the pipeline and run, and per-task logs.
- Integration tests against real Postgres and Redis (for example with Testcontainers), API-level tests, browser tests and CI.
- Metrics and structured logging for queue depth, run durations and recovery events.
