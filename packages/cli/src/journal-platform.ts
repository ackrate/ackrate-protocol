/** POSIX mode checks and directory fsync are required for local payment recovery. */
export function requireJournalPlatform(): void {
  if (!["linux", "darwin", "freebsd", "openbsd", "netbsd"].includes(process.platform)) {
    throw new Error("Payment file journals require a local POSIX filesystem. On Windows, use Linux/WSL with state in its Linux filesystem, not /mnt/c or /mnt/d. Keep existing journals for recovery; pending operations remain uncertain.");
  }
}
