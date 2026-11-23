/** A least-recently-used cache with a fixed capacity. */
export class LRUCache {
  constructor(capacity) {
    if (!(capacity > 0)) throw new Error("capacity must be positive");
    this.capacity = capacity;
    this.map = new Map();
  }
  get(key) {
    return this.map.get(key);
  }
  has(key) {
    return this.map.has(key);
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value);
    return this;
  }
  get size() {
    return this.map.size;
  }
}
