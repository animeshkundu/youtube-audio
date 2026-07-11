export interface LyricLine {
  time: number;
  text: string;
}

const TIMESTAMP = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(value: string): readonly LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(TIMESTAMP)];
    if (timestamps.length === 0) continue;
    const text = rawLine.replace(TIMESTAMP, '').trim();
    if (!text) continue;
    for (const match of timestamps) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) continue;
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      const time = minutes * 60 + seconds + fraction;
      if (Number.isFinite(time)) lines.push({ time, text });
    }
  }
  return lines.sort((left, right) => left.time - right.time);
}
