# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's [private vulnerability reporting](https://github.com/TriSDec/RepoLens/security/advisories/new) rather than a public issue, and allow a reasonable time to fix before disclosure. Useful reports include steps to reproduce, the browser and version, and the impact you believe it has.

## Scope

RepoLens analyses untrusted input (arbitrary project folders, ZIP archives and saved report files) entirely in the user's browser, so the areas of most interest are:

- anything that lets a project, file name, archive or report file run script in the page, or make the page or the analyzer worker open a network connection;
- anything that makes a secret value appear in a report, export, screenshot or log;
- crashes, hangs or unbounded memory use from crafted input that the file, size, path and time limits should have contained;
- weaknesses in the Content Security Policy or response headers.

## Design summary

- Analysis runs in a Web Worker. The page is served with `connect-src 'none'`; the worker script is served with `default-src 'none'; connect-src 'none'`.
- A per-request nonce with `strict-dynamic` gates all script execution; there are no third-party scripts.
- Imported reports are validated against strict bounds and rebuilt from known fields.
- Credential findings never store the matched value.
- The command-line tool never opens network connections and never follows symbolic links.

See the in-app Privacy & security page for the full description and how to verify it.

## Supported versions

The latest release on the default branch.
