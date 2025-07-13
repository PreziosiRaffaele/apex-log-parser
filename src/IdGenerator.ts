export class IdGenerator {
    private prefix: string;
    private padding: number;
    private counter: number;

    constructor(prefix = 'evt', padding = 3) {
        this.prefix = prefix;
        this.padding = padding;
        this.counter = 0;
    }

    next() {
        this.counter++;
        return `${this.prefix}_${this.counter.toString().padStart(this.padding, '0')}`;
    }

    reset() {
        this.counter = 0;
    }
}
