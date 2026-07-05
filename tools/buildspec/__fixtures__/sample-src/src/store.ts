// @novakai-node store kind=class
export class Store {
  value!: number;
  get(): number { throw new Error('unimplemented'); }
  set(_v: number): void { throw new Error('unimplemented'); }
  private _secret(): void { throw new Error('unimplemented'); }
}
