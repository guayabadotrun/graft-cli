// Programmatic entry point for @guayaba/graft-cli.
//
// This is intentionally tiny right now: it only re-exports the package
// version so consumers (and the CLI itself) have a single source of truth.
// Workspace parsers, prompt definitions and the GRAFT builder will be
// added here as separate exports in the next iterations.

export const VERSION = '0.0.1';
