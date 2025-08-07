export class IdGenerator {
    private padding: number;
    private counter: number;

    constructor(padding = 5) {
        this.padding = padding;
        this.counter = 0;
    }

    next() {
        this.counter++;
        return `${this.counter.toString().padStart(this.padding, '0')}`;
    }

    reset() {
        this.counter = 0;
    }
}
