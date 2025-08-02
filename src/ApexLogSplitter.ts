type LogCallback = (log: string) => void | Promise<void>;

class ApexLogSplitter {
    private currentLog: string[] = [];
    private onLogCallback?: LogCallback;
    private hasFoundFirstLog: boolean = false;

    constructor(onLog?: LogCallback) {
        this.onLogCallback = onLog;
    }

    private isLogStart(line: string): boolean {
        // Pattern: version number followed by debug level configuration
        // e.g., "64.0 APEX_CODE,FINEST;APEX_PROFILING,INFO;..."
        const logStartPattern = /^\d+\.\d+\s+APEX_CODE,/;
        return logStartPattern.test(line);
    }

    public processLine(line: string): void {
        if (this.isLogStart(line)) {
            // If we have a current log and we have already passed the first log header, emit it.
            if (this.hasFoundFirstLog && this.currentLog.length > 0) {
                const completedLog = this.currentLog.join('\n');
                // Emit the completed log immediately
                if (this.onLogCallback) {
                    this.onLogCallback(completedLog);
                }
            }
            // Start new log
            this.currentLog = [line];
            this.hasFoundFirstLog = true; // Mark that we've found at least one log header
        } else if (this.hasFoundFirstLog) {
            // Only add lines if we have found the start of a log.
            // This prevents collecting garbage/empty lines from before the first log.
            this.currentLog.push(line);
        }
    }

    public finalize(): void {
        // Emit the last log if it exists
        if (this.currentLog.length > 0) {
            const lastLog = this.currentLog.join('\n');
            if (this.onLogCallback) {
                this.onLogCallback(lastLog);
            }
        }
    }

    public setOnLogCallback(callback: LogCallback): void {
        this.onLogCallback = callback;
    }

    public reset(): void {
        this.currentLog = [];
        this.hasFoundFirstLog = false;
    }
}

export {
    ApexLogSplitter,
    LogCallback
};
