---
name: aw-offline-network
description: Use when a download, package install or network request fails (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, Could not resolve host, 407, certificate errors such as UNABLE_TO_GET_ISSUER_CERT_LOCALLY) or the requirement says the machine is offline or on an intranet. How to keep working without the internet and what never to change to get around it.
---

# Working without the internet

This app often runs on intranet machines: package registries, GitHub and other public sites may be out of reach, or reachable only through the company's mirror and proxy. A network failure is a fact about the environment, not a defect of the project to work around.

## Recognising it

`ENOTFOUND` / `getaddrinfo`, `ECONNREFUSED`, `ETIMEDOUT`, `socket hang up`, `Could not resolve host`, `407 Proxy Authentication Required`, `self-signed certificate in certificate chain`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `npm ERR! network`, Maven's `Could not transfer artifact`, pip's `Could not find a version that satisfies the requirement` after connection errors.

## Never

- Change proxy, certificate, registry or mirror settings (`.npmrc`, `settings.xml`, `pip.conf`, `GOPROXY`, `.gradle` properties, environment variables), or turn off certificate checks (`strict-ssl=false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `--insecure`, `-k`, `trusted-host`).
- Fetch it another way: `curl` or `wget` from the internet, copying a package's source or a binary into the repository.
- Change, skip or delete a test because it failed on the network.

## Instead

1. **Use what is there.** Look at the dependencies the project already has (its lockfile, `node_modules`, the local Maven or Gradle cache, `vendor/`) and at the mirror its configuration points to. Prefer a solution with the existing dependencies and the standard library.
2. **A new dependency that cannot be installed.** When your instructions let you ask, call `agent-workflow_ask_user`: name the package, the version and why it is needed. Otherwise do the step without it if that is possible, and write in your result which package you could not install and what that left out.
3. **A check that needs the network** (tests that call outside services, a build that downloads): run what can run offline, and write in your notes which check could not run, with the error line.
4. **Planning.** Prefer steps that need no new dependencies. When one is unavoidable, say so in the plan's assumptions, so the user can install it before the step runs.

Write what you could not verify plainly in the result; do not report a check as passed when it did not run.
