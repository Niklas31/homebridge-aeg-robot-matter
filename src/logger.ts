import type { Logger } from 'homebridge';

export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error'
}

export class PrefixLogger {
    debugLevel: LogLevel = LogLevel.DEBUG;

    constructor(readonly delegate: Logger | PrefixLogger, readonly prefix?: string) {}

    get logName(): string {
        return this.prefix ?? '';
    }

    set logName(_logName: string) {
        // Homebridge does not expose mutable logger names.
    }

    get logLevel(): LogLevel {
        return LogLevel.DEBUG;
    }

    set logLevel(_logLevel: LogLevel) {
        // Homebridge controls log levels globally.
    }

    debug(message: string, ...parameters: unknown[]): void {
        this.log(LogLevel.DEBUG, message, ...parameters);
    }

    info(message: string, ...parameters: unknown[]): void {
        this.log(LogLevel.INFO, message, ...parameters);
    }

    warn(message: string, ...parameters: unknown[]): void {
        this.log(LogLevel.WARN, message, ...parameters);
    }

    error(message: string, ...parameters: unknown[]): void {
        this.log(LogLevel.ERROR, message, ...parameters);
    }

    log(level: LogLevel, message: string, ...parameters: unknown[]): void {
        if (level === LogLevel.DEBUG) level = this.debugLevel;
        const text = this.prefix ? `[${this.prefix}] ${message}` : message;
        switch (level) {
        case LogLevel.DEBUG: this.delegate.debug(text, ...parameters); break;
        case LogLevel.INFO:  this.delegate.info(text,  ...parameters); break;
        case LogLevel.WARN:  this.delegate.warn(text,  ...parameters); break;
        case LogLevel.ERROR: this.delegate.error(text, ...parameters); break;
        }
    }

    logDebugAsInfo(): void {
        this.debugLevel = LogLevel.INFO;
    }

    static addApplianceId(_applianceId: string, _name?: string): void {
        // Kept for compatibility with the shared Electrolux API layer.
    }
}

export type AnsiLogger = PrefixLogger;
