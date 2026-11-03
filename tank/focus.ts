// DECSET 1004 focus reporting: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
export const FOCUS_ENABLE = "\x1b[?1004h";
export const FOCUS_DISABLE = "\x1b[?1004l";
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

/** Finds focus reports in raw terminal input. Reports can straddle chunks, so the unmatched tail is kept. */
export class FocusParser {
    private buffer = "";

    feed(chunk: string): ("in" | "out")[] {
        this.buffer += chunk;
        const events: ("in" | "out")[] = [];
        let index = 0;
        while (index + FOCUS_IN.length <= this.buffer.length) {
            if (this.buffer.startsWith(FOCUS_IN, index)) {
                events.push("in");
                index += FOCUS_IN.length;
            } else if (this.buffer.startsWith(FOCUS_OUT, index)) {
                events.push("out");
                index += FOCUS_OUT.length;
            } else {
                index++;
            }
        }
        this.buffer = this.buffer.slice(index);
        return events;
    }
}
