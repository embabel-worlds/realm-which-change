# realm-which-change

Which change broke production? One query from a failure in a Java service's logs to:

- the method and line in the application that threw it;
- the commit that last changed that line;
- who wrote it, and whether a coding agent helped;
- the pull request that brought it in.

Nothing is installed in the application. The logs are read where they are, the code from the jar
that shipped, the history from a clone of the repository.

| view | question |
|---|---|
| `WhichChange(fingerprint, project, sourceRoot?)` | one failure, traced to the change and its pull request |
| `FailuresAndTheirChanges(project, sourceRoot?, logs?, limit?)` | every failure with a line in the application's code, and the change behind each |

`project` is the repository at the commit that was running:
`https://github.com/owner/repo@<full sha>`. `fingerprint` comes from realm-jvm-logs' `JvmLogFailures`.

## It adds no data

Its views join three realms, all of which must be installed, with realm-dev-vocabulary:

| realm | gives |
|---|---|
| realm-jvm-logs (with realm-java-code and realm-java-source-code) | the failure, the frame in the application, its line |
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
