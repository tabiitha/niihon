/** One server-sent event, with its `data` parsed as JSON. */
export interface StreamEvent {
  readonly event: string;
  readonly id: string | undefined;
  readonly data: any;
}

export interface EventStreamClient {
  readonly status: number;
  readonly headers: Headers;
  /** The error body of a refused subscription. */
  readonly error: any;
  /** `retry:` values received so far. */
  readonly retries: number[];
  /** Comment lines received so far, such as heartbeats. */
  readonly comments: string[];
  /** The next event, or `undefined` once the server ended the stream; fails after `timeoutMs`. */
  next(timeoutMs?: number): Promise<StreamEvent | undefined>;
  /** Resolves `undefined` when nothing arrives within `ms`, and fails when an event does. */
  quiet(ms: number): Promise<void>;
  close(): void;
}

/** Subscribes with `fetch` and parses the `text/event-stream` answer, as a test client. */
export async function openEventStream(url: string, headers: Record<string, string> = {}): Promise<EventStreamClient> {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const retries: number[] = [];
  const comments: string[] = [];
  if (response.status !== 200) {
    return {
      status: response.status,
      headers: response.headers,
      error: await response.json(),
      retries,
      comments,
      next: () => Promise.reject(new Error('The subscription was refused.')),
      quiet: () => Promise.reject(new Error('The subscription was refused.')),
      close: () => controller.abort(),
    };
  }

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = '';
  let done = false;
  let reading: Promise<void> | undefined;

  /** Reads one more chunk, moving complete events from the buffer to `events`. */
  const readMore = () =>
    (reading ??= reader.read().then(
      ({ value, done: finished }) => {
        reading = undefined;
        done = finished;
        buffer += decoder.decode(value, { stream: !finished });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const fields = new Map<string, string>();
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) {
              comments.push(line.slice(1).trim());
              continue;
            }
            const colon = line.indexOf(':');
            fields.set(line.slice(0, colon), line.slice(colon + 1).trimStart());
          }
          if (fields.has('retry')) {
            retries.push(Number(fields.get('retry')));
          }
          if (fields.has('event')) {
            const data = fields.get('data');
            events.push({ event: fields.get('event') as string, id: fields.get('id'), data: data === undefined ? undefined : JSON.parse(data) });
          }
        }
      },
      () => {
        reading = undefined;
        done = true;
      },
    ));

  const timeout = (ms: number) => new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms).unref());

  return {
    status: 200,
    headers: response.headers,
    error: undefined,
    retries,
    comments,
    async next(timeoutMs = 2_000) {
      const deadline = timeout(timeoutMs);
      while (events.length === 0 && !done) {
        if ((await Promise.race([readMore(), deadline])) === 'timeout') {
          throw new Error(`No event within ${timeoutMs} ms.`);
        }
      }
      return events.shift();
    },
    async quiet(ms) {
      const deadline = timeout(ms);
      while (events.length === 0 && !done) {
        if ((await Promise.race([readMore(), deadline])) === 'timeout') {
          return;
        }
      }
      throw new Error(done ? 'The stream ended.' : `Unexpected event ${JSON.stringify(events[0])}.`);
    },
    close: () => controller.abort(),
  };
}
