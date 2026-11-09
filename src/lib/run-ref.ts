// The short id shown to users next to an error, and attached to every log line of a run, so support can search for it.
export const runRef = (runId: string) => runId.slice(-8);
