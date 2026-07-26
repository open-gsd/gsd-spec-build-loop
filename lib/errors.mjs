export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message) {
    super(message, 2);
  }
}

export class BlockedError extends CliError {
  constructor(message) {
    super(message, 3);
  }
}
