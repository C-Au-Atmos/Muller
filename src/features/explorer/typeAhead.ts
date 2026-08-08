export interface TypeAheadBuffer {
  buffer: string;
  lastInputAt: number;
}

export interface TypeAheadInput {
  state: TypeAheadBuffer;
  query: string;
}

export function updateTypeAheadBuffer(
  current: TypeAheadBuffer,
  character: string,
  now: number,
  timeoutMs = 1000,
): TypeAheadInput {
  const folded = character.toLocaleLowerCase();
  const buffer = now - current.lastInputAt > timeoutMs ? folded : current.buffer + folded;
  const repeated = [...buffer].every((value) => value === folded);
  return {
    state: { buffer, lastInputAt: now },
    query: repeated ? folded : buffer,
  };
}
