# realm-which-change

> **Experimental.** This realm is new and still changing: types, views and parameters may change without notice, and it has been run on few systems. Check its answers before relying on them.

Which change broke production? One query from a failure in a Java service's logs to:

- the method and line in the application that threw it;
- the commit that last changed that line;
- who wrote it, and whether a coding agent helped;
- the pull request that brought it in.

Nothing is installed in the application. The logs are read where they are, the code from the jar
that shipped, the history from a clone of the repository.

| view | question |
|---|---|
| `WhatBrokeInProduction(namespace, app, repo)` | what the pods of one application are failing with now, each failure traced to the line, the commit, its author and the pull request |
| `WhatBrokeFromLogs(service, repo, window?)` | the same chain from the log store: counted over every event in the hour, day or week, and still there after the pod is gone |
| `StartupFailureFromLogs(service, repo, window?)` | a service that never started: the setting it could not resolve, the bean that needed it, and the change that added it |
| `PoolExhaustionCause(service, repo, window?)` | database pool timeouts, traced past the requests that timed out to the transaction that holds a connection across a remote call |
| `WhichChange(fingerprint, project)` / `FailuresAndTheirChanges(project, logs?, limit?)` | one failure, or every failure, from log files the world holds |
| `StartupFailureCause(project, fingerprint?)`, `ConnectionHeldAcrossRemoteCall(project)` | the startup and pool chains over log files, by project |
| `RunningVersions(namespace, app, repo)` | which commit each version of the pods is: how many pods, ready, crash-looping, and who wrote it |
| `WatchedServices` | the services this world watches |

`repo` is `owner/repo` on GitHub. `project` is the repository at the commit that was running:
`https://github.com/owner/repo@<full sha>`. The views that start from the cluster or the log store
find that commit themselves, from the pods' `app.kubernetes.io/version` label.

## It adds no data

Its views join realms that each know one thing, all of which must be installed, with
realm-dev-vocabulary:

| realm | gives |
|---|---|
| realm-kubernetes | the pods, the commit each runs, and their logs |
| realm-elastic-logs | the same logs from the log store, after the pods are gone (optional) |
| realm-jvm-logs | the failure, its stack trace, the frame in the application |
| realm-polyglot-code | the repository's files at that commit, and the declarations in them |
| realm-git | the commit that last changed that line, its author and co-authors |
| realm-github | the pull request that commit came in through |

## What it does not say

The commit that last touched the failing line is where to look first. It is not proof of cause: a
failure can be caused by a change elsewhere. The pull-request hop reads each pull request of the
repository, so it is slow on a repository with many.

## Verified

On PetClinic in a Kubernetes cluster: a change that removed a null check made an endpoint fail. From
the pod logs, `WhichChange` returned `OwnerController.processFindForm`, line 100, six occurrences,
the commit that removed the check (not the later commit that touched the same file), `assisted`
for its `Co-Authored-By` trailer, and pull request #1. `git blame` and GitHub agree.
