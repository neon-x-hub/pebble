import { Duplex } from "node:stream";

export function makeDuplexPair(): [Duplex, Duplex] {
  const streamAtoB = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      streamB.push(chunk);
      callback();
    },
  });

  const streamB = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      streamAtoB.push(chunk);
      callback();
    },
  });

  return [streamAtoB, streamB];
}
