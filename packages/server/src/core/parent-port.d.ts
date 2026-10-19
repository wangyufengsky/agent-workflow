// Set by Electron when this process runs as a utilityProcess; undefined under plain Node.
declare namespace NodeJS {
  interface Process {
    parentPort?: { postMessage(message: unknown): void };
  }
}
