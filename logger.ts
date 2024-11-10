type LogHandler = typeof console.log;

export class Logger {
  private readonly obj: Record<string, unknown>;
  constructor(public readonly name: string, obj?: Record<string, unknown>) {
    if (!obj) obj = {};
    this.obj = { ...obj, name };
  }

  private log(
    handler: LogHandler,
    message: string,
    obj?: Record<string, unknown>,
  ) {
    const o = obj || {};
    handler({
      ts: Date.now(),
      message,
      ...this.obj,
      ...o,
    });
  }

  debug(message: string, obj?: Record<string, unknown>) {
    this.log(console.debug, message, obj);
  }

  info(message: string, obj?: Record<string, unknown>) {
    this.log(console.info, message, obj);
  }

  warn(message: string, obj?: Record<string, unknown>) {
    this.log(console.warn, message, obj);
  }

  error(message: string, obj?: Record<string, unknown>) {
    this.log(console.error, message, obj);
  }

  sub(name: string, obj?: Record<string, unknown>) {
    if (!obj) obj = {};
    return new Logger(this.name + "." + name, { ...this.obj, ...obj });
  }
}
