#!/bin/sh
# Battery for realm-which-change. L1: every view answers BY NAME without an error.
#
#   APPLIANCE=http://127.0.0.1:11043 AUTH=user:pass sh tests/verify.sh
#
# This realm adds no data of its own: its views join a cluster's pods and logs, a log store, a
# repository's source and its history. WatchedServices always runs. The rest run only when the
# environment names a service they can reach, and are otherwise reported as SKIP:
#   NAMESPACE, APP, REPO (owner/repo)   WhatBrokeInProduction, RunningVersions (a reachable cluster)
#   SERVICE, REPO                       WhatBrokeFromLogs, StartupFailureFromLogs, PoolExhaustionCause (a log store)
#   PROJECT (repo URL @ full sha)       ConnectionHeldAcrossRemoteCall, StartupFailureCause, FailuresAndTheirChanges
#   FINGERPRINT, PROJECT                WhichChange
# The last line on success is exactly `ALL CHECKS PASS`; any failure exits nonzero.
set -e
cd "$(dirname "$0")/.."
exec python3 tests/verify.py "$@"
