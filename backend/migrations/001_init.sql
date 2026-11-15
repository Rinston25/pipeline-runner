-- Pipeline definitions. A pipeline is immutable once created; runs snapshot its tasks.
CREATE TABLE pipelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id  uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- Simulated work: how long the task "runs" and whether it should fail.
  duration_ms  integer NOT NULL DEFAULT 1000 CHECK (duration_ms >= 0),
  should_fail  boolean NOT NULL DEFAULT false,
  UNIQUE (pipeline_id, name)
);

-- Edge "task_id depends on depends_on_task_id".
CREATE TABLE task_dependencies (
  task_id             uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

-- One execution of a pipeline.
-- queued -> running -> success | failed
CREATE TABLE runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'success', 'failed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  -- Refreshed by the worker while it executes the run; used to detect crashes.
  heartbeat_at  timestamptz,
  -- Run-level problem (for example "worker stopped"); task errors live on run_tasks.
  error         text
);
CREATE INDEX runs_pipeline_created_idx ON runs (pipeline_id, created_at DESC);
CREATE INDEX runs_status_idx ON runs (status);

-- State of each task within a run.
-- pending -> running -> success | failed, or pending -> skipped
CREATE TABLE run_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- Snapshot of the task settings at the moment the run was queued.
  name         text NOT NULL,
  duration_ms  integer NOT NULL,
  should_fail  boolean NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped')),
  started_at   timestamptz,
  finished_at  timestamptz,
  -- Wall-clock time the task actually took.
  elapsed_ms   integer,
  error        text,
  UNIQUE (run_id, task_id)
);
CREATE INDEX run_tasks_run_idx ON run_tasks (run_id);
